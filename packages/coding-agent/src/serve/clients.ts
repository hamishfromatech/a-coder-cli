/**
 * Paired-device registry for `a-coder-cli serve`.
 *
 * The bridge writes one record per paired mobile client to
 * `~/.a-coder/cli/agent/serve/clients.json` so the desktop Settings → Mobile
 * access card can list devices and remove one. The file shape is
 * `{ version, devices: [{ id, name, platform, lastSeen, addedAt }], revoked }`;
 * the desktop reader (`desktop-app/src-tauri/src/serve.rs`) also tolerates a
 * bare top-level array, and ignores keys it does not know — which is where the
 * `revoked` tombstones live.
 *
 * Device identity (mobile-app/plan/04-bridge-spec.md §5.4): a client presents
 * its stable id on the upgrade as the `x-acoder-device-id` header (plus
 * optional `x-acoder-device-name` / `x-acoder-device-platform`), or, on clients
 * that cannot set headers, as the `device_id` / `device_name` /
 * `device_platform` query parameters of the `/rpc` URL, or as a first
 * `{"type":"hello","device":{...}}` frame once the socket is open.
 *
 * Revocation: removing the record is the revoke path. The bridge compares the
 * registry it last observed with the file on disk before admitting a device, so
 * a record deleted through the desktop card (or by hand) becomes a durable
 * tombstone and the removed device's next upgrade is rejected with 401. A
 * tombstone survives bridge restarts because it is persisted in this file;
 * token rotation (`serve --rotate`) remains the revoke-all path for a client
 * that never presents an identity.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { basename, dirname, join } from "node:path";
import { serveDir } from "./pairing.ts";

export const REGISTRY_FILE = "clients.json";
export const REGISTRY_VERSION = 1;
/** Newest devices kept; older records are dropped so a buggy client cannot grow the file without bound. */
export const MAX_DEVICES = 32;

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 64;
const MAX_PLATFORM_LENGTH = 32;
/** Device ids are opaque to the bridge; they never reach a path, only JSON. */
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** One device as the desktop card renders it (`ServeDevice` in Rust). */
export interface DeviceRecord {
	id: string;
	name: string;
	platform: string | null;
	lastSeen: string | null;
	addedAt: string | null;
}

/** Durable tombstone: this id was removed and must not connect again. */
export interface RevokedDevice {
	id: string;
	revokedAt: string;
}

export interface DeviceRegistry {
	version: number;
	devices: DeviceRecord[];
	revoked: RevokedDevice[];
}

/** Identity a client presents on the upgrade or in its `hello` frame. */
export interface DeviceIdentity {
	id: string;
	name?: string;
	platform?: string;
}

/** Absolute path of the registry file (`serve/clients.json`). */
export function clientsPath(): string {
	return join(serveDir(), REGISTRY_FILE);
}

function cleanText(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	return trimmed.slice(0, max);
}

/** Accept a client-supplied id only when it is a bounded, printable token. */
export function normalizeDeviceId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) return null;
	return ID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeRecord(value: unknown): DeviceRecord | null {
	if (typeof value !== "object" || value === null) return null;
	const entry = value as Record<string, unknown>;
	const id = normalizeDeviceId(entry.id ?? entry.deviceId ?? entry.device_id);
	if (!id) return null;
	return {
		id,
		name: cleanText(entry.name ?? entry.deviceName ?? entry.device_name, MAX_NAME_LENGTH) ?? "Device",
		platform: cleanText(entry.platform, MAX_PLATFORM_LENGTH) ?? null,
		lastSeen: cleanText(entry.lastSeen ?? entry.last_seen, 40) ?? null,
		addedAt: cleanText(entry.addedAt ?? entry.added_at, 40) ?? null,
	};
}

function normalizeRevoked(value: unknown): RevokedDevice | null {
	if (typeof value !== "object" || value === null) return null;
	const entry = value as Record<string, unknown>;
	const id = normalizeDeviceId(entry.id);
	if (!id) return null;
	return { id, revokedAt: cleanText(entry.revokedAt, 40) ?? "" };
}

/**
 * Read the registry, tolerating the shapes already on disk: a missing file, a
 * bare top-level array (older readers), and records with foreign key names.
 * A corrupt file reads as empty rather than throwing; the next write repairs it.
 */
export function readRegistry(path: string = clientsPath()): DeviceRegistry {
	return readRegistryFile(path) ?? { version: REGISTRY_VERSION, devices: [], revoked: [] };
}

/**
 * Read a registry that exists and parses, or null. The null case matters to the
 * bridge: a missing or unreadable file must never be mistaken for "every
 * device was removed", which would silently revoke the whole fleet.
 */
