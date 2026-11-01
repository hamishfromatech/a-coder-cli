import { beforeEach, describe, expect, it, vi } from "vitest";

// The store binds the Tauri event channel at module load; stub the IPC surface
// so the tests exercise only the event reducer.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { useBrowserStore } from "./browser-store";

const tab = {
	id: "t1",
	url: "https://example.com/",
	title: "Example",
	loading: true,
	back: false,
	forward: false,
	muted: false,
	zoom: 1,
};

describe("browser event reducer", () => {
	beforeEach(() => {
		useBrowserStore.setState({
			tabs: [tab],
			activeId: "t1",
			initialized: true,
			supported: true,
			gateway: null,
			downloads: [],
			recentDownloads: [],
		});
	});

	it("applies a title event keyed by tabId", () => {
		useBrowserStore
			.getState()
			.applyEvent({ type: "title", tabId: "t1", title: "Example Domain", seq: 5 });
		expect(useBrowserStore.getState().tabs[0]?.title).toBe("Example Domain");
	});

	it("clears loading when the finish arrives after a newer url event", () => {
		// A redirect commit (url, seq 9) is delivered before the previous
		// document's finished load (seq 8); the stop must still apply.
		useBrowserStore
			.getState()
			.applyEvent({ type: "url", tabId: "t1", url: "https://example.com/next", seq: 9 });
		useBrowserStore
			.getState()
			.applyEvent({ type: "load", tabId: "t1", url: "https://example.com/next", started: false, seq: 8 });
		expect(useBrowserStore.getState().tabs[0]?.loading).toBe(false);
	});

	it("drops a stale started event superseded by a newer finish", () => {
		useBrowserStore
			.getState()
			.applyEvent({ type: "load", tabId: "t1", url: "https://example.com/", started: true, seq: 10 });
		useBrowserStore
			.getState()
			.applyEvent({ type: "load", tabId: "t1", url: "https://example.com/", started: false, seq: 11 });
		useBrowserStore
			.getState()
			.applyEvent({ type: "load", tabId: "t1", url: "https://example.com/", started: true, seq: 10 });
		expect(useBrowserStore.getState().tabs[0]?.loading).toBe(false);
	});

	it("ignores events for tabs it does not know", () => {
		useBrowserStore
			.getState()
			.applyEvent({ type: "title", tabId: "ghost", title: "Ghost", seq: 1 });
		expect(useBrowserStore.getState().tabs[0]?.title).toBe("Example");
	});
});
