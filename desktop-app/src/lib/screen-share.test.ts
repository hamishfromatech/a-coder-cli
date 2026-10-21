import { describe, expect, it } from "vitest";
import { screenFrameDataUrl, shouldAttachScreenFrame } from "./screen-share";

describe("screen share attachment policy", () => {
	it("attaches the first frame", () => {
		expect(shouldAttachScreenFrame(1, -1, 0)).toBe(true);
	});

	it("attaches a changed frame immediately", () => {
		expect(shouldAttachScreenFrame(4, 3, 1_000, 2_000)).toBe(true);
	});

	it("skips an unchanged frame inside the refresh window", () => {
		expect(shouldAttachScreenFrame(4, 4, 1_000, 20_000)).toBe(false);
	});

	it("refreshes an unchanged frame after 30 seconds", () => {
		expect(shouldAttachScreenFrame(4, 4, 1_000, 31_000)).toBe(true);
	});

	it("builds a data URL without changing the base64 payload", () => {
		const frame = {
			base64: "abc123",
			mimeType: "image/jpeg",
			width: 1568,
			height: 900,
			version: 2,
			changedRatio: 0.2,
			capturedAt: 123,
			sourceName: "Safari",
		};
		expect(screenFrameDataUrl(frame)).toBe("data:image/jpeg;base64,abc123");
	});
});
