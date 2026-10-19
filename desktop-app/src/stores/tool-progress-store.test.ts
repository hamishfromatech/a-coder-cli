import { beforeEach, describe, expect, it } from "vitest";
import { useToolProgressStore } from "./tool-progress-store";

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
});
