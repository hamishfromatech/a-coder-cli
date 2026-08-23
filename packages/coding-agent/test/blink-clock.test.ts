import { describe, expect, it, vi } from "vitest";
import { isBlinkVisible, subscribeBlink } from "../src/modes/interactive/components/blink-clock.ts";

// Mock TUI
const mockTui = {
	requestRender: vi.fn(),
};

describe("blink-clock", () => {
	it("isBlinkVisible returns true when no timer is running", () => {
		// Before any subscribers, visible should be true.
		expect(isBlinkVisible()).toBe(true);
	});

	it("subscribeBlink starts the timer and calls requestRender on tick", () => {
		vi.useFakeTimers();

		const unsubscribe = subscribeBlink(mockTui as any);

		// Timer should be running now.
		expect(mockTui.requestRender).not.toHaveBeenCalled();

		// Advance past the blink interval (480ms).
		vi.advanceTimersByTime(500);

		expect(mockTui.requestRender).toHaveBeenCalled();

		unsubscribe();
		vi.useRealTimers();
	});

	it("isBlinkVisible toggles on each tick", () => {
		vi.useFakeTimers();

		const unsubscribe = subscribeBlink(mockTui as any);

		const initial = isBlinkVisible();

		vi.advanceTimersByTime(500);
		const afterTick = isBlinkVisible();

		expect(afterTick).toBe(!initial);

		unsubscribe();
		vi.useRealTimers();
	});

	it("timer stops when last subscriber unsubscribes", () => {
		vi.useFakeTimers();

		const unsubscribe1 = subscribeBlink(mockTui as any);
		const unsubscribe2 = subscribeBlink(mockTui as any);

		vi.advanceTimersByTime(500);
		const callCountAfterFirstTick = mockTui.requestRender.mock.calls.length;

		unsubscribe1();
		// Timer still running (one subscriber left).
		vi.advanceTimersByTime(500);
		expect(mockTui.requestRender.mock.calls.length).toBeGreaterThan(callCountAfterFirstTick);

		const callCountAfterSecondTick = mockTui.requestRender.mock.calls.length;
		unsubscribe2();
		// Timer stopped.
		vi.advanceTimersByTime(500);
		expect(mockTui.requestRender.mock.calls.length).toBe(callCountAfterSecondTick);

		vi.useRealTimers();
	});
});
