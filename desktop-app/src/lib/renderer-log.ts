import { invoke } from "@tauri-apps/api/core";

/** Renderer lifecycle diagnostics, appended to /tmp/a-coder-renderer.log via
 *  the Rust debug_log command (same sink as main.tsx's error/rejection hooks).
 *  Used to trace the approval-UI mount churn that blackened the window on
 *  WKWebView; cheap string work on state transitions only. */
export function rendererLog(line: string): void {
	try {
		void invoke("debug_log", { line: `${new Date().toISOString()} ${line}` }).catch(() => {});
	} catch {
		// Not running under Tauri (browser/dev) — ignore.
	}
}