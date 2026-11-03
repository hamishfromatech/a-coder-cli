// A-Coder serve (mobile bridge) frontend bindings: invoke wrappers for the
// tauri serve commands, listeners for the streamed banner, and the pure helpers
// the Settings → Mobile access card uses to render status, QR and devices.
//
// The CLI prints the pairing banner (endpoint, token, manual code, mDNS name)
// to stderr. Rust parses it into `ServeSnapshot` and emits
// `desktop://serve-info`, so the card can remount without losing the QR; the
// raw lines still stream as `desktop://serve-line` for the log strip.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Current bridge state + parsed pairing banner (mirrors the Rust snapshot). */
export interface ServeSnapshot {
	running: boolean;
	starting: boolean;
	endpoint: string | null;
	port: number | null;
	tls: boolean;
	pin: string | null;
	token: string | null;
	manual: string | null;
	name: string | null;
}

/** One device recorded by the bridge in `serve/clients.json`. */
export interface ServeDevice {
	id: string;
	name: string;
	platform: string | null;
	lastSeen: string | null;
	addedAt: string | null;
}

/** Registry read result: `available` is false until the bridge creates it. */
export interface ServeRegistry {
	available: boolean;
	path: string;
	devices: ServeDevice[];
	error: string | null;
}

export const STOPPED_SNAPSHOT: ServeSnapshot = {
	running: false,
	starting: false,
	endpoint: null,
	port: null,
	tls: false,
	pin: null,
	token: null,
	manual: null,
	name: null,
};

/**
 * Start the bridge for a workspace. Pass `rotate` to regenerate the persisted
 * pairing token — every previously paired client is rejected with 401 on its
 * next connection.
 */
export async function serveStart(
	cwd: string,
	port?: number,
	rotate = false,
): Promise<void> {
	await invoke("serve_start", { cwd, port: port ?? null, rotate });
}

export async function serveStop(): Promise<void> {
	await invoke("serve_stop");
}

/** Whether a serve child is currently alive (kept for older callers). */
export async function serveStatus(): Promise<boolean> {
	return await invoke<boolean>("serve_status");
}

/** Full bridge state (running, port, TLS/pin, token, QR pieces). */
export async function serveInfo(): Promise<ServeSnapshot> {
	return await invoke<ServeSnapshot>("serve_info");
}

/** Connected/paired devices recorded by the bridge registry. */
export async function serveDevices(): Promise<ServeRegistry> {
	return await invoke<ServeRegistry>("serve_devices");
}

/** Remove one device record from `serve/clients.json`. */
export async function serveRemoveDevice(deviceId: string): Promise<ServeRegistry> {
	return await invoke<ServeRegistry>("serve_remove_device", { deviceId });
}

/** Subscribe to `a-coder-cli serve` stderr lines (banner + `[serve]` logs). */
export async function onServeLine(handler: (line: string) => void): Promise<UnlistenFn> {
	return await listen<string>("desktop://serve-line", (payload) => {
		handler(payload.payload);
	});
}

/** Subscribe to parsed bridge-state updates (after each banner line). */
export async function onServeInfo(handler: (snapshot: ServeSnapshot) => void): Promise<UnlistenFn> {
	return await listen<ServeSnapshot>("desktop://serve-info", (payload) => {
		handler(payload.payload);
	});
}

/** Subscribe to serve process exit (exit code). */
export async function onServeExit(handler: (exitCode: number) => void): Promise<UnlistenFn> {
	return await listen<number>("desktop://serve-exit", (payload) => {
		handler(payload.payload);
	});
}

/** The pieces of the pairing banner the UI renders (line-parser shape). */
export interface ServeBanner {
	endpoint: string | null;
	token: string | null;
	manual: string | null;
	name: string | null;
	tls: boolean;
	pin: string | null;
}

