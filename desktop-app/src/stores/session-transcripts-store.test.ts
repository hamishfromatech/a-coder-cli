import { beforeEach, describe, expect, it } from "vitest";
import { useSessionTranscriptsStore } from "./session-transcripts-store";

beforeEach(() => {
	useSessionTranscriptsStore.setState({ transcripts: {}, subscribed: {} });
});

describe("session transcripts store", () => {
	it("tracks unread and clears it on read", () => {
		const store = useSessionTranscriptsStore.getState();
		store.update("/s/a.jsonl", (previous) => ({ ...previous, unread: 2 }));
		expect(useSessionTranscriptsStore.getState().transcripts["/s/a.jsonl"]?.unread).toBe(2);
		useSessionTranscriptsStore.getState().markRead("/s/a.jsonl");
		expect(useSessionTranscriptsStore.getState().transcripts["/s/a.jsonl"]?.unread).toBe(0);
	});

	it("keeps subscribed transcripts when evicting", () => {
		useSessionTranscriptsStore.getState().setSubscribed("/s/0.jsonl", true);
		for (let i = 0; i < 10; i += 1) {
			useSessionTranscriptsStore.getState().update(`/s/${i}.jsonl`, (previous) => ({
				...previous,
				lastActivity: i,
			}));
		}
		useSessionTranscriptsStore.getState().update("/s/10.jsonl", (previous) => ({
			...previous,
			lastActivity: 10,
		}));
		expect(useSessionTranscriptsStore.getState().transcripts["/s/0.jsonl"]).toBeDefined();
	});
});
