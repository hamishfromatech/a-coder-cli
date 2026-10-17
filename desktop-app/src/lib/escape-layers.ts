/**
 * Ordered Escape ownership for the app's transient window-level layers.
 *
 * Several surfaces bind their own `window` `keydown` Escape handler (command
 * palette, find bar, approval bar, model picker, titlebar inline edit, HUD
 * stop/interrupt). Without a shared order a single Escape fired all of them at
 * once — stopping an in-flight run *and* closing the palette sitting over it.
 *
 * Contract for a layer handler (higher number = closer to the user):
 *   1. bail if `event.defaultPrevented` (a higher layer already handled it);
 *   2. bail unless `isTopEscapeLayer(myPriority)` (a higher layer is open);
 *   3. otherwise act and `event.preventDefault()`.
 *
 * A layer registers its priority (via `pushEscapeLayer`) only while it's open.
 * Ported from hermes desktop's escape-layers.ts.
 */

/** Priorities: leave numeric gaps to slot new layers between them. */
export const ESCAPE_PRIORITY = {
	/** Low: stops an in-flight agent run once nothing more urgent owns Esc. */
	engineStop: 10,
	/** Small transient menus (browser tab context menu). */
	contextMenu: 30,
	/** Titlebar inline rename edit. */
	titlebarEdit: 50,
	/** Model picker + command center overlays. */
	picker: 60,
	/** Find-in-page (⌘F). */
	findBar: 70,
	/** Command palette (⌘K). */
	palette: 80,
	/** Pending tool approval — Esc denies; most urgent surface. */
	approval: 90
} as const;

const active = new Map<symbol, number>();

/** Register an open layer; call the returned disposer when it closes. */
export function pushEscapeLayer(priority: number): () => void {
	const key = Symbol("escape-layer");
	active.set(key, priority);
	return () => {
		active.delete(key);
	};
}

/** True when no open layer outranks `priority`, so its handler should act. */
export function isTopEscapeLayer(priority: number): boolean {
	for (const p of active.values()) {
		if (p > priority) return false;
	}
	return true;
}