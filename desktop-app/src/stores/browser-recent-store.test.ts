import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserRecentStore, webUrl } from "./browser-recent-store";

describe("webUrl", () => {
	it("keeps http(s) pages only", () => {
		expect(webUrl("https://example.com/a#b")).toBe("https://example.com/a#b");
		expect(webUrl("http://localhost:3000/")).toBe("http://localhost:3000/");
		expect(webUrl("mailto:hi@example.com")).toBeNull();
		expect(webUrl("file:///tmp/x")).toBeNull();
		expect(webUrl("not a url")).toBeNull();
	});
});

describe("recent pages", () => {
	beforeEach(() => {
		useBrowserRecentStore.setState({ pages: [] });
	});

	it("records a page once, newest first", () => {
		const store = useBrowserRecentStore.getState();
		store.record("https://example.com/one", "One");
		store.record("https://example.com/two", "Two");
		store.record("https://example.com/one", "One again");

		expect(useBrowserRecentStore.getState().pages.map((page) => page.title)).toEqual([
			"One again",
			"Two",
		]);
	});

	it("falls back to the host when a page has no title", () => {
		useBrowserRecentStore.getState().record("https://docs.example.com/guide", "   ");
		expect(useBrowserRecentStore.getState().pages[0]?.title).toBe("docs.example.com");
	});

	it("ignores non-web addresses and caps the list", () => {
		const store = useBrowserRecentStore.getState();
		store.record("mailto:hi@example.com", "Mail");
		expect(useBrowserRecentStore.getState().pages).toHaveLength(0);

		for (let index = 0; index < 70; index += 1) {
			store.record(`https://example.com/${index}`, `Page ${index}`);
		}
		expect(useBrowserRecentStore.getState().pages).toHaveLength(60);
		expect(useBrowserRecentStore.getState().pages[0]?.title).toBe("Page 69");
	});

	it("clears", () => {
		useBrowserRecentStore.getState().record("https://example.com/", "Example");
		useBrowserRecentStore.getState().clear();
		expect(useBrowserRecentStore.getState().pages).toHaveLength(0);
	});
});
