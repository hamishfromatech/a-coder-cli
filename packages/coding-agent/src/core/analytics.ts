import { PostHog } from "posthog-node";
import { VERSION } from "../config.ts";
import type { AppMode } from "./project-trust.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { isTruthyEnvFlag } from "./telemetry.ts";

/**
 * Product analytics via PostHog, gated behind the opt-in `enableAnalytics`
 * setting (default off). When opted in, settings.json also carries a
 * `trackingId` (random UUID generated on first opt-in) used as the anonymous
 * distinct ID. No prompt content, file paths, or personal information is ever
 * captured — only anonymous, aggregate usage counters.
 *
 * The PostHog project API key is a write-only ingest token (safe to embed,
 * same trust model as posthog-js in browsers). It is baked in below and can
 * be overridden for self-hosting/testing via `A_CODER_CLI_POSTHOG_KEY` /
 * `A_CODER_CLI_POSTHOG_HOST`.
 */
const POSTHOG_API_KEY = "phc_2JUflk80xdIy6wphTpa1TYtjJupiIpartdetzQo0l8p";
const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | undefined;
/** Module-level start state so rpc/acp modes can capture session_end from their own exit paths. */
let startedAt: number | undefined;
let startedMode: AppMode | undefined;
let baseProps: Record<string, unknown> | undefined;

function getPostHogApiKey(): string {
	// An explicitly empty `A_CODER_CLI_POSTHOG_KEY` disables the client (used by
	// tests to stay hermetic even with a baked-in key).
	if (process.env.A_CODER_CLI_POSTHOG_KEY !== undefined) {
		return process.env.A_CODER_CLI_POSTHOG_KEY;
	}
	return POSTHOG_API_KEY;
}

function getPostHogHost(): string {
	return process.env.A_CODER_CLI_POSTHOG_HOST || POSTHOG_HOST;
}

/**
 * Resolve the analytics opt-in state. Analytics is strictly opt-in via the
 * `enableAnalytics` setting; `A_CODER_CLI_ANALYTICS=1` force-enables (testing),
 * `=0` force-disables, and offline mode always disables.
 */
export function resolveAnalyticsSettings(settingsManager: SettingsManager): {
	enabled: boolean;
	distinctId: string | undefined;
} {
	const distinctId = settingsManager.getTrackingId();
	const analyticsEnv = process.env.A_CODER_CLI_ANALYTICS;
	let enabled: boolean;
	if (analyticsEnv !== undefined) {
		enabled = isTruthyEnvFlag(analyticsEnv);
	} else {
		enabled = settingsManager.getEnableAnalytics();
	}
	if (process.env.A_CODER_CLI_OFFLINE) {
		enabled = false;
	}
	return { enabled: enabled && Boolean(distinctId), distinctId };
}

function getAnalyticsBaseProps(mode: AppMode): Record<string, unknown> {
	return {
		version: VERSION,
		mode,
		os: process.platform,
		arch: process.arch,
		node: process.version,
	};
}

function getClient(settingsManager: SettingsManager): PostHog | null {
	if (client) return client;
	const { enabled, distinctId } = resolveAnalyticsSettings(settingsManager);
	if (!enabled || !distinctId) return null;
	const apiKey = getPostHogApiKey();
	if (!apiKey) return null;
	client = new PostHog(apiKey, {
		host: getPostHogHost(),
		// CLI sessions are short-lived: send every event immediately instead of
		// waiting for the batcher, so events survive abrupt process exits.
		flushAt: 1,
		flushInterval: 1000,
		requestTimeout: 3000,
		fetchRetryCount: 1,
		disableGeoip: false,
	});
	return client;
}

function safeCapture(settingsManager: SettingsManager, event: string, properties: Record<string, unknown>): void {
	const posthog = getClient(settingsManager);
	if (!posthog) return;
	try {
		posthog.capture({ distinctId: settingsManager.getTrackingId() ?? "", event, properties });
	} catch {
		// Analytics must never break the session.
	}
}

/**
 * Capture an install/update event (fired alongside the existing anonymous
 * install ping when the CLI detects a new version).
 */
export function captureCliInstall(
	version: string,
	firstInstall: boolean,
	mode: AppMode,
	settingsManager: SettingsManager,
): void {
	safeCapture(settingsManager, "cli_install", {
		...getAnalyticsBaseProps(mode),
		install_version: version,
		first_install: firstInstall,
	});
}

