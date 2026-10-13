// A-Coder desktop page agent: installed by the browser panel's bridge
// (browser/agent.rs) under Symbol.for("a-coder.agent") in the page's world.
// It answers ONE op at a time, synchronously, so the eval callback gets a
// JSON string back — no promises, no postMessage, no IPC from the page.
// The page shares this world, so everything it reports must be treated as
// potentially fake by the panel.
//
// Ops (each with stable refs between ops):
//   snapshot {fullPage?, ref?}      -> text render of the page with [rN] refs
//   find {query}                    -> ref'd hits, honoring the same visibility
//   describe {ref?}                 -> one element, incl. form/submitter facts
//   click {ref, navigateLinks?}     -> {navigate} for real links: the panel
//                                      navigates, keeping the address bar true
//   type {ref, text, submit?}       -> sets the value the way frameworks see it
//   select {ref, value}             -> by value or option text
//   scroll {direction, ref?}        -> the page or a scrollable `ref`
//   press {key}                     -> on the focused element
//   status                          -> quiet time, position (for settling)
//
// Secret fields are redacted in text ("filled"/"empty") and can be masked for
// screenshots by the panel (op "mask"). The page can fake any of this, so the
// panel cross-checks against captures before acting on it.
(function () {
	"use strict";

	var MAX_LINE = 200;
	var VIEW_CHARS = 8000;
	var PAGE_CHARS = 24000;
	var MAX_LINKS = 400;
	var MAX_ELEMENTS = 1200;

	var SKIP_TAGS = { script: 1, style: 1, noscript: 1, template: 1, head: 1, meta: 1, link: 1, title: 1 };
	var ROLES = {
		button: 1, link: 1, checkbox: 1, radio: 1, switch: 1, tab: 1,
		menuitem: 1, option: 1, combobox: 1, textbox: 1, searchbox: 1,
		slider: 1, spinbutton: 1, treeitem: 1,
	};
	var BUTTON_INPUTS = { button: 1, submit: 1, reset: 1, image: 1 };
	var SELECT_INPUTS = { checkbox: 1, radio: 1 };
	var TEXT_INPUTS = { text: 1, search: 1, email: 1, url: 1, tel: 1, number: 1, password: 1, none: 1, date: 1, time: 1, month: 1, week: 1 };
	var SECRET_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/i;
	var SECRET_NAME = /\b(password|passcode|card ?number|cvc|cvv|security code|ssn|social security)\b/i;
	var BLOCK_DISPLAY = /^(block|flex|grid|table|list-item|table-row|table-cell|flow-root)/;

	// ---- refs: stable across ops, dead with their element ----

	var refs = new WeakMap();
	var byRef = new Map();
	var nextRef = 1;
	var lastMutation = 0;
	try {
		new MutationObserver(function () {
			lastMutation = Date.now();
		}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
	} catch (error) {
		// No document element yet: settling reads as already quiet.
	}

	function quietMs() {
		return Math.max(0, Date.now() - lastMutation);
	}

	function refOf(el) {
		if (!(el instanceof Element)) return null;
		var id = refs.get(el);
		if (id === undefined) {
			if (nextRef > 900000) return null; // Refuse, not wrap: a wrapped ref points at the past.
			id = nextRef++;
			refs.set(el, id);
			byRef.set(id, new WeakRef(el));
		}
		return "r" + id;
	}

	function lookup(ref) {
		var id = Number(String(ref == null ? "" : ref).replace(/^r/i, ""));
		var el = byRef.get(id) && byRef.get(id).deref();
		if (!el || !el.isConnected) throw new Error(ref + " is gone from the page; snapshot for fresh refs.");
		return el;
	}

	// ---- text helpers ----

	function clean(value, max) {
		var text = value == null ? "" : String(value).replace(/\s+/g, " ").trim();
		max = max || 80;
		return text.length > max ? text.slice(0, max - 1) + "…" : text;
	}

	function quoted(value) {
		return JSON.stringify(value);
	}

	// ---- visibility, accessibility roles and names ----

	function hiddenEl(el, style) {
		return (
			el.getAttribute("aria-hidden") === "true" ||
			el.hidden === true ||
			style.display === "none" ||
			style.visibility === "hidden" ||
			style.visibility === "collapse" ||
			style.opacity === "0"
		);
	}

	function sized(rect) {
		return rect.width > 1 && rect.height > 1;
	}

	function onScreen(rect) {
		return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
	}

	function roleOf(el) {
		var explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
		if (explicit && ROLES[explicit]) return explicit;
		var tag = el.tagName.toLowerCase();
		if (tag === "a" && el.hasAttribute("href")) return "link";
		if (tag === "button" || tag === "summary") return "button";
		if (tag === "select") return "combobox";
		if (tag === "textarea") return "textbox";
		if (tag === "input") {
			var type = ((el.type || "text") || "text").toLowerCase();
			if (type === "hidden") return null;
			if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
			if (type === "checkbox" || type === "radio") return type;
			if (type === "range") return "slider";
			if (type === "search") return "searchbox";
			if (type === "file") return "file-input";
			if (type === "password") return "password";
			return "textbox";
		}
		if (el.isContentEditable && el.hasAttribute("contenteditable")) return "textbox";
		return null;
	}

	// The control's words, minus what the page hides: hidden text must not name
	// a button.
	function visibleText(root) {
		var words = [];
		var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
		for (var node = walker.nextNode(); node; node = walker.nextNode()) {
			var shown = !node.parentElement || parseFloat(getComputedStyle(node.parentElement).fontSize) >= 2;
			for (var el = node.parentElement; el && shown; el = el === root ? null : el.parentElement) {
				var style = getComputedStyle(el);
				if (hiddenEl(el, style)) shown = false;
				else if (el !== root && style.display !== "contents" && !sized(el.getBoundingClientRect())) shown = false;
			}
			if (shown) words.push(node.nodeValue || "");
		}
		return words.join(" ");
	}

	function nameOf(el) {
		var aria = el.getAttribute("aria-label");
		if (aria && aria.trim()) return clean(aria);
		var labelledBy = el.getAttribute("aria-labelledby");
		if (labelledBy) {
			var text = labelledBy
				.split(/\s+/)
				.map(function (id) {
					var label = document.getElementById(id);
					if (!label) return "";
					var style = getComputedStyle(label);
					if (style.display !== "contents" && !sized(label.getBoundingClientRect())) return "";
					return visibleText(label);
				})
				.join(" ");
			if (text.trim()) return clean(text);
		}
		var field = el;
		if (field.labels && field.labels.length) {
			var words = Array.prototype.map
				.call(field.labels, function (label) {
					return visibleText(label);
				})
				.join(" ");
			if (words.trim()) return clean(words);
		}
		var tag = el.tagName.toLowerCase();
		if (tag === "input" && BUTTON_INPUTS[(field.type || "").toLowerCase()] && field.value) return clean(field.value);
		if (tag === "input" && field.type === "image" && el.getAttribute("alt")) return clean(el.getAttribute("alt"));
		if (tag === "input" || tag === "textarea") {
			return clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name"));
		}
		if (tag === "select") return clean(el.getAttribute("title") || el.getAttribute("name"));
		var own = visibleText(el);
		if (own.trim()) return clean(own);
		var img = el.querySelector("img[alt]");
		var titled = el.querySelector("[title], [aria-label]");
		return clean(
			(img && img.getAttribute("alt")) || el.getAttribute("title") || (titled && (titled.getAttribute("aria-label") || titled.getAttribute("title")))
		);
	}

	// The input type, not the role: role="textbox" on a password field must not
	// show its value.
	function isSecret(el, role) {
		if (role === "password") return true;
		var tag = el.tagName.toLowerCase();
		if (tag === "input" && (el.type || "").toLowerCase() === "password") return true;
		if (SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "")) return true;
		return Boolean(el.value) && SECRET_NAME.test(nameOf(el));
	}

	function sameSite(href) {
		try {
			var url = new URL(href, document.baseURI);
			var pageUrl = new URL(document.baseURI || location.href);
			return clean(url.origin === pageUrl.origin ? url.pathname + url.search + url.hash : url.href, 120);
		} catch (error) {
			return clean(href, 120);
		}
	}

	function stateOf(el, role) {
		var parts = [];
		var tag = el.tagName.toLowerCase();
		if (tag === "input" || tag === "textarea") {
			if (SELECT_INPUTS[role]) parts.push(el.checked ? "checked" : "unchecked");
			else if (isSecret(el, role)) parts.push(el.value ? "filled" : "empty");
			else if (role !== "button" && role !== "file-input" && el.value) parts.push("value=" + quoted(clean(el.value, 60)));
		} else if (tag === "select") {
			var chosen = el.selectedOptions && el.selectedOptions[0];
			if (chosen) parts.push("selected=" + quoted(clean(chosen.text, 40)));
			var options = Array.prototype.map.call(el.options || [], function (option) {
				return clean(option.text, 30);
			});
			if (options.length) parts.push("options: " + options.slice(0, 8).join(" | ") + (options.length > 8 ? " (+" + (options.length - 8) + " more)" : ""));
		} else if (role === "textbox" && el.isContentEditable) {
			var value = clean(el.innerText, 60);
			var secret = SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "") || SECRET_NAME.test(nameOf(el));
			if (secret) parts.push(value ? "filled" : "empty");
			else if (value) parts.push("value=" + quoted(value));
		} else if (role === "link") {
			var href = el.getAttribute("href") || "";
			if (href && href.indexOf("javascript:") !== 0) parts.push("-> " + sameSite(href));
		}
		var checked = el.getAttribute("aria-checked");
		if (checked && tag !== "input") parts.push(checked === "true" ? "checked" : "unchecked");
		if (el.getAttribute("aria-expanded")) parts.push(el.getAttribute("aria-expanded") === "true" ? "expanded" : "collapsed");
		if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current")) parts.push("current");
		if (el.getAttribute("aria-pressed") === "true") parts.push("pressed");
		if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
		if (el.required) parts.push("required");
		return parts;
	}

	function elementLine(el, role) {
		var name = nameOf(el);
		return ["[" + refOf(el) + "] " + role, name ? quoted(name) : ""]
			.concat(stateOf(el, role))
			.filter(Boolean)
			.join(" ");
	}

	// ---- the readable render ----

	var SCROLLER = document.scrollingElement || document.documentElement;

	function position() {
		var height = Math.max(SCROLLER.scrollHeight, document.body ? document.body.scrollHeight : 0);
		if (height <= window.innerHeight + 4) return "";
		var top = Math.round(SCROLLER.scrollTop || window.scrollY);
		var bottom = Math.min(height, top + window.innerHeight);
		return "Showing " + top + "-" + bottom + "px of " + height + "px; scroll for more.";
	}

	function read(root, wholePage, budget) {
		var lines = [];
		var links = [];
		var used = 0;
		var cut = false;
		var buffer = "";
		var bufferShown = false;

		function push(line) {
			if (cut) return;
			if (used + line.length + 1 > budget) {
				cut = true;
				return;
			}
			lines.push(line);
			used += line.length + 1;
		}

		function flush() {
			var text = clean(buffer, 400);
			if (text && bufferShown && text.length > 1) push(text);
			buffer = "";
			bufferShown = false;
		}

		function walk(el) {
			if (cut) return;
			var tag = el.tagName.toLowerCase();
			if (SKIP_TAGS[tag]) return;
			var style = getComputedStyle(el);
			if (hiddenEl(el, style)) return;
			var rect = el.getBoundingClientRect();
			var shown = wholePage || onScreen(rect);
			var role = roleOf(el);
			if (role) {
				if (sized(rect) || role === "checkbox" || role === "radio") {
					flush();
					if (shown) {
						push(elementLine(el, role));
						if (role === "link" && links.length < MAX_LINKS && el.href) links.push(el.href);
					}
				}
				if (role !== "combobox" || tag === "select") return;
			}
			if (tag === "iframe" || tag === "canvas" || tag === "video" || tag === "img") {
				if (shown && sized(rect)) {
					var label = tag === "img" ? clean(el.getAttribute("alt"), 80) : "";
					if (tag !== "img" || label) {
						flush();
						push((tag === "img" ? "image" : tag) + (label ? " " + quoted(label) : ""));
					}
				}
				return;
			}
			var heading = /^h([1-6])$/.exec(tag);
			if (heading) {
				flush();
				var text = clean(visibleText(el), 200);
				if (shown && text) push(new Array(Number(heading[1]) + 1).join("#") + " " + text);
				var controls = el.querySelectorAll("a[href], button, input, [role]");
				for (var i = 0; i < controls.length; i++) walk(controls[i]);
				return;
			}
			if (BLOCK_DISPLAY.test(style.display)) flush();
			var labelledTag = tag === "label" && el.control;
			var unreadable = parseFloat(style.fontSize) < 2;
			var children = el.shadowRoot
				? Array.prototype.slice.call(el.shadowRoot.childNodes).concat(Array.prototype.slice.call(el.childNodes))
				: Array.prototype.slice.call(el.childNodes);
			var count = 0;
			for (var j = 0; j < children.length; j++) {
				var node = children[j];
				if (cut) return;
				if (node.nodeType === 3 /* TEXT */) {
					var value = node.nodeValue || "";
					if (unreadable) buffer += " ";
					else if (!labelledTag) {
						buffer += value;
						if (value.trim() && shown && sized(rect)) bufferShown = true;
					}
				} else if (node.nodeType === 1 /* ELEMENT */) {
					count++;
					if (count <= MAX_ELEMENTS) walk(node);
					else flush();
				}
			}
			if (BLOCK_DISPLAY.test(style.display)) flush();
		}

		walk(root);
		flush();
		return { text: lines.join("\n"), links: links, cut: cut };
	}

	// ---- interaction ----

	function covering(el) {
		var rect = el.getBoundingClientRect();
		var top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		if (!top || top === el || el.contains(top) || top.contains(el)) return null;
		if (top.control === el) return null;
		for (var node = top; node && node !== document.body; node = node.parentElement) {
			if (node.contains(el)) return null;
			var position = getComputedStyle(node).position;
			if (position === "fixed" || position === "sticky") return node;
		}
		return null;
	}

	function mouse(el, type) {
		var rect = el.getBoundingClientRect();
		var init = {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			button: 0,
			view: window,
		};
		var event = type.indexOf("pointer") === 0
			? new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true })
			: new MouseEvent(type, init);
		el.dispatchEvent(event);
	}

	function isSubmitter(node) {
		if (node instanceof HTMLButtonElement) return node.type === "submit";
		return node instanceof HTMLInputElement && (node.type === "submit" || node.type === "image");
	}

	function defaultSubmitter(form) {
		if (!form) return null;
		var nodes = document.querySelectorAll("button, input");
		for (var i = 0; i < nodes.length; i++) {
			if (nodes[i].form === form && isSubmitter(nodes[i])) return nodes[i];
		}
		return null;
	}

	function describeEl(el, forSelectValue) {
		var holder = el.closest ? el.closest("button, label") : null;
		var target = holder || el;
		if (target instanceof HTMLLabelElement && target.control) target = target.control;
		var field = target;
		var form = (field.form || (target.closest ? target.closest("form") : null)) || null;
		var anchor = target.closest ? target.closest("a[href]") : null;
		var tag = target.tagName.toLowerCase();
		var submits = Boolean(form) && isSubmitter(target);
		var submitterEl = submits ? target : defaultSubmitter(form);
		var method = (submitterEl && submitterEl.getAttribute("formmethod")) || (form && form.getAttribute("method")) || "get";
		var action = submitterEl && submitterEl.hasAttribute("formaction")
			? new URL(submitterEl.getAttribute("formaction"), document.baseURI).href
			: form && form.action
				? form.action
				: document.baseURI || location.href;
		var info = {
			role: roleOf(target) || (anchor ? "link" : "element"),
			name: nameOf(target) || (anchor ? nameOf(anchor) : ""),
			tag: tag,
			type: (field.type || "").toLowerCase(),
			href: anchor ? anchor.href : "",
			autocomplete: (target.getAttribute("autocomplete") || "").toLowerCase(),
			formMethod: form ? String(method).toLowerCase() : "get",
			formAction: form ? action : "",
			formHasPassword: form
				? Array.prototype.some.call(form.elements, function (node) {
						return node.type === "password";
					})
				: false,
			submits: submits,
			rect: rectOf(target),
			quietMs: quietMs(),
		};
		if (target instanceof HTMLSelectElement && typeof forSelectValue === "string") {
			var option = findOption(target, forSelectValue);
			info.option = option ? clean(option.text, 200) : "";
		}
		return info;
	}

	function findOption(select, value) {
		var options = select.options || [];
		for (var i = 0; i < options.length; i++) {
			if (options[i].value === value || clean(options[i].text, 100) === clean(value, 100)) return options[i];
		}
		return null;
	}

	function setValue(el, value) {
		var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		// The prototype's setter, so frameworks that wrap the element's own
		// setter see the change.
		var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
		if (descriptor && descriptor.set) descriptor.set.call(el, value);
		else el.value = value;
		el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
	}

	function pressKey(target, name) {
		var keyName = name === "Space" ? " " : name;
		var init = { key: keyName, code: name === " " ? "Space" : name, bubbles: true, cancelable: true, composed: true };
		var down = target.dispatchEvent(new KeyboardEvent("keydown", init));
		if (down && keyName === "Enter") {
			target.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, composed: true, key: "Enter", code: "Enter", charCode: 13, keyCode: 13 }));
		}
		target.dispatchEvent(new KeyboardEvent("keyup", init));
		return down;
	}

	function scrollerOf(el) {
		if (!el || el === document.body) return SCROLLER;
		var node = el;
		while (node && node !== document.documentElement) {
			var style = getComputedStyle(node);
			if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
			node = node.parentElement;
		}
		return SCROLLER;
	}

	// ---- masking for screenshots ----

	var masked = [];

	function mask(on) {
		while (masked.length) {
			var entry = masked.pop();
			entry.el.style.setProperty("color", entry.color);
			entry.el.style.setProperty("-webkit-text-fill-color", entry.fill === null ? "" : entry.fill);
			entry.el.style.setProperty("text-shadow", entry.shadow);
			if (entry.frameHidden) {
				entry.el.style.visibility = entry.visibility;
			}
		}
		if (!on) return { ok: true, masked: masked.length };
		var fields = document.querySelectorAll("input, textarea, [contenteditable]");
		for (var i = 0; i < fields.length; i++) {
			var el = fields[i];
			var secret = el.isContentEditable
				? Boolean((el.innerText || "").trim()) && (SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "") || SECRET_NAME.test(nameOf(el)))
				: Boolean(el.value) && isSecret(el, roleOf(el));
			if (!secret) continue;
			masked.push({
				el: el,
				color: el.style.color,
				fill: el.style.getPropertyValue("-webkit-text-fill-color"),
				shadow: el.style.textShadow,
				frameHidden: false,
			});
			el.style.setProperty("color", "transparent", "important");
			el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
			el.style.setProperty("text-shadow", "none", "important");
		}
		// Fields inside frames cannot be read from here: hide the frames.
		var frames = document.querySelectorAll("iframe, frame");
		for (var j = 0; j < frames.length; j++) {
			masked.push({
				el: frames[j],
				color: "",
				fill: "",
				shadow: "",
				frameHidden: true,
				visibility: frames[j].style.visibility || "",
			});
			frames[j].style.setProperty("visibility", "hidden", "important");
		}
		return { ok: true };
	}

	// ---- the one entry point ----

	function run(op) {
		try {
			return dispatch(op || {});
		} catch (error) {
			return { ok: false, error: String((error && error.message) || error) };
		}
	}

	function dispatch(op) {
		switch (op.op) {
			case "snapshot": {
				var root;
				try {
					root = op.ref ? lookup(op.ref) : document.body || document.documentElement;
				} catch (error) {
					return { ok: false, error: String(error.message || error) };
				}
				var full = Boolean(op.fullPage || op.ref);
				var out = read(root, full, full ? PAGE_CHARS : VIEW_CHARS);
				var header = op.ref || op.fullPage ? "" : position();
				var tail = out.cut ? "\n… (more below: scroll, find, or a snapshot ref)" : "";
				var dialog = document.querySelector('dialog[open], [role=dialog][aria-modal="true"], [role=alertdialog]');
				var notes = [header, dialog ? "A dialog is open." : ""].filter(Boolean).join(" ");
				return {
					ok: true,
					text: (notes ? notes + "\n" : "") + (out.text || "(nothing readable here)") + tail,
					links: out.links,
					quietMs: quietMs(),
				};
			}
			case "find": {
				var terms = String(op.query || "").toLowerCase().split(/\s+/).filter(Boolean);
				if (!terms.length) return { ok: true, text: "Nothing to search for." };
				var hits = [];
				var links = [];
				var all = document.querySelectorAll("body *");
				var limit = Math.min(all.length, 30000);
				for (var i = 0; i < limit; i++) {
					if (hits.length >= 20) break;
					var el = all[i];
					var tag = el.tagName.toLowerCase();
					if (SKIP_TAGS[tag]) continue;
					var role = roleOf(el);
					var haystack;
					if (role) {
						haystack = role + " " + nameOf(el) + " " + stateOf(el, role).join(" ");
					} else {
						var own = "";
						var kids = el.childNodes;
						for (var k = 0; k < kids.length; k++) {
							if (kids[k].nodeType === 3) own += kids[k].nodeValue || "";
						}
						if (!own.trim() || parseFloat(getComputedStyle(el).fontSize) < 2) continue;
						haystack = own;
					}
					var lower = haystack.toLowerCase();
					var matched = true;
					for (var t = 0; t < terms.length; t++) {
						if (lower.indexOf(terms[t]) === -1) {
							matched = false;
							break;
						}
					}
					if (!matched) continue;
					if (el.closest("[aria-hidden=true], [hidden]")) continue;
					var rect = el.getBoundingClientRect();
					if (!sized(rect)) continue;
					var checkVisibility = el.checkVisibility;
					if (checkVisibility && !checkVisibility.call(el, { checkOpacity: true, checkVisibilityCSS: true })) continue;
					var where = rect.bottom < 0 ? " (above)" : rect.top > window.innerHeight ? " (below)" : "";
					if (role) {
						hits.push(elementLine(el, role) + where);
						if (role === "link" && el.href) links.push(el.href);
					} else {
						hits.push("[" + refOf(el) + "] text " + quoted(clean(haystack, 160)) + where);
					}
				}
				return {
					ok: true,
					text: hits.length ? hits.join("\n") : "Nothing on this page matches " + quoted(String(op.query)) + ".",
					links: links,
					quietMs: quietMs(),
				};
			}
			case "describe": {
				var el2 = op.ref ? lookup(op.ref) : document.activeElement || document.body;
				return { ok: true, info: describeEl(el2) };
			}
			case "click": {
				var el3 = lookup(op.ref);
				el3.scrollIntoView({ block: "center", inline: "center" });
				var over = covering(el3);
				if (over) {
					return {
						ok: false,
						error: op.ref + " is covered by an overlay; snapshot to find its close button, or scroll first.",
					};
				}
				var anchor = el3.closest ? el3.closest("a[href]") : null;
				var href = anchor ? anchor.href : "";
				if (anchor && /^https?:/i.test(href)) {
					var target = new URL(href);
					var page = new URL(document.baseURI || location.href);
					if (!(target.hash && target.href.split("#")[0] === page.href.split("#")[0])) {
						if (op.navigateLinks || anchor.target === "_blank") return { ok: true, navigate: href };
					}
				}
				mouse(el3, "pointerover");
				mouse(el3, "pointerdown");
				mouse(el3, "mousedown");
				if (typeof el3.focus === "function") el3.focus({ preventScroll: true });
				mouse(el3, "pointerup");
				mouse(el3, "mouseup");
				if (typeof el3.click === "function") el3.click();
				else mouse(el3, "click");
				return { ok: true, info: describeEl(el3), quietMs: quietMs() };
			}
			case "type": {
				var el4 = lookup(op.ref);
				el4.scrollIntoView({ block: "center" });
				if (typeof el4.focus === "function") el4.focus({ preventScroll: true });
				setValue(el4, String(op.text == null ? "" : op.text));
				if (op.submit) pressKey(el4, "Enter");
				// What will happen on submit, so the panel can gate it.
				return { ok: true, info: describeEl(el4), quietMs: quietMs() };
			}
			case "select": {
				var el5 = lookup(op.ref);
				if (!(el5 instanceof HTMLSelectElement)) return { ok: false, error: "not a dropdown" };
				var option = findOption(el5, String(op.value == null ? "" : op.value));
				if (!option) return { ok: false, error: "no such option" };
				el5.scrollIntoView({ block: "center" });
				el5.value = option.value;
				el5.dispatchEvent(new Event("input", { bubbles: true }));
				el5.dispatchEvent(new Event("change", { bubbles: true }));
				return { ok: true, info: describeEl(el5, op.value), quietMs: quietMs() };
			}
			case "scroll": {
				var scroller = scrollerOf(op.ref ? lookup(op.ref) : null);
				if (op.direction === "up") scroller.scrollTop -= scroller.clientHeight * 0.9;
				else if (op.direction === "top") scroller.scrollTop = 0;
				else scroller.scrollTop += scroller.clientHeight * 0.9;
				return { ok: true, text: position(), quietMs: quietMs() };
			}
			case "press": {
				var focus = document.activeElement || document.body;
				pressKey(focus, String(op.key || "Enter"));
				return { ok: true, quietMs: quietMs() };
			}
			case "mask":
				return mask(Boolean(op.on));
			case "status":
				return { ok: true, quietMs: quietMs(), position: position(), url: location.href, title: document.title };
			default:
				return { ok: false, error: "unknown op: " + String(op.op) };
		}
	}

	function rectOf(el) {
		var r = el.getBoundingClientRect();
		return {
			x: Math.round(r.x),
			y: Math.round(r.y),
			width: Math.round(r.width),
			height: Math.round(r.height),
		};
	}

	return { run: run };
})();