function readRegistryFile(path: string): DeviceRegistry | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(path, "utf8"));
	} catch {
		return null;
	}
	const devices: DeviceRecord[] = [];
	const seen = new Set<string>();
	for (const entry of registryEntries(parsed)) {
		const record = normalizeRecord(entry);
		if (!record || seen.has(record.id)) continue;
		seen.add(record.id);
		devices.push(record);
	}
	const revoked: RevokedDevice[] = [];
	const revokedIds = new Set<string>();
	for (const entry of revokedEntries(parsed)) {
		const record = normalizeRevoked(entry);
		if (!record || revokedIds.has(record.id)) continue;
		revokedIds.add(record.id);
		revoked.push(record);
	}
	return { version: REGISTRY_VERSION, devices, revoked };
}

function registryEntries(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value !== "object" || value === null) return [];
	const devices = (value as Record<string, unknown>).devices;
	return Array.isArray(devices) ? devices : [];
}

function revokedEntries(value: unknown): unknown[] {
	if (typeof value !== "object" || value === null) return [];
	const revoked = (value as Record<string, unknown>).revoked;
	return Array.isArray(revoked) ? revoked : [];
}

/**
 * Persist the registry atomically: write a sibling temp file with owner-only
 * permissions, then rename over the target so a reader never sees a partial
 * JSON document and a crash cannot truncate the existing one.
 */
export function writeRegistry(registry: DeviceRegistry, path: string = clientsPath()): void {
	const directory = dirname(path);
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
	const body = `${JSON.stringify(
		{ version: REGISTRY_VERSION, devices: registry.devices, revoked: registry.revoked },
		null,
		2,
	)}\n`;
	fs.writeFileSync(temporary, body, { mode: 0o600 });
	try {
		fs.renameSync(temporary, path);
	} catch (error) {
		try {
			fs.rmSync(temporary, { force: true });
		} catch {
			// best effort: the temp file is already useless
		}
		throw error;
	}
	// rename keeps the temp file's mode, but a pre-existing target on some
	// filesystems wins its own permissions; re-assert owner-only access.
	try {
		fs.chmodSync(path, 0o600);
	} catch {
		// best effort on filesystems without POSIX modes
	}
}

/** Identity from the upgrade headers (`x-acoder-device-id` + optional name/platform). */
export function deviceFromHeaders(headers: Record<string, string | string[] | undefined>): DeviceIdentity | null {
	const id = normalizeDeviceId(headerValue(headers["x-acoder-device-id"]));
	if (!id) return null;
	return deviceIdentity(id, {
		name: headerValue(headers["x-acoder-device-name"]),
		platform: headerValue(headers["x-acoder-device-platform"]),
	});
}

/** Identity from `/rpc?device_id=…&device_name=…&device_platform=…`. */
export function deviceFromUrl(url: string | undefined): DeviceIdentity | null {
	if (!url) return null;
	let parsed: URL;
	try {
		parsed = new URL(url, "http://localhost");
	} catch {
		return null;
	}
	const id = normalizeDeviceId(parsed.searchParams.get("device_id"));
	if (!id) return null;
	return deviceIdentity(id, {
		name: parsed.searchParams.get("device_name"),
		platform: parsed.searchParams.get("device_platform"),
	});
}

/** Identity from a first `hello` frame — the only path for clients that cannot set headers. */
export function deviceFromFrame(raw: string): DeviceIdentity | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const frame = parsed as Record<string, unknown>;
	if (frame.type !== "hello") return null;
	const source =
		typeof frame.device === "object" && frame.device !== null ? (frame.device as Record<string, unknown>) : frame;
	const id = normalizeDeviceId(source.id ?? source.deviceId ?? source.device_id);
	if (!id) return null;
	return deviceIdentity(id, {
		name: source.name ?? source.deviceName ?? source.device_name,
		platform: source.platform,
	});
}

function headerValue(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) return value[0];
	return value;
}

function deviceIdentity(id: string, extra: { name?: unknown; platform?: unknown }): DeviceIdentity {
	const name = cleanText(extra.name, MAX_NAME_LENGTH);
	const platform = cleanText(extra.platform, MAX_PLATFORM_LENGTH);
	return { id, ...(name ? { name } : {}), ...(platform ? { platform } : {}) };
}

export interface DeviceRegistryOptions {
	/** Registry file path; defaults to `serve/clients.json` under the agent dir. */
	path?: string;
	/** Clock override for deterministic tests. */
	now?: () => Date;
}

/**
 * In-process view of `clients.json`.
 *
 * `admit()` is the gate: it re-reads the file, turns any record that vanished
 * since the last observation into a tombstone, and answers whether the device
 * may connect. `record()` upserts the device (last seen now, added at on first
 * sight) and persists. Both are cheap enough to run per upgrade.
 */
export class DeviceRegistryStore {
	private readonly filePath: string;
	private readonly now: () => Date;
	private observed: DeviceRegistry;
	/** Ids this process has seen in the file; a delta from it means a removal. */
	private readonly known = new Set<string>();
	private readonly tombstoned = new Set<string>();

