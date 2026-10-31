import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToolProgressStore } from "../stores/tool-progress-store";
import { findRunningBashToolCallId } from "./bash-background";

vi.mock("./rpc", () => ({
	sendCommand: vi.fn().mockResolvedValue({ toolCallId: "t1" }),
}));
vi.mock("../stores/toast-store", () => ({
	toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

describe("background bash", () => {
	beforeEach(() => {
		useToolProgressStore.getState().clear();
	});

	it("finds the latest running bash stream", () => {
		const store = useToolProgressStore.getState();
		store.start("t1", "bash");
		store.start("t2", "read");
		expect(findRunningBashToolCallId()).toBe("t1");
	});

	it("ignores ended streams", () => {
		const store = useToolProgressStore.getState();
		store.start("t1", "bash");
		store.end("t1", false);
		expect(findRunningBashToolCallId()).toBeNull();
	});

	it("prefers the most recent running bash when several exist", () => {
		const store = useToolProgressStore.getState();
		store.start("t1", "bash");
		store.start("t2", "bash");
		expect(findRunningBashToolCallId()).toBe("t2");
	});
});
