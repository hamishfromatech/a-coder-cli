//! Screenshots for the browser panel. A page in a native view captures
//! through its own engine (a private snapshot on macOS, Chromium's DevTools
//! protocol on Windows); the app's own content captures through the app
//! webview, cropped to the reported region — which also covers pages shown as
//! proxied frames on platforms without native child webviews. Native snapshots
//! need no screen-share prompt, unlike capturing the window.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::Response;
use tauri::{Manager, Runtime, Webview};

use super::require_main;
use super::tabs;
use super::ViewBounds;

const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);
/// Larger than any screen's worth of pixels; a bigger answer is not a shot.
const MAX_PNG_BYTES: usize = 64 * 1024 * 1024;

type Done = Box<dyn FnOnce(Result<Vec<u8>, String>) + Send>;

/// A rect in the calling webview's CSS pixels, plus its width in CSS pixels to
/// scale by the app's zoom.
#[derive(Clone, Copy)]
pub(crate) struct Clip {
	pub x: f64,
	pub y: f64,
	pub width: f64,
	pub height: f64,
	pub viewport_width: f64,
}

/// Whether the capture command exists on this platform.
#[tauri::command]
pub fn browser_capture_supported() -> bool {
	cfg!(any(target_os = "macos", windows))
}

/// A PNG of a tab's page (`tab_id`), or of the calling webview's own content
/// inside `bounds` — the two cover the native page and the proxied-frame
/// fallback respectively.
#[tauri::command]
pub async fn browser_capture<R: Runtime>(
	webview: Webview<R>,
	tab_id: Option<String>,
	bounds: Option<ViewBounds>,
) -> Result<Response, String> {
	require_main(&webview)?;
	capture_command(webview, tab_id, bounds).await
}

async fn capture_command<R: Runtime>(
	webview: Webview<R>,
	tab_id: Option<String>,
	bounds: Option<ViewBounds>,
) -> Result<Response, String> {
	#[cfg(not(any(target_os = "macos", windows)))]
	{
		let _ = (&tab_id, &bounds);
		return Err("Screenshots are unsupported on this platform".into());
	}
	#[cfg(any(target_os = "macos", windows))]
	{
		let view = match (&tab_id, &bounds) {
			(Some(tab_id), _) => webview
				.app_handle()
				.get_webview(&format!("{}{tab_id}", tabs::LABEL_PREFIX))
				.ok_or_else(|| "That tab is closed".to_string())?,
			(None, Some(_bounds)) => webview.clone(),
			_ => return Err("nothing to capture".into()),
		};
		let clip =
			bounds
				.as_ref()
				.map(ViewBounds::parts)
				.map(|(x, y, width, height, viewport_width)| Clip {
					x: x.max(0.0),
					y: y.max(0.0),
					width,
					height,
					viewport_width,
				});
		let (sender, receiver) = tokio::sync::oneshot::channel();
		let sender = Arc::new(Mutex::new(Some(sender)));
		let done: Done = Box::new(move |result| {
			if let Some(sender) = sender.lock().unwrap().take() {
				let _ = sender.send(result);
			}
		});
		view.with_webview(move |platform| platform_capture(platform, clip, done))
			.map_err(|error| error.to_string())?;
		let png = match tokio::time::timeout(CAPTURE_TIMEOUT, receiver).await {
			Ok(Ok(result)) => result?,
			_ => return Err("The screenshot didn't finish".into()),
		};
		if png.is_empty() || png.len() > MAX_PNG_BYTES {
			return Err("The screenshot came back empty".into());
		}
		Ok(Response::new(png))
	}
}

/// A tab's capture as raw PNG bytes, for the agent's MCP server.
pub(crate) async fn capture_png<R: Runtime>(
	app: &tauri::AppHandle<R>,
	tab_id: &str,
) -> Result<Vec<u8>, String> {
	let page = app
		.get_webview(&format!("{}{tab_id}", tabs::LABEL_PREFIX))
		.ok_or_else(|| "That tab is closed".to_string())?;
	let (sender, receiver) = tokio::sync::oneshot::channel();
	let sender = Arc::new(Mutex::new(Some(sender)));
	let done: Done = Box::new(move |result| {
		if let Some(sender) = sender.lock().unwrap().take() {
			let _ = sender.send(result);
		}
	});
	page.with_webview(move |platform| platform_capture(platform, None, done))
		.map_err(|error| error.to_string())?;
	let png = match tokio::time::timeout(CAPTURE_TIMEOUT, receiver).await {
		Ok(Ok(result)) => result?,
		_ => return Err("The screenshot didn't finish".into()),
	};
	if png.is_empty() || png.len() > MAX_PNG_BYTES {
		return Err("The screenshot came back empty".into());
	}
	Ok(png)
}

