import { useMemo } from "react";

export interface EditDiffProps {
	/** Display diff as produced by the edit tool (`details.diff`): one line per
	 * row, prefixed with `+` (added), `-` (removed) or ` ` (context), followed
	 * by a right-aligned line number, a space, and the line content. */
	diff: string;
}

type DiffRowKind = "add" | "remove" | "context" | "skip";

interface DiffRow {
	kind: DiffRowKind;
	lineNum: string;
	content: string;
}

function parseDiffRow(raw: string): DiffRow {
	const marker = raw[0] ?? " ";
	const rest = raw.slice(1);
	if (rest.trim() === "...") {
		return { kind: "skip", lineNum: "", content: "..." };
	}
	// Line numbers are right-aligned with leading pad spaces before the single
	// separator space, so strip the pad before locating the separator.
	const trimmed = rest.replace(/^\s+/, "");
	const separator = trimmed.indexOf(" ");
	const lineNum = separator >= 0 ? trimmed.slice(0, separator) : trimmed;
	const content = separator >= 0 ? trimmed.slice(separator + 1) : "";
	if (marker === "+") return { kind: "add", lineNum, content };
	if (marker === "-") return { kind: "remove", lineNum, content };
	return { kind: "context", lineNum, content };
}

/** Parse a display diff string into renderable rows. Blank lines are dropped. */
export function parseDiffRows(diff: string): DiffRow[] {
	return diff
		.split("\n")
		.filter((line) => line.length > 0)
		.map(parseDiffRow);
}

/** Added/removed line counts for the collapsed-row stats chip. */
export function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const raw of diff.split("\n")) {
		if (raw.length === 0) continue;
		if (raw[0] === "+") added++;
		else if (raw[0] === "-") removed++;
	}
	return { added, removed };
}

const rowTint: Record<DiffRowKind, string> = {
	add: "bg-pi-success/10",
	remove: "bg-pi-error/10",
	context: "",
	skip: "",
};

const markerGlyph: Record<DiffRowKind, string> = {
	add: "+",
	remove: "\u2212", // minus sign, visually distinct from context hyphens
	context: " ",
	skip: " ",
};

const markerColor: Record<DiffRowKind, string> = {
	add: "text-pi-success",
	remove: "text-pi-error",
	context: "text-pi-text-faint",
	skip: "text-pi-text-faint",
};

export function EditDiff({ diff }: EditDiffProps) {
	const rows = useMemo(() => parseDiffRows(diff), [diff]);
	if (rows.length === 0) return null;

	return (
		<div className="overflow-x-auto py-1">
			<div className="min-w-full font-mono text-2xs leading-[1.6]">
				{rows.map((row, i) => (
					<div
						key={i}
						className={`flex min-w-0 ${rowTint[row.kind]}`}
					>
						<span
							className={`w-4 shrink-0 select-none text-center ${markerColor[row.kind]}`}
						>
							{markerGlyph[row.kind]}
						</span>
						<span className="w-10 shrink-0 select-none pr-2 text-right text-pi-text-faint">
							{row.lineNum}
						</span>
						<span
							className={`min-w-0 flex-1 whitespace-pre-wrap break-all pr-2 ${
								row.kind === "add"
									? "text-pi-success"
									: row.kind === "remove"
										? "text-pi-error"
										: "text-pi-text-secondary"
							}`}
						>
							{row.kind === "skip" ? "···" : row.content}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}