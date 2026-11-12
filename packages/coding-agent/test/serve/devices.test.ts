import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
	clientsPath,
	DeviceRegistryStore,
	deviceFromFrame,
	deviceFromHeaders,
	deviceFromUrl,
	MAX_DEVICES,
	readRegistry,
	writeRegistry,
} from "../../src/serve/clients.ts";
import { BridgeWsServer, type WsServerOptions } from "../../src/serve/ws-server.ts";

const TOKEN = "device-registry-token";
const SAVED_ENV = process.env.A_CODER_CLI_CODING_AGENT_DIR;
let tempRoot = "";

beforeAll(() => {
	tempRoot = fs.mkdtempSync(join(os.tmpdir(), "acoder-devices-test-"));
	// clientsPath() resolves under the agent dir; point it at the temp root so a
	// careless test can never touch the real registry.
	process.env.A_CODER_CLI_CODING_AGENT_DIR = tempRoot;
});

afterAll(() => {
	if (SAVED_ENV !== undefined) {
		process.env.A_CODER_CLI_CODING_AGENT_DIR = SAVED_ENV;
	} else {
		delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
	}
	fs.rmSync(tempRoot, { recursive: true, force: true });
});

function freshPath(): string {
	const dir = fs.mkdtempSync(join(tempRoot, "run-"));
	return join(dir, "serve", "clients.json");
}

/** A clock the test drives, so lastSeen/addedAt assertions are exact. */
function steppableClock(start = "2026-11-13T00:00:00.000Z"): { now: () => Date; advance: (ms: number) => void } {
	let current = Date.parse(start);
	return {
		now: () => new Date(current),
		advance: (ms: number) => {
			current += ms;
		},
	};
}

