export type FileKind =
	| "html"
	| "markdown"
	| "mermaid"
	| "svg"
	| "image"
	| "audio"
	| "video"
	| "pdf"
	| "csv"
	| "code"
	| "text"
	| "binary";

export type ArtifactViewMode = "raw" | "preview";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"jfif",
	"gif",
	"webp",
	"avif",
	"heic",
	"heif",
	"tif",
	"tiff",
	"bmp",
	"ico",
]);

const AUDIO_EXTENSIONS = new Set([
	"mp3",
	"wav",
	"aac",
	"ogg",
	"flac",
	"m4a",
	"oga",
	"opus",
]);

const VIDEO_EXTENSIONS = new Set([
	"mp4",
	"mov",
	"mkv",
	"avi",
	"webm",
	"ogv",
	"m4v",
	"mpg",
	"mpeg",
	"wmv",
	"flv",
]);

const CODE_EXTENSIONS: Record<string, string> = {
	"ts": "typescript",
	"tsx": "tsx",
	"js": "javascript",
	"jsx": "jsx",
	"mjs": "javascript",
	"cjs": "javascript",
	"mts": "typescript",
	"cts": "typescript",
	"py": "python",
	"pyi": "python",
	"pyw": "python",
	"rs": "rust",
	"go": "go",
	"json": "json",
	"jsonc": "json",
	"json5": "json",
	"yaml": "yaml",
	"yml": "yaml",
	"md": "markdown",
	"mdx": "markdown",
	"sh": "bash",
	"bash": "bash",
	"zsh": "bash",
	"fish": "bash",
	"sql": "sql",
	"html": "html",
	"htm": "html",
	"xhtml": "html",
	"css": "css",
	"scss": "scss",
	"sass": "sass",
	"less": "less",
	"xml": "xml",
	"plist": "xml",
	"xsl": "xml",
	"xsd": "xml",
	"rss": "xml",
	"atom": "xml",
	"svg": "xml",
	"dockerfile": "dockerfile",
	"toml": "toml",
	"lock": "json",
	// C family
	"c": "c",
	"h": "c",
	"cpp": "cpp",
	"cxx": "cpp",
	"cc": "cpp",
	"hpp": "cpp",
	"hh": "cpp",
	"m": "objectivec",
	"mm": "objectivec",
	"cs": "csharp",
	"java": "java",
	"kt": "kotlin",
	"kts": "kotlin",
	"swift": "swift",
	"dart": "dart",
	// Scripting
	"rb": "ruby",
	"php": "php",
	"lua": "lua",
	"pl": "perl",
	"pm": "perl",
	"r": "r",
	"jl": "julia",
	"ex": "elixir",
	"exs": "elixir",
	"erl": "erlang",
	"hs": "haskell",
	"elm": "elm",
	"clj": "clojure",
	"cljs": "clojure",
	"fs": "fsharp",
	"fsx": "fsharp",
	"zig": "zig",
	"nim": "nim",
	"groovy": "groovy",
	// Web frameworks / shell-ish
	"vue": "vue",
	"svelte": "svelte",
	"astro": "astro",
	"graphql": "graphql",
	"gql": "graphql",
	"prisma": "prisma",
	"bat": "batch",
	"cmd": "batch",
	"ps1": "powershell",
	"psm1": "powershell",
	// Config / data / docs
	"ini": "ini",
	"cfg": "ini",
	"conf": "ini",
	"properties": "ini",
	"env": "ini",
	"csv": "csv",
	"tsv": "csv",
	"tf": "hcl",
	"tfvars": "hcl",
	"hcl": "hcl",
	"proto": "protobuf",
	"sol": "solidity",
	"nix": "nix",
	"gradle": "groovy",
	"cmake": "cmake",
	"mk": "makefile",
	"diff": "diff",
	"patch": "diff",
	"tex": "latex",
	"bib": "latex",
	"rst": "rst",
	"adoc": "asciidoc",
	"asciidoc": "asciidoc",
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
	"justfile",
]);

export function getFileKind(path: string): FileKind {
	const ext = getExtension(path).toLowerCase();
	if (ext === "html" || ext === "htm") return "html";
	if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
	if (ext === "mmd" || ext === "mermaid") return "mermaid";
	if (ext === "svg") return "svg";
	if (ext === "pdf") return "pdf";
	if (ext === "csv" || ext === "tsv") return "csv";
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	if (AUDIO_EXTENSIONS.has(ext)) return "audio";
	if (VIDEO_EXTENSIONS.has(ext)) return "video";
	if (CODE_EXTENSIONS[ext] || TEXT_EXTENSIONS.has(ext)) return "code";
	// Treat files without an extension and known text-y names as text.
	if (ext === "") {
		const base = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
		if (["dockerfile", "makefile", "justfile", "cmakelists.txt", "license", "readme", ".gitignore", ".env"].includes(base)) {
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
	return (
		kind === "html" ||
		kind === "markdown" ||
		kind === "mermaid" ||
		kind === "svg" ||
		kind === "image" ||
		kind === "audio" ||
		kind === "video" ||
		kind === "pdf" ||
		kind === "csv"
	);
}

export function canShowRaw(kind: FileKind): boolean {
	return kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "pdf";
}

export function getDefaultViewMode(path: string): ArtifactViewMode {
	const kind = getFileKind(path);
	if (canPreview(kind)) return "preview";
	if (isTextFile(kind)) return "raw";
	// Binary files fall back to preview, which shows a friendly "no preview" message.
	return "preview";
}

export function isTextFile(kind: FileKind): boolean {
	return kind !== "binary" && kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "pdf";
}
