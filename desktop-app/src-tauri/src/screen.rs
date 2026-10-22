//! Screen share for voice calls.
//!
//! A call can attach one frame of the user's selected window or display to a
//! spoken turn. Capture is local and cheap: the frontend polls at ~2 Hz, this
//! module downscales each frame, compares a 64x64 luma signature, and only
//! publishes a new JPEG when the screen materially changed. The voice turn
//! pulls the latest frame on demand.
//!
//! Nothing is streamed to the model. A frame rides the normal `prompt` /
//! `follow_up` image attachment path, so any image-capable model works.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, ImageEncoder, RgbaImage};
use serde::Serialize;
use tauri::{AppHandle, State};
use xcap::{Monitor, Window};

/// Long edge of the image sent to the model. Large enough for UI text without
/// paying for a 4K frame.
const MAX_EDGE: u32 = 1568;
/// JPEG quality. 74 keeps labels readable at a fraction of PNG's size.
const JPEG_QUALITY: u8 = 74;
/// Luma signature resolution for change detection.
const SIGNATURE_EDGE: u32 = 64;
/// Fraction of signature pixels that must change before a frame counts.
const CHANGE_THRESHOLD: f32 = 0.02;
/// Don't re-encode the preview more than once per interval.
const PREVIEW_INTERVAL: Duration = Duration::from_millis(900);
/// Reuse the latest capture for a turn if it is this fresh.
const FRESH_FRAME: Duration = Duration::from_millis(1200);

#[derive(Default)]
pub struct ScreenShareState {
	inner: Mutex<Option<Session>>,
}

struct Session {
	source: ScreenSource,
	target: TargetSpec,
	last_signature: Option<Vec<u8>>,
	latest: Option<RgbaImage>,
	version: u64,
	last_preview_version: u64,
	last_preview_at: Instant,
	last_capture_at: Instant,
	last_ratio: f32,
}

/// A source by id, not a platform capture handle. xcap's Windows monitor
/// handle is a raw `HMONITOR`, which is not `Send`; keeping the id here lets the
/// Tauri state stay `Send + Sync`, and resolves the handle on the capture
/// thread instead.
#[derive(Clone, Debug)]
enum TargetSpec {
	Window(u32),
	Monitor(u32),
}

