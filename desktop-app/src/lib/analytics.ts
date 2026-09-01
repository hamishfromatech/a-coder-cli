import { getVersion } from "@tauri-apps/api/app";
import posthog from "posthog-js";
import { readSettingsFile } from "./rpc";

/**
 * Product analytics for the desktop app via PostHog, gated behind the CLI's
 * opt-in `enableAnalytics` setting (default off, shared settings.json with the
 * CLI). When opted in, the `trackingId` stored in settings.json is used as the
 * anonymous distinct ID. No file paths, prompt content, or personal
 * information is ever captured.
 *
 * The PostHog project API key is a write-only ingest token (safe to embed,
 * same trust model as any posthog-js browser integration). It is baked in
 * below and can be overridden at build time via `VITE_POSTHOG_KEY`.
 */
const POSTHOG_API_KEY = "phc_2JUflk80xdIy6wphTpa1TYtjJupiIpartdetzQo0l8p";
const POSTHOG_HOST = "https://us.i.posthog.com";

function getApiKey(): string {
	return import.meta.env.VITE_POSTHOG_KEY || POSTHOG_API_KEY;
}

let initialized = false;
let launchAt = 0;
let exitCaptured = false;

function platformName(): string {
	const ua = navigator.userAgent;
	if (ua.includes("Macintosh")) return "macos";
	if (ua.includes("Windows")) return "windows";
	if (ua.includes("Linux") || ua.includes("X11")) return "linux";
	return "unknown";
}

/**
 * Initialize analytics if the user opted in via settings.json. Safe to call
 * multiple times; resolves without initializing when opted out, when the
 * ingest key is unset, or when settings cannot be read (e.g. dev in a plain
 * browser). Fire-and-forget: never blocks app boot.
 */
export async function initDesktopAnalytics(): Promise<void> {
	if (initialized) return;
	try {
		const settings = await readSettingsFile({ scope: "global" });
		const enabled = settings.enableAnalytics === true;
		const trackingId = typeof settings.trackingId === "string" ? settings.trackingId : undefined;
		const apiKey = getApiKey();
		if (!enabled || !trackingId || !apiKey) return;

		posthog.init(apiKey, {
			api_host: POSTHOG_HOST,
			// No autocapture/pageview/session recording: explicit events only,
			// minimal data collection by design.
			autocapture: false,
			capture_pageview: false,
			disable_session_recording: true,
			persistence: "localStorage",
			person_profiles: "identified_only",
			advanced_disable_toolbar_metrics: true,
			request_batching: true,
		});
		posthog.identify(trackingId);
		initialized = true;
		launchAt = Date.now();
		void getVersion()
			.then((version) => {
				posthog.capture("desktop_app_launch", {
					version,
					platform: platformName(),
				});
			})
			.catch(() => undefined);

		// Best-effort exit event: pagehide flushes via sendBeacon/keepalive.
		window.addEventListener("pagehide", () => {
			if (exitCaptured || !initialized) return;
			exitCaptured = true;
			posthog.capture("desktop_app_exit", { duration_ms: Date.now() - launchAt });
		});
	} catch {
		// Settings unavailable (non-Tauri dev, backend not ready) — stay off.
	}
}

/** Capture a desktop UI event. No-op until init succeeded. */
export function captureDesktopEvent(event: string, properties?: Record<string, unknown>): void {
	if (!initialized) return;
	try {
		posthog.capture(event, properties);
	} catch {
		// Analytics must never break the app.
	}
}