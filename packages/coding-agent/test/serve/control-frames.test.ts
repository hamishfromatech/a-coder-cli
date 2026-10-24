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
			{ type: "bridge", event: "engine_unavailable", reason: "starting" },
			{ type: "bridge", event: "engine_unavailable", reason: "backlog", id: "c9" },
			{ type: "bridge", event: "server_version", version: "1.0", contract: 1 },
			{ type: "bridge", event: "slow_client", ip: "192.168.1.5" },
		];
		for (const event of events) {
			expect(isBridgeFrame(JSON.parse(bridgeFrame(event)))).toBe(true);
		}
	});

	it("carries the client ip on slow_client so the client can attribute the eviction", () => {
		const frame = JSON.parse(bridgeFrame({ type: "bridge", event: "slow_client", ip: "10.0.0.7" }));
		expect(frame).toEqual({ v: 1, type: "bridge", event: "slow_client", ip: "10.0.0.7" });
	});

	it("rejects engine frames and non-bridge objects", () => {
		expect(isBridgeFrame({ type: "response", id: "1" })).toBe(false);
		expect(isBridgeFrame({ type: "message_update" })).toBe(false);
		expect(isBridgeFrame({ type: "bridge" })).toBe(false);
		expect(isBridgeFrame("bridge")).toBe(false);
		expect(isBridgeFrame(null)).toBe(false);
	});
});
