import { beforeEach, describe, expect, it } from "vitest";
import { useDraftStore } from "./draft-store";

describe("draft-store", () => {
	beforeEach(() => {
		useDraftStore.setState({ drafts: {} });
	});

	it("saves and takes a draft", () => {
		const store = useDraftStore.getState();
		store.saveDraft("/s/a.jsonl", "half-written message");
		expect(useDraftStore.getState().drafts["/s/a.jsonl"]).toBe("half-written message");
	});

	it("takeDraft returns and removes the draft", () => {
		useDraftStore.setState({ drafts: { "/s/a.jsonl": "hello" } });
		expect(useDraftStore.getState().takeDraft("/s/a.jsonl")).toBe("hello");
		// Consumed: second take returns undefined.
		expect(useDraftStore.getState().drafts["/s/a.jsonl"]).toBeUndefined();
	});

	it("keeps drafts for different sessions isolated", () => {
		useDraftStore.getState().saveDraft("/s/a.jsonl", "draft A");
		useDraftStore.getState().saveDraft("/s/b.jsonl", "draft B");
		expect(useDraftStore.getState().takeDraft("/s/a.jsonl")).toBe("draft A");
		expect(useDraftStore.getState().drafts["/s/b.jsonl"]).toBe("draft B");
	});

	it("returns undefined for sessions without a draft", () => {
		expect(useDraftStore.getState().takeDraft("/s/none.jsonl")).toBeUndefined();
	});
});