/** Quick Open helpers: `path/file.ts:42` jumps to a line; plain text filters. */

export interface FileLocation {
	/** The path portion of the query (trimmed). */
	path: string;
	/** 1-based line, when the query ended with `:<digits>`. */
	line?: number;
}

/**
 * Splits an optional trailing `:<line>` off the query. Windows drive letters
 * (`C:\src\a.ts`) are safe because the suffix must be digits after the last
 * colon and there must be something before it.
 */
export function parseFileLocation(input: string): FileLocation {
	const trimmed = input.trim();
	const match = /^(.*?):(\d+)$/.exec(trimmed);
	if (!match) return { path: trimmed };
	const path = match[1].trim();
	const line = Number.parseInt(match[2], 10);
	if (!path || !Number.isFinite(line) || line < 1) return { path: trimmed };
	return { path, line };
}

/** Relative directory of a workspace-relative file path ("" at the root). */
export function relativeDir(rel: string): string {
	const normalized = rel.replace(/\\/g, "/");
	const parts = normalized.split("/");
	return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}