	constructor(options: DeviceRegistryOptions = {}) {
		this.filePath = options.path ?? clientsPath();
		this.now = options.now ?? (() => new Date());
		this.observed = readRegistry(this.filePath);
		this.seed(this.observed);
	}

	get path(): string {
		return this.filePath;
	}

	/** Current view (never mutates the file). */
	snapshot(): DeviceRegistry {
		return { version: REGISTRY_VERSION, devices: [...this.observed.devices], revoked: [...this.observed.revoked] };
	}

	/**
	 * Re-read the file and convert removals into durable tombstones. A device the
	 * desktop card deleted while this bridge was running is rejected from here on.
	 */
	refresh(): DeviceRegistry {
		const fresh = readRegistryFile(this.filePath);
		// Missing or corrupt: keep the last good view rather than revoking everything.
		if (!fresh) return this.snapshot();
		const present = new Set(fresh.devices.map((device) => device.id));
		const revoked = new Map(fresh.revoked.map((entry) => [entry.id, entry]));
		let changed = false;

		for (const id of this.known) {
			if (present.has(id) || revoked.has(id)) continue;
			const tombstone: RevokedDevice = { id, revokedAt: this.now().toISOString() };
			revoked.set(id, tombstone);
			this.tombstoned.add(id);
			changed = true;
		}
		// A tombstone always wins over a leftover record.
		const devices = fresh.devices.filter((device) => !revoked.has(device.id));
		if (devices.length !== fresh.devices.length) changed = true;

		this.observed = { version: REGISTRY_VERSION, devices, revoked: [...revoked.values()] };
		this.seed(this.observed);
		if (changed) {
			// Persist the tombstone now: revocation must outlive this process.
			writeRegistry(this.observed, this.filePath);
		}
		return this.snapshot();
	}

	/** True when the device may connect. Re-reads the file before deciding. */
	admit(identity: DeviceIdentity): boolean {
		this.refresh();
		return !this.tombstoned.has(identity.id);
	}

	/** Upsert the device record: adds on first sight, refreshes name/platform/lastSeen after. */
	record(identity: DeviceIdentity): DeviceRecord {
		const nowIso = this.now().toISOString();
		const devices = [...this.observed.devices];
		const index = devices.findIndex((device) => device.id === identity.id);
		const existing = index >= 0 ? devices[index] : undefined;
		const record: DeviceRecord = existing
			? {
					...existing,
					name: identity.name ?? existing.name,
					platform: identity.platform ?? existing.platform,
					lastSeen: nowIso,
				}
			: {
					id: identity.id,
					name: identity.name ?? "Device",
					platform: identity.platform ?? null,
					lastSeen: nowIso,
					addedAt: nowIso,
				};
		if (index >= 0) devices[index] = record;
		else devices.push(record);

		const capped = this.cap(devices);
		// A record evicted by the size cap was not revoked: forget it, so a later
		// refresh does not turn the eviction into a permanent tombstone.
		const kept = new Set(capped.map((device) => device.id));
		for (const device of devices) {
			if (!kept.has(device.id)) this.known.delete(device.id);
		}

		this.observed = {
			version: REGISTRY_VERSION,
			devices: capped,
			revoked: this.observed.revoked,
		};
		this.seed(this.observed);
		writeRegistry(this.observed, this.filePath);
		return record;
	}

	/**
	 * Explicitly revoke a device (tombstone + drop its record). The desktop card
	 * writes the file directly; this is the same effect from inside the bridge.
	 */
	revoke(id: string): boolean {
		const deviceId = normalizeDeviceId(id);
		if (!deviceId) return false;
		this.refresh();
		const alreadyGone =
			this.tombstoned.has(deviceId) && !this.observed.devices.some((device) => device.id === deviceId);
		if (alreadyGone) return false;
		this.tombstoned.add(deviceId);
		this.observed = {
			version: REGISTRY_VERSION,
			devices: this.observed.devices.filter((device) => device.id !== deviceId),
			revoked: [
				...this.observed.revoked.filter((entry) => entry.id !== deviceId),
				{
					id: deviceId,
					revokedAt: this.now().toISOString(),
				},
			],
		};
		this.known.delete(deviceId);
		writeRegistry(this.observed, this.filePath);
		return true;
	}

	private seed(registry: DeviceRegistry): void {
		for (const device of registry.devices) this.known.add(device.id);
		for (const entry of registry.revoked) this.tombstoned.add(entry.id);
	}

	/** Keep the newest MAX_DEVICES records, preferring the ones seen most recently. */
	private cap(devices: DeviceRecord[]): DeviceRecord[] {
		if (devices.length <= MAX_DEVICES) return devices;
		const sorted = [...devices].sort((left, right) => {
			const leftAt = left.lastSeen ?? left.addedAt ?? "";
			const rightAt = right.lastSeen ?? right.addedAt ?? "";
			return rightAt.localeCompare(leftAt);
		});
		return sorted.slice(0, MAX_DEVICES);
	}
}
