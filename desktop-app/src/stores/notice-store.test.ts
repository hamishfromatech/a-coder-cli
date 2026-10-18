// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notice, useNoticeStore } from "./notice-store";

beforeEach(() => {
	localStorage.clear();
	useNoticeStore.setState({ notices: [], dismissed: [] });
});

describe("notice store", () => {
	it("replaces a notice with the same id instead of stacking", () => {
		notice({ id: "auth", title: "first" });
		notice({ id: "auth", title: "second" });
		expect(useNoticeStore.getState().notices).toHaveLength(1);
		expect(useNoticeStore.getState().notices[0]?.title).toBe("second");
	});

	it("derives priority from tone unless given", () => {
		notice({ id: "a", title: "info", tone: "info" });
		notice({ id: "b", title: "err", tone: "error" });
		const byId = Object.fromEntries(useNoticeStore.getState().notices.map((n) => [n.id, n.priority]));
		expect(byId.b!).toBeGreaterThan(byId.a!);
	});

	it("remembers a persisted dismissal across a reload", () => {
		notice({ id: "mcp", title: "MCP down", persistKey: "mcp-unavailable" });
		const target = useNoticeStore.getState().notices[0]!;
		useNoticeStore.getState().dismissForever(target);
		expect(useNoticeStore.getState().notices).toHaveLength(0);

		// Simulate a fresh process: dismissed keys come from storage.
		useNoticeStore.setState({
			notices: [],
			dismissed: JSON.parse(localStorage.getItem("a-coder.notices.dismissed") ?? "[]") as string[],
		});
		notice({ id: "mcp", title: "MCP down", persistKey: "mcp-unavailable" });
		expect(useNoticeStore.getState().notices).toHaveLength(0);
	});

	it("does not persist a dismissal without a persistKey", () => {
		notice({ id: "tmp", title: "temp" });
		useNoticeStore.getState().dismissForever(useNoticeStore.getState().notices[0]!);
		expect(localStorage.getItem("a-coder.notices.dismissed")).toBeNull();
		notice({ id: "tmp", title: "temp" });
		expect(useNoticeStore.getState().notices).toHaveLength(1);
	});

	it("runs an action on select", () => {
		const onSelect = vi.fn();
		notice({ id: "x", title: "x", action: { label: "Go", onSelect } });
		useNoticeStore.getState().notices[0]!.action?.onSelect();
		expect(onSelect).toHaveBeenCalledOnce();
	});
});