describe("device registry file", () => {
	it("resolves under the serve directory", () => {
		expect(clientsPath()).toBe(join(tempRoot, "serve", "clients.json"));
	});

	it("reads a missing file as empty instead of throwing", () => {
		expect(readRegistry(freshPath())).toEqual({ version: 1, devices: [], revoked: [] });
	});

	it("writes the desktop's {version, devices} shape with owner-only permissions", () => {
		const path = freshPath();
		writeRegistry(
			{
				version: 1,
				devices: [{ id: "phone-1", name: "Pixel", platform: "android", lastSeen: null, addedAt: null }],
				revoked: [],
			},
			path,
		);
		const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as { version: number; devices: unknown[] };
		expect(parsed.version).toBe(1);
		expect(parsed.devices).toHaveLength(1);
		expect(fs.statSync(path).mode & 0o777).toBe(0o600);
	});

	it("tolerates a bare top-level array and foreign key names", () => {
		const path = freshPath();
		fs.mkdirSync(join(path, ".."), { recursive: true });
		fs.writeFileSync(
			path,
			JSON.stringify([
				{ deviceId: "phone-2", deviceName: "iPhone", platform: "ios", added_at: "2026-11-01T00:00:00.000Z" },
			]),
		);
		const registry = readRegistry(path);
		expect(registry.devices).toEqual([
			{
				id: "phone-2",
				name: "iPhone",
				platform: "ios",
				lastSeen: null,
				addedAt: "2026-11-01T00:00:00.000Z",
			},
		]);
	});

	it("adds a record on first sight and refreshes lastSeen without losing addedAt", () => {
		const clock = steppableClock();
		const store = new DeviceRegistryStore({ path: freshPath(), now: clock.now });

		const first = store.record({ id: "phone-1", name: "Pixel 9", platform: "android" });
		expect(first).toEqual({
			id: "phone-1",
			name: "Pixel 9",
			platform: "android",
			lastSeen: "2026-11-13T00:00:00.000Z",
			addedAt: "2026-11-13T00:00:00.000Z",
		});

		clock.advance(60_000);
		const second = store.record({ id: "phone-1" });
		expect(second.lastSeen).toBe("2026-11-13T00:01:00.000Z");
		expect(second.addedAt).toBe("2026-11-13T00:00:00.000Z");
		// A reconnect without a name keeps the one already recorded.
		expect(second.name).toBe("Pixel 9");
		expect(readRegistry(store.path).devices).toHaveLength(1);
	});

	it("does not treat a size-cap eviction as a revocation", () => {
		const clock = steppableClock();
		const store = new DeviceRegistryStore({ path: freshPath(), now: clock.now });
		for (let index = 0; index <= MAX_DEVICES; index++) {
			store.record({ id: `phone-${index}` });
			clock.advance(1_000);
		}
		// phone-0 fell off the list; that is an eviction, not a removal, so it can
		// pair again instead of being refused forever.
		expect(store.admit({ id: "phone-0" })).toBe(true);
		store.record({ id: "phone-0" });
		expect(readRegistry(store.path).devices.some((device) => device.id === "phone-0")).toBe(true);
	});

	it("caps the registry at MAX_DEVICES, keeping the most recently seen", () => {
		const clock = steppableClock();
		const store = new DeviceRegistryStore({ path: freshPath(), now: clock.now });
		for (let index = 0; index < MAX_DEVICES + 8; index++) {
			store.record({ id: `phone-${index}` });
			clock.advance(1_000);
		}
		const devices = readRegistry(store.path).devices;
		expect(devices).toHaveLength(MAX_DEVICES);
		expect(devices.some((device) => device.id === "phone-0")).toBe(false);
		expect(devices.some((device) => device.id === `phone-${MAX_DEVICES + 7}`)).toBe(true);
	});

	it("turns a record deleted from the file into a durable tombstone", () => {
		const path = freshPath();
		const store = new DeviceRegistryStore({ path });
		store.record({ id: "phone-1", name: "Pixel 9" });
		store.record({ id: "phone-2", name: "iPad" });
		expect(store.admit({ id: "phone-1" })).toBe(true);

		// The desktop card's Remove deletes the record and rewrites the file.
		const onDisk = readRegistry(path);
		writeRegistry({ ...onDisk, devices: onDisk.devices.filter((device) => device.id !== "phone-1") }, path);

		expect(store.admit({ id: "phone-1" })).toBe(false);
		expect(readRegistry(path).revoked.map((entry) => entry.id)).toContain("phone-1");

		// A restarted bridge reads the tombstone back and keeps refusing.
		const restarted = new DeviceRegistryStore({ path });
		expect(restarted.admit({ id: "phone-1" })).toBe(false);
		// Devices that were not removed keep working.
		expect(restarted.admit({ id: "phone-2" })).toBe(true);
	});

	it("never revokes everything when the file is missing or corrupt", () => {
		const path = freshPath();
		const store = new DeviceRegistryStore({ path });
		store.record({ id: "phone-1" });
		fs.rmSync(path);
		expect(store.admit({ id: "phone-1" })).toBe(true);
		fs.mkdirSync(join(path, ".."), { recursive: true });
		fs.writeFileSync(path, "{ not json");
		expect(store.admit({ id: "phone-1" })).toBe(true);
	});

	it("revoke() drops the record and refuses the device", () => {
		const store = new DeviceRegistryStore({ path: freshPath() });
		store.record({ id: "phone-1" });
		expect(store.revoke("phone-1")).toBe(true);
		expect(store.revoke("phone-1")).toBe(false);
		expect(store.admit({ id: "phone-1" })).toBe(false);
		expect(readRegistry(store.path).devices).toHaveLength(0);
	});
});

describe("device identity parsing", () => {
	it("reads the upgrade headers", () => {
		expect(
			deviceFromHeaders({
				"x-acoder-device-id": "phone-abc",
				"x-acoder-device-name": "Pixel 9",
				"x-acoder-device-platform": "android",
			}),
		).toEqual({ id: "phone-abc", name: "Pixel 9", platform: "android" });
	});

	it("reads the /rpc query parameters", () => {
		expect(deviceFromUrl("/rpc?token=t&device_id=phone-abc&device_name=Pixel&device_platform=android")).toEqual({
			id: "phone-abc",
			name: "Pixel",
			platform: "android",
		});
	});

	it("reads a hello frame", () => {
		expect(deviceFromFrame('{"type":"hello","device":{"id":"phone-abc","name":"Pixel","platform":"ios"}}')).toEqual({
			id: "phone-abc",
			name: "Pixel",
			platform: "ios",
		});
	});

	it("ignores anything that is not a well-formed hello", () => {
		expect(deviceFromFrame("not json")).toBeNull();
		expect(deviceFromFrame('{"type":"command","id":"c1"}')).toBeNull();
		expect(deviceFromFrame('{"type":"hello","device":{"id":"../etc/passwd"}}')).toBeNull();
		expect(deviceFromFrame(`{"type":"hello","device":{"id":"${"x".repeat(200)}"}}`)).toBeNull();
		expect(deviceFromHeaders({ "x-acoder-device-id": "has space" })).toBeNull();
		expect(deviceFromUrl("/rpc?device_id=")).toBeNull();
	});
});