/// # Safety
/// Runs on the main thread via `with_webview`; `platform.inner()` is wry's
/// live WKWebView.
#[cfg(target_os = "macos")]
fn platform_capture(platform: tauri::webview::PlatformWebview, clip: Option<Clip>, done: Done) {
	use objc2::MainThreadMarker;
	use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
	use objc2_foundation::{NSDictionary, NSError, NSPoint, NSRect, NSSize};
	use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

	let Some(mtm) = MainThreadMarker::new() else {
		done(Err("Not on the main thread".into()));
		return;
	};
	// Safety: wry's live view, used on the main thread.
	unsafe {
		let view = &*(platform.inner() as *const WKWebView);
		let config = WKSnapshotConfiguration::new(mtm);
		if let Some(clip) = clip {
			// WKWebView is flipped, so its points read like CSS pixels, scaled
			// by this view's width relative to the caller's viewport width.
			let width = view.frame().size.width;
			let scale = if width > 0.0 && clip.viewport_width > 0.0 {
				width / clip.viewport_width
			} else {
				1.0
			};
			config.setRect(NSRect::new(
				NSPoint::new(clip.x * scale, clip.y * scale),
				NSSize::new(clip.width * scale, clip.height * scale),
			));
		}
		let done = Mutex::new(Some(done));
		let handler = block2::RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
			let Some(done) = done.lock().unwrap().take() else {
				return;
			};
			// The TIFF keeps the snapshot's backing pixels, so a Retina screen
			// gives a 2x PNG.
			let png = image
				.as_ref()
				.and_then(|image| image.TIFFRepresentation())
				.and_then(|tiff| NSBitmapImageRep::imageRepWithData(&tiff))
				.and_then(|bitmap| {
					bitmap.representationUsingType_properties(
						NSBitmapImageFileType::PNG,
						&NSDictionary::new(),
					)
				})
				.map(|data| data.to_vec());
			done(png.ok_or_else(|| "The page couldn't be captured".to_string()));
		});
		view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
	}
}

/// Chromium captures through the DevTools protocol; the answer arrives as
/// base64 in JSON. `scale` is 1: DevTools CSS pixels match the page's viewport
/// and the surface already carries the device pixel ratio.
#[cfg(windows)]
fn platform_capture(platform: tauri::webview::PlatformWebview, clip: Option<Clip>, done: Done) {
	use base64::Engine;
	use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
	use windows_core::{BOOL, HSTRING};

	let mut params = serde_json::json!({ "format": "png", "fromSurface": true });
	if let Some(clip) = clip {
		params["clip"] = serde_json::json!({
			"x": clip.x,
			"y": clip.y,
			"width": clip.width,
			"height": clip.height,
			"scale": 1,
		});
	}
	let params = HSTRING::from(params.to_string());
	let done = std::sync::Arc::new(std::sync::Mutex::new(Some(done)));
	let finish = {
		let done = done.clone();
		move |result: Result<Vec<u8>, String>| {
			if let Some(done) = done.lock().unwrap().take() {
				done(result);
			}
		}
	};
	let core = match unsafe { platform.controller.CoreWebView2() } {
		Ok(core_webview) => core_webview,
		Err(_) => {
			done_first(&done, Err("The webview controller was gone".into()));
			return;
		}
	};
	let devtools = match unsafe {
		core.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_16>()
	} {
		Ok(devtools) => devtools,
		Err(_) => {
			done_first(
				&done,
				Err("The WebView2 runtime is too old for screenshots".into()),
			);
			return;
		}
	};
	let answer = finish.clone();
	let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
		move |error_code, result_json: String| -> windows_core::Result<()> {
			if error_code.is_err() {
				answer(Err("The page refused to be captured".into()));
				return Ok(());
			}
			let parsed = serde_json::from_str::<serde_json::Value>(&result_json).ok();
			let png = parsed
				.as_ref()
				.and_then(|value| value.get("data"))
				.and_then(serde_json::Value::as_str)
				.and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok());
			match png {
				Some(png) => answer(Ok(png)),
				None => answer(Err("The screenshot was unreadable".into())),
			}
		},
	));
	unsafe {
		let _ = devtools.CallDevToolsProtocolMethod(
			&HSTRING::from("Page.captureScreenshot"),
			&params,
			&handler,
		);
	}
}

