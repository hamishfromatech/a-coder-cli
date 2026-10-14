//! Content rules for the agent's page views, macOS only (defense in
//! depth): the agent reads page content, not ads — well-known ad/tracker
//! domains are excluded, and https: pages cannot pull insecure script,
//! style, image, font, or media subresources through. The rules never touch
//! the app's own chrome webview; the fallback platforms police the same
//! spirit at the gateway proxy instead. A page can slip through only in the
//! seconds before the first compile completes; every later page is covered
//! from its first load, since installs happen inside with_webview before
//! the page's navigation is issued.

use std::sync::Mutex;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKUserContentController};
use serde_json::{json, Value};

/// Ad/tracker networks kept out of agent page views. Small and honest: these
/// exist purely to serve ads or profile browsing; no site the agent is asked
/// to read depends on them for its content.
const BLOCKED_HOSTS: &[&str] = &[
	"doubleclick.net",
	"googlesyndication.com",
	"googleadservices.com",
	"google-analytics.com",
	"googletagmanager.com",
	"scorecardresearch.com",
	"hotjar.com",
	"mixpanel.com",
	"criteo.com",
	"criteo.net",
	"taboola.com",
	"outbrain.com",
	"adnxs.com",
	"adsrvr.org",
	"rubiconproject.com",
	"pubmatic.com",
];

/// The store identifier. The default store persists compiled lists across
/// launches, so a later run usually compiles near-instantly.
const IDENTIFIER: &str = "agent-page-blocks";

/// The compiled list, once per run.
struct CompiledList(Option<Retained<WKContentRuleList>>);
// Safety: WebKit objects live on the main thread and we only touch the
// wrapped Retained on the main thread (every caller holds a
// MainThreadMarker); nothing else can ever read it concurrently.
unsafe impl Send for CompiledList {}
static COMPILED: Mutex<CompiledList> = Mutex::new(CompiledList(None));

/// The content-rule JSON: one block rule per tracker host (any subdomain,
/// any path) plus the mixed-content rule for secure top pages.
pub fn rule_json() -> String {
	let mut rules = Vec::with_capacity(BLOCKED_HOSTS.len() + 1);
	for host in BLOCKED_HOSTS {
		rules.push(json!({
			"trigger": {
				"url-filter": format!("^[^:]+://[^/]*\\.{host}(/|$)"),
			},
			"action": { "type": "block" },
		}));
	}
	rules.push(json!({
		"trigger": {
			"url-filter": "^http:",
			"resource-type": ["script", "style-sheet", "image", "font", "media"],
			"if-top-url": ["https://*"],
		},
		"action": { "type": "block" },
	}));
	serde_json::to_string(&Value::Array(rules)).expect("rule list serializes")
}

/// Registers the rule list on a page view's content controller. Called on
/// the main thread for every created page. When the list is not compiled
/// yet, this controller is parked: the compile's callback installs into it
/// right before it is dropped here, so the page that triggered the compile
/// still gets covered.
pub(crate) fn install(controller: Retained<WKUserContentController>, mtm: MainThreadMarker) {
	if let Some(list) = COMPILED.lock().unwrap().0.as_ref() {
		// Safety: addContentRuleList touches WebKit state; this runs on the
		// main thread (MainThreadMarker proves it) and `list` is live.
		unsafe { controller.addContentRuleList(list) };
		return;
	}
	let Some(store) = (unsafe { WKContentRuleListStore::defaultStore(mtm) }) else {
		return;
	};
	let encoded = NSString::from_str(&rule_json());
	// Safety: the callback runs back on this same main thread (the store
	// delivers on the caller's thread); the WebKit-returned objects are
	// autoreleased on entry and the pointers stay valid for the callback.
	unsafe {
		let handler = RcBlock::new(move |list: *mut WKContentRuleList, error: *mut NSError| {
			if !error.is_null() {
				if let Some(error) = Retained::retain_autoreleased(error) {
					log::warn!("content rules did not compile: {error:?}");
				}
				return;
			}
			let Some(list) = Retained::retain_autoreleased(list) else {
				return;
			};
			add(&controller, &list);
			COMPILED.lock().unwrap().0 = Some(list);
		});
		store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
			Some(&NSString::from_str(IDENTIFIER)),
			Some(&encoded),
			Some(&*handler),
		);
	}
}

/// Applies the list to one controller and marks it current. Safety contract:
/// main thread only, `list` live.
unsafe fn add(controller: &WKUserContentController, list: &WKContentRuleList) {
	// Safety: main thread (guaranteed by every caller), both objects live.
	unsafe { controller.addContentRuleList(list) };
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rule_json_covers_the_trackers_and_mixed_content() {
		let json = rule_json();
		let parsed: Value = serde_json::from_str(&json).expect("the rule list parses");
		let rules = parsed.as_array().expect("top level is an array");
		assert_eq!(rules.len(), BLOCKED_HOSTS.len() + 1);
		for host in BLOCKED_HOSTS {
			assert!(json.contains(host), "{host} missing from the rule list");
		}
		assert!(json.contains("if-top-url"));
		assert!(json.contains("resource-type"));
	}
}
