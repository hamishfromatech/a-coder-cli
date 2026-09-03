import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Container, TUI } from "../src/index.ts";
import { TestTerminal } from "./terminal-colors.test.ts";

/** Focusable recorder: remembers every handleInput payload. */
class InputRecorder extends Container {
	inputs: string[] = [];
	handleInput(data: string): void {
		this.inputs.push(data);
	}
}

/** Simulate raw stdin bytes arriving (TestTerminal sends to start()'s handler). */
async function feed(terminal: TestTerminal, data: string): Promise<void> {
	terminal.sendInput(data);
	// Allow the TUI's nextTick/microtask pipeline to deliver to the component.
	await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("TUI mouse wheel handling", () => {
	it("translates SGR wheel reports into arrow inputs for the focused component", async () => {
		const terminal = new TestTerminal();
		const tui = new TUI(terminal);
		const component = new InputRecorder();
		tui.addChild(component);
		tui.setFocus(component);
		tui.setMouseEnabled(true);
		tui.start();
		try {
			await feed(terminal, "\x1b[<64;10;10M");
			assert.deepEqual(component.inputs, ["\x1b[A", "\x1b[A", "\x1b[A"]);

			component.inputs.length = 0;
			await feed(terminal, "\x1b[<65;10;10M");
			assert.deepEqual(component.inputs, ["\x1b[B", "\x1b[B", "\x1b[B"]);
		} finally {
			tui.stop();
		}
	});

	it("honors coalesced reports in one chunk (each wheel tick counts)", async () => {
		const terminal = new TestTerminal();
		const tui = new TUI(terminal);
		const component = new InputRecorder();
		tui.addChild(component);
		tui.setFocus(component);
		tui.setMouseEnabled(true);
		tui.start();
		try {
			await feed(terminal, "\x1b[<64;1;1M\x1b[<64;1;1M\x1b[<65;1;1M");
			const ups = component.inputs.filter((i) => i === "\x1b[A").length;
			const downs = component.inputs.filter((i) => i === "\x1b[B").length;
			assert.equal(ups, 6);
			assert.equal(downs, 3);
		} finally {
			tui.stop();
		}
	});

	it("swallows click and motion reports without producing input", async () => {
		const terminal = new TestTerminal();
		const tui = new TUI(terminal);
		const component = new InputRecorder();
		tui.addChild(component);
		tui.setFocus(component);
		tui.setMouseEnabled(true);
		tui.start();
		try {
			// Button 0 press/release (left click), button 35 motion.
			await feed(terminal, "\x1b[<0;5;5M\x1b[<0;5;5m\x1b[<35;7;7M");
			assert.deepEqual(component.inputs, []);
		} finally {
			tui.stop();
		}
	});

	it("passes input through untouched when mouse tracking is off", async () => {
		const terminal = new TestTerminal();
		const tui = new TUI(terminal);
		const component = new InputRecorder();
		tui.addChild(component);
		tui.setFocus(component);
		tui.start();
		try {
			// Not a mouse report at all when disabled — the bytes flow through.
			await feed(terminal, "\x1b[<64;10;10M");
			assert.equal(component.inputs.filter((i) => i === "\x1b[A").length, 0);
		} finally {
			tui.stop();
		}
	});

	it("stop() clears mouse tracking", () => {
		const terminal = new TestTerminal();
		const tui = new TUI(terminal);
		tui.setMouseEnabled(true);
		tui.stop();
		const internal = tui as unknown as { mouseEnabled: boolean };
		assert.equal(internal.mouseEnabled, false);
	});
});