#[cfg(windows)]
fn done_first(
	done: &std::sync::Arc<std::sync::Mutex<Option<Done>>>,
	result: Result<Vec<u8>, String>,
) {
	if let Some(done) = done.lock().unwrap().take() {
		done(result);
	}
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_capture(_platform: tauri::webview::PlatformWebview, _clip: Option<Clip>, done: Done) {
	done(Err("Screenshots are unsupported on this platform".into()));
}

/// Debug: composite the app window's own layer tree (what the user actually
/// sees) to browser-window.png next to browser-debug.log. Own-window captures
/// need no screen-recording permission.
#[tauri::command]
pub async fn browser_debug_window_shot<R: Runtime>(
	webview: tauri::Webview<R>,
) -> Result<String, String> {
	super::require_main(&webview)?;
	let app = webview.app_handle().clone();
	capture_window_composite(&app).await
}

/// One composite per app run, whatever load lands first.
static WINDOW_SHOT_TAKEN: std::sync::atomic::AtomicBool =
	std::sync::atomic::AtomicBool::new(false);

/// Fires a single window composite shortly after a page commits, for the
/// loading diagnosis; remove once the black-page mystery is settled.
pub(crate) fn schedule_window_composite_once<R: Runtime>(app: &tauri::AppHandle<R>) {
	use std::sync::atomic::Ordering;
	if WINDOW_SHOT_TAKEN.swap(true, Ordering::Relaxed) {
		return;
	}
	let app = app.clone();
	tauri::async_runtime::spawn(async move {
		tokio::time::sleep(Duration::from_millis(1800)).await;
		match capture_window_composite(&app).await {
			Ok(path) => log::info!("window composite auto-shotted: {path}"),
			Err(error) => log::warn!("auto window composite failed: {error}"),
		}
	});
}

async fn capture_window_composite<R: Runtime>(
	app: &tauri::AppHandle<R>,
) -> Result<String, String> {
	// Snapshot the main webview itself: page-area pixels with alpha near 0
	// mean the app is see-through above the page; alpha 255 means something
	// opaque composites over it. Uses the same WKWebView snapshot pipeline
	// as page capture, which is proven.
	let Some(main) = app.get_webview("main") else {
		return Err("no main webview".into());
	};
	let dir = app
		.path()
		.app_local_data_dir()
		.map_err(|error| error.to_string())?;
	let (sender, receiver) = tokio::sync::oneshot::channel();
	let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
	let dir_arc = std::sync::Arc::new(dir);
	main.with_webview(move |platform| {
		{
			// Safety: main webview live, main thread inside with_webview.
			unsafe {
				use objc2::msg_send;
					use objc2_foundation::{NSObjectNSKeyValueCoding as _};
					let view = &*(platform.inner() as *const objc2_app_kit::NSView);
				let wb = &*(platform.inner() as *const objc2_web_kit::WKWebView);
				let draws = wb
					.valueForKey(objc2_foundation::ns_string!("drawsBackground"))
					.and_then(|v| v.downcast::<objc2_foundation::NSNumber>().ok())
					.map(|v| v.as_bool());
				log::info!(
					"tree: main drawsBackground={:?} isOpaque={:?} frame={:?}",
					draws,
					wb.isOpaque(),
					wb.frame()
				);
				let Some(window) = view.window() else { log::warn!("tree: no window"); return; };
				let Some(content) = window.contentView() else { log::warn!("tree: no content"); return; };
				let dump = |node: &objc2_app_kit::NSView, depth: usize| -> String {
					let mut line = format!(
						"tree: {} {} frame=({:.0},{:.0},{:.0},{:.0}) hidden={} alpha={:.2}",
						"  ".repeat(depth),
						format!("{:?}", {
							let cls: &'static objc2::runtime::AnyClass = unsafe { msg_send![node, class] };
							cls
						}),
						node.frame().origin.x,
						node.frame().origin.y,
						node.frame().size.width,
						node.frame().size.height,
						node.isHidden(),
						node.alphaValue()
					);
					line
				};
				log::info!(
					"tree: window frame={:?} flipped={} content frame={:?} bounds={:?}",
					window.frame(),
					content.isFlipped(),
					content.frame(),
					content.bounds()
				);
				log::info!("{}", dump(&content, 0));
				let mut stack: Vec<(objc2::rc::Retained<objc2_app_kit::NSView>, usize)> =
					vec![(content.clone(), 0)];
				let mut lines = Vec::new();
				while let Some((node, depth)) = stack.pop() {
					lines.push(dump(node.as_ref(), depth));
					if depth < 2 {
						let subs: Vec<objc2::rc::Retained<objc2_app_kit::NSView>> =
							node.subviews().into_iter().collect();
						for sub in subs.into_iter().rev() {
							stack.push((sub, depth + 1));
						}
					}
				}
				for line in lines.iter().take(12) {
					log::info!("{}", line);
				}
			}
		}
		let dir = dir_arc.clone();
		if let Some(sender) = sender.lock().unwrap().take() {
			platform_capture(platform, None, Box::new(move |result| {
				let outcome = match result {
					Ok(png) => {
						let target = dir.join("browser-main-shot.png");
						match std::fs::write(&target, &png) {
							Ok(()) => Ok(target.display().to_string()),
							Err(error) => Err(error.to_string()),
						}
					}
					Err(error) => Err(error),
				};
				let _ = sender.send(outcome);
			}));
		}
	})
	.map_err(|error| error.to_string())?;
	tokio::time::timeout(CAPTURE_TIMEOUT, receiver)
		.await
		.map_err(|_| String::from("window shot timed out"))?
		.map_err(|error| error.to_string())?;
	Ok("saved".into())
}
