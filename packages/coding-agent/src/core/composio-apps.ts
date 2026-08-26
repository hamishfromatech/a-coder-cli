// Composio "apps" gallery service — the direct (non-agent) surface behind the
// CLI `/apps` command and the desktop Apps page. Lists every Composio toolkit
// (an "app"), shows which the current user has already connected, and drives
// the connect/disconnect flow.
//
// The connect flow resolves a toolkit's auth config (reusing an existing one
// or creating a Composio-managed one) and then calls
// `connectedAccounts.link()` — the non-deprecated path (the legacy
// `initiate()` retired for Composio-managed OAuth on 2026-07-03). The returned
// `ConnectionRequest` carries the sign-in `redirectUrl` and a
// `waitForConnection()` poller the caller can await to confirm the user
// finished signing in.

import type { ResolvedComposioConfig } from "./composio.ts";
import { createComposioClient } from "./composio.ts";

/** A single Composio app (toolkit) as shown in the apps gallery. */
export interface ComposioApp {
	/** Toolkit slug, e.g. `github`. The stable key for connect/disconnect. */
	slug: string;
	/** Display name, e.g. `GitHub`. */
	name: string;
	description?: string;
	logo?: string;
	toolsCount?: number;
	/** True when the toolkit needs no auth (can be used without connecting). */
	noAuth?: boolean;
	/** True when the current user has an ACTIVE connected account for it. */
	connected: boolean;
	/** The connected-account id when `connected` is true (for disconnect). */
	connectedAccountId?: string;
}

/** Result of starting a connect flow. */
export interface ComposioConnectResult {
	/** The OAuth sign-in URL to open in a browser, or null if none. */
	redirectUrl: string | null;
	/** The pending connected-account id (use to disconnect / re-list). */
	connectedAccountId: string;
	/**
	 * Polls Composio until the user completes sign-in (or `timeoutMs` elapses).
	 * Resolves with the finalized connected account. Callers that don't want
	 * to block (e.g. RPC) can ignore this and re-list instead.
	 */
	waitForConnection: (timeoutMs?: number) => Promise<unknown>;
}

const ACTIVE = "ACTIVE";

/**
 * List every Composio toolkit, annotated with the current user's connection
 * status. Toolkits without a connection are returned too (so the gallery can
 * offer to connect them).
 */
export async function listComposioApps(config: ResolvedComposioConfig, agentDir: string): Promise<ComposioApp[]> {
	const { composio, userId } = createComposioClient(config, agentDir);

	const [toolkits, accounts] = await Promise.all([
		composio.toolkits.get({ limit: 1000 }),
		// Omit `statuses` (the enum isn't re-exported from @composio/core) and
		// filter to ACTIVE client-side.
		composio.connectedAccounts.list({ userIds: [userId] }),
	]);

	const activeBySlug = new Map<string, string>();
	for (const account of accounts.items) {
		if (account.status === ACTIVE && account.toolkit?.slug) {
			activeBySlug.set(account.toolkit.slug, account.id);
		}
	}

	return (toolkits as readonly ComposioToolkitItem[]).map((t) => {
		const connectedAccountId = activeBySlug.get(t.slug);
		return {
			slug: t.slug,
			name: t.name,
			description: t.meta?.description,
			logo: t.meta?.logo,
			toolsCount: t.meta?.toolsCount,
			noAuth: t.noAuth,
			connected: connectedAccountId !== undefined,
			connectedAccountId,
		};
	});
}

/**
 * Start a connection for a toolkit: resolve (or create) its auth config, then
 * create a Composio Connect Link. Returns the sign-in URL and a poller. Does
 * not block on the user finishing sign-in — call `waitForConnection()` (CLI)
 * or re-`listComposioApps` (RPC/desktop) to confirm.
 */
export async function connectComposioApp(
	config: ResolvedComposioConfig,
	agentDir: string,
	slug: string,
): Promise<ComposioConnectResult> {
	const { composio, userId } = createComposioClient(config, agentDir);

	const existing = await composio.authConfigs.list({ toolkit: slug });
	let authConfigId = existing.items[0]?.id;
	if (!authConfigId) {
		const created = await composio.authConfigs.create(slug, {
			type: "use_composio_managed_auth",
			name: `${slug} Auth Config`,
		});
		authConfigId = created.id;
	}

	const request = await composio.connectedAccounts.link(userId, authConfigId, { allowMultiple: true });
	return {
		redirectUrl: request.redirectUrl ?? null,
		connectedAccountId: request.id,
		waitForConnection: (timeoutMs?: number) => request.waitForConnection(timeoutMs),
	};
}

/** Disconnect (delete) a connected account by id. */
export async function disconnectComposioApp(
	config: ResolvedComposioConfig,
	agentDir: string,
	connectedAccountId: string,
): Promise<void> {
	const { composio } = createComposioClient(config, agentDir);
	await composio.connectedAccounts.delete(connectedAccountId);
}

// The toolkit item shape from @composio/core (kept local to avoid importing an
// unexported type). Only the fields we read are declared.
interface ComposioToolkitItem {
	slug: string;
	name: string;
	meta?: {
		description?: string;
		logo?: string;
		toolsCount?: number;
	};
	noAuth?: boolean;
}
