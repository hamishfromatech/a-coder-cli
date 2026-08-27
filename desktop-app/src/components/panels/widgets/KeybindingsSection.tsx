import { RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as rpc from "../../../lib/rpc";

export function KeybindingsSection() {
	const [value, setValue] = useState<string>("");
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			const data = await rpc.readKeybindingsFile();
			setValue(safeStringify(data));
			setLoadError(null);
			setError(null);
			setSaved(false);
		} catch (e) {
			setLoadError(String(e));
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const commit = useCallback(
		(raw: string) => {
			setValue(raw);
			try {
				JSON.parse(raw.trim() === "" ? "{}" : raw);
				setError(null);
			} catch (e) {
				setError((e as Error).message);
			}
		},
		[],
	);

	const save = useCallback(async () => {
		try {
			const parsed = value.trim() === "" ? {} : JSON.parse(value);
			await rpc.writeKeybindingsFile({ value: parsed });
			setSaved(true);
			setError(null);
			setTimeout(() => setSaved(false), 2000);
		} catch (e) {
			setError((e as Error).message);
		}
	}, [value]);

	return (
		<div className="space-y-5">
			<div>
				<h2 className="text-[15px] font-semibold tracking-tight transition-smooth hover:text-pi-text-secondary">
					Keybindings
				</h2>
				<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
					Edit keyboard shortcuts stored in{" "}
					<code className="font-mono text-pi-text">~/.a-coder/cli/agent/keybindings.json</code>.
					Changes take effect the next time you start a-coder-cli in a new session.
				</p>
			</div>

			{loadError && (
				<div className="rounded-md bg-pi-error-soft px-3 py-2 text-2xs text-pi-error">
					Couldn't read keybindings.json: {loadError}
				</div>
			)}

			<div className="space-y-1">
				<textarea
					value={value}
					onChange={(e) => commit(e.target.value)}
					rows={16}
					spellCheck={false}
					className={`w-full rounded-md bg-pi-surface-raised p-3 font-mono text-2xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none ${error ? "shadow-ring-error" : ""}`}
				/>
				{error && <p className="text-2xs text-pi-error">Invalid JSON: {error}</p>}
			</div>

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={save}
					disabled={Boolean(error)}
					className="inline-flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-xs font-semibold text-white transition-hover active-press hover:bg-pi-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Save className="h-3.5 w-3.5" />
					Save keybindings
				</button>
				<button
					type="button"
					onClick={() => void reload()}
					className="inline-flex h-8 items-center gap-1.5 rounded-md bg-pi-surface-overlay px-3 text-xs font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
				>
					<RotateCcw className="h-3.5 w-3.5" />
					Revert
				</button>
				{saved && (
					<span className="text-2xs font-medium text-pi-success">Saved</span>
				)}
			</div>

			<div className="rounded-md bg-pi-surface-raised px-3 py-2.5 text-2xs text-pi-text-muted shadow-ring">
				<p className="mb-1 font-medium text-pi-text">Common keybinding format</p>
				<pre className="overflow-auto rounded bg-pi-bg p-2 font-mono text-3xs text-pi-text">
					{`{
  "app.model.cycleForward": { "key": "c", "ctrl": true },
  "app.session.tree": { "key": "t", "ctrl": true },
  "app.editor.external": { "key": "g", "ctrl": true }
}`}
				</pre>
				<p className="mt-1">
					Use the JSON editor above to add, remove, or change shortcuts.
					Restart a-coder-cli to pick up changes.
				</p>
			</div>
		</div>
	);
}

function safeStringify(value: unknown): string {
	if (value === undefined || value === null) return "{}";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "{}";
	}
}