/**
 * Capture session start. Fire-and-forget; never blocks startup.
 * Remembers start time/mode so `captureCliSessionEnd` can be called from
 * mode-specific exit paths (rpc/acp) that bypass main().
 */
export function captureCliSessionStart(
	session: {
		model?: { id: string; provider: string };
		getSessionStats?(): AnalyticsSessionStats;
	},
	mode: AppMode,
	settingsManager: SettingsManager,
): void {
	startedAt = Date.now();
	startedMode = mode;
	baseProps = getAnalyticsBaseProps(mode);
	safeCapture(settingsManager, "cli_session_start", {
		...baseProps,
		model: session.model?.id,
		provider: session.model?.provider,
	});
}

/** Shape of the aggregate session stats this module reads. */
export interface AnalyticsSessionStats {
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	cost: number;
}

/** Minimal structural view of a session message used for model-usage aggregation. */
export interface AnalyticsSessionMessage {
	role: string;
	provider?: string;
	model?: string;
	responseModel?: string; // Concrete serving model when it differs from the requested one
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost?: { total: number };
	};
}

interface ModelUsageGroup {
	provider: string;
	model: string;
	requestedModel: string;
	turns: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costUsd: number;
}

/** Group assistant messages by serving provider/model and sum usage per group. Exported for tests. */
export function aggregateModelUsage(messages: ReadonlyArray<AnalyticsSessionMessage> | undefined): ModelUsageGroup[] {
	if (!messages || messages.length === 0) return [];
	const groups = new Map<string, ModelUsageGroup>();
	for (const message of messages) {
		if (message.role !== "assistant" || !message.usage || !message.model || !message.provider) continue;
		const servingModel = message.responseModel ?? message.model;
		const key = `${message.provider}/${servingModel}`;
		let group = groups.get(key);
		if (!group) {
			group = {
				provider: message.provider,
				model: servingModel,
				requestedModel: message.model,
				turns: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costUsd: 0,
			};
			groups.set(key, group);
		}
		group.turns += 1;
		group.inputTokens += message.usage.input;
		group.outputTokens += message.usage.output;
		group.cacheReadTokens += message.usage.cacheRead;
		group.cacheWriteTokens += message.usage.cacheWrite;
		group.costUsd += message.usage.cost?.total ?? 0;
	}
	return [...groups.values()];
}

/**
 * Capture session end with aggregate usage stats and flush the client so
 * events are delivered before process exit. Awaits network delivery.
 */
export async function captureCliSessionEnd(
	session: {
		model?: { id: string; provider: string };
		getSessionStats(): AnalyticsSessionStats;
		messages?: ReadonlyArray<AnalyticsSessionMessage>;
	},
	settingsManager: SettingsManager,
): Promise<void> {
	const mode = startedMode;
	if (mode === undefined) return;
	const durationMs = startedAt !== undefined ? Date.now() - startedAt : 0;
	const stats = session.getSessionStats();

	// Per-model usage: one event per (provider, serving model) pair actually used
	// during the session, so mid-session model switches are counted accurately.
	for (const group of aggregateModelUsage(session.messages)) {
		safeCapture(settingsManager, "cli_model_usage", {
			...(baseProps ?? getAnalyticsBaseProps(mode)),
			model: group.model,
			provider: group.provider,
			requested_model: group.requestedModel,
			turns: group.turns,
			input_tokens: group.inputTokens,
			output_tokens: group.outputTokens,
			cache_read_tokens: group.cacheReadTokens,
			cache_write_tokens: group.cacheWriteTokens,
			cost_usd: Math.round(group.costUsd * 1e6) / 1e6,
		});
	}

	safeCapture(settingsManager, "cli_session_end", {
		...(baseProps ?? getAnalyticsBaseProps(mode)),
		model: session.model?.id,
		provider: session.model?.provider,
		duration_ms: durationMs,
		user_messages: stats.userMessages,
		assistant_messages: stats.assistantMessages,
		tool_calls: stats.toolCalls,
		input_tokens: stats.tokens.input,
		output_tokens: stats.tokens.output,
		cache_read_tokens: stats.tokens.cacheRead,
		cache_write_tokens: stats.tokens.cacheWrite,
		cost_usd: Math.round(stats.cost * 1e6) / 1e6,
	});
	await flushAnalytics();
}

/** Flush and tear down the analytics client so the process can exit cleanly. */
export async function flushAnalytics(): Promise<void> {
	const posthog = client;
	client = undefined;
	if (!posthog) return;
	try {
		await posthog.flush();
	} catch {
		// Best-effort delivery; never block exit.
	}
}
