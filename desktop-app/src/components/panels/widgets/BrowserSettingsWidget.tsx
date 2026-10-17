// Browser panel settings widget: where approved downloads land, whether the
// AI can drive the panel, and the local MCP endpoint the coding agent uses.
// Values live under the "browser" object in the CLI's global settings file.

import { useEffect, useState } from "react";
import { Check, Copy, FolderOpen, RotateCcw } from "lucide-react";
import * as rpc from "../../../lib/rpc";
import { Button } from "../../ui/Button";
import { useBrowserStore } from "../../../stores/browser-store";

interface Props {
	value?: unknown;
	onChange: (v: unknown) => void;
}

interface BrowserPrefs {
	downloadFolder?: string;
	agentTools?: boolean;
	linkTarget?: "default" | "desktop";
}

function prefsOf(value: unknown): BrowserPrefs {
	return (value ?? {}) as BrowserPrefs;
}

export function BrowserSettingsWidget({ value, onChange }: Props) {
	const prefs = prefsOf(value);
	const [folder, setFolder] = useState(prefs.downloadFolder ?? "");
	const [linkTarget, setLinkTargetState] = useState<"default" | "desktop">(
		(prefs.linkTarget === "desktop" ? "desktop" : "default") as "default" | "desktop",
	);
	const [endpoint, setEndpoint] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Track external schema edits (scope switches, file reloads).
	useEffect(() => {
		setFolder(prefs.downloadFolder ?? "");
		setLinkTargetState((prefs.linkTarget === "desktop" ? "desktop" : "default") as "default" | "desktop");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [prefs.downloadFolder, prefs.linkTarget]);

	// The MCP endpoint exists only with native page views (macOS 14+/Windows).
	useEffect(() => {
		void rpc.getAgentServerUrl().then(setEndpoint).catch(() => setEndpoint(null));
	}, []);

	const commit = (next: BrowserPrefs) => {
		onChange(next);
	};

	const browse = async () => {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const picked = await open({ directory: true, multiple: false });
			if (typeof picked === "string" && picked.trim()) {
				setFolder(picked);
				commit({ ...prefs, downloadFolder: picked });
			}
		} catch {
			// No picker available: the text field still works.
		}
	};

	const reset = () => {
		setFolder("");
		commit({ ...prefs, downloadFolder: "" });
	};

	const toggleAgentTools = (enabled: boolean) => {
		commit({ ...prefs, agentTools: enabled });
	};

	/** Where chat/panel-external links open; synced into the live store so
	 *  clicks see the new routing without a restart. */
	const setLinkTarget = (linkTarget: "default" | "desktop") => {
		useBrowserStore.setState({ linkTarget });
		commit({ ...prefs, linkTarget });
	};

	useEffect(() => {
		if (!prefs.agentTools) return;
		void rpc.getAgentServerUrl().then(setEndpoint).catch(() => setEndpoint(null));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [prefs.agentTools]);

	const inputClass =
		"h-8 w-full min-w-0 rounded border border-pi-border bg-pi-surface-raised px-2.5 text-xs text-pi-text placeholder:text-pi-text-muted focus:outline-none focus:ring-1 focus:ring-pi-accent";

	return (
		<div className="flex flex-col gap-4 py-1">
			<div>
				<div className="mb-1.5 text-xs font-medium text-pi-text">Open links in</div>
				<select
					value={linkTarget}
					onChange={(event) => setLinkTarget(event.target.value === "desktop" ? "desktop" : "default")}
					aria-label="Where to open URLs"
					title="Default browser hands every link to the system; This app's browser opens them as tabs in the desktop browser panel."
					className="h-8 w-full cursor-pointer rounded border border-pi-border bg-pi-surface-raised px-2 text-xs text-pi-text focus:outline-none focus:ring-1 focus:ring-pi-accent"
				>
					<option value="default">Default browser</option>
					<option value="desktop">This app's browser</option>
				</select>
				<p className="mt-1 text-3xs text-pi-text-muted">
					Handoffs the panel can't host (downloads, target blank) and OAuth sign-ins always go to
					the system browser.
				</p>
			</div>

			<div>
				<div className="mb-1.5 text-xs font-medium text-pi-text">Download folder</div>
				<div className="flex items-center gap-1.5">
					<input
						value={folder}
						onChange={(event) => {
							setFolder(event.target.value);
							commit({ ...prefs, downloadFolder: event.target.value });
						}}
						placeholder="Downloads/a-coder-downloads"
						spellCheck={false}
						className={inputClass}
					/>
					<Button variant="secondary" size="sm" icon={FolderOpen} onClick={() => void browse()}>
						Browse
					</Button>
					<button
						type="button"
						onClick={reset}
						className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Reset to default download folder"
						title="Reset to default (Downloads/a-coder-downloads)"
					>
						<RotateCcw className="h-3.5 w-3.5" />
					</button>
				</div>
				<p className="mt-1 text-3xs text-pi-text-muted">
					Approved panel downloads land here; empty uses Downloads/a-coder-downloads.
				</p>
			</div>

			<div className="border-t border-pi-border pt-3">
				<label className="flex cursor-pointer items-start justify-between gap-3">
					<span className="min-w-0">
						<span className="block text-xs font-medium text-pi-text">Let the AI drive the browser</span>
						<span className="mt-0.5 block text-3xs leading-4 text-pi-text-muted">
							Exposes browser tools (navigate, read, click, type, screenshot) to coding sessions over
							a local-only endpoint. Pages stay sandboxed to public hosts either way.
						</span>
					</span>
					<input
						type="checkbox"
						checked={prefs.agentTools ?? true}
						onChange={(event) => toggleAgentTools(event.target.checked)}
						className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-pi-accent"
					/>
				</label>

				{(prefs.agentTools ?? true) && endpoint && (
					<div className="mt-2 flex items-center gap-2 rounded border border-pi-border bg-pi-surface-raised px-2.5 py-1.5">
						<code className="min-w-0 flex-1 truncate text-3xs text-pi-text-muted">{endpoint}</code>
						<button
							type="button"
							onClick={() => {
								void navigator.clipboard.writeText(endpoint);
								setCopied(true);
								setTimeout(() => setCopied(false), 1500);
							}}
							className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-hover hover:text-pi-text"
							aria-label="Copy MCP endpoint"
							title="Copy for the CLI's mcpServers entry"
						>
							{copied ? <Check className="h-3 w-3 text-pi-success" /> : <Copy className="h-3 w-3" />}
						</button>
					</div>
				)}
				{(prefs.agentTools ?? true) && endpoint && (
					<p className="mt-1 text-3xs text-pi-text-muted">
						The entry <code>desktop-browser</code> is added to the engine's settings automatically
						on app start, so coding sessions get the browser tools without manual setup. If the
						port ever changes, the entry is updated on the next start.
					</p>
				)}
			</div>
		</div>
	);
}