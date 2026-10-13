//! macOS: browser pages sit under the app's webview, which stays transparent
//! over them, so panel UI built in HTML draws on top of a live page. This
//! module is the input half of that trick:
//!
//! - The app's webview answers `hitTest:` (and AppKit's private drag lookup)
//!   with nil wherever a page owns the pointer, so clicks and drops fall
//!   through to the page; panel rects (`browser_set_page_input`) still take
//!   their clicks.
//! - Mouse moves are handed to exactly one view at a time, because WebKit's
//!   tracking areas would otherwise fire cursor and hover on both, flickering
//!   over links and text.
//!
//! Overrides are installed once, on wry's shared webview class, and keyed on
//! the main view by pointer so pages behave normally.

use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};
use objc2_app_kit::{NSEvent, NSView, NSWindowOrderingMode};
use objc2_foundation::{ns_string, NSNumber, NSObjectNSKeyValueCoding, NSPoint, NSRect, NSSize};
use tauri::Runtime;

use super::ViewBounds;

type HitTest = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, NSPoint) -> *mut AnyObject;
/// AppKit's private drop-target lookup; WKWebView claims its whole frame
/// without it, so a page would never see a drag.
type DragHitTest = unsafe extern "C-unwind" fn(
	*mut AnyObject,
	Sel,
	*mut NSPoint,
	*mut AnyObject,
) -> *mut AnyObject;

/// The app's webview; set once on the main thread, alive as long as the app.
static MAIN: AtomicPtr<AnyObject> = AtomicPtr::new(null_mut());
static INSTALLING: AtomicBool = AtomicBool::new(false);
static HIT_TEST: OnceLock<HitTest> = OnceLock::new();
static DRAG_HIT_TEST: OnceLock<DragHitTest> = OnceLock::new();
/// Which webview takes mouse moves (`APP` or `PAGE`, 0 before the first).
static MOVES_TO: AtomicU8 = AtomicU8::new(0);
/// The view that just lost moves, cut off at the next move so it sees the
/// pointer leave before the other view's enter arrives.
static LAGGING: AtomicU8 = AtomicU8::new(0);
const APP: u8 = 1;
const PAGE: u8 = 2;
static INPUT: Mutex<Input> = Mutex::new(Input {
	blocked: false,
	exclude: Vec::new(),
});

/// Panel UI over the page, in the app's CSS pixels: `(x, y, w, h,
/// viewport_width)`, the last to scale rects when the app view is zoomed.
struct Input {
	/// A menu or dialog is open: the panel takes all page input.
	blocked: bool,
	exclude: Vec<(f64, f64, f64, f64, f64)>,
}

/// Sets which parts of the page the panel's UI covers; true when `blocked`
/// changed (the caller routes moves again).
pub fn set_input(blocked: bool, exclude: &[ViewBounds]) -> bool {
	let mut input = INPUT.lock().unwrap();
	let changed = input.blocked != blocked;
	input.blocked = blocked;
	input.exclude = exclude.iter().map(ViewBounds::parts).collect();
	changed
}

/// Gives mouse moves to whichever view owns the pointer now, e.g. after a menu
/// opened. Main thread.
pub fn reroute_moves() {
	let Some(main) = main_view() else {
		return;
	};
	let Some(window) = main.window() else {
		return;
	};
	// Safety: AppKit class and window methods, on the main thread.
	let point: NSPoint = unsafe {
		let screen: NSPoint = msg_send![class!(NSEvent), mouseLocation];
		msg_send![&*window, convertPointFromScreen: screen]
	};
	route_moves(main, main.convertPoint_fromView(point, None));
}

fn route_moves(main: &NSView, point: NSPoint) {
	let to = if over_page(main, point) { PAGE } else { APP };
	let lagging = LAGGING.swap(0, Ordering::Relaxed);
	if lagging != 0 && lagging != to {
		ignore_moves(main, lagging, true);
	}
	let from = MOVES_TO.swap(to, Ordering::Relaxed);
	if from == to {
		return;
	}
	ignore_moves(main, to, false);
	match from {
		0 => ignore_moves(main, APP + PAGE - to, true),
		_ => LAGGING.store(from, Ordering::Relaxed),
	}
}

