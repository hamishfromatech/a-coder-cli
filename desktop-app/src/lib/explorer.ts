/**
 * Pure helpers for the file explorer: the flattened visible-row list the
 * keyboard and rendering share, git decoration lookup (files and folders),
 * and a coarse file-kind classifier for the icon set.
 */

export interface ExplorerEntry {
	path: string;
	name: string;
	is_dir: boolean;
}

export interface ExplorerRow {
	entry: ExplorerEntry;
	depth: number;
}

/** Repo-relative path for git decoration lookups. */
export function relativeToRoot(path: string, root: string): string {
	const base = root.replace(/[/\\]+$/, "");
	return path.startsWith(base) ? path.slice(base.length).replace(/^[/\\]/, "") : path;
}

/** Directories first, then case-insensitive name, matching the backend. */
export function sortEntries<T extends ExplorerEntry>(entries: T[]): T[] {
	return [...entries].sort((a, b) => {
		if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});
}

/**
 * Flatten the expanded tree into render rows. A filter keeps files whose name
 * matches and every directory (so the user can drill into unloaded folders);
 * directories are auto-expanded while filtering so matches surface.
 */
export function flattenVisible(
	children: Map<string, ExplorerEntry[]>,
	expanded: Set<string>,
	root: string,
	filter = "",
): ExplorerRow[] {
	const needle = filter.trim().toLowerCase();
	const filtering = needle.length > 0;
	const rows: ExplorerRow[] = [];

	/** Name match, or a matching loaded descendant; unloaded folders stay so
	 *  the user can drill into them (their contents are not indexed yet). */
	const subtreeMatches = (entry: ExplorerEntry): boolean => {
		if (!entry.is_dir) return entry.name.toLowerCase().includes(needle);
		if (entry.name.toLowerCase().includes(needle)) return true;
		const kids = children.get(entry.path);
		if (!kids) return true;
		return kids.some(subtreeMatches);
	};

	const walk = (dir: string, depth: number): void => {
		const entries = children.get(dir);
		if (!entries) return;
		for (const entry of sortEntries(entries)) {
			if (filtering && !subtreeMatches(entry)) continue;
			rows.push({ entry, depth });
			if (entry.is_dir && (filtering || expanded.has(entry.path))) walk(entry.path, depth + 1);
		}
	};

	walk(root, 0);
	return rows;
}

/** Parent directory of an absolute path (no trailing separator). */
export function parentOf(path: string): string {
	const normalized = path.replace(/[/\\]+$/, "");
	const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
	return index > 0 ? normalized.slice(0, index) : normalized;
}

/** The `git status` letter for a file, or whether a folder has changes below. */
export function decorationFor(
	path: string,
	isDir: boolean,
	root: string,
	statusByPath: Map<string, string>,
): { letter: string | null; dirtyDir: boolean } {
	const relative = relativeToRoot(path, root);
	if (!isDir) return { letter: statusByPath.get(relative) ?? null, dirtyDir: false };
	const prefix = relative ? `${relative}/` : "";
	let dirtyDir = false;
	for (const changed of statusByPath.keys()) {
		if (changed.startsWith(prefix) && changed !== relative) {
			dirtyDir = true;
			break;
		}
	}
	return { letter: null, dirtyDir };
}

export type FileKind =
	| "code"
	| "json"
	| "markdown"
	| "image"
	| "style"
	| "data"
	| "shell"
	| "config"
	| "archive"
	| "text";

const KIND_BY_EXT: Record<string, FileKind> = {
	ts: "code",
	tsx: "code",
	mts: "code",
	cts: "code",
	js: "code",
	jsx: "code",
	mjs: "code",
	cjs: "code",
	py: "code",
	rb: "code",
	go: "code",
	rs: "code",
	java: "code",
	kt: "code",
	c: "code",
	h: "code",
	cpp: "code",
	cc: "code",
	hpp: "code",
	cs: "code",
	swift: "code",
	dart: "code",
	php: "code",
	lua: "code",
	vue: "code",
	svelte: "code",
	json: "json",
	jsonc: "json",
	json5: "json",
	lock: "config",
	md: "markdown",
	mdx: "markdown",
	markdown: "markdown",
	txt: "text",
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	svg: "image",
	avif: "image",
	ico: "image",
	heic: "image",
	css: "style",
	scss: "style",
	sass: "style",
	less: "style",
	sql: "data",
	csv: "data",
	tsv: "data",
	yml: "config",
	yaml: "config",
	toml: "config",
	ini: "config",
	conf: "config",
	env: "config",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	zip: "archive",
	gz: "archive",
	tar: "archive",
	rar: "archive",
	"7z": "archive",
};

/** Coarse kind for icon/color selection. */
export function fileKind(name: string): FileKind {
	const lower = name.toLowerCase();
	if (lower === "dockerfile" || lower === "makefile" || lower === ".gitignore" || lower === ".env") {
		return "config";
	}
	if (lower.endsWith(".d.ts")) return "code";
	const dot = lower.lastIndexOf(".");
	const ext = dot >= 0 ? lower.slice(dot + 1) : "";
	return KIND_BY_EXT[ext] ?? "text";
}
