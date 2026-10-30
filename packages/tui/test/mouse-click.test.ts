import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Container, TuiMainScreen, type TuiMouseDispatchResult, type TuiMouseEvent } from "../src/index.ts";
import { TestTerminal } from "./terminal-colors.test.ts";

/** Fixed-height child that records click events. */
class ClickRecorder extends Container {
	clicks: TuiMouseEvent[] = [];
	readonly height = 40;

	override render(width: number): string[] {
		// Record the width implicitly used by dispatch to sanity-check bounds.
		return Array.from({ length: this.height }, (_, i) => `row${i}`.padEnd(Math.min(width, 10)));
	}

	handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		if (event.type !== "click") return undefined;
		this.clicks.push(event);
		return {
			handled: true,
			target: { component: this, originX: 0, originY: 0, width: event.width, height: event.height },
		};
	}
}

/** Simulate raw stdin bytes arriving. */
async function feed(terminal: TestTerminal, data: string): Promise<void> {
	terminal.sendInput(data);
	await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("TuiMainScreen click dispatch", () => {
	it("synthesizes a click from press+release in one cell and maps viewport rows to content", async () => {
		const terminal = new TestTerminal();
		const tui = new TuiMainScreen(terminal);
		const component = new ClickRecorder();
		tui.addChild(component);
		tui.enableMouseReportTracking();
		tui.start();
		try {
			// Viewport row 6 is the last visible row of 40 content lines at 24 rows
			// of viewport: contentY = 40 - 24 + 6.
			await feed(terminal, "\x1b[<0;11;7M");
			await feed(terminal, "\x1b[<0;11;7m");
			assert.equal(component.clicks.length, 1);
			const click = component.clicks[0];
			assert.equal(click.type, "click");
			assert.equal(click.x, 10);
			assert.equal(click.y, 40 - tui.terminal.rows + 6);
		} finally {
			tui.stop();
		}
	});

	it("ignores a drag (release far from press)", async () => {
		const terminal = new TestTerminal();
		const tui = new TuiMainScreen(terminal);
		const component = new ClickRecorder();
		tui.addChild(component);
		tui.enableMouseReportTracking();
		tui.start();
		try {
			await feed(terminal, "\x1b[<0;1;1M");
			await feed(terminal, "\x1b[<0;40;20m");
			assert.equal(component.clicks.length, 0);
		} finally {
			tui.stop();
		}
	});

	it("ignores middle/right and orphan releases", async () => {
		const terminal = new TestTerminal();
		const tui = new TuiMainScreen(terminal);
		const component = new ClickRecorder();
		tui.addChild(component);
		tui.enableMouseReportTracking();
		tui.start();
		try {
			await feed(terminal, "\x1b[<1;5;5M\x1b[<1;5;5m");
			await feed(terminal, "\x1b[<2;5;5M\x1b[<2;5;5m");
			await feed(terminal, "\x1b[<0;5;5m");
			assert.equal(component.clicks.length, 0);
		} finally {
			tui.stop();
		}
	});

	it("does not dispatch when tracking was never acquired", async () => {
		const terminal = new TestTerminal();
		const tui = new TuiMainScreen(terminal);
		const component = new ClickRecorder();
		tui.addChild(component);
		tui.start();
		try {
			const raw = component.render(80);
			await feed(terminal, "\x1b[<0;5;5M\x1b[<0;5;5m");
			assert.equal(component.clicks.length, 0);
			// And the report must not leak into the component as input either.
			assert.deepEqual(raw, component.render(80));
		} finally {
			tui.stop();
		}
	});
});
