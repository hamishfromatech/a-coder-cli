// Composio (https://composio.dev) integration for a-coder-cli.
//
// Uses the native `PiProvider` from `@composio/experimental`, which is built
// against `@earendil-works/pi-coding-agent` (this package): the tools it
// returns are `ToolDefinition[]` and drop straight into `createAgentSession`'s
// `customTools`. When enabled, the agent gets:
//   - composio_search_tools        (discover exact Composio tool slugs + schemas)
//   - composio_manage_connections  (check + initiate auth for missing toolkits)
//   - composio_execute_tool        (execute an exact Composio tool slug)
//   - composio_remote_workbench    (remote Python sandbox; opt-in)
//   - composio_remote_bash         (remote bash sandbox; opt-in)
// plus a Composio system-prompt section appended to the base prompt.
//
// Auth links surfaced by `composio_manage_connections` come back as tool
// results in the chat (both CLI and desktop, since desktop runs the CLI in RPC
// mode), so no separate event channel is needed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Composio } from "@composio/core";
import { createPiComposioSystemPrompt, PiProvider, type PiToolCollection } from "@composio/experimental";
import { getAgentDir } from "../config.ts";
import type { ToolDefinition } from "./extensions/types.ts";
import type { ComposioSettings } from "./settings-manager.ts";

/** Composio config with the API key resolved (from env or settings), so the
 * key is guaranteed present before we try to create a session. */
export type ResolvedComposioConfig = Omit<ComposioSettings, "apiKey"> & { apiKey: string };

export interface ComposioIntegration {
	/** Composio helper tools, assignable to `createAgentSession({ customTools })`. */
	tools: ToolDefinition[];
	/** Names of the tools above, to add to the session `tools` allow-list. */
	toolNames: string[];
	/** Composio system-prompt section to append to the base system prompt. */
	systemPrompt: string;
}

/**
 * Build (and cache) the Composio integration for a session.
 *
 * The Composio session is a network call, so the result is cached per process
 * by a key derived from the effective config — project switches, `--continue`
 * resumes, and model swaps reuse the same session instead of recreating it.
 *
 * `config` is the merged view of `Settings.composio` + the `COMPOSIO_API_KEY`
 * env var (env wins). Throws if the API key is missing or the session can't be
 * created; the caller is expected to catch and degrade gracefully.
 */
export async function createComposioIntegration(
	config: ResolvedComposioConfig,
	agentDir: string = getAgentDir(),
): Promise<ComposioIntegration> {
	// Accept either a string[] or a comma-separated string (the desktop
	// settings panel edits toolkits as a single text field).
	const toolkits = Array.isArray(config.toolkits)
		? config.toolkits
		: typeof config.toolkits === "string"
			? config.toolkits
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: [];

	const cacheKey = JSON.stringify({
		apiKey: config.apiKey,
		userId: config.userId,
		toolkits,
		sandbox: config.sandbox ?? false,
		includeWorkbenchTools: config.includeWorkbenchTools ?? false,
		callbackUrl: config.callbackUrl,
	});
	const cached = CACHE.get(cacheKey);
	if (cached) return cached;

	const { composio, userId } = createComposioClient(config, agentDir);

	const session = await composio.sessions.create(userId, {
		...(toolkits.length > 0 ? { toolkits } : {}),
		manageConnections: {
			enable: true,
			...(config.callbackUrl ? { callbackUrl: config.callbackUrl } : {}),
		},
		...(config.sandbox ? { sandbox: { enable: true } } : {}),
	});

	const tools: PiToolCollection = composio.provider.createSessionTools(session, {
		includeWorkbenchTools: config.includeWorkbenchTools ?? false,
		...(config.callbackUrl ? { callbackUrl: config.callbackUrl } : {}),
	});

	const toolNames = tools.map((t) => t.name);
	const systemPrompt = createPiComposioSystemPrompt(session.sessionId, {
		includeWorkbenchTools: config.includeWorkbenchTools ?? false,
	});

	const integration: ComposioIntegration = {
		tools: tools as unknown as ToolDefinition[],
		toolNames,
		systemPrompt,
	};
	CACHE.set(cacheKey, integration);
	return integration;
}

/**
 * Resolve the effective Composio config from settings + env. Returns `null`
 * when Composio is not enabled (no `enabled: true` and no API key), so the
 * caller can skip the integration entirely.
 */
export function resolveComposioConfig(settings: ComposioSettings | undefined): ResolvedComposioConfig | null {
	const apiKey = process.env.COMPOSIO_API_KEY ?? settings?.apiKey;
	const enabled = settings?.enabled === true || (settings?.enabled === undefined && Boolean(apiKey));
	if (!enabled || !apiKey) return null;
	return { ...settings, apiKey };
}

/** The five helper tool names, for reference / allow-listing.
 *  Re-exported as a live binding (not a snapshot `const`) because this module
 *  and `@composio/experimental` are in a dependency cycle (@composio/experimental
 *  imports `defineTool` from this package). An eager `export const X = imported`
 *  reads the binding at module-eval time and triggers a TDZ error during the
 *  cycle; the re-export form is deferred to consumer import access. */
export { PI_COMPOSIO_SESSION_TOOL_NAMES as COMPOSIO_TOOL_NAMES } from "@composio/experimental";

// --- internal ----------------------------------------------------------------

const CACHE = new Map<string, ComposioIntegration>();

/**
 * Construct a `Composio` client and resolve the stable per-install user id.
 * Shared by the agent integration (`createComposioIntegration`) and the
 * apps-gallery service (`composio-apps.ts`) so both route connections under
 * the same user id and API key.
 */
export function createComposioClient(
	config: ResolvedComposioConfig,
	agentDir: string = getAgentDir(),
): { composio: Composio<PiProvider>; userId: string } {
	const composio = new Composio({ apiKey: config.apiKey, provider: new PiProvider() });
	const userId = config.userId ?? resolveStableUserId(agentDir);
	return { composio, userId };
}

/**
 * Composio scopes connected accounts by `user_id` within a developer's API
 * key, so a stable per-install id keeps a user's connections across sessions.
 * Persisted at `<agentDir>/composio-user-id`, generated on first use.
 */
export function resolveStableUserId(agentDir: string): string {
	const file = join(agentDir, "composio-user-id");
	try {
		if (existsSync(file)) {
			const id = readFileSync(file, "utf8").trim();
			if (id) return id;
		}
		mkdirSync(agentDir, { recursive: true });
		const id = `acoder_${randomId()}`;
		writeFileSync(file, id, "utf8");
		return id;
	} catch {
		// Fall back to a per-process id if the agent dir isn't writable.
		return `acoder_${randomId()}`;
	}
}

function randomId(): string {
	// 16 hex chars; crypto is overkill for a non-secret local identifier.
	return Math.random().toString(16).slice(2, 18).padEnd(16, "0");
}
