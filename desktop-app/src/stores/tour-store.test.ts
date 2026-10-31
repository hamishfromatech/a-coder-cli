import { beforeEach, describe, expect, it } from "vitest";
import { useTourStore } from "./tour-store";

describe("tour store", () => {
	beforeEach(() => {
		useTourStore.setState({ completed: false, stepIndex: null });
	});

	it("starts the tour for a new user", () => {
		useTourStore.getState().startForNewUser();
		expect(useTourStore.getState().stepIndex).toBe(0);
		expect(useTourStore.getState().completed).toBe(false);
	});

	it("does not start again once completed (skip or finish counts)", () => {
		useTourStore.getState().end();
		useTourStore.getState().startForNewUser();
		expect(useTourStore.getState().stepIndex).toBeNull();
	});

	it("ends the tour from any step and marks completion", () => {
		useTourStore.getState().start();
		useTourStore.getState().next();
		useTourStore.getState().next();
		useTourStore.getState().end();
		expect(useTourStore.getState().completed).toBe(true);
		expect(useTourStore.getState().stepIndex).toBeNull();
	});

	it("restarts deliberately even after completion", () => {
		useTourStore.getState().end();
		useTourStore.getState().start();
		expect(useTourStore.getState().stepIndex).toBe(0);
	});

	it("back stops at the first step", () => {
		useTourStore.getState().start();
		useTourStore.getState().back();
		expect(useTourStore.getState().stepIndex).toBe(0);
	});
});
