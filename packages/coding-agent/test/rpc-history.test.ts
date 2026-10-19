import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { SessionTreeNode } from "../src/core/session-manager.ts";
import { flattenSessionTree, pageMessages } from "../src/modes/rpc/rpc-history.ts";

const msg = (role: AgentMessage["role"]): AgentMessage => ({ role, content: [] }) as unknown as AgentMessage;

describe("pageMessages", () => {
	const all = [msg("user"), msg("assistant"), msg("toolResult"), msg("toolResult"), msg("assistant")];

	it("returns everything when no pagination is requested", () => {
		const page = pageMessages(all);
		expect(page.messages).toHaveLength(5);
		expect(page).toMatchObject({ total: 5, start: 0, end: 5, hasMore: false });
	});

	it("returns the tail page by default", () => {
		const page = pageMessages(all, { limit: 3 });
		// The page start (index 2) is a tool result, so it walks back to the
		// assistant that owns the call.
		expect(page.messages.map((m) => m.role)).toEqual(["assistant", "toolResult", "toolResult", "assistant"]);
		expect(page).toMatchObject({ total: 5, start: 1, end: 5, hasMore: true });
	});

	it("walks a page start back to the owning assistant message", () => {
		const page = pageMessages(all, { limit: 2, before: 5 });
		expect(page.start).toBe(1);
		expect(page.messages.map((m) => m.role)).toEqual(["assistant", "toolResult", "toolResult", "assistant"]);
		expect(page.hasMore).toBe(true);
	});

	it("returns an older page and reports when history is exhausted", () => {
		const page = pageMessages(all, { limit: 2, before: 2 });
		expect(page.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(page).toMatchObject({ start: 0, end: 2, hasMore: false });
	});

	it("clamps out-of-range cursors and limits", () => {
		expect(pageMessages(all, { limit: 10_000, before: 99 })).toMatchObject({ start: 0, end: 5 });
		expect(pageMessages(all, { before: -4 })).toMatchObject({ start: 0, end: 0, hasMore: false });
	});
});

describe("flattenSessionTree", () => {
	it("returns a depth-first flat node list without message bodies", () => {
		const tree = [
			{
				entry: {
					id: "a",
					parentId: null,
					type: "message",
					timestamp: "t1",
					message: { role: "user", content: [] },
				},
				children: [
					{
						entry: {
							id: "b",
							parentId: "a",
							type: "message",
							timestamp: "t2",
							message: { role: "assistant", content: [] },
						},
						children: [],
						label: "turn",
					},
				],
				label: "start",
			},
		] as unknown as SessionTreeNode[];

		const nodes = flattenSessionTree(tree);
		expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
		expect(nodes[0]).toMatchObject({ parentId: null, type: "message", messageRole: "user", label: "start" });
		expect(nodes[1]).toMatchObject({ parentId: "a", messageRole: "assistant", label: "turn" });
		expect(nodes.every((n) => !("message" in n))).toBe(true);
	});
});