describe("bridge device registry", () => {
	let server: BridgeWsServer;
	let port: number;
	let store: DeviceRegistryStore;
	let registryFile: string;
	let forwarded: string[];
	let registered: string[];
	let revoked: string[];

	function makeOptions(overrides: Partial<WsServerOptions> = {}): WsServerOptions {
		return {
			port: 0,
			host: "127.0.0.1",
			token: TOKEN,
			maxClients: 2,
			requireAuth: true,
			version: "0.80.199",
			machineId: "deadbeef",
			friendlyName: "test bridge",
			onClientMessage: (data) => {
				forwarded.push(data);
			},
			onClientConnected: () => {},
			onClientDisconnected: () => {},
			deviceRegistry: store,
			onDeviceRegistered: (device) => {
				registered.push(device.id);
			},
			onDeviceRevoked: (device) => {
				revoked.push(device.id);
			},
			...overrides,
		};
	}

	beforeEach(async () => {
		registryFile = freshPath();
		store = new DeviceRegistryStore({ path: registryFile });
		forwarded = [];
		registered = [];
		revoked = [];
		server = new BridgeWsServer(makeOptions());
		await server.start();
		port = server.address!.port;
	});

	afterEach(async () => {
		await server.stop();
	});

	/**
	 * Connect and start buffering frames immediately: the bridge sends
	 * `server_version` (and `device_registered`) in the same tick as the upgrade,
	 * so a listener attached after `open` would miss them.
	 */
	async function connectWithFrames(
		path: string,
		headers: Record<string, string> = {},
	): Promise<{
		ws: WebSocket;
		next: (predicate: (frame: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
	}> {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
		const buffered: Record<string, unknown>[] = [];
		const waiters: Array<{
			predicate: (frame: Record<string, unknown>) => boolean;
			resolve: (frame: Record<string, unknown>) => void;
		}> = [];
		ws.on("message", (data: unknown) => {
			const frame = JSON.parse(String(data)) as Record<string, unknown>;
			const index = waiters.findIndex((waiter) => waiter.predicate(frame));
			if (index >= 0) {
				waiters.splice(index, 1)[0]!.resolve(frame);
				return;
			}
			buffered.push(frame);
		});
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("unexpected-response", (_req: unknown, res: IncomingMessage & { statusCode?: number }) => {
				const status = res.statusCode ?? 0;
				res.resume();
				reject(new Error(`handshake rejected: ${status}`));
			});
			ws.on("error", reject);
		});
		return {
			ws,
			next: (predicate) => {
				const index = buffered.findIndex(predicate);
				if (index >= 0) return Promise.resolve(buffered.splice(index, 1)[0]!);
				return new Promise((resolve, reject) => {
					const timer = setTimeout(() => {
						const at = waiters.findIndex((waiter) => waiter.resolve === resolve);
						if (at >= 0) waiters.splice(at, 1);
						reject(new Error("timed out waiting for frame"));
					}, 2_000);
					waiters.push({
						predicate,
						resolve: (frame) => {
							clearTimeout(timer);
							resolve(frame);
						},
					});
				});
			},
		};
	}

	/** Handshake failures are asserted by status, not by message text. */
	function connectRejecting(path: string, headers: Record<string, string> = {}): Promise<Error> {
		return connectWithFrames(path, headers).then(
			({ ws }) => {
				ws.close();
				throw new Error("handshake unexpectedly accepted");
			},
			(error: Error) => error,
		);
	}

	it("records a device presented on the upgrade and answers device_registered", async () => {
		const { ws, next } = await connectWithFrames(`/rpc?token=${TOKEN}`, {
			"x-acoder-device-id": "phone-abc",
			"x-acoder-device-name": "Pixel 9",
			"x-acoder-device-platform": "android",
		});
		const frame = await next((parsed) => parsed.event === "device_registered");
		expect(frame).toMatchObject({ type: "bridge", id: "phone-abc", name: "Pixel 9" });
		ws.close();

		const registry = readRegistry(registryFile);
		expect(registry.devices).toHaveLength(1);
		expect(registry.devices[0]).toMatchObject({ id: "phone-abc", name: "Pixel 9", platform: "android" });
		expect(registry.devices[0]!.lastSeen).not.toBeNull();
		expect(registered).toEqual(["phone-abc"]);
	});

	it("leaves the registry untouched for a client that presents no identity", async () => {
		const { ws, next } = await connectWithFrames(`/rpc?token=${TOKEN}`);
		await next((parsed) => parsed.event === "server_version");
		ws.close();
		expect(fs.existsSync(registryFile)).toBe(false);
	});

	it("rejects with 401 once the device record is removed", async () => {
		const first = await connectWithFrames(`/rpc?token=${TOKEN}`, { "x-acoder-device-id": "phone-abc" });
		await first.next((parsed) => parsed.event === "device_registered");
		first.ws.close();

		// The desktop card removes the record while the bridge is running.
		const onDisk = readRegistry(registryFile);
		writeRegistry({ ...onDisk, devices: [] }, registryFile);

		const error = await connectRejecting(`/rpc?token=${TOKEN}`, { "x-acoder-device-id": "phone-abc" });
		expect(error.message).toBe("handshake rejected: 401");
		expect(revoked).toEqual(["phone-abc"]);
		// The tombstone is durable, so a restart keeps refusing the device.
		expect(new DeviceRegistryStore({ path: registryFile }).admit({ id: "phone-abc" })).toBe(false);
	});

	it("records a device that identifies itself with a hello frame", async () => {
		const { ws, next } = await connectWithFrames(`/rpc?token=${TOKEN}`);
		await next((parsed) => parsed.event === "server_version");
		ws.send(JSON.stringify({ type: "hello", device: { id: "phone-hello", name: "iPad", platform: "ios" } }));
		const frame = await next((parsed) => parsed.event === "device_registered");
		expect(frame).toMatchObject({ id: "phone-hello", name: "iPad" });
		ws.close();

		expect(forwarded).toEqual([]);
		expect(readRegistry(registryFile).devices[0]).toMatchObject({ id: "phone-hello", platform: "ios" });
	});

	it("refuses a revoked device that identifies with a hello frame", async () => {
		store.record({ id: "phone-hello" });
		store.revoke("phone-hello");

		const { ws, next } = await connectWithFrames(`/rpc?token=${TOKEN}`);
		await next((parsed) => parsed.event === "server_version");
		ws.send(JSON.stringify({ type: "hello", device: { id: "phone-hello" } }));

		const frame = await next((parsed) => parsed.event === "device_revoked");
		expect(frame).toMatchObject({ id: "phone-hello" });
		const closeCode = await new Promise<number>((resolve) => ws.on("close", (code: number) => resolve(code)));
		expect(closeCode).toBe(4401);
		expect(revoked).toEqual(["phone-hello"]);
	});

	it("forwards ordinary client frames and hello frames when no registry is configured", async () => {
		await server.stop();
		server = new BridgeWsServer(makeOptions({ deviceRegistry: undefined }));
		await server.start();
		port = server.address!.port;

		const { ws, next } = await connectWithFrames(`/rpc?token=${TOKEN}`);
		await next((parsed) => parsed.event === "server_version");
		ws.send('{"type":"hello","device":{"id":"phone-x"}}');
		ws.send('{"id":"c1","method":"ping"}');
		await new Promise((resolve) => setTimeout(resolve, 100));
		ws.close();
		expect(forwarded).toEqual(['{"type":"hello","device":{"id":"phone-x"}}', '{"id":"c1","method":"ping"}']);
	});
});
