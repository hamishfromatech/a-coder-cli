import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	bridgeStatus,
	buildPairingPayload,
	manualChunks,
	maskToken,
	parseEndpoint,
	parseServeBannerLine,
	platformLabel,
	relativeTime,
	STOPPED_SNAPSHOT,
	type ServeBanner,
} from "./serve";

const EMPTY: ServeBanner = {
	endpoint: null,
	token: null,
	manual: null,
	name: null,
	tls: false,
	pin: null,
};

const TOKEN = "abcd1234efgh5678ijkl9012mnop3456qrst7890";

function machineId(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 8);
}

describe("parseServeBannerLine", () => {
	it("parses the plain-ws banner", () => {
		const banner = parseServeBannerLine(EMPTY, "a-coder-cli serve listening on ws://192.168.1.20:8787");
		expect(banner.endpoint).toBe("ws://192.168.1.20:8787");
		expect(banner.tls).toBe(false);
	});

	it("parses TLS, pin, token, manual chunks and mDNS name", () => {
		let banner = parseServeBannerLine(EMPTY, "a-coder-cli serve listening on wss://10.0.0.4:9443");
		banner = parseServeBannerLine(banner, `TLS certificate pin (SHA-256): ${"ab".repeat(32)}`);
		banner = parseServeBannerLine(banner, `Pairing token: ${TOKEN}`);
		banner = parseServeBannerLine(banner, "  manual: abcd-1234-efgh-5678");
		banner = parseServeBannerLine(banner, '[serve] mDNS: _a-coder._tcp announced as "A-Coder on mac"');
		expect(banner.endpoint).toBe("wss://10.0.0.4:9443");
		expect(banner.tls).toBe(true);
		expect(banner.pin).toBe("ab".repeat(32));
		expect(banner.token).toBe(TOKEN);
		expect(banner.manual).toBe("abcd-1234-efgh-5678");
		expect(banner.name).toBe("A-Coder on mac");
	});

	it("ignores unrelated log lines", () => {
		expect(parseServeBannerLine(EMPTY, "[serve] engine started")).toEqual(EMPTY);
	});
});

describe("parseEndpoint", () => {
	it("splits host, port and scheme", () => {
		expect(parseEndpoint("ws://192.168.1.20:8787")).toEqual({
			host: "192.168.1.20",
			port: 8787,
			tls: false,
		});
		expect(parseEndpoint("wss://10.0.0.4:9443")).toEqual({
			host: "10.0.0.4",
			port: 9443,
			tls: true,
		});
	});

	it("rejects malformed endpoints", () => {
		expect(parseEndpoint(null)).toBeNull();
		expect(parseEndpoint("http://nope:1")).toBeNull();
		expect(parseEndpoint("ws://nope")).toBeNull();
	});
});

describe("buildPairingPayload", () => {
	it("builds a plain-ws payload without a pin", async () => {
		const payload = await buildPairingPayload({
			endpoint: "ws://192.168.1.20:8787",
			token: TOKEN,
			name: "A-Coder on mac",
			pin: null,
			tls: false,
		});
		expect(payload).toMatchObject({
			v: 1,
			kind: "acoder",
			host: "192.168.1.20",
			port: 8787,
			tls: false,
			token: TOKEN,
			name: "A-Coder on mac",
			id: machineId(TOKEN),
		});
		expect(payload).not.toHaveProperty("pin");
	});

	it("builds a pinned-wss payload", async () => {
		const pin = "ab".repeat(32);
		const payload = await buildPairingPayload({
			endpoint: "wss://10.0.0.4:9443",
			token: TOKEN,
			name: "A-Coder on mac",
			pin,
			tls: true,
		});
		expect(payload?.tls).toBe(true);
		expect(payload?.pin).toBe(pin);
	});

	it("returns null until endpoint and token exist", async () => {
		expect(await buildPairingPayload({ ...EMPTY })).toBeNull();
		expect(
			await buildPairingPayload({ ...EMPTY, endpoint: "ws://1.2.3.4:8787" }),
		).toBeNull();
	});
});

describe("token display", () => {
	it("masks all but the first four characters", () => {
		const masked = maskToken(TOKEN);
		expect(masked.startsWith("abcd")).toBe(true);
		expect(masked).not.toContain(TOKEN.slice(4));
		expect(masked.length).toBeGreaterThanOrEqual(12);
	});

	it("chunks a token into four groups of eight", () => {
		expect(manualChunks(TOKEN.replace(/-/g, ""))).toBe("abcd1234-efgh5678-ijkl9012-mnop3456");
	});
});

describe("bridgeStatus", () => {
	it("distinguishes stopped, starting and running", () => {
		expect(bridgeStatus(STOPPED_SNAPSHOT)).toBe("stopped");
		expect(bridgeStatus({ ...STOPPED_SNAPSHOT, running: true, starting: true })).toBe("starting");
		expect(bridgeStatus({ ...STOPPED_SNAPSHOT, running: true, starting: false })).toBe("starting");
		expect(
			bridgeStatus({
				...STOPPED_SNAPSHOT,
				running: true,
				starting: false,
				endpoint: "ws://1.2.3.4:8787",
			}),
		).toBe("running");
	});
});

describe("device helpers", () => {
	const now = Date.parse("2026-11-04T12:00:00Z");

	it("formats relative timestamps", () => {
		expect(relativeTime(null, now)).toBeNull();
		expect(relativeTime("not-a-date", now)).toBeNull();
		expect(relativeTime("2026-11-04T11:59:30Z", now)).toBe("just now");
		expect(relativeTime("2026-11-04T11:30:00Z", now)).toBe("30m ago");
		expect(relativeTime("2026-11-04T09:00:00Z", now)).toBe("3h ago");
		expect(relativeTime("2026-11-01T12:00:00Z", now)).toBe("3d ago");
	});

	it("normalises common platform names", () => {
		expect(platformLabel("ios")).toBe("iOS");
		expect(platformLabel("iPhone")).toBe("iOS");
		expect(platformLabel("Android")).toBe("Android");
		expect(platformLabel("macos")).toBe("macOS");
		expect(platformLabel("linux")).toBe("Linux");
		expect(platformLabel(null)).toBeNull();
		expect(platformLabel("watchOS")).toBe("watchOS");
	});
});
