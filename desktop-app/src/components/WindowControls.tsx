import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * In-app window controls for frameless windows (Windows/Linux; macOS keeps
 * the native overlay traffic lights). Rendered flush against the titlebar's
 * right edge, Windows-style. Double-click on the titlebar's drag region
 * toggles maximize via Tauri's injected handler, so only single clicks are
 * wired here.
 */
export function WindowControls() {
	const [maximized, setMaximized] = useState(false);

	useEffect(() => {
		if (!("__TAURI_INTERNALS__" in window)) return;
		const win = getCurrentWindow();
		let unlisten: (() => void) | undefined;
		const sync = () => {
			win.isMaximized()
				.then(setMaximized)
				.catch(() => {});
		};
		void sync();
		win.onResized(() => sync())
			.then((fn) => {
				unlisten = fn;
			})
			.catch(() => {});
		return () => unlisten?.();
	}, []);

	const controlClass =
		"flex h-full w-11 shrink-0 cursor-pointer items-center justify-center text-pi-text-muted transition-colors focus-visible:shadow-focus focus-visible:outline-none";

	return (
		<div className="flex h-full shrink-0">
			<button
				type="button"
				aria-label="Minimize window"
				onClick={() => void getCurrentWindow().minimize()}
				className={`${controlClass} hover:bg-pi-surface-raised hover:text-pi-text`}
			>
				<Minus className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				aria-label={maximized ? "Restore window" : "Maximize window"}
				onClick={() => void getCurrentWindow().toggleMaximize()}
				className={`${controlClass} hover:bg-pi-surface-raised hover:text-pi-text`}
			>
				{maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
			</button>
			<button
				type="button"
				aria-label="Close window"
				onClick={() => void getCurrentWindow().close()}
				className={`${controlClass} hover:bg-[#e81123] hover:text-white`}
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}