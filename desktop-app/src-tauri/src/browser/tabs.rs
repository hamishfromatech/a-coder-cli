//! Page views: one native child webview per browser tab. Tabs are created,
//! moved to the panel's reported bounds, parked off-window (so their snapshot
//! keeps painting) or closed; the panel drives each step by command.
//!
//! Everything the panel learns about a page flows back on one event channel:
//! loads, titles, pushState URLs and history, handoffs (mailto: etc.), and
//! targets of `_blank` links (which open as tabs; the popup itself is denied).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PageLoadPayload};
use tauri::{
	AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Runtime, State, Url, Webview,
	WebviewBuilder, WebviewUrl,
};

use super::security::{is_external_handoff, navigation_allowed, page_url, reportable};
use super::{emit, require_main, BrowserEvent, ViewBounds};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect, NSSize};

/// The app's webview, the only caller browser commands answer.
pub(crate) const MAIN_LABEL: &str = "main";
/// Child labels start with this, and pages keep their event channel here.
pub(crate) const LABEL_PREFIX: &str = "browser-page-";
pub(crate) const EVENT_NAME: &str = "desktop://browser";
/// How often the shown page's address is re-read while it is open.
const URL_POLL: Duration = Duration::from_millis(800);
/// How far left of the window a parked page sits, in logical pixels.
const PARK_GAP: f64 = 64.0;
/// Fixed macOS data store for pages, so their storage persists as a profile.
#[cfg(target_os = "macos")]
const PAGE_DATA_STORE: [u8; 16] = *b"a-coder-browser1";

/// Whether pages open in native child webviews here: macOS 14+ (per-webview
/// proxy routing and the fixed data store) and Windows (proxy via browser
/// args). Linux's Tauri packs child webviews into the window's GtkBox, which
/// ignores bounds, so the panel falls back to proxied frames there.
#[tauri::command]
pub fn browser_supported() -> bool {
	native_pages_supported()
}

pub(crate) fn native_pages_supported() -> bool {
	#[cfg(target_os = "macos")]
	return macos().is_some_and(|(major, _)| major >= 14);
	#[cfg(windows)]
	return true;
	#[cfg(not(any(target_os = "macos", windows)))]
	return false;
}

#[cfg(target_os = "macos")]
/// The macOS version as (major, minor), read once from the system plist.
fn macos() -> Option<(u64, u64)> {
	static VERSION: OnceLock<Option<(u64, u64)>> = OnceLock::new();
	VERSION
		.get_or_init(|| {
			let text =
				std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist").ok()?;
			parse_product_version(&text)
		})
		.to_owned()
}

/// The `ProductVersion` (e.g. 14.6.1) of a `SystemVersion.plist`-shaped plist.
fn parse_product_version(plist: &str) -> Option<(u64, u64)> {
	let at = plist.find("<key>ProductVersion</key>")?;
	let after = &plist[at..];
	let start = after.find("<string>")? + "<string>".len();
	let end = start + after[start..].find("</string>")?;
	let version = after.get(start..end)?.trim();
	let mut parts = version.split('.');
	let major = parts.next()?.parse::<u64>().ok()?;
	let minor = parts
		.next()
		.map(|p| p.parse::<u64>().ok())
		.flatten()
		.unwrap_or(0);
	Some((major, minor))
}

/// Whether pages sit under the panel's UI (the macOS compositing model); the
/// panel asks once per load, which also drops input state a reload left behind.
#[tauri::command]
pub fn browser_layered<R: Runtime>(webview: Webview<R>) -> Result<bool, String> {
	require_main(&webview)?;
	#[cfg(target_os = "macos")]
	{
		if super::layer::set_input(false, &[]) {
			let _ = webview.run_on_main_thread(super::layer::reroute_moves);
		}
		return Ok(native_pages_supported());
	}
	#[cfg(not(target_os = "macos"))]
	Ok(false)
}

/// The panel UI over the page: all of it while a menu or dialog is open, else
/// just the clickable rects (toolbar buttons, tabs), so clicks fall through to
/// the page everywhere else. No-op off macOS, where the model differs.
#[tauri::command]
pub fn browser_set_page_input<R: Runtime>(
	webview: Webview<R>,
	blocked: bool,
	exclude: Vec<ViewBounds>,
) -> Result<(), String> {
	require_main(&webview)?;
	#[cfg(target_os = "macos")]
	{
		if super::layer::set_input(blocked, &exclude) {
			let _ = webview.run_on_main_thread(super::layer::reroute_moves);
		}
		return Ok(());
	}
	#[cfg(not(target_os = "macos"))]
	{
		let _ = (blocked, exclude);
		Ok(())
	}
}

/// Every open tab, for the panel to restore its bar after a reload.
#[tauri::command]
pub fn browser_tab_list<R: Runtime>(webview: Webview<R>) -> Result<Vec<TabInfo>, String> {
	require_main(&webview)?;
	let app = webview.app_handle();
	let state_handle = app.state::<TabsState>();
	let state = state_handle.inner.lock().unwrap();
	let mut infos: Vec<TabInfo> = state
		.created
		.iter()
		.map(|tab_id| TabInfo {
			tab_id: tab_id.clone(),
			url: state.urls.get(tab_id).cloned(),
			title: state.titles.get(tab_id).cloned().unwrap_or_default(),
		})
		.collect();
	// Creation order, so the restored bar keeps its order.
	infos.sort_by_key(|info| {
		info.tab_id
			.split('t')
			.next_back()
			.and_then(|n| n.parse::<u64>().ok())
			.unwrap_or(0)
	});
	Ok(infos)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
	pub tab_id: String,
	pub url: Option<String>,
	pub title: String,
}

#[derive(Default)]
pub struct TabsState {
	pub(crate) inner: Mutex<Inner>,
}

#[derive(Default)]
pub(crate) struct Inner {
	/// tab ids with a live view (or just opened).
	pub(crate) created: HashSet<String>,
	pub(crate) titles: HashMap<String, String>,
	pub(crate) urls: HashMap<String, String>,
	/// Per tab: the visited stack and the position in it, for the panel's
	/// back/forward offers.
	pub(crate) history: HashMap<String, Hist>,
	pub(crate) shown: Option<String>,
	pub(crate) muted: HashSet<String>,
	/// Whether the page's first navigation (a commit) happened, for downloads' site.
	pub(crate) committed: HashSet<String>,
	pub(crate) polling: bool,
	/// Opening tab with no bounds yet: the panel calls openTab before its
	/// bounds are measured, so the reserved address is shown once the first
	/// bounds-driven view_show arrives.
	pub(crate) pending_url: HashMap<String, String>,
	/// Per tab: the last event's ordinal, handed out under the inner lock so
	/// interleaved commit tasks keep their per-tab numbering monotonic.
	pub(crate) event_seq: HashMap<String, u64>,
}

/// Bumps and returns the tab's event sequence. Call sites finish their state
/// work under one lock scope and emit after dropping it.
fn next_seq(inner: &mut Inner, tab_id: &str) -> u64 {
	let seq = inner.event_seq.entry(tab_id.to_string()).or_default();
	*seq += 1;
	*seq
}

/// The visited stack per tab: urls plus the current position. Capped, so an
/// old tab's memory stays bounded; the back button just runs out early.
#[derive(Clone, Default)]
pub(crate) struct Hist {
	pub(crate) entries: Vec<String>,
	pub(crate) index: usize,
}

const MAX_HISTORY: usize = 60;

fn label_for(tab_id: &str) -> String {
	format!("{LABEL_PREFIX}{tab_id}")
}

fn tab_of_label(label: &str) -> Option<String> {
	label.strip_prefix(LABEL_PREFIX).map(str::to_string)
}

fn view<R: Runtime>(app: &AppHandle<R>, tab_id: &str) -> Result<Webview<R>, String> {
	app.get_webview(&label_for(tab_id))
		.ok_or_else(|| "That tab is closed".to_string())
}

