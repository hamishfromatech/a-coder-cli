import { beforeEach, describe, expect, it } from "vitest";
import { useSessionViewStore } from "./session-view-store";

beforeEach(() => {
	useSessionViewStore.setState({ scroll: {}, expanded: {} });
});

describe("session view store", () => {
	it("records a scroll anchor per session", () => {
		useSessionViewStore.getState().setScroll("/a.jsonl", 120);
		useSessionViewStore.getState().setScroll("/b.jsonl", 40);
		expect(useSessionViewStore.getState().scroll).toEqual({ "/a.jsonl": 120, "/b.jsonl": 40 });
	});

	it("toggles tool expansion per session without duplicates", () => {
		const store = useSessionViewStore.getState();
		store.setToolExpanded("/a.jsonl", "t1", true);
		store.setToolExpanded("/a.jsonl", "t1", true);
		store.setToolExpanded("/a.jsonl", "t2", true);
		expect(useSessionViewStore.getState().expanded["/a.jsonl"]).toEqual(["t1", "t2"]);
		store.setToolExpanded("/a.jsonl", "t1", false);
		expect(useSessionViewStore.getState().expanded["/a.jsonl"]).toEqual(["t2"]);
	});
});
