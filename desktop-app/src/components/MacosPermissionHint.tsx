import { open } from "@tauri-apps/plugin-shell";
import { ShieldAlert } from "lucide-react";

/**
 * macOS shows a privacy denial as `EPERM`, which reads like a filesystem bug.
 * The engine appends an explanation when a guarded folder is blocked; this
 * turns it into a one-click trip to the right settings pane.
 */
const TCC_MARKER = "macOS is blocking access to";

const PRIVACY_SETTINGS_URL =
	"x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders";

export function MacosPermissionHint({ text }: { text: string }) {
	if (!text.includes(TCC_MARKER)) return null;
	const folder = /~\/[A-Za-z ]+/.exec(text)?.[0] ?? "that folder";
	return (
		<div className="mx-2.5 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-pi-warning/40 bg-pi-warning/10 px-2 py-1.5 text-2xs text-pi-text-secondary">
			<ShieldAlert className="size-3.5 shrink-0 text-pi-warning" aria-hidden />
			<span className="min-w-0 flex-1">
				macOS is blocking access to {folder}. Grant access for A-Coder Desktop.
			</span>
			<button
				type="button"
				className="shrink-0 rounded border border-pi-border px-1.5 py-0.5 font-medium text-pi-text hover:bg-pi-hover"
				onClick={(event) => {
					event.stopPropagation();
					void open(PRIVACY_SETTINGS_URL).catch(() => undefined);
				}}
			>
				Open Privacy Settings
			</button>
		</div>
	);
}
