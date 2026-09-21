import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticesComponent } from "../src/modes/interactive/components/notices.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

describe("NoticesComponent expiry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("auto-expires notices after the TTL and fires onExpire", () => {
		const onExpire = vi.fn();
		const notices = new NoticesComponent();
		notices.onExpire = onExpire;

		notices.add("error", "model timeout");
		expect(notices.render(80).length).toBeGreaterThan(0);

		vi.advanceTimersByTime(7999);
		expect(notices.render(80).length).toBeGreaterThan(0);

		vi.advanceTimersByTime(1);
		expect(onExpire).toHaveBeenCalledTimes(1);
		expect(notices.render(80)).toEqual([]);
	});

	it("refreshes expiry when an identical notice repeats", () => {
		const notices = new NoticesComponent();
		notices.add("error", "model timeout");
		vi.advanceTimersByTime(7000);
		notices.add("error", "model timeout"); // collapse + refresh

		vi.advanceTimersByTime(7000);
		// 14s elapsed since the first add, only 7s since the refresh — still visible.
		const lines = notices.render(80);
		expect(lines.join("\n")).toContain("×2");

		vi.advanceTimersByTime(1000);
		expect(notices.render(80)).toEqual([]);
	});

	it("keeps later notices until their own expiry after an earlier one expires", () => {
		const notices = new NoticesComponent();
		notices.add("error", "first");
		vi.advanceTimersByTime(5000);
		notices.add("warning", "second");

		vi.advanceTimersByTime(3000); // first expires at 8s
		const lines = notices.render(80).join("\n");
		expect(lines).not.toContain("first");
		expect(lines).toContain("second");

		vi.advanceTimersByTime(5000); // second expires at 13s
		expect(notices.render(80)).toEqual([]);
	});

	it("clear() cancels the pending expiry", () => {
		const onExpire = vi.fn();
		const notices = new NoticesComponent();
		notices.onExpire = onExpire;

		notices.add("error", "model timeout");
		notices.clear();
		vi.advanceTimersByTime(60000);
		expect(onExpire).not.toHaveBeenCalled();
		expect(notices.render(80)).toEqual([]);
	});
});
