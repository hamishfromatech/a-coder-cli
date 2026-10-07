import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StdinBuffer } from "../src/stdin-buffer.ts";

const WHEEL_DOWN = "\x1b[<65;65;20M";
const WHEEL_DOWN_2 = "\x1b[<65;65;21M";
const WHEEL_UP = "\x1b[<64;65;19M";

describe("stdin buffer mouse report handling", () => {
	it("splits coalesced SGR mouse reports into single sequences", () => {
		const buffer = new StdinBuffer();
		const emitted: string[] = [];
		buffer.on("data", (sequence) => emitted.push(sequence));
		buffer.process(`${WHEEL_DOWN}${WHEEL_DOWN_2}${WHEEL_UP}`);
		assert.deepEqual(emitted, [WHEEL_DOWN, WHEEL_DOWN_2, WHEEL_UP]);
	});

	it("a single SGR wheel report stays one sequence", () => {
		const buffer = new StdinBuffer();
		const emitted: string[] = [];
		buffer.on("data", (sequence) => emitted.push(sequence));
		buffer.process(WHEEL_DOWN);
		assert.deepEqual(emitted, [WHEEL_DOWN]);
	});

	it("holds a split mouse report until the tail arrives — no editor leak", (t) => {
		// Under load (streaming output), stdin chunks split mid-sequence and the
		// tail arrives after the short sequence timeout. Flushing the fragment
		// reaches the editor as typed text ("<65;65;20M"); the buffer must hold
		// a plausible CSI prefix until the tail completes it.
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const buffer = new StdinBuffer();
		const emitted: string[] = [];
		buffer.on("data", (sequence) => emitted.push(sequence));

		buffer.process("\x1b[<65;6");
		t.mock.timers.tick(80); // past the old 50ms fragment timeout
		assert.deepEqual(emitted, []); // must NOT flush the partial report

		buffer.process("5;20M");
		assert.deepEqual(emitted, [WHEEL_DOWN]); // reassembled wholesale

		t.mock.timers.tick(1200); // the hold cap never leaks a completed report
		assert.deepEqual(emitted, [WHEEL_DOWN]);
	});

	it("a CSI fragment flushes eventually when the tail never arrives", (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const buffer = new StdinBuffer();
		const emitted: string[] = [];
		buffer.on("data", (sequence) => emitted.push(sequence));

		buffer.process("\x1b[<65;6");
		t.mock.timers.tick(1400); // hard cap: bounded hold, then flush as-is
		assert.deepEqual(emitted, ["\x1b[<65;6"]);
	});

	it("plain text and lone ESC still follow the short timeouts", (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const buffer = new StdinBuffer();
		const emitted: string[] = [];
		buffer.on("data", (sequence) => emitted.push(sequence));

		// Lone ESC (meta-escape ambiguity): flushed after the short escape window.
		buffer.process("\x1b");
		t.mock.timers.tick(15);
		assert.deepEqual(emitted, ["\x1b"]);
	});
});
