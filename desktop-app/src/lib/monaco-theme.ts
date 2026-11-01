/** Monaco theme derived from the app's design tokens (shared by every editor). */

import * as monaco from "monaco-editor";
import { tokenColor, tokenColorAlpha } from "./ide.ts";

let registered = false;

export function ensureMonacoTheme(): string {
	if (registered) return "a-coder-dark";
	try {
		monaco.editor.defineTheme("a-coder-dark", {
			base: "vs-dark",
			inherit: true,
			rules: [],
			colors: {
				"editor.background": tokenColor("--pi-bg", "#16181d"),
				"editor.foreground": tokenColor("--pi-text", "#d6dbe4"),
				"editorLineNumber.foreground": tokenColor("--pi-text-faint", "#4b5058"),
				"editorGutter.background": tokenColor("--pi-bg", "#16181d"),
				"editor.lineHighlightBackground": tokenColorAlpha("--pi-accent", 0.1, "#4f7dd9"),
				"editorCursor.foreground": tokenColor("--pi-accent", "#4f7dd9"),
				"editorIndentGuide.background1": tokenColor("--pi-border", "#2a2e35"),
				"editor.selectionBackground": tokenColorAlpha("--pi-accent", 0.25, "#4f7dd9"),
				"diffEditor.insertedTextBackground": tokenColorAlpha("--pi-success", 0.18, "#2ea043"),
				"diffEditor.removedTextBackground": tokenColorAlpha("--pi-error", 0.18, "#f85149"),
			},
		});
		registered = true;
	} catch {
		return "vs-dark";
	}
	return "a-coder-dark";
}
