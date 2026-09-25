import { describe, expect, it } from "vitest";
import { type BridgeEvent, bridgeFrame, isBridgeFrame } from "../../src/serve/control-frames.ts";

describe("bridge control frames", () => {
	it("builds and recognizes a connected frame", () => {
		const line = bridgeFrame({ type: "bridge", event: "connected", clients: 2 });
		expect(line.endsWith("\n")).toBe(true);
		const frame = JSON.parse(line);
		expect(frame).toEqual({ v: 1, type: "bridge", event: "connected", clients: 2 });
		expect(isBridgeFrame(frame)).toBe(true);
	});

	it("recognizes all control frame events", () => {
		const events: BridgeEvent[] = [
			{ type: "bridge", event: "connected", clients: 1 },
			{ type: "bridge", event: "shutting_down" },
			{ type: "bridge", event: "engine_exited", code: 3 },
			{ type: "bridge", event: "engine_failed", attempts: 2 },
			{ type: "bridge", event: "server_version", version: "1.0" },
		];
		for (const event of events) {
			expect(isBridgeFrame(JSON.parse(bridgeFrame(event)))).toBe(true);
		}
	});

	it("rejects engine frames and non-bridge objects", () => {
		expect(isBridgeFrame({ type: "response", id: "1" })).toBe(false);
		expect(isBridgeFrame({ type: "message_update" })).toBe(false);
		expect(isBridgeFrame({ type: "bridge" })).toBe(false);
		expect(isBridgeFrame("bridge")).toBe(false);
		expect(isBridgeFrame(null)).toBe(false);
	});
});
