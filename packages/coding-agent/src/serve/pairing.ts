/**
 * Pairing token management for `a-coder-cli serve`.
 *
 * The token is the bearer credential for every mobile client. It is generated
 * once (256-bit, base64url), persisted with owner-only permissions, and is
 * presented to users as a QR payload or 4x8 manual chunks.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";

export const TOKEN_BYTES = 32;

/** Directory holding serve state (token, paired-device registry). */
export function serveDir(): string {
	return join(getAgentDir(), "serve");
}

function tokenPath(): string {
	return join(serveDir(), "token");
}

/** Generate a fresh URL-safe pairing token. */
export function generateToken(): string {
	return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Load the persisted token, or null when none exists. */
export function loadToken(): string | null {
	try {
		const raw = fs.readFileSync(tokenPath(), "utf8").trim();
		return raw.length > 0 ? raw : null;
	} catch {
		return null;
	}
}

/** Persist the token with owner-only permissions. Returns the written token. */
export function saveToken(token: string): string {
	fs.mkdirSync(serveDir(), { recursive: true });
	fs.writeFileSync(tokenPath(), `${token}\n`, { mode: 0o600 });
	return token;
}

/**
 * Resolve the active token: explicit override wins, else the persisted one,
 * else a fresh generated + persisted one. `rotate` forces regeneration.
 */
export function resolveToken(options: { token?: string; rotate?: boolean }): string {
	if (options.token && options.token.length > 0) return options.token;
	if (options.rotate || !loadToken()) {
		return saveToken(generateToken());
	}
	return loadToken()!;
}

/** Stable per-token machine id (first 8 hex of SHA-256) so clients can dedupe instances without seeing the token. */
export function machineId(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 8);
}

/** Constant-time token comparison for the auth path. */
export function tokenMatches(presented: string, expected: string): boolean {
	const a = Buffer.from(presented, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** Token rendered as 4 groups of 8 chars for manual entry. */
export function manualChunks(token: string): string {
	const flat = token.replace(/[^a-zA-Z0-9]/g, "");
	if (flat.length < 32) {
		// base64url of 32 bytes is 43 chars; group the first 32 for readability.
		const padded = flat.padEnd(32, "0");
		return [0, 8, 16, 24].map((i) => padded.slice(i, i + 8)).join("-");
	}
	return [0, 8, 16, 24].map((i) => flat.slice(i, i + 8)).join("-");
}

/** Versioned QR pairing payload (mobile-app/plan/04 §5.2). */
export interface PairingPayload {
	v: number;
	kind: "acoder";
	host: string;
	port: number;
	tls: boolean;
	token: string;
	name: string;
	id: string;
}

export function pairingPayload(options: { host: string; port: number; token: string; name: string }): PairingPayload {
	return {
		v: 1,
		kind: "acoder",
		host: options.host,
		port: options.port,
		tls: false,
		token: options.token,
		name: options.name,
		id: machineId(options.token),
	};
}

/** Extract a bearer token from an Authorization header value. */
export function bearerFromHeader(header: string | undefined): string | null {
	if (!header) return null;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match ? match[1]!.trim() : null;
}

/** Extract the `token` query parameter from a request URL, when present. */
export function tokenFromUrl(url: string | undefined): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url, "http://localhost");
		const value = parsed.searchParams.get("token");
		return value && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}
