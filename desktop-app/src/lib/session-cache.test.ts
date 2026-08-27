import { beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	clearSessionCache,
	getCachedSessionMessages,
	setCachedSessionMessages,
} from "./session-cache";

function msg(role: "user" | "assistant", text: string): AgentMessage {
	return { role, content: [{ type: "text", text }] } as unknown as AgentMessage;
}

describe("session-cache", () => {
	beforeEach(() => {
		clearSessionCache();
	});

	it("stores and retrieves messages by session file", () => {
		const messages = [msg("user", "hi")];
		setCachedSessionMessages("/s/a.jsonl", messages);
		expect(getCachedSessionMessages("/s/a.jsonl")).toBe(messages);
	});

	it("evicts the least recently used entry beyond the cap", () => {
		for (let i = 0; i < 24; i++) {
			setCachedSessionMessages(`/s/${i}.jsonl`, [msg("user", `m${i}`)]);
		}
		// Touch the oldest so it survives.
		expect(getCachedSessionMessages("/s/0.jsonl")).toBeDefined();
		setCachedSessionMessages("/s/new.jsonl", [msg("user", "new")]);
		// The second-oldest was evicted, the touched one survived.
		expect(getCachedSessionMessages("/s/1.jsonl")).toBeUndefined();
		expect(getCachedSessionMessages("/s/0.jsonl")).toBeDefined();
		expect(getCachedSessionMessages("/s/23.jsonl")).toBeDefined();
	});

	it("refreshes recency on get", () => {
		for (let i = 0; i < 24; i++) {
			setCachedSessionMessages(`/s/${i}.jsonl`, [msg("user", "hi")]);
		}
		// Touch the oldest entry, then insert one more — the second-oldest should
		// be evicted instead of the just-read one.
		getCachedSessionMessages("/s/0.jsonl");
		setCachedSessionMessages("/s/new.jsonl", [msg("user", "x")]);
		expect(getCachedSessionMessages("/s/1.jsonl")).toBeUndefined();
		expect(getCachedSessionMessages("/s/0.jsonl")).toBeDefined();
	});

	it("ignores empty session file keys", () => {
		setCachedSessionMessages("", []);
		expect(getCachedSessionMessages("")).toBeUndefined();
	});
});