/** Fold one streamed banner line into a banner snapshot. */
export function parseServeBannerLine(banner: ServeBanner, line: string): ServeBanner {
	const clean = line.startsWith("[serve] ") ? line.slice("[serve] ".length) : line;
	const next = { ...banner };
	const endpointMatch = /^a-coder-cli serve listening on (wss?:\/\/\S+)$/.exec(clean);
	if (endpointMatch) {
		next.endpoint = endpointMatch[1] ?? null;
		next.tls = (next.endpoint ?? "").startsWith("wss://");
	}
	const pinMatch = /^TLS certificate pin \(SHA-256\): (\S+)$/.exec(clean);
	if (pinMatch) {
		next.pin = pinMatch[1] ?? null;
		next.tls = true;
	}
	const tokenMatch = /^Pairing token: (\S+)$/.exec(clean);
	if (tokenMatch) next.token = tokenMatch[1] ?? null;
	const manualMatch = /^ {2}manual: (\S+)$/.exec(clean);
	if (manualMatch) next.manual = manualMatch[1] ?? null;
	const nameMatch = /^mDNS: \S+ announced as "(.+)"$/.exec(clean);
	if (nameMatch) next.name = nameMatch[1] ?? null;
	return next;
}

/** Parse a `ws(s)://host:port` endpoint. */
export function parseEndpoint(
	endpoint: string | null,
): { host: string; port: number; tls: boolean } | null {
	if (!endpoint) return null;
	const match = /^(wss?):\/\/([^:/]+):(\d+)$/.exec(endpoint);
	if (!match) return null;
	const port = Number.parseInt(match[3]!, 10);
	if (!Number.isFinite(port)) return null;
	return { host: match[2]!, port, tls: match[1] === "wss" };
}

/** Pairing QR payload per mobile-app/plan/04 §5. */
export interface PairingPayload {
	v: number;
	kind: string;
	host: string;
	port: number;
	tls: boolean;
	token: string;
	name: string;
	id: string;
	pin?: string;
}

/**
 * Build the QR payload from the live snapshot (or a parsed banner). `id` is
 * the first 8 hex chars of sha256(token), matching `machineId()` in the CLI.
 */
export async function buildPairingPayload(
	banner: Pick<ServeBanner, "endpoint" | "token" | "name" | "pin"> & { tls?: boolean },
): Promise<PairingPayload | null> {
	if (!banner.endpoint || !banner.token) return null;
	const parsed = parseEndpoint(banner.endpoint);
	if (!parsed) return null;
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(banner.token));
	const id = Array.from(new Uint8Array(digest).slice(0, 4))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const tls = banner.tls ?? parsed.tls;
	const pin = banner.pin ?? undefined;
	return {
		v: 1,
		kind: "acoder",
		host: parsed.host,
		port: parsed.port,
		tls,
		token: banner.token,
		name: banner.name ?? "A-Coder",
		id,
		...(tls && pin ? { pin } : {}),
	};
}

/** Mask a pairing token for display; Copy always uses the real token. */
export function maskToken(token: string): string {
	if (token.length <= 4) return "•".repeat(token.length);
	return `${token.slice(0, 4)}${"•".repeat(Math.max(8, token.length - 4))}`;
}

/** Token rendered as 4 groups of 8 chars, matching the CLI's manual fallback. */
export function manualChunks(token: string): string {
	const flat = token.replace(/[^a-zA-Z0-9]/g, "");
	const padded = flat.length < 32 ? flat.padEnd(32, "0") : flat;
	return [0, 8, 16, 24].map((i) => padded.slice(i, i + 8)).join("-");
}

/** Human status for the card: stopped / starting / running. */
export function bridgeStatus(snapshot: ServeSnapshot): "stopped" | "starting" | "running" {
	if (!snapshot.running) return "stopped";
	if (snapshot.starting || !snapshot.endpoint) return "starting";
	return "running";
}

/** Short relative label for a device timestamp; null when absent/unparsable. */
export function relativeTime(iso: string | null, now = Date.now()): string | null {
	if (!iso) return null;
	const time = new Date(iso).getTime();
	if (!Number.isFinite(time)) return null;
	const delta = Math.max(0, now - time);
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	if (delta < 30 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
	return new Date(time).toLocaleDateString();
}

/** Platform label for a registry entry. */
export function platformLabel(platform: string | null): string | null {
	if (!platform) return null;
	const normalized = platform.trim().toLowerCase();
	if (normalized === "ios" || normalized === "iphone" || normalized === "ipad") return "iOS";
	if (normalized === "android") return "Android";
	if (normalized === "macos" || normalized === "mac") return "macOS";
	if (normalized === "windows") return "Windows";
	if (normalized === "linux") return "Linux";
	return platform;
}
