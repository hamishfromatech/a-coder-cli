import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { Editor } from "../src/components/editor.ts";
import type { TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/** Create an editor backed by a virtual terminal for testing */
function createEditor(): Editor {
	const tui: TUI = new TuiMainScreen(new VirtualTerminal(80, 24));
	return new Editor(tui, defaultEditorTheme);
}

// pi#11383: escape sequences in terminal input must never reach the buffer, and
// a bracketed paste that never terminates must not wedge the editor.
describe("Editor input escape handling", () => {
	it("strips SGR sequences from bracketed paste", () => {
		const editor = createEditor();

		editor.handleInput("\x1b[200~plain \x1b[31mred\x1b[0m end\x1b[201~");

		assert.strictEqual(editor.getText(), "plain red end");
	});

	it("strips OSC sequences from bracketed paste", () => {
		const editor = createEditor();

		editor.handleInput("\x1b[200~x\x1b]0;title\x07y\x1b[201~");

		assert.strictEqual(editor.getText(), "xy");
	});

	it("strips SGR sequences with colon sub-parameters from bracketed paste", () => {
		const editor = createEditor();

		editor.handleInput("\x1b[200~\x1b[38:2::255:0:0mred\x1b[0m\x1b[201~");

		assert.strictEqual(editor.getText(), "red");
	});

	it("does not record an undo step for an ANSI-only paste", () => {
		const editor = createEditor();

		editor.handleInput("a");
		editor.handleInput("\x1b[200~\x1b[31m\x1b[201~");
		editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)

		assert.strictEqual(editor.getText(), "");
	});

	it("strips escape sequences from a plain input chunk", () => {
		const editor = createEditor();

		editor.handleInput("a\x1b[31mred\x1b[0m");

		assert.strictEqual(editor.getText(), "ared");
	});

	it("leaves bracketed paste mode on Ctrl+C", () => {
		const editor = createEditor();

		editor.handleInput("\x1b[200~dangling");
		editor.handleInput("\x03"); // Ctrl+C
		editor.handleInput("keep");

		assert.strictEqual(editor.getText(), "keep");
	});

	it("flushes a paste that never terminates after the timeout", () => {
		mock.timers.enable({ apis: ["Date"] });
		try {
			const editor = createEditor();

			editor.handleInput("\x1b[200~dangling");
			mock.timers.tick(10_001);
			editor.handleInput("x");

			// The buffered content is flushed through the paste path, then "x" is typed.
			assert.strictEqual(editor.getText(), "danglingx");
		} finally {
			mock.timers.reset();
		}
	});

	it("flushes a paste buffer that exceeds the size cap", () => {
		const editor = createEditor();

		editor.handleInput(`\x1b[200~${"a".repeat(1_000_001)}`);
		editor.handleInput("x");

		assert.match(editor.getText(), /^\[paste #1 \d+ chars\]x$/);
	});
});
