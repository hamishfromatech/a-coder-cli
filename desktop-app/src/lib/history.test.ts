import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	getMessages: vi.fn(),
}));

vi.mock("./rpc", () => ({
	getMessages: h.getMessages,
}));

import { applyHistoryPage, loadOlderHistory } from "./history";
import { useSessionStore } from "../stores/session-store";

const message = (text: string) => ({ role: "user", content: [{ type: "text", text }] }) as never;

beforeEach(() => {
	h.getMessages.mockReset();
	useSessionStore.getState().resetSession();
});

describe("history paging", () => {
	it("applies a tail page with its window metadata", () => {
		applyHistoryPage({ messages: [message("tail")], total: 40, start: 39, hasMore: true });
		const state = useSessionStore.getState();
		expect(state.messages).toHaveLength(1);
		expect(state.messagesStart).toBe(39);
		expect(state.messagesTotal).toBe(40);
		expect(state.hasMoreOlder).toBe(true);
	});

	it("loads an older page and prepends it", async () => {
		applyHistoryPage({ messages: [message("tail")], total: 40, start: 39, hasMore: true });
		h.getMessages.mockResolvedValue({
			messages: [message("older")],
			total: 40,
			start: 38,
			hasMore: true,
		});
		const added = await loadOlderHistory();
		expect(added).toBe(1);
		expect(h.getMessages).toHaveBeenCalledWith({ limit: 100, before: 39 });
		const state = useSessionStore.getState();
		expect(state.messagesStart).toBe(38);
		expect(state.hasMoreOlder).toBe(true);
		expect(state.loadingOlder).toBe(false);
		expect(state.messages.map((m: any) => m.content[0].text)).toEqual(["older", "tail"]);
	});

	it("does nothing when history is exhausted", async () => {
		applyHistoryPage({ messages: [message("only")], total: 1, start: 0, hasMore: false });
		expect(await loadOlderHistory()).toBe(0);
		expect(h.getMessages).not.toHaveBeenCalled();
	});
});
