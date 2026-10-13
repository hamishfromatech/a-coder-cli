//! Tab mute. Windows mutes the whole view through WebView2 (audio contexts
//! included) and it stays muted across loads; macOS WebKit has no public mute,
//! so the page's media is silenced by an injected script and re-silenced on
//! every commit (a fresh document has fresh media). Linux has neither route.

use tauri::Runtime;
use tauri::{Manager, Webview};

use super::tabs;

/// Silence `tab_id`; re-applied per load on macOS (see tabs' page-load hook).
#[tauri::command]
pub async fn browser_tab_mute<R: Runtime>(
	webview: Webview<R>,
	tab_id: String,
	muted: bool,
) -> Result<(), String> {
	super::require_main(&webview)?;
	let app = webview.app_handle();
	{
		let state = app.state::<tabs::TabsState>();
		let mut inner = state.inner.lock().unwrap();
		if muted {
			inner.muted.insert(tab_id.clone());
		} else {
			inner.muted.remove(&tab_id);
		}
	}
	// No view yet: it is muted as it opens (the page-load hook re-applies).
	let Some(page) = app.get_webview(&format!("{}{tab_id}", tabs::LABEL_PREFIX)) else {
		return Ok(());
	};
	apply(&page, muted)
}

pub(crate) fn apply<R: Runtime>(page: &Webview<R>, muted: bool) -> Result<(), String> {
	#[cfg(target_os = "macos")]
	{
		page.eval(format!("{MUTE_SCRIPT}({muted})"))
			.map_err(|error| error.to_string())
	}
	#[cfg(windows)]
	{
		// Fire-and-forget: WebView2's mute lands on the controller; failures
		// surface as audible audio, not a broken panel.
		let _ = page.with_webview(move |platform| {
			if let Ok(core) = unsafe { platform.controller.CoreWebView2() } {
				if let Ok(muted_view) = unsafe {
					core.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8>()
				} {
					let _ = unsafe { muted_view.SetIsMuted(windows_core::BOOL::from(muted)) };
				}
			}
		});
		Ok(())
	}
	#[cfg(not(any(target_os = "macos", windows)))]
	Err("Muting is unsupported on this platform".into())
}

/// Mutes a page's media and its audio contexts in place, installable once per
/// document and toggleable after. Media created while on stays muted because
/// `play` is wrapped and elements are tracked; contexts are suspended and
/// resumed. Run in the page's own world, so a page can undo it for itself.
#[cfg(target_os = "macos")]
const MUTE_SCRIPT: &str = r#"
((muted) => {
  const key = Symbol.for("a-coder.browser.mute");
  if (!window[key]) {
    let on = false;
    const silenced = new Set();
    const contexts = new Set();
    const paused = new Set();
    const silence = (media) => {
      if (media.muted) return;
      media.muted = true;
      silenced.add(media);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (on) silence(this);
      return play.apply(this, args);
    };
    document.addEventListener("play", (event) => event.target instanceof HTMLMediaElement && silence(event.target), true);
    document.addEventListener("volumechange", (event) => event.target instanceof HTMLMediaElement && silence(event.target), true);
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const Base = window[name];
      if (typeof Base !== "function") continue;
      window[name] = class extends Base {
        constructor(...args) {
          super(...args);
          contexts.add(this);
          if (on && this.state === "running") {
            paused.add(this);
            this.suspend().catch(() => {});
          }
        }
      };
    }
    const toggle = (value) => {
      on = value;
      if (on) {
        for (const media of document.querySelectorAll("audio, video")) silence(media);
        for (const context of contexts) {
          if (context.state === "running") {
            paused.add(context);
            context.suspend().catch(() => {});
          }
        }
        return;
      }
      for (const media of silenced) media.muted = false;
      silenced.clear();
      for (const context of paused) context.resume().catch(() => {});
      paused.clear();
    };
    window[key] = toggle;
  }
  window[key](muted);
})"#;
