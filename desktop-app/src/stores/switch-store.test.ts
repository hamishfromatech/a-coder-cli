import { describe, expect, it } from "vitest";
import { useSwitchStore } from "./switch-store";

describe("switch store", () => {
	it("admits one switch at a time", () => {
		useSwitchStore.setState({ pending: null });
		expect(useSwitchStore.getState().begin({ kind: "session", path: "/a", name: "A" })).toBe(true);
		expect(useSwitchStore.getState().begin({ kind: "session", path: "/b", name: "B" })).toBe(false);
		expect(useSwitchStore.getState().pending?.path).toBe("/a");
	});

	it("only clears the switch it was asked to clear", () => {
		useSwitchStore.setState({ pending: { kind: "project", path: "/p", name: "P" } });
		useSwitchStore.getState().clear("/other");
		expect(useSwitchStore.getState().pending?.path).toBe("/p");
		useSwitchStore.getState().clear("/p");
		expect(useSwitchStore.getState().pending).toBeNull();
	});
});