/// `_setIgnoresMouseMoveEvents:` (private, macOS 13+, checked first) on the
/// app or every page view.
fn ignore_moves(main: &NSView, which: u8, ignore: bool) {
	let set = |view: &NSView| {
		// Safety: a live view of wry's class, on the main thread.
		unsafe {
			let responds: bool =
				msg_send![view, respondsToSelector: sel!(_setIgnoresMouseMoveEvents:)];
			if responds {
				let _: () =
					msg_send![view, _setIgnoresMouseMoveEvents: objc2::runtime::Bool::new(ignore)];
			}
		}
	};
	if which == APP {
		set(main);
		return;
	}
	// Safety: the main thread's view tree.
	let Some(parent) = (unsafe { main.superview() }) else {
		return;
	};
	for view in parent.subviews().iter() {
		if !std::ptr::eq(&*view, main) && std::ptr::eq(view.class(), main.class()) {
			set(&view);
		}
	}
}

/// Makes the app's webview transparent and routes its input. Runs once,
/// before any page exists.
pub fn install<R: Runtime>(main: &tauri::Webview<R>) {
	if INSTALLING.swap(true, Ordering::SeqCst) {
		return;
	}
	let _ = main.with_webview(|platform| {
		let view = platform.inner() as *mut AnyObject;
		// Safety: wry's live WKWebView, called on the main thread.
		unsafe { install_on(view) };
	});
}

/// Puts a page view below the app's webview, so the panel UI is over the page.
pub fn place<R: Runtime>(page: &tauri::Webview<R>) {
	let _ = page.with_webview(|platform| {
		let Some(main) = main_view() else {
			return;
		};
		// Safety: both are live NSViews, used on the main thread.
		unsafe {
			let page = &*(platform.inner() as *const NSView);
			if let Some(parent) = main.superview() {
				if page.superview().as_deref() == Some(&*parent) {
					parent.addSubview_positioned_relativeTo(
						page,
						NSWindowOrderingMode::Below,
						Some(main),
					);
					MOVES_TO.store(0, Ordering::Relaxed);
					reroute_moves();
				}
			}
		}
	});
}

/// # Safety
/// `view` is wry's live WKWebView on the main thread, called once per app.
unsafe fn install_on(view: *mut AnyObject) {
	let Some(class_ref) = (unsafe { view.as_ref() }).map(AnyObject::class) else {
		return;
	};
	// Pages share wry's class, so the overrides check for the main view by
	// pointer and forward everything else to the originals.
	let (Some(hit_test), Some(drag_hit_test)) = (
		class_ref.instance_method(sel!(hitTest:)),
		class_ref.instance_method(sel!(_hitTest:dragTypes:)),
	) else {
		log::warn!("browser pages stay under the panel: the webview class cannot be routed");
		return;
	};
	// Safety: same signatures; originals are stored before the swap uses them.
	unsafe {
		let _ =
			HIT_TEST.get_or_init(|| std::mem::transmute::<Imp, HitTest>(hit_test.implementation()));
		let _ = DRAG_HIT_TEST.get_or_init(|| {
			std::mem::transmute::<Imp, DragHitTest>(drag_hit_test.implementation())
		});
		let class = (class_ref as *const AnyClass).cast_mut();
		objc2::ffi::class_replaceMethod(
			class,
			sel!(hitTest:),
			std::mem::transmute::<HitTest, Imp>(routed_hit_test),
			objc2::ffi::method_getTypeEncoding(hit_test),
		);
		objc2::ffi::class_replaceMethod(
			class,
			sel!(_hitTest:dragTypes:),
			std::mem::transmute::<DragHitTest, Imp>(routed_drag_hit_test),
			objc2::ffi::method_getTypeEncoding(drag_hit_test),
		);
		// Private KVC key, as wry's own `transparent` option sets.
		let main = &*(view as *const NSView);
		main.setValue_forKey(
			Some(&NSNumber::numberWithBool(false)),
			ns_string!("drawsBackground"),
		);
	}
	MAIN.store(view, Ordering::Release);
	// Before dispatch, so the view losing moves is cut off on the move that
	// leaves it.
	let route = block2::RcBlock::new(|event: *mut AnyObject| -> *mut AnyObject {
		// Safety: AppKit hands a live NSEvent to the monitor, on the main thread.
		if let (Some(main), Some(moved)) =
			(main_view(), unsafe { (event as *const NSEvent).as_ref() })
		{
			if main.window().map(|window| window.windowNumber()) == Some(moved.windowNumber()) {
				route_moves(
					main,
					main.convertPoint_fromView(moved.locationInWindow(), None),
				);
			}
		}
		event
	});
	// NSEventMaskMouseMoved. Held for the app's lifetime, like the main view.
	let mask: u64 = 1 << 5;
	// Safety: a class method taking a mask and an `NSEvent *(^)(NSEvent *)` block.
	let monitor: Option<Retained<AnyObject>> = unsafe {
		msg_send![class!(NSEvent), addLocalMonitorForEventsMatchingMask: mask, handler: &*route]
	};
	std::mem::forget(monitor);
}

/// Whether `point` (app view coordinates) belongs to a visible page and not to
/// the panel's UI above it.
fn over_page(main: &NSView, point: NSPoint) -> bool {
	let input = INPUT.lock().unwrap();
	if input.blocked {
		return false;
	}
	// Safety: the main thread's view tree.
	let Some(parent) = (unsafe { main.superview() }) else {
		return false;
	};
	let class = main.class();
	let page = parent.subviews().iter().any(|view| {
		!std::ptr::eq(&*view, main)
			&& std::ptr::eq(view.class(), class)
			&& !view.isHidden()
			&& point_in(
				main.convertRect_fromView(view.frame(), Some(&parent)),
				point,
			)
	});
	if !page {
		return false;
	}
	// The app view is flipped: its coordinates read like CSS px.
	let width = main.frame().size.width;
	!input.exclude.iter().any(|&(x, y, w, h, viewport)| {
		let scale = if viewport > 0.0 {
			width / viewport
		} else {
			1.0
		};
		point_in(
			NSRect::new(
				NSPoint::new(x * scale, y * scale),
				NSSize::new(w * scale, h * scale),
			),
			point,
		)
	})
}

fn point_in(rect: NSRect, point: NSPoint) -> bool {
	point.x >= rect.origin.x
		&& point.y >= rect.origin.y
		&& point.x < rect.origin.x + rect.size.width
		&& point.y < rect.origin.y + rect.size.height
}

fn main_view() -> Option<&'static NSView> {
	// Safety: set once to the app's webview, which outlives every event.
	unsafe { (MAIN.load(Ordering::Acquire) as *const NSView).as_ref() }
}

/// # Safety
/// AppKit's `hitTest:` arguments, with the original implementation available.
unsafe extern "C-unwind" fn routed_hit_test(
	this: *mut AnyObject,
	cmd: Sel,
	point: NSPoint,
) -> *mut AnyObject {
	if let Some(main) = main_view().filter(|main| std::ptr::eq(*main as *const NSView, this.cast()))
	{
		// `point` is in the superview's coordinates.
		// Safety: the main thread's view tree.
		let local = main.convertPoint_fromView(point, unsafe { main.superview() }.as_deref());
		if over_page(main, local) {
			return null_mut();
		}
	}
	let original = HIT_TEST.get().expect("installed before routing");
	// Safety: AppKit's arguments, forwarded to the original implementation.
	unsafe { original(this, cmd, point) }
}

/// # Safety
/// AppKit's `_hitTest:dragTypes:` arguments, with the original available.
unsafe extern "C-unwind" fn routed_drag_hit_test(
	this: *mut AnyObject,
	cmd: Sel,
	point: *mut NSPoint,
	types: *mut AnyObject,
) -> *mut AnyObject {
	if let Some(main) = main_view().filter(|main| std::ptr::eq(*main as *const NSView, this.cast()))
	{
		// Safety: AppKit passes a live point in the superview's coordinates.
		if let Some(at) = unsafe { point.as_ref() } {
			let local = main.convertPoint_fromView(*at, unsafe { main.superview() }.as_deref());
			if over_page(main, local) {
				return null_mut();
			}
		}
	}
	let original = DRAG_HIT_TEST.get().expect("installed before routing");
	// Safety: AppKit's arguments, forwarded to the original implementation.
	unsafe { original(this, cmd, point, types) }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn point_in_covers_half_open_edges() {
		let rect = point_rect(10.0, 20.0, 30.0, 40.0);
		assert!(point_in(rect, NSPoint::new(10.0, 20.0)));
		assert!(point_in(rect, NSPoint::new(39.0, 59.0)));
		assert!(!point_in(rect, NSPoint::new(40.0, 30.0)));
		assert!(!point_in(rect, NSPoint::new(9.0, 20.0)));
	}

	fn point_rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
		NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
	}
}
