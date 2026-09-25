// A-Coder serve (mobile bridge) frontend bindings: invoke wrappers for the
// tauri serve commands and listeners for the streamed banner lines. The CLI
// prints the pairing banner (endpoint, token, QR, mDNS) to stderr; these
// helpers parse the pieces the settings UI needs.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function serveStart(cwd: string, port?: number): Promise<void> {
	await invoke("serve_start", { cwd, port: port ?? null });
}

export async function serveStop(): Promise<void> {
	await invoke("serve_stop");
}

export async function serveStatus(): Promise<boolean> {
	return await invoke<boolean>("serve_status");
}

/** Subscribe to `a-coder-cli serve` stderr lines (banner + `[serve]` logs). */
export async function onServeLine(handler: (line: string) => void): Promise<UnlistenFn> {
	return await listen<string>("desktop://serve-line", (payload) => {
		handler(payload.payload);
	});
}

/** Subscribe to serve process exit (exit code). */
export async function onServeExit(handler: (exitCode: number) => void): Promise<UnlistenFn> {
	return await listen<number>("desktop://serve-exit", (payload) => {
		handler(payload.payload);
	});
}

/** The pieces of the pairing banner the UI renders. */
export interface ServeBanner {
	endpoint: string | null;
	token: string | null;
	manual: string | null;
	name: string | null;
}

/** Extract endpoint/token/manual/name from banner lines as they stream in. */
export function parseServeBannerLine(banner: ServeBanner, line: string): ServeBanner {
	const next = { ...banner };
	const endpointMatch = /^a-coder-cli serve listening on (ws:\/\/\S+)$/.exec(line);
	if (endpointMatch) next.endpoint = endpointMatch[1];
	const tokenMatch = /^Pairing token: (\S+)$/.exec(line);
	if (tokenMatch) next.token = tokenMatch[1];
	const manualMatch = /^ {2}manual: (\S+)$/.exec(line);
	if (manualMatch) next.manual = manualMatch[1];
	const nameMatch = /^mDNS: \S+ announced as "(.+)"$/.exec(line);
	if (nameMatch) next.name = nameMatch[1];
	return next;
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
}

/** Build the QR payload from a parsed banner (id = 8 hex chars of sha256(token)). */
export async function buildPairingPayload(banner: ServeBanner): Promise<PairingPayload | null> {
	if (!banner.endpoint || !banner.token) return null;
	const match = /^ws:\/\/([^:/]+):(\d+)$/.exec(banner.endpoint);
	if (!match) return null;
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(banner.token));
	const id = Array.from(new Uint8Array(digest).slice(0, 4))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return {
		v: 1,
		kind: "acoder",
		host: match[1],
		port: Number.parseInt(match[2], 10),
		tls: false,
		token: banner.token,
		name: banner.name ?? "A-Coder",
		id,
	};
}