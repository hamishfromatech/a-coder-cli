import { beforeEach, describe, expect, it } from "vitest";
import { formatToolProgress, useToolProgressStore } from "./tool-progress-store";

beforeEach(() => {
	useToolProgressStore.getState().clear();
});

describe("tool progress store", () => {
	it("appends and resets stdout/stderr independently", () => {
		const store = useToolProgressStore.getState();
		store.start("t1", "bash");
		store.append("t1", "stdout", "abc");
		store.append("t1", "stdout", "def");
		store.append("t1", "stderr", "warn");
		store.append("t1", "stdout", "xyz", true);
		const stream = useToolProgressStore.getState().streams.t1;
		expect(stream).toMatchObject({ stdout: "xyz", stderr: "warn", ended: false });
	});

	it("marks the stream ended", () => {
		useToolProgressStore.getState().start("t1", "bash");
		useToolProgressStore.getState().end("t1", true);
		expect(useToolProgressStore.getState().streams.t1).toMatchObject({ ended: true, isError: true });
	});

	it("stores live MCP progress without clearing output", () => {
		const store = useToolProgressStore.getState();
		store.start("t1", "mcp__meshy__refine");
		store.append("t1", "stdout", "working");
		store.setProgress("t1", "mcp__meshy__refine", {
			progress: 42,
			total: 100,
			percent: 42,
			message: "refining mesh",
		});
		expect(useToolProgressStore.getState().streams.t1).toMatchObject({
			stdout: "working",
			progress: { percent: 42, message: "refining mesh" },
		});
	});

	it("formats percent and message", () => {
		expect(formatToolProgress(undefined)).toBe("");
		expect(formatToolProgress({ progress: 1 })).toBe("");
		expect(formatToolProgress({ progress: 1, percent: 42 })).toBe("42%");
		expect(formatToolProgress({ progress: 1, percent: 42, message: "refining mesh" })).toBe(
			"42% · refining mesh",
		);
		expect(formatToolProgress({ progress: 1, message: "working" })).toBe("working");
	});
});
