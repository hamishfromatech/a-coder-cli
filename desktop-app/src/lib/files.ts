export type FileKind =
	| "html"
	| "markdown"
	| "mermaid"
	| "svg"
	| "image"
	| "code"
	| "text"
	| "binary";

export type ArtifactViewMode = "raw" | "preview";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"ico",
]);

const CODE_EXTENSIONS: Record<string, string> = {
	"ts": "typescript",
	"tsx": "tsx",
	"js": "javascript",
	"jsx": "jsx",
	"mjs": "javascript",
	"cjs": "javascript",
	"py": "python",
	"rs": "rust",
	"go": "go",
	"json": "json",
	"yaml": "yaml",
	"yml": "yaml",
	"md": "markdown",
	"sh": "bash",
	"bash": "bash",
	"zsh": "bash",
	"sql": "sql",
	"html": "html",
	"css": "css",
	"scss": "scss",
	"sass": "sass",
	"xml": "xml",
	"dockerfile": "dockerfile",
	"toml": "toml",
	"lock": "json",
};

const TEXT_EXTENSIONS = new Set([
	"txt",
	"log",
	"ini",
	"cfg",
	"env",
	"gitignore",
	"editorconfig",
	"gitattributes",
	"license",
	"readme",
]);

export function getFileKind(path: string): FileKind {
	const ext = getExtension(path).toLowerCase();
	if (ext === "html" || ext === "htm") return "html";
	if (ext === "md" || ext === "markdown") return "markdown";
	if (ext === "mmd" || ext === "mermaid") return "mermaid";
	if (ext === "svg") return "svg";
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	if (CODE_EXTENSIONS[ext] || TEXT_EXTENSIONS.has(ext)) return "code";
	// Treat files without an extension and known text-y names as text.
	if (ext === "") {
		const base = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
		if (["dockerfile", "makefile", "cmakelists.txt", "license", "readme"].includes(base)) {
			return "code";
		}
	}
	return "binary";
}

export function getExtension(path: string): string {
	const name = path.split(/[/\\]/).pop() ?? "";
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return "";
	return name.slice(dot + 1);
}

export function getLanguage(path: string): string | null {
	const ext = getExtension(path).toLowerCase();
	return CODE_EXTENSIONS[ext] ?? null;
}

export function canPreview(kind: FileKind): boolean {
	return kind === "html" || kind === "markdown" || kind === "mermaid" || kind === "svg" || kind === "image";
}

export function canShowRaw(kind: FileKind): boolean {
	return kind !== "image";
}

export function getDefaultViewMode(path: string): ArtifactViewMode {
	const kind = getFileKind(path);
	if (canPreview(kind)) return "preview";
	if (isTextFile(kind)) return "raw";
	// Binary files fall back to preview, which shows a friendly "no preview" message.
	return "preview";
}

export function isTextFile(kind: FileKind): boolean {
	return kind !== "binary" && kind !== "image";
}
