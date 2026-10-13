// Carves a viewport-rectangular hole in the app's DOM backgrounds so the
// native page view under the app webview shows through. Ancestor backgrounds
// stay visible around the hole: marked nodes go transparent and repaint
// their own color as four fixed bands that stop at the hole's edges.
// Technique modeled on unsloth/studio's native-hole system (AGPL — studied,
// not copied).

const ATTRIBUTE = "data-native-hole";
const VARS = ["--hole-x", "--hole-y", "--hole-w", "--hole-h"] as const;

let placeholder: HTMLElement | null = null;
let holed: HTMLElement[] = [];
let signature = "";
let rect: { x: number; y: number; width: number; height: number } | null = null;
let themeWatcher: MutationObserver | null = null;

/** True when a computed color actually paints (alpha > 0, not "none"). */
function opaque(color: string): boolean {
	if (color === "transparent" || color === "none") return false;
	// Computed colors end in either "rgb(r g b)", "rgba(r, g, b, a)" or a
	// slash form ("lab(...) / a)"). An explicit alpha of 0 does not paint.
	const alpha =
		/\/\s*([\d.]+)(?:%?)\s*\)$/.exec(color) ?? /,\s*([\d.]+)\s*\)$/.exec(color);
	return !alpha || Number.parseFloat(alpha[1]) > 0;
}

/** Marks every opaque ancestor of the placeholder; returns true if re-walked. */
function mark(): boolean {
	if (!placeholder || !placeholder.isConnected) return false;
	const chain: HTMLElement[] = [];
	for (let node: HTMLElement | null = placeholder; node; node = node.parentElement) {
		chain.push(node);
	}
	// Rerender keys that change background colors cheaply detectable: the
	// html class list (theme) and each node's classes.
	const root = document.documentElement;
	const next = `${root.className}|${chain.map((node) => node.className).join("|")}`;
	if (next === signature && holed.every((node) => node.isConnected)) return false;
	closeHole();
	signature = next;
	chain.forEach((node) => {
		// Computed styles must all be read before any mutation, or later
		// reads see the mutation's transparency.
		const computed = getComputedStyle(node);
		if (computed.backgroundImage !== "none" || !opaque(computed.backgroundColor)) {
			return;
		}
		node.style.setProperty("--hole-bg", computed.backgroundColor);
		node.setAttribute(ATTRIBUTE, "");
		holed.push(node);
	});
	place();
	// Everything transparent mid-theme-flip: retry on the next call.
	if (holed.length === 0) signature = "";
	return true;
}

/** Measures the placeholder and writes the hole rect into every marked node. */
function place(): void {
	if (!placeholder) return;
	const box = placeholder.getBoundingClientRect();
	rect =
		box.width > 0 && box.height > 0
			? { x: box.x, y: box.y, width: box.width, height: box.height }
			: null;
	for (const node of holed) {
		for (const [index, name] of VARS.entries()) {
			const value = rect ? [rect.x, rect.y, rect.width, rect.height][index] : 0;
			node.style.setProperty(name, `${value}px`);
		}
	}
}

/**
 * Points the hole at `element` (the panel in layered mode), re-walking the
 * ancestor chain when the DOM or theme changed and re-measuring the rect.
 * Called on every bounds update; early-exits when nothing changed.
 */
export function updateHole(next: HTMLElement | null): void {
	if (!next) {
		closeHole();
		return;
	}
	placeholder = next;
	mark();
	place();
	watchTheme();
}

/** Drops every marked node; the hole is gone and backgrounds return. */
export function closeHole(): void {
	for (const node of holed) {
		node.removeAttribute(ATTRIBUTE);
		node.style.removeProperty("--hole-bg");
		for (const name of VARS) node.style.removeProperty(name);
	}
	holed = [];
	signature = "";
	rect = null;
	placeholder = null;
	if (themeWatcher) {
		themeWatcher.disconnect();
		themeWatcher = null;
	}
}

/** Keeps a watcher alive while a hole is open: theme flips re-walk. */
function watchTheme(): void {
	if (themeWatcher || typeof MutationObserver === "undefined") return;
	themeWatcher = new MutationObserver(() => {
		mark();
	});
}

export function getHoleRect(): { x: number; y: number; width: number; height: number } | null {
	return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}