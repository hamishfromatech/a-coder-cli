/**
 * IDE-mode IPC: file text ops + integrated terminal (real PTY on the host).
 * Event payloads mirror desktop-app/src-tauri/src/ide.rs.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { toast } from "../stores/toast-store";
import { useIdeStore } from "../stores/ide-store";

import { readTextFile } from "./rpc.ts";

export { listDirectory, readTextFile } from "./rpc.ts";
export type { DirEntry } from "./rpc.ts";

export async function writeTextFile(path: string, content: string): Promise<void> {
	return await invoke<void>("write_text_file", { path, content });
}

/**
 * Open a workspace-relative file in the IDE editor: resolves the absolute
 * path (relative to the workspace root, or used as-is when absolute), reads
 * from disk, and opens the tab. Read errors surface via toast.
 */
export async function openWorkspaceFile(root: string, path: string): Promise<void> {
	const isAbsolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
	const absolute = isAbsolute ? path : `${root.replace(/\/+$/, "")}/${path}`;
	try {
		const content = await readTextFile(absolute);
		useIdeStore.getState().openFile(absolute, content);
	} catch (e) {
		toast.warning("Could not open", e instanceof Error ? e.message : String(e));
	}
}

// ============================================================================
// Integrated terminal
// ============================================================================

export interface IdePtyOutput {
	id: number;
	chunk: string;
}

export interface IdePtyExit {
	id: number;
	code?: number | null;
}

export async function ptySpawn(cwd: string): Promise<number> {
	const res = await invoke<{ id: number }>("ide_pty_spawn", { cwd });
	return res.id;
}

export async function ptyWrite(id: number, data: string): Promise<void> {
	return await invoke<void>("ide_pty_write", { id, data });
}

export async function ptyResize(id: number, cols: number, rows: number): Promise<void> {
	return await invoke<void>("ide_pty_resize", { id, cols, rows });
}

export async function ptyKill(id: number): Promise<void> {
	return await invoke<void>("ide_pty_kill", { id });
}

export async function onPtyOutput(handler: (output: IdePtyOutput) => void): Promise<UnlistenFn> {
	return await listen<IdePtyOutput>("desktop://ide-pty-output", (event) => handler(event.payload));
}

export async function onPtyExit(handler: (output: IdePtyExit) => void): Promise<UnlistenFn> {
	return await listen<IdePtyExit>("desktop://ide-pty-exit", (event) => handler(event.payload));
}

// ============================================================================
// Language mapping for Monaco syntax highlighting
// ============================================================================

const EXTENSION_LANGUAGE: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	cts: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	json: "json",
	jsonc: "json",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	less: "less",
	md: "markdown",
	mdx: "markdown",
	markdown: "markdown",
	py: "python",
	pyi: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	c: "cpp",
	h: "cpp",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	cs: "csharp",
	swift: "swift",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	sql: "sql",
	yml: "yaml",
	yaml: "yaml",
	xml: "xml",
	toml: "ini",
	ini: "ini",
	properties: "ini",
	php: "php",
	lua: "lua",
	r: "r",
	dart: "dart",
	graphql: "graphql",
	prisma: "graphql",
	dockerfile: "dockerfile",
	vue: "html",
	svelte: "html",
};

/** Monaco language id for a file path, or undefined (plain text). */
export function languageForPath(path: string): string | undefined {
	const base = path.split(/[/\\]/).at(-1) ?? path;
	if (base.toLowerCase() === "dockerfile") return "dockerfile";
	if (/^(makefile|cmakelists\.txt)$/i.test(base)) return "shell";
	const ext = base.split(".").at(-1)?.toLowerCase() ?? "";
	return EXTENSION_LANGUAGE[ext];
}

export const IDE_DEFAULT_MONACO_ID = "vs-dark";

// Canvas normalizes ANY parseable CSS color (oklch, color(display-p3), rgb)
// to the canonical string form. That is the most robust cross-parser
// conversion available in a webview.
let colorCanvas: HTMLCanvasElement | null = null;

function normalizeCanvasColor(cssColor: string): string | null {
	if (!cssColor) return null;
	colorCanvas ??= document.createElement("canvas");
	const ctx = colorCanvas.getContext("2d");
	if (!ctx) return null;
	ctx.fillStyle = "#000000";
	ctx.fillStyle = cssColor;
	const normalized = ctx.fillStyle as string;
	// fillStyle stays #000000 only when the assignment was rejected AND the
	// source was not genuinely black (checked again by the caller's parse).
	return normalized;
}

interface ParsedColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

function hexByte(value: number): string {
	return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function parseColorChannels(cssColor: string): ParsedColor | null {
	const hex = /^#([0-9a-f]{3,8})$/i.exec(cssColor);
	if (hex) {
		let h = hex[1];
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
		const r = parseInt(h.slice(0, 2), 16);
		const g = parseInt(h.slice(2, 4), 16);
		const b = parseInt(h.slice(4, 6), 16);
		const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
		return { r, g, b, a };
	}
	const rgb = /^rgba?\(([^)]+)\)$/i.exec(cssColor);
	if (rgb) {
		const parts = rgb[1].split(/\s*,\s*|\s+/).filter(Boolean).map(Number);
		if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
			return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
		}
	}
	// color(srgb ...) / color(display-p3 ...): components are 0-1 floats.
	const fn = /^color\(\s*[a-z0-9-]+\s+([^)]+)\)$/i.exec(cssColor);
	if (fn) {
		const parts = fn[1].split(/\s*\/\s*|\s+/).filter(Boolean).map(Number);
		if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
			return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts[3] ?? 1 };
		}
	}
	return null;
}

/**
 * Resolve a design token to #RRGGBB — the ONLY color form Monaco theme defs
 * parse ("Illegal value for token color" otherwise; computed values arrive as
 * rgb()/oklch()/color(...)).
 */
export function tokenColor(token: string, fallback: string): string {
	const probe = document.createElement("div");
	probe.style.color = `var(${token})`;
	document.documentElement.appendChild(probe);
	const computed = getComputedStyle(probe).color;
	probe.remove();
	// rgb()/rgba()/color(...) computed values parse directly; oklch and other
	// exotic forms need the canvas round-trip first.
	const parsed = parseColorChannels(computed) ?? parseColorChannels(normalizeCanvasColor(computed) ?? "");
	if (!parsed) return fallback;
	return `#${hexByte(parsed.r)}${hexByte(parsed.g)}${hexByte(parsed.b)}`;
}

/** Resolve a token to #RRGGBBAA with an explicit alpha (selection washes). */
export function tokenColorAlpha(token: string, alpha: number, fallback: string): string {
	const opaque = tokenColor(token, fallback);
	return `${opaque}${hexByte(alpha * 255)}`;
}