fn next_tab_id() -> String {
	// A counter (not a clock), so ids sort in creation order for the tab bar.
	static COUNTER: AtomicU64 = AtomicU64::new(1);
	format!("t{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Open a tab at `url` (creating its view now) positioned in `bounds`; returns
/// the new tab id.
#[tauri::command]
pub async fn browser_open_tab<R: Runtime>(
	webview: Webview<R>,
	state: State<'_, TabsState>,
	url: Option<String>,
	bounds: Option<ViewBounds>,
) -> Result<String, String> {
	require_main(&webview)?;
	log::info!("open_tab called: url={url:?} bounds={bounds:?}");
	let tab_id = next_tab_id();
	if bounds.is_none() {
		if let Some(address) = url.as_deref() {
			state
				.inner
				.lock()
				.unwrap()
				.pending_url
				.insert(tab_id.clone(), address.to_string());
		}
	}
	browser_view_show(
		webview,
		state,
		Some(tab_id.clone()),
		url,
		bounds,
		Some(false),
	)
	.await?;
	Ok(tab_id)
}

/// Show a tab's page at `bounds` (created at `url` first time) and hide the
/// rest; `None` for `tab_id` hides all. `parked` moves the page just
/// off-window instead of hiding it, so its snapshot stays alive.
#[tauri::command]
pub async fn browser_view_show<R: Runtime>(
	webview: Webview<R>,
	state: State<'_, TabsState>,
	tab_id: Option<String>,
	url: Option<String>,
	bounds: Option<ViewBounds>,
	parked: Option<bool>,
) -> Result<(), String> {
	require_main(&webview)?;
	log::info!(
		"view_show called: tab={tab_id:?} url={url:?} bounds={:?}",
		bounds.as_ref().map(|b| b.parts())
	);
	let app = webview.app_handle().clone();
	let parked = parked.unwrap_or(false);
	let target = match (&tab_id, &bounds) {
		(Some(tab_id), Some(bounds)) => Some(match app.get_webview(&label_for(tab_id)) {
			Some(view) => {
				let (mut position, size, scale) = logical_rect(&webview, bounds)?;
				if parked {
					position.x = -size.width - PARK_GAP;
				}
				view.set_bounds(Rect {
					position: position.into(),
					size: size.into(),
				})
				.map_err(|error| error.to_string())?;
				#[cfg(target_os = "macos")]
				sync_frame(&view.clone(), position, size, scale);
				view
			}
			None if parked => return Err("no page to park".into()),
			None => {
				// The opening tab's address may be reserved for the first bounds-
				// driven show (openTab ran before the panel measured its bounds,
				// so it arrived with url + no bounds).
				let reserved = state.inner.lock().unwrap().pending_url.remove(tab_id);
				let url = match (url.as_deref(), reserved) {
					(Some(address), _) => parse_page_url(address)?,
					(None, Some(reserved)) => parse_page_url(&reserved)?,
					(None, None) => return Err("no address to open".into()),
				};
				#[cfg(target_os = "macos")]
				super::layer::install(&webview);
				open_view(&webview, &state, tab_id, url, *bounds)?
			}
		}),
		_ => None,
	};
	let shown = tab_id.filter(|_| target.is_some());
	// A resize only moves the shown view; showing it and hiding the others is
	// for a switch.
	if state.inner.lock().unwrap().shown == shown {
		return Ok(());
	}
	if let Some(view) = &target {
		view.show().map_err(|error| error.to_string())?;
	}
	// Hide only the OTHER PAGE views: app.webviews() also holds the main
	// app webview, and hiding it blacks out the whole UI around the page.
	for (label, view) in app
		.webviews()
		.into_iter()
		.filter(|(label, _)| label.starts_with(LABEL_PREFIX))
	{
		if Some(label.as_str()) != target.as_ref().map(|view| view.label()) {
			let _ = view.hide();
		}
	}
	state.inner.lock().unwrap().shown = shown.clone();
	start_url_poll(&app);
	Ok(())
}

#[tauri::command]
pub fn browser_navigate_tab<R: Runtime>(
	webview: Webview<R>,
	tab_id: String,
	url: String,
) -> Result<(), String> {
	require_main(&webview)?;
	tauri::async_runtime::block_on(navigate_tab(webview.app_handle(), &tab_id, &url))
}

/// The navigate core, shared with the agent's MCP server.
pub(crate) async fn navigate_tab<R: Runtime>(
	app: &AppHandle<R>,
	tab_id: &str,
	url: &str,
) -> Result<(), String> {
	let nav = parse_page_url(url)?;
	let page = app
		.get_webview(&label_for(tab_id))
		.ok_or_else(|| "That tab is closed".to_string())?;
	app.state::<TabsState>()
		.inner
		.lock()
		.unwrap()
		.urls
		.remove(tab_id);
	page.navigate(nav).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_tab_action<R: Runtime>(
	webview: Webview<R>,
	tab_id: String,
	action: String,
) -> Result<(), String> {
	require_main(&webview)?;
	let page = view(webview.app_handle(), &tab_id)?;
	let result = match action.as_str() {
		"back" | "forward" => {
			// Move the stack position optimistically: the panel's offers flip
			// right away, and the commit dedups against the new position.
			let (was, offers, seq) = {
				let state = webview.app_handle().state::<TabsState>();
				let mut inner = state.inner.lock().unwrap();
				let was = inner
					.history
					.get(&tab_id)
					.map(offers_of)
					.unwrap_or((false, false));
				if let Some(hist) = inner.history.get_mut(&tab_id) {
					if action == "back" && hist.index > 0 {
						hist.index -= 1;
					} else if action == "forward" && hist.index + 1 < hist.entries.len() {
						hist.index += 1;
					}
				}
				let offers = inner
					.history
					.get(&tab_id)
					.map(offers_of)
					.unwrap_or((false, false));
				let seq = next_seq(&mut inner, &tab_id);
				(was, offers, seq)
			};
			if was != offers {
				emit(
					webview.app_handle(),
					BrowserEvent::History {
						tab_id: tab_id.clone(),
						back: offers.0,
						forward: offers.1,
						seq,
					},
				);
			}
			let direction = if action == "back" {
				"back()"
			} else {
				"forward()"
			};
			page.eval(&format!("history.{direction}"))
		}
		"reload" => page.reload(),
		"stop" => page.eval("window.stop()"),
		"focus" => page.set_focus(),
		// Key focus back to the panel, e.g. for the find bar.
		"blur" => webview.set_focus(),
		_ => return Err("unknown action".into()),
	};
	result.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_set_tab_zoom<R: Runtime>(
	webview: Webview<R>,
	tab_id: String,
	zoom: f64,
) -> Result<(), String> {
	require_main(&webview)?;
	if !(0.25..=5.0).contains(&zoom) {
		return Err("zoom out of range".into());
	}
	view(webview.app_handle(), &tab_id)?
		.set_zoom(zoom)
		.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_close_tab<R: Runtime>(
	webview: Webview<R>,
	state: State<'_, TabsState>,
	tab_id: String,
) -> Result<(), String> {
	require_main(&webview)?;
	let app = webview.app_handle().clone();
	{
		let mut inner = state.inner.lock().unwrap();
		inner.created.remove(&tab_id);
		inner.titles.remove(&tab_id);
		inner.urls.remove(&tab_id);
		inner.history.remove(&tab_id);
		inner.muted.remove(&tab_id);
		inner.pending_url.remove(&tab_id);
		if inner.shown.as_deref() == Some(tab_id.as_str()) {
			inner.shown = None;
		}
	}
	emit(
		&app,
		BrowserEvent::Closed {
			tab_id: tab_id.clone(),
		},
	);
	// A tab the panel is forgetting (its view may already be gone) is fine.
	if let Some(page) = app.get_webview(&label_for(&tab_id)) {
		super::downloads::forget_tab(&app, &tab_id);
		page.close().map_err(|error| error.to_string())?;
	}
	Ok(())
}

/// Find forward or backward from the last position; true when found.
#[tauri::command]
pub async fn browser_find_in_page<R: Runtime>(
	webview: Webview<R>,
	tab_id: String,
	query: String,
	backwards: bool,
) -> Result<bool, String> {
	require_main(&webview)?;
	if query.is_empty() || query.len() > 1000 {
		return Ok(false);
	}
	let page = view(webview.app_handle(), &tab_id)?;
	let query = serde_json::to_string(&query).map_err(|error| error.to_string())?;
	let script = format!(
		"(() => {{ try {{ return Boolean(window.find({query}, false, {backwards}, true, false, false, false)); }} catch {{ return false; }} }})()"
	);
	let (tx, rx) = tokio::sync::oneshot::channel();
	let sender = Mutex::new(Some(tx));
	page.eval_with_callback(script, move |raw| {
		if let Some(tx) = sender.lock().unwrap().take() {
			let _ = tx.send(raw.trim() == "true");
		}
	})
	.map_err(|error| error.to_string())?;
	match tokio::time::timeout(Duration::from_secs(5), rx).await {
		Ok(Ok(found)) => Ok(found),
		Ok(Err(error)) => Err(error.to_string()),
		Err(_) => Err("The page did not answer".into()),
	}
}

// ---- creation ----

fn parse_page_url(input: &str) -> Result<Url, String> {
	let url = page_url(input)?;
	if !reportable(url.as_str()) {
		return Err("Address too long to open".into());
	}
	if !navigation_allowed(&url) {
		return Err("Only public web pages load in the panel".into());
	}
	Ok(url)
}

/// The window's device pixel ratio, so the panel's CSS-pixel bounds can be
/// scaled into window pixels (tauri/wry divide it back out on the way in).
/// NOTE: the window's screen position must NOT enter this math — the child's
/// frame is relative to the window's content view, and adding it (an earlier
/// attempt) pushed every page off by the window's screen origin.
fn caller_scale<R: Runtime>(webview: &Webview<R>) -> Result<f64, String> {
	let window = webview.window();
	let scale = window.scale_factor().map_err(|error| error.to_string())?;
	let inner = window.inner_size().map_err(|error| error.to_string())?;
	let _ = inner;
	Ok(scale)
}

fn logical_rect<R: Runtime>(
	webview: &Webview<R>,
	bounds: &ViewBounds,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>, f64), String> {
	let scale = caller_scale(webview)?;
	Ok((
		LogicalPosition::new(bounds.x * scale, bounds.y * scale),
		LogicalSize::new(
			(bounds.width * scale).max(1.0),
			(bounds.height * scale).max(1.0),
		),
		scale,
	))
}

/// macOS: write the page's frame directly instead of trusting the tauri/wry
/// bounds conversion, which has landed children offset by the window's screen
/// position (observed frame `(origin.x + x, origin.y - y - …)`): the panel's
/// CSS rect maps to AppKit points with the contentView's unflipped math, y
/// growing upward from the bottom.
#[cfg(target_os = "macos")]
fn sync_frame<R: Runtime>(
	view: &Webview<R>,
	position: LogicalPosition<f64>,
	size: LogicalSize<f64>,
	scale: f64,
) {
	let result = view.with_webview(move |platform| {
		// Safety: the page view is live; with_webview runs on the main thread.
		unsafe {
			let node = &*(platform.inner() as *const objc2_app_kit::NSView);
			let Some(parent) = node.superview() else {
				log::warn!("sync_frame: no superview");
				return;
			};
			let height = parent.frame().size.height;
			let x = position.x / scale;
			let y = position.y / scale;
			let width = size.width / scale;
			let frame_height = size.height / scale;
			let frame = NSRect::new(
				NSPoint::new(x, height - y - frame_height),
				NSSize::new(width, frame_height),
			);
			node.setFrame(frame);
			log::info!(
				"sync_frame: pos=({:.1},{:.1}) size=({:.1},{:.1}) parent_h={:.1} -> frame=({:.1},{:.1})",
				position.x,
				position.y,
				size.width,
				size.height,
				height,
				frame.origin.x,
				frame.origin.y
			);
		}
	});
	if let Err(error) = &result {
		log::warn!("sync_frame dispatch failed: {error}");
	}
}

/// Open (create) a tab's page view.
fn open_view<R: Runtime>(
	caller: &Webview<R>,
	state: &State<'_, TabsState>,
	tab_id: &str,
	url: Url,
	bounds: ViewBounds,
) -> Result<Webview<R>, String> {
	let label = label_for(tab_id);
	let app = caller.app_handle().clone();
	// Heal the state if a view died without its tab: rebuild from scratch.
	if state.inner.lock().unwrap().created.contains(tab_id) && app.get_webview(&label).is_none() {
		state.inner.lock().unwrap().created.remove(tab_id);
	}
	if state.inner.lock().unwrap().created.contains(tab_id) {
		return app
			.get_webview(&label)
			.ok_or_else(|| "Tab opened but is missing".into());
	}

	let load_tab = tab_id.to_string();
	let page_app = app.clone();
	let nav_app = app.clone();
	let nav_tab = tab_id.to_string();
	let title_app = app.clone();
	let title_tab = tab_id.to_string();
	let window_app = app.clone();
	let window_tab = tab_id.to_string();
	let download_tab = tab_id.to_string();
	let download_app = app.clone();

	// macOS: pages land on about:blank so the proxy and placement are in place
	// before the first request, then the URL is loaded.
	#[cfg(target_os = "macos")]
	let (initial, deferred) = (Url::parse("about:blank").unwrap(), Some(url));
	#[cfg(not(target_os = "macos"))]
	let (initial, deferred): (Url, Option<Url>) = (url, None);

	let builder = WebviewBuilder::new(&label, WebviewUrl::External(initial))
		.on_navigation(move |url| {
			log::info!("page navigation requested: {}", url.as_str());
			if navigation_allowed(url) && reportable(url.as_str()) {
				return true;
			}
			log::info!("page navigation refused: {}", url.as_str());
			if is_external_handoff(url) && reportable(url.as_str()) {
				emit(
					&nav_app,
					BrowserEvent::External {
						tab_id: nav_tab.clone(),
						url: url.to_string(),
					},
				);
			}
			false
		})
		.on_page_load(move |page_view, payload| {
			on_page_load(&page_view, payload, &load_tab, &page_app)
		})
		.on_document_title_changed(move |page_view, title| {
			let bounded = bounded_title(&title);
			let event = {
				let state = title_app.state::<TabsState>();
				let mut inner = state.inner.lock().unwrap();
				let seq = next_seq(&mut inner, &title_tab);
				inner.titles.insert(title_tab.clone(), bounded.clone());
				BrowserEvent::Title {
					tab_id: title_tab.clone(),
					title: bounded,
					seq,
				}
			};
			emit(&title_app, event);
		})
		.on_new_window(move |url, _features| {
			if !reportable(url.as_str()) {
				return NewWindowResponse::Deny;
			}
			if navigation_allowed(&url) {
				emit(
					&window_app,
					BrowserEvent::NewTab {
						tab_id: window_tab.clone(),
						url: url.to_string(),
					},
				);
			} else if is_external_handoff(&url) {
				emit(
					&window_app,
					BrowserEvent::External {
						tab_id: window_tab.clone(),
						url: url.to_string(),
					},
				);
			}
			NewWindowResponse::Deny
		})
		.on_download(move |page, event| match event {
			DownloadEvent::Requested { url, destination } => {
				super::downloads::requested(&page, &download_tab, url, destination)
			}
			DownloadEvent::Finished { url, path, success } => {
				super::downloads::finished(&download_app, url.to_string(), path, success);
				true
			}
			_ => false,
		})
		.zoom_hotkeys_enabled(false)
		.devtools(cfg!(debug_assertions))
		.focused(false);
	let builder = with_page_profile(builder, &app)?;

	let (position, size, scale) = logical_rect(caller, &bounds)?;
	let page_view = caller
		.window()
		.add_child(builder, position, size)
		.map_err(|error| error.to_string())?;
	#[cfg(target_os = "macos")]
	{
		super::layer::place(&page_view);
		sync_frame(&page_view, position, size, scale);
	}
	state
		.inner
		.lock()
		.unwrap()
		.created
		.insert(tab_id.to_string());
	if let Some(url) = deferred {
		load_through_proxy(&app, &page_view, url);
	}
	Ok(page_view)
}

fn on_page_load<R: Runtime>(
	page: &Webview<R>,
	payload: PageLoadPayload<'_>,
	tab_id: &str,
	app: &AppHandle<R>,
) {
	if payload.url().scheme() == "about" || !reportable(payload.url().as_str()) {
		return;
	}
	let url = payload.url().to_string();
	let loading = matches!(payload.event(), PageLoadEvent::Started);
	// The state bookkeeping and events happen off the WebKit callback: this
	// handler runs inside the web commit's IPC dispatch on the main thread,
	// and anything blocking (locks) there froze the whole app.
	let app = app.clone();
	let tab_id = tab_id.to_string();
	let page = page.clone();
	let _ = tauri::async_runtime::spawn(async move {
		let state = app.state::<TabsState>();
		let mut events = Vec::new();
		let muted = {
			let mut inner = state.inner.lock().unwrap();
			inner.urls.insert(tab_id.clone(), url.clone());
			// Started is a commit (WebKit) or content loading (WebView2): never
			// a download. Feed the visited stack here, where redirects funnel.
			if loading {
				inner.committed.insert(tab_id.clone());
			}
			events.push(BrowserEvent::Load {
				tab_id: tab_id.clone(),
				url: url.clone(),
				loading,
				seq: next_seq(&mut inner, &tab_id),
			});
			if loading {
				events.extend(commit_offers(&mut inner, &tab_id, &url));
			}
			inner.muted.contains(&tab_id)
		};
		// Emit after the lock drops: the WebKit commit dispatch must never block.
		for event in events {
			emit(&app, event);
		}
		if !loading {
			super::capture::schedule_window_composite_once(&app);
		}
		// A muted tab stays muted through its loads; each page is muted again
		// on commit, since a fresh document has fresh media.
		#[cfg(target_os = "macos")]
		if muted {
			let _ = super::mute::apply(&page, true);
		}
	});
}

/// The page's own profile: its data store (never the app's), and the proxy.
fn with_page_profile<R: Runtime>(
	builder: WebviewBuilder<R>,
	app: &AppHandle<R>,
) -> Result<WebviewBuilder<R>, String> {
	#[cfg(target_os = "macos")]
	{
		let _ = app;
		if !native_pages_supported() {
			return Err("Native pages need macOS 14".into());
		}
		// The proxy is routed after creation, against the fixed data store.
		return Ok(builder.data_store_identifier(PAGE_DATA_STORE));
	}
	#[cfg(windows)]
	{
		let proxy = super::proxy::address()?;
		// These replace wry's defaults, so repeat the ones it sets: they keep
		// Chromium from bypassing the proxy for loopback, and from UI chrome
		// (the PDF viewer) inside tabs.
		return Ok(builder
			.additional_browser_args(&format!(
				"--disable-features=msWebOOUI,msPdfOOUI --proxy-server=http://{proxy} \
				 --proxy-bypass-list=<-loopback>"
			))
			.data_directory(match app.path().app_local_data_dir() {
				Ok(dir) => dir.join("browser-profile"),
				Err(_) => return Err("no profile directory for pages".into()),
			}));
	}
	#[cfg(not(any(target_os = "macos", windows)))]
	{
		let _ = (builder, app);
		Err("Native pages are unsupported on this platform; the panel uses proxied frames".into())
	}
}

fn bounded_title(title: &str) -> String {
	title.chars().take(200).collect()
}

/// Offers of a stack position.
fn offers_of(hist: &Hist) -> (bool, bool) {
	(hist.index > 0, hist.index + 1 < hist.entries.len())
}

/// Records a committed url in the tab's visited stack and tells the panel
/// when its offers change.
fn note_commit<R: Runtime>(app: &AppHandle<R>, tab_id: &str, url: &str) {
	let state = app.state::<TabsState>();
	let event = {
		let mut inner = state.inner.lock().unwrap();
		commit_offers(&mut inner, tab_id, url)
	};
	if let Some(event) = event {
		emit(app, event);
	}
}

/// Stack update on an ALREADY-LOCKED inner (commit paths that hold it): a
/// commit matching the neighbouring entry is a back/forward move; anything
/// else is a fresh navigation that cuts the forward tail (back works,
/// forward dies, like real browsers). Returns the History event to emit
/// after the caller drops the lock.
fn commit_offers(inner: &mut Inner, tab_id: &str, url: &str) -> Option<BrowserEvent> {
	let was = inner
		.history
		.get(tab_id)
		.map(offers_of)
		.unwrap_or((false, false));
	let hist = inner.history.entry(tab_id.to_string()).or_default();
	let current = hist.entries.get(hist.index).map(String::as_str);
	if current != Some(url) {
		if hist.entries.get(hist.index + 1) == Some(&url.to_string()) {
			hist.index += 1;
		} else {
			hist.entries.truncate(hist.index + 1);
			hist.entries.push(url.to_string());
			if hist.entries.len() > MAX_HISTORY {
				hist.entries.remove(0);
			}
			hist.index = hist.entries.len() - 1;
		}
	}
	let offers = offers_of(hist);
	if was == offers {
		return None;
	}
	Some(BrowserEvent::History {
		tab_id: tab_id.to_string(),
		back: offers.0,
		forward: offers.1,
		seq: next_seq(inner, tab_id),
	})
}

// ---- URL polling ----

/// The shown page's address, read from the page itself (wry's `url()` panics
/// without one on macOS; a script works everywhere, including pushState).
fn poll_url<R: Runtime>(app: AppHandle<R>) {
	let state = app.state::<TabsState>();
	let shown = state.inner.lock().unwrap().shown.clone();
	let Some(tab_id) = shown else {
		return;
	};
	let Some(page) = app.get_webview(&label_for(&tab_id)) else {
		return;
	};
	let _ = page.eval_with_callback(
		"(() => { try { return JSON.stringify({ href: location.href, back: history.length > 1 }); } catch { return '{}'; } })()",
		move |raw| {
			let tab_id = tab_id.clone();
			let inner = serde_json::from_str::<serde_json::Value>(raw.trim())
				.ok()
				.and_then(|outer| outer.as_str().map(str::to_string))
				.and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
				.unwrap_or(serde_json::Value::Null);
			let href = inner
				.get("href")
				.and_then(serde_json::Value::as_str)
				.map(str::to_string);
			let Some(url) = href.filter(|url| {
				let scheme = Url::parse(url).map(|u| u.scheme().to_string()).unwrap_or_default();
				matches!(scheme.as_str(), "http" | "https") && reportable(url)
			}) else {
				return;
			};
			let (events, changed) = {
				let state = app.state::<TabsState>();
				let mut i = state.inner.lock().unwrap();
				// The panel may have switched or closed it while the page read.
				if i.shown.as_deref() != Some(tab_id.as_str()) {
					return;
				}
				// Polls see SPA moves too (pushState/replaceState): feed the
				// stack under the same lock, so offers track the real document.
				let changed = i.urls.insert(tab_id.clone(), url.clone()) != Some(url.clone());
				let mut events = commit_offers(&mut i, &tab_id, &url).into_iter().collect::<Vec<_>>();
				if changed {
					events.push(BrowserEvent::Url {
						tab_id: tab_id.clone(),
						url,
						seq: next_seq(&mut i, &tab_id),
					});
				}
				(events, changed)
			};
			// Emit after the lock drops (the Url event is present only when
			// the address really moved).
			for event in events {
				emit(&app, event);
			}
		},
	);
}

/// Read the shown tab's address every `URL_POLL` while any tab is open.
fn start_url_poll<R: Runtime>(app: &AppHandle<R>) {
	let state = app.state::<TabsState>();
	{
		let mut inner = state.inner.lock().unwrap();
		if inner.polling {
			return;
		}
		inner.polling = true;
	}
	let app = app.clone();
	tauri::async_runtime::spawn(async move {
		loop {
			{
				let state = app.state::<TabsState>();
				let mut inner = state.inner.lock().unwrap();
				if inner.created.is_empty() {
					// The last tab closed: end this loop; a new tab restarts it.
					inner.polling = false;
					return;
				}
			}
			poll_url(app.clone());
			tokio::time::sleep(URL_POLL).await;
		}
	});
}

// ---- macOS: route a page's requests through the loopback proxy ----

/// macOS: point the page's data store at the proxy (macOS 14+), then load.
/// Windows pages are proxied via args at creation.
#[cfg(target_os = "macos")]
fn load_through_proxy<R: Runtime>(app: &AppHandle<R>, page: &Webview<R>, url: Url) {
	let route_url = url.to_string();
	let page = page.clone();
	let load = {
		let page = page.clone();
		let load_url = url.clone();
		move || {
			let page = page.clone();
			log::info!("issuing deferred navigate: {}", load_url);
			tauri::async_runtime::spawn(async move {
				if let Err(error) = page.navigate(load_url) {
					log::info!("deferred navigate failed: {error}");
				}
			});
		}
	};
	let app = app.clone();
	let page_tab = page.label().to_string();
	let _ = page.with_webview(move |platform| {
		let raw = platform.inner() as *mut objc2_web_kit::WKWebView;
		// Safety: wry's view, alive with its webview; retained for the callback.
		let Some(view) = (unsafe { objc2::rc::Retained::retain(raw) }) else {
			return;
		};
		let routed = mac_proxy::route(&view);
		log::info!("page proxy routed: {} -> {}", route_url, routed);
		// Never unproxied: a page whose proxy cannot route does not load.
		if !routed {
			log::error!("browser page not loaded: its proxy could not be set");
			emit(
				&app,
				BrowserEvent::ProxyFailed {
					// The caller's tab id lives in the label; the event wants it back.
					tab_id: tab_of_label(&page_tab).unwrap_or_default(),
					url: route_url,
				},
			);
			return;
		}
		let _ = load();
	});
}

#[cfg(target_os = "macos")]
mod mac_proxy {
	use objc2::rc::Retained;
	use objc2_foundation::{ns_string, NSArray, NSObjectNSKeyValueCoding};
	use objc2_web_kit::WKWebView;
	use std::ffi::{c_char, CString};

	type CreateHost =
		unsafe extern "C" fn(*const c_char, *const c_char) -> *mut objc2::runtime::AnyObject;
	type CreateConnect = unsafe extern "C" fn(
		*mut objc2::runtime::AnyObject,
		*mut objc2::runtime::AnyObject,
	) -> *mut objc2::runtime::AnyObject;

	/// Point the view's data store at the loopback proxy. The Network calls
	/// (macOS 14+) are looked up at run time, so linking them would stop older
	/// macOS from launching the app at all.
	pub fn route(view: &WKWebView) -> bool {
		let Ok(address) = super::super::proxy::address() else {
			return false;
		};
		let (Ok(ip), Ok(port)) = (
			CString::new(address.ip().to_string()),
			CString::new(address.port().to_string()),
		) else {
			return false;
		};
		unsafe {
			libc::dlopen(
				c"/System/Library/Frameworks/Network.framework/Network".as_ptr(),
				libc::RTLD_LAZY,
			);
			let create_host = libc::dlsym(libc::RTLD_DEFAULT, c"nw_endpoint_create_host".as_ptr());
			let create_connect = libc::dlsym(
				libc::RTLD_DEFAULT,
				c"nw_proxy_config_create_http_connect".as_ptr(),
			);
			if create_host.is_null() || create_connect.is_null() {
				return false;
			}
			let create_host: CreateHost = std::mem::transmute(create_host);
			let create_connect: CreateConnect = std::mem::transmute(create_connect);
			// Both return +1 references.
			let Some(endpoint) = Retained::from_raw(create_host(ip.as_ptr(), port.as_ptr())) else {
				return false;
			};
			let Some(config) = Retained::from_raw(create_connect(
				Retained::as_ptr(&endpoint).cast_mut(),
				std::ptr::null_mut(),
			)) else {
				return false;
			};
			let configs = NSArray::from_retained_slice(&[config]);
			view.configuration()
				.websiteDataStore()
				.setValue_forKey(Some(&configs), ns_string!("proxyConfigurations"));
		}
		true
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn labels_use_the_page_prefix() {
		assert_eq!(label_for("t7"), format!("{LABEL_PREFIX}t7"));
	}

	#[test]
	fn tab_ids_sort_in_creation_order() {
		let a = next_tab_id();
		let b = next_tab_id();
		assert!(a < b, "{a} should sort before {b}");
	}

	#[test]
	fn titles_keep_to_a_reasonable_length() {
		let long = "x".repeat(10_000);
		assert_eq!(bounded_title(&long).chars().count(), 200);
	}

	#[test]
	fn macos_product_version_is_parsed_from_the_plist() {
		let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ProductBuildVersion</key>
	<string>23G93</string>
	<key>ProductCopyright</key>
	<string>1983-2024 Apple Inc.</string>
	<key>ProductName</key>
	<string>macOS</string>
	<key>ProductUserVisibleVersion</key>
	<string>14.6.1</string>
	<key>ProductVersion</key>
	<string>14.6.1</string>
</dict>
</plist>"#;
		assert_eq!(parse_product_version(plist), Some((14, 6)));
		assert_eq!(
			parse_product_version("<key>ProductVersion</key><string>15.0</string>"),
			Some((15, 0))
		);
		assert_eq!(
			parse_product_version("<key>ProductVersion</key><string>26.1</string>"),
			Some((26, 1))
		);
		assert_eq!(parse_product_version("no version here"), None);
	}
}
