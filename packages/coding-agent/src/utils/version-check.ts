import { compare, valid } from "semver";
import { getPiUserAgent } from "./pi-user-agent.ts";

// This fork publishes releases via GitHub, so the latest-version check
// queries the repo's releases/latest API (tag_name) rather than the
// upstream a-coder-cli.dev endpoint. Override with A_CODER_LATEST_VERSION_URL.
const LATEST_VERSION_URL =
	process.env.A_CODER_LATEST_VERSION_URL ?? "https://api.github.com/repos/hamishfromatech/pi-mono/releases/latest";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestPiRelease {
	version: string;
	packageName?: string;
	note?: string;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestPiRelease(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<LatestPiRelease | undefined> {
	if (process.env.A_CODER_CLI_SKIP_VERSION_CHECK || process.env.A_CODER_CLI_OFFLINE) return undefined;

	const response = await fetch(LATEST_VERSION_URL, {
		headers: {
			"User-Agent": getPiUserAgent(currentVersion),
			accept: "application/vnd.github+json",
		},
		signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS),
	});
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		tag_name?: unknown;
		// Fall back fields for the legacy a-coder-cli.dev shape, in case
		// A_CODER_LATEST_VERSION_URL points at an endpoint that returns it.
		version?: unknown;
		packageName?: unknown;
		note?: unknown;
	};
	// GitHub releases/latest returns tag_name ("vX.Y.Z"); strip the leading v.
	const fromTag =
		typeof data.tag_name === "string" && data.tag_name.trim() ? data.tag_name.trim().replace(/^v/, "") : undefined;
	const fromField = typeof data.version === "string" && data.version.trim() ? data.version.trim() : undefined;
	const version = fromTag ?? fromField;
	if (!version) return undefined;
	const packageName =
		typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : undefined;
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version,
		packageName,
		...(note ? { note } : {}),
	};
}

export async function getLatestPiVersion(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
	return (await getLatestPiRelease(currentVersion, options))?.version;
}

export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPiRelease | undefined> {
	try {
		const latestRelease = await getLatestPiRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