impl TargetSpec {
	fn capture(&self) -> Result<RgbaImage, String> {
		match self {
			TargetSpec::Window(id) => {
				let windows =
					Window::all().map_err(|e| format!("Could not list windows: {}", e))?;
				let window = windows
					.into_iter()
					.find(|window| window.id().ok() == Some(*id))
					.ok_or_else(|| "That window is no longer open".to_string())?;
				window.capture_image().map_err(|e| e.to_string())
			}
			TargetSpec::Monitor(id) => {
				let monitors =
					Monitor::all().map_err(|e| format!("Could not list displays: {}", e))?;
				let monitor = monitors
					.into_iter()
					.find(|monitor| monitor.id().ok() == Some(*id))
					.ok_or_else(|| "That display is no longer available".to_string())?;
				monitor.capture_image().map_err(|e| e.to_string())
			}
		}
	}
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSource {
	pub id: String,
	pub kind: String,
	pub name: String,
	pub app_name: String,
	pub width: u32,
	pub height: u32,
	pub primary: bool,
	pub focused: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSources {
	pub permission: bool,
	pub sources: Vec<ScreenSource>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenFrame {
	pub base64: String,
	pub mime_type: String,
	pub width: u32,
	pub height: u32,
	pub version: u64,
	pub changed_ratio: f32,
	pub captured_at: u64,
	pub source_name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureResult {
	pub changed: bool,
	pub version: u64,
	pub changed_ratio: f32,
	pub frame: Option<ScreenFrame>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenStatus {
	pub active: bool,
	pub source_id: Option<String>,
	pub source_name: Option<String>,
	pub permission: bool,
	pub version: u64,
}

#[cfg(target_os = "macos")]
fn screen_permission() -> bool {
	objc2_core_graphics::CGPreflightScreenCaptureAccess()
}

#[cfg(not(target_os = "macos"))]
fn screen_permission() -> bool {
	true
}

/// TCC's preflight check is a UI-process query; ask it on the main thread.
/// Tauri async commands otherwise run it on a worker, where macOS can report
/// the previous (denied) state even after the user grants access.
fn main_thread_permission(app: &AppHandle) -> bool {
	let (tx, rx) = std::sync::mpsc::channel();
	if app
		.run_on_main_thread(move || {
			let _ = tx.send(screen_permission());
		})
		.is_err()
	{
		return screen_permission();
	}
	rx.recv_timeout(Duration::from_secs(1))
		.unwrap_or_else(|_| screen_permission())
}

/// Ask macOS for Screen Recording access. The OS shows its own prompt; the
/// user still has to enable the app in System Settings, and the app may need a
/// restart before frames are readable.
#[tauri::command]
pub async fn screen_share_request_permission(app: AppHandle) -> bool {
	#[cfg(target_os = "macos")]
	{
		let _ = tauri::async_runtime::spawn_blocking(|| {
			let _ = objc2_core_graphics::CGRequestScreenCaptureAccess();
		})
		.await;
		return main_thread_permission(&app);
	}
	#[cfg(not(target_os = "macos"))]
	{
		let _ = app;
		true
	}
}

fn lock<'a>(
	state: &'a State<'_, ScreenShareState>,
) -> Result<std::sync::MutexGuard<'a, Option<Session>>, String> {
	state
		.inner
		.lock()
		.map_err(|_| "Screen share state is unavailable".to_string())
}

fn now_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis() as u64
}

fn fit_max(image: &RgbaImage) -> RgbaImage {
	let (width, height) = image.dimensions();
	let long = width.max(height);
	if long <= MAX_EDGE {
		return image.clone();
	}
	let scale = MAX_EDGE as f32 / long as f32;
	let next_w = ((width as f32 * scale).round() as u32).max(1);
	let next_h = ((height as f32 * scale).round() as u32).max(1);
	image::imageops::resize(image, next_w, next_h, FilterType::Triangle)
}

fn luma_signature(image: &RgbaImage) -> Vec<u8> {
	let small =
		image::imageops::resize(image, SIGNATURE_EDGE, SIGNATURE_EDGE, FilterType::Triangle);
	let mut out = Vec::with_capacity((SIGNATURE_EDGE * SIGNATURE_EDGE) as usize);
	for pixel in small.pixels() {
		let [r, g, b, _] = pixel.0;
		let luma = (r as u32 * 299 + g as u32 * 587 + b as u32 * 114) / 1000;
		out.push(luma as u8);
	}
	out
}

fn changed_ratio(previous: &[u8], current: &[u8]) -> f32 {
	if previous.len() != current.len() || current.is_empty() {
		return 1.0;
	}
	let changed = previous
		.iter()
		.zip(current)
		.filter(|(a, b)| a.abs_diff(**b) > 12)
		.count();
	changed as f32 / current.len() as f32
}

fn encode_jpeg(image: &RgbaImage) -> Result<Vec<u8>, String> {
	let rgb = DynamicImage::ImageRgba8(image.clone()).to_rgb8();
	let mut bytes = Vec::new();
	JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY)
		.write_image(
			rgb.as_raw(),
			rgb.width(),
			rgb.height(),
			ExtendedColorType::Rgb8,
		)
		.map_err(|e| format!("Could not encode the screen frame: {}", e))?;
	Ok(bytes)
}

fn frame_from(session: &Session, image: &RgbaImage) -> Result<ScreenFrame, String> {
	let bytes = encode_jpeg(image)?;
	Ok(ScreenFrame {
		base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
		mime_type: "image/jpeg".to_string(),
		width: image.width(),
		height: image.height(),
		version: session.version,
		changed_ratio: session.last_ratio,
		captured_at: now_ms(),
		source_name: session.source.name.clone(),
	})
}

fn source_from_window(window: &Window) -> ScreenSource {
	let app_name = window.app_name().unwrap_or_default();
	let title = window.title().unwrap_or_default();
	let name = if title.trim().is_empty() {
		if app_name.trim().is_empty() {
			format!("Window {}", window.id().unwrap_or_default())
		} else {
			app_name.clone()
		}
	} else {
		title
	};
	ScreenSource {
		id: format!("window:{}", window.id().unwrap_or_default()),
		kind: "window".to_string(),
		name,
		app_name,
		width: window.width().unwrap_or_default(),
		height: window.height().unwrap_or_default(),
		primary: false,
		focused: window.is_focused().unwrap_or(false),
	}
}

fn source_from_monitor(monitor: &Monitor) -> ScreenSource {
	let name = monitor
		.friendly_name()
		.or_else(|_| monitor.name())
		.unwrap_or_else(|_| "Display".to_string());
	ScreenSource {
		id: format!("display:{}", monitor.id().unwrap_or_default()),
		kind: "display".to_string(),
		name,
		app_name: String::new(),
		width: monitor.width().unwrap_or_default(),
		height: monitor.height().unwrap_or_default(),
		primary: monitor.is_primary().unwrap_or(false),
		focused: false,
	}
}

fn resolve_source(source_id: &str) -> Result<(ScreenSource, TargetSpec), String> {
	let (kind, raw_id) = source_id
		.split_once(':')
		.ok_or_else(|| "Invalid screen source".to_string())?;
	let id: u32 = raw_id
		.parse()
		.map_err(|_| "Invalid screen source id".to_string())?;
	match kind {
		"window" => {
			let windows = Window::all().map_err(|e| format!("Could not list windows: {}", e))?;
			let window = windows
				.into_iter()
				.find(|window| window.id().ok() == Some(id))
				.ok_or_else(|| "That window is no longer open".to_string())?;
			let source = source_from_window(&window);
			Ok((source, TargetSpec::Window(id)))
		}
		"display" => {
			let monitors = Monitor::all().map_err(|e| format!("Could not list displays: {}", e))?;
			let monitor = monitors
				.into_iter()
				.find(|monitor| monitor.id().ok() == Some(id))
				.ok_or_else(|| "That display is no longer available".to_string())?;
			let source = source_from_monitor(&monitor);
			Ok((source, TargetSpec::Monitor(id)))
		}
		_ => Err("Unknown screen source kind".to_string()),
	}
}

/// List displays and shareable windows. Windows owned by this app are omitted
/// (sharing your own call window would recurse); empty and minimized windows
/// are skipped.
#[tauri::command]
pub async fn screen_share_sources(app: AppHandle) -> Result<ScreenSources, String> {
	let permission = main_thread_permission(&app);
	let mut sources = Vec::new();

	if let Ok(monitors) = Monitor::all() {
		for monitor in monitors {
			let source = source_from_monitor(&monitor);
			if source.width > 0 && source.height > 0 {
				sources.push(source);
			}
		}
	}
	sources.sort_by(|a, b| b.primary.cmp(&a.primary).then_with(|| a.name.cmp(&b.name)));

	let own_pid = std::process::id();
	let mut windows: Vec<ScreenSource> = Window::all()
		.map(|windows| {
			windows
				.into_iter()
				.filter(|window| window.pid().ok() != Some(own_pid))
				.filter(|window| !window.is_minimized().unwrap_or(false))
				.map(|window| source_from_window(&window))
				.filter(|source| {
					let system_window = matches!(
						source.app_name.as_str(),
						"Dock"
							| "Window Server" | "A-Coder Desktop"
							| "Control Center" | "Notification Center"
					);
					let unnamed =
						source.name.trim().is_empty() && source.app_name.trim().is_empty();
					source.width >= 64 && source.height >= 64 && !system_window && !unnamed
				})
				.collect()
		})
		.unwrap_or_default();
	windows.sort_by(|a, b| {
		b.focused
			.cmp(&a.focused)
			.then_with(|| a.app_name.to_lowercase().cmp(&b.app_name.to_lowercase()))
			.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
	});
	windows.truncate(80);
	sources.extend(windows);

	Ok(ScreenSources {
		permission,
		sources,
	})
}

fn status_from(session: &Option<Session>, permission: bool) -> ScreenStatus {
	ScreenStatus {
		active: session.is_some(),
		source_id: session.as_ref().map(|s| s.source.id.clone()),
		source_name: session.as_ref().map(|s| s.source.name.clone()),
		permission,
		version: session.as_ref().map_or(0, |s| s.version),
	}
}

#[tauri::command]
pub async fn screen_share_status(
	app: AppHandle,
	state: State<'_, ScreenShareState>,
) -> Result<ScreenStatus, String> {
	let permission = main_thread_permission(&app);
	let guard = lock(&state)?;
	Ok(status_from(&guard, permission))
}

#[tauri::command]
pub async fn screen_share_start(
	app: AppHandle,
	state: State<'_, ScreenShareState>,
	source_id: String,
) -> Result<ScreenStatus, String> {
	let permission = main_thread_permission(&app);
	if !permission {
		return Err(
			"Screen Recording permission is required. Enable A-Coder Desktop in System Settings → Privacy & Security → Screen Recording, then restart the app."
				.to_string(),
		);
	}
	let (source, target) = resolve_source(&source_id)?;
	let mut guard = lock(&state)?;
	*guard = Some(Session {
		source,
		target,
		last_signature: None,
		latest: None,
		version: 0,
		last_preview_version: 0,
		last_preview_at: Instant::now() - PREVIEW_INTERVAL,
		last_capture_at: Instant::now() - FRESH_FRAME,
		last_ratio: 1.0,
	});
	Ok(status_from(&guard, permission))
}

#[tauri::command]
pub async fn screen_share_stop(state: State<'_, ScreenShareState>) -> Result<(), String> {
	let mut guard = lock(&state)?;
	*guard = None;
	Ok(())
}

/// Capture a frame, update the change signature, and return a new preview
/// JPEG when the screen changed (throttled to one preview per ~900 ms).
#[tauri::command]
pub async fn screen_share_capture(
	state: State<'_, ScreenShareState>,
) -> Result<ScreenCaptureResult, String> {
	let mut guard = lock(&state)?;
	let session = guard
		.as_mut()
		.ok_or_else(|| "Screen sharing is not active".to_string())?;
	let image = fit_max(&session.target.capture()?);
	let signature = luma_signature(&image);
	let ratio = match session.last_signature.as_deref() {
		Some(previous) => changed_ratio(previous, &signature),
		None => 1.0,
	};
	let changed = ratio >= CHANGE_THRESHOLD;
	if changed {
		session.version = session.version.saturating_add(1);
		session.latest = Some(image);
		session.last_ratio = ratio;
	}
	session.last_signature = Some(signature);
	session.last_capture_at = Instant::now();

	let mut frame = None;
	if session.version > session.last_preview_version
		&& session
			.last_capture_at
			.duration_since(session.last_preview_at)
			>= PREVIEW_INTERVAL
	{
		if let Some(latest) = session.latest.as_ref() {
			frame = Some(frame_from(session, latest)?);
			session.last_preview_version = session.version;
			session.last_preview_at = session.last_capture_at;
		}
	}

	Ok(ScreenCaptureResult {
		changed,
		version: session.version,
		changed_ratio: ratio,
		frame,
	})
}

/// Return the freshest frame for a voice turn. Reuses the polled capture if it
/// is under ~1.2 s old; otherwise captures now.
#[tauri::command]
pub async fn screen_share_latest(
	state: State<'_, ScreenShareState>,
) -> Result<ScreenFrame, String> {
	let mut guard = lock(&state)?;
	let session = guard
		.as_mut()
		.ok_or_else(|| "Screen sharing is not active".to_string())?;
	let now = Instant::now();
	if session.latest.is_none() || now.duration_since(session.last_capture_at) >= FRESH_FRAME {
		let image = fit_max(&session.target.capture()?);
		let signature = luma_signature(&image);
		let ratio = match session.last_signature.as_deref() {
			Some(previous) => changed_ratio(previous, &signature),
			None => 1.0,
		};
		if ratio >= CHANGE_THRESHOLD {
			session.version = session.version.saturating_add(1);
			session.last_ratio = ratio;
		}
		session.last_signature = Some(signature);
		session.latest = Some(image);
		session.last_capture_at = now;
	}
	let latest = session
		.latest
		.as_ref()
		.ok_or_else(|| "No screen frame is available".to_string())?;
	frame_from(session, latest)
}

#[cfg(test)]
mod tests {
	use super::*;
	use image::Rgba;

	#[test]
	fn fit_max_keeps_small_frames() {
		let image = RgbaImage::from_pixel(800, 600, Rgba([10, 20, 30, 255]));
		let fitted = fit_max(&image);
		assert_eq!(fitted.dimensions(), (800, 600));
	}

	#[test]
	fn fit_max_limits_the_long_edge() {
		let image = RgbaImage::from_pixel(4000, 2000, Rgba([10, 20, 30, 255]));
		let fitted = fit_max(&image);
		assert_eq!(fitted.width(), MAX_EDGE);
		assert_eq!(fitted.height(), MAX_EDGE / 2);
	}

	#[test]
	fn change_ratio_detects_a_large_change() {
		let before = vec![0u8; 64 * 64];
		let mut after = before.clone();
		for pixel in after.iter_mut().take(200) {
			*pixel = 255;
		}
		assert!(changed_ratio(&before, &after) > CHANGE_THRESHOLD);
	}

	#[test]
	#[ignore = "requires Screen Recording permission"]
	fn capture_smoke() {
		let monitors = Monitor::all().expect("monitors");
		assert!(!monitors.is_empty(), "no displays");
		let image = monitors[0].capture_image().expect("display capture");
		assert!(image.width() > 0 && image.height() > 0);
		let fitted = fit_max(&image);
		let jpeg = encode_jpeg(&fitted).expect("jpeg encode");
		println!(
			"captured {}x{}, {} JPEG bytes",
			fitted.width(),
			fitted.height(),
			jpeg.len()
		);
		assert!(jpeg.len() > 1_000, "unexpectedly small JPEG");
		// A denied Screen Recording grant usually yields a flat/black image.
		let values: Vec<f64> = fitted
			.pixels()
			.map(|p| (p.0[0] as f64 + p.0[1] as f64 + p.0[2] as f64) / 3.0)
			.collect();
		let mean = values.iter().sum::<f64>() / values.len() as f64;
		let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64;
		println!("mean luma {:.1}, variance {:.1}", mean, variance);
		assert!(
			variance > 1.0,
			"capture looks blank; check Screen Recording permission"
		);
	}

	#[test]
	fn change_ratio_ignores_a_cursor_sized_change() {
		let before = vec![100u8; 64 * 64];
		let mut after = before.clone();
		for pixel in after.iter_mut().take(20) {
			*pixel = 240;
		}
		assert!(changed_ratio(&before, &after) < CHANGE_THRESHOLD);
	}
}
