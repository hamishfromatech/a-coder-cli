import { Folder, Plus, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";

interface Props {
	value: string[];
	onChange: (next: string[]) => void;
	disabled?: boolean;
	placeholder?: string;
	/** If true, opens a directory picker; otherwise opens a file picker. */
	directory?: boolean;
}

/**
 * Path list editor with a Tauri file/folder picker. Used for local
 * extensions, skills, prompts, and themes in settings.json.
 */
export function PathListInput({
	value,
	onChange,
	disabled,
	placeholder,
	directory = true,
}: Props) {
	const [draft, setDraft] = useState("");

	const pickPath = useCallback(async () => {
		try {
			const path = await open({ directory });
			if (typeof path === "string" && !value.includes(path)) {
				onChange([...value, path]);
			}
		} catch (e) {
			console.error("Failed to pick path", e);
		}
	}, [directory, value, onChange]);

	const addDraft = useCallback(
		(raw: string) => {
			const paths = raw
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			if (paths.length === 0) return;
			const next = Array.from(new Set([...value, ...paths]));
			onChange(next);
			setDraft("");
		},
		[value, onChange],
	);

	const removePath = useCallback(
		(idx: number) => {
			onChange(value.filter((_, i) => i !== idx));
		},
		[value, onChange],
	);

	return (
		<div className="w-full space-y-2">
			{value.length === 0 && (
				<p className="text-[11px] text-pi-text-faint">No paths configured.</p>
			)}

			{value.map((path, idx) => (
				<div
					key={`${path}-${idx}`}
					className="flex items-center gap-2 rounded-md bg-pi-bg px-2 py-1 shadow-ring"
				>
					<Folder className="h-3 w-3 shrink-0 text-pi-text-faint" />
					<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-pi-text" title={path}>
						{path}
					</span>
					<button
						type="button"
						onClick={() => removePath(idx)}
						disabled={disabled}
						className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-error-soft hover:text-pi-error disabled:opacity-50 focus-visible:shadow-focus focus-visible:outline-none"
						title="Remove path" aria-label="Remove path"
					>
						<Trash2 className="h-3 w-3" />
					</button>
				</div>
			))}

			<form
				onSubmit={(e) => {
					e.preventDefault();
					addDraft(draft);
				}}
				className="flex gap-2"
			>
				<textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					placeholder={placeholder ?? "Type a path, or use the picker"}
					disabled={disabled}
					rows={1}
					className="min-w-0 flex-1 resize-none rounded-md bg-pi-bg px-2.5 py-1.5 font-mono text-[11px] text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none"
					spellCheck={false}
				/>
				<button
					type="button"
					onClick={pickPath}
					disabled={disabled}
					className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-pi-surface-overlay text-pi-text transition-hover active-press hover:bg-pi-surface-raised disabled:opacity-50"
					title={`Pick ${directory ? "folder" : "file"}`}
					aria-label={`Pick ${directory ? "folder" : "file"}`}
				>
					<Folder className="h-3.5 w-3.5" />
				</button>
				<button
					type="submit"
					disabled={disabled || !draft.trim()}
					className="inline-flex h-8 items-center gap-1 rounded-md bg-pi-surface-overlay px-2 text-[11px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised disabled:opacity-50"
				>
					<Plus className="h-3 w-3" />
					Add
				</button>
			</form>
		</div>
	);
}
