import { Check, ChevronDown, Eye, EyeOff, KeyRound, LogOut, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as rpc from "../../../lib/rpc";
import {
	groupedProviders,
	type ProviderSpec,
} from "../../../lib/providers";

interface ProviderCredential {
	type: string;
	key?: string;
	access?: string;
	refresh?: string;
	expires?: number;
	email?: string;
	account?: string;
	[key: string]: unknown;
}

function getProviderCredentials(
	auth: Record<string, unknown>,
	providerId: string,
): ProviderCredential | undefined {
	const entry = auth[providerId];
	if (!entry || typeof entry !== "object") return undefined;
	return entry as ProviderCredential;
}

/**
 * Account section — one card per supported AI provider.
 *
 * Three auth surfaces depending on what the cli knows how to do:
 *
 *   - `oauth: true`        — fires `/login <id>` through the engine (device
 *                           code flow handled by the cli).
 *   - `complex: true`      — multi-field or ambient auth (AWS, gcloud, CF).
 *                           We link the user to the right console + env vars
 *                           rather than offering a paste input.
 *   - "regular"            — single API key, paste-back input writes to
 *                           `auth.json` via `write_auth_file`.
 */
export function AccountSection() {
	const [auth, setAuth] = useState<Record<string, unknown>>({});
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveStatus, setSaveStatus] = useState<
		{ providerId: string; kind: "success" | "error"; message: string } | null
	>(null);

	const reload = useCallback(async () => {
		try {
			const data = await rpc.readAuthFile();
			setAuth((data as Record<string, unknown>) ?? {});
			setLoadError(null);
		} catch (e) {
			setLoadError(String(e));
		}
	}, []);

	const notifyAuthChanged = useCallback(() => {
		window.dispatchEvent(new CustomEvent("a-coder:auth-changed"));
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const handleSignOut = useCallback(
		async (providerId: string) => {
			try {
				const next = { ...auth };
				delete next[providerId];
				await rpc.writeAuthFile({ value: next });
				setAuth(next);
				notifyAuthChanged();
				try {
					await rpc.reloadAuth();
				} catch (reloadErr) {
					console.warn("Engine auth reload failed after sign out", reloadErr);
				}
			} catch (e) {
				setSaveStatus({
					providerId,
					kind: "error",
					message: e instanceof Error ? e.message : String(e),
				});
			}
		},
		[auth, notifyAuthChanged],
	);

	const handlePasteKey = useCallback(
		async (providerId: string, key: string) => {
			const trimmed = key.trim();
			if (!trimmed) return;
			const next = {
				...auth,
				[providerId]: { type: "api_key", key: trimmed },
			};
			try {
				await rpc.writeAuthFile({ value: next });
				setAuth(next);
				notifyAuthChanged();
				let reloadWarning = "";
				try {
					await rpc.reloadAuth();
				} catch (reloadErr) {
					// Engine refresh is a nice-to-have; the file write already
					// succeeded. Warn rather than failing the whole save.
					reloadWarning = reloadErr instanceof Error ? reloadErr.message : String(reloadErr);
					console.warn("Engine auth reload failed", reloadErr);
				}
				setSaveStatus({
					providerId,
					kind: "success",
					message: reloadWarning
						? `Saved, but the running engine didn't pick it up: ${reloadWarning}`
						: "API key saved and ready to use.",
				});
			} catch (e) {
				setSaveStatus({
					providerId,
					kind: "error",
					message: e instanceof Error ? e.message : String(e),
				});
			}
		},
		[auth, notifyAuthChanged],
	);

	const handleOAuthSignIn = useCallback(
		async (providerId: string) => {
			try {
				await rpc.sendCommand({
					type: "prompt",
					message: `/login ${providerId}`,
				});
			} catch (e) {
				console.error("OAuth login failed", e);
			}
			setTimeout(() => void reload(), 2500);
		},
		[reload],
	);

	const groups = groupedProviders();

	return (
		<div className="space-y-5">
			<div>
				<h2 className="text-[15px] font-semibold tracking-tight transition-smooth hover:text-pi-text-secondary">Account</h2>
				<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
					Sign in to an AI provider so the assistant can talk to it. OAuth
					opens the provider's website; API keys stay on your machine. Some
					providers also accept environment variables.
				</p>
			</div>

			{loadError && (
				<div className="rounded-md bg-pi-error-soft px-3 py-2 text-2xs text-pi-error transition-smooth">
					Couldn't read auth.json: {loadError}
				</div>
			)}

			{groups.map(({ group, providers }) => (
				<section key={group} className="space-y-2">
					<header className="flex items-baseline gap-2 px-1 transition-smooth hover:text-pi-text-secondary">
						<h3 className="text-3xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
							{group}
						</h3>
						<span className="text-3xs text-pi-text-faint">
							{providers.length} provider{providers.length === 1 ? "" : "s"}
						</span>
					</header>
					<div className="space-y-2">
						{providers.map((p) => (
							<ProviderCard
								key={p.id}
								provider={p}
								credential={getProviderCredentials(auth, p.id)}
								saveStatus={saveStatus?.providerId === p.id ? saveStatus : null}
								onClearSaveStatus={() => setSaveStatus(null)}
								onSignOut={() => void handleSignOut(p.id)}
								onPasteKey={(key) => void handlePasteKey(p.id, key)}
								onOAuth={() => void handleOAuthSignIn(p.id)}
							/>
						))}
					</div>
				</section>
			))}

			<div className="rounded-md bg-pi-surface-raised px-3 py-2.5 text-2xs text-pi-text-muted shadow-ring transition-smooth hover:bg-pi-surface-overlay">
				Many providers accept environment variables too (e.g.{" "}
				<code className="font-mono text-pi-text">ANTHROPIC_API_KEY</code>,
				{" "}<code className="font-mono text-pi-text">OPENAI_API_KEY</code>) —
				already-set env vars work without signing in here.
			</div>
		</div>
	);
}

function ProviderCard({
	provider,
	credential,
	saveStatus,
	onClearSaveStatus,
	onSignOut,
	onPasteKey,
	onOAuth,
}: {
	provider: ProviderSpec;
	credential: ProviderCredential | undefined;
	saveStatus: { kind: "success" | "error"; message: string } | null;
	onClearSaveStatus: () => void;
	onSignOut: () => void;
	onPasteKey: (key: string) => void;
	onOAuth: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [showKey, setShowKey] = useState(false);

	const signedIn = Boolean(credential);
	const isOAuth = credential?.type === "oauth";
	const isApiKey = credential?.type === "api_key";

	const statusLabel = signedIn
		? isOAuth
			? `Signed in (OAuth${credential?.email ? ` · ${credential.email}` : ""})`
			: isApiKey
				? "Signed in (API key)"
				: "Signed in"
		: "Not signed in";

	return (
		<div className={`overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring transition-smooth hover:shadow-card-hover`}>
			<div className="flex items-start gap-3 px-4 py-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-pi-accent to-pi-accent-hover font-semibold text-xs text-white active-press transition-smooth group-hover:opacity-80">
					{provider.label
						.replace(/\(.*?\)/g, "")
						.trim()
						.slice(0, 1)
						.toUpperCase()}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-xs font-semibold text-pi-text transition-smooth hover:text-pi-text-secondary">
							{provider.label}
						</span>
						{signedIn ? (
							<span className="inline-flex items-center gap-1 rounded-full bg-pi-success/15 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider text-pi-success transition-smooth hover:bg-pi-success/20">
								<Check className="h-2.5 w-2.5" />
								Connected
							</span>
						) : (
							<span className="inline-flex items-center gap-1 rounded-full bg-pi-surface-overlay px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider text-pi-text-muted transition-smooth hover:bg-pi-surface-raised">
								Not connected
							</span>
						)}
					</div>
					<div className="mt-0.5 text-2xs text-pi-text-muted transition-smooth">
						{provider.hint}
					</div>
					<div className="mt-0.5 truncate text-3xs font-mono text-pi-text-faint">
						{statusLabel}
					</div>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1.5">
					{signedIn ? (
						<button
							type="button"
							onClick={onSignOut}
							className={`inline-flex h-7 items-center gap-1 rounded-md bg-pi-surface-overlay px-2.5 text-2xs font-medium transition-hover active-press hover:bg-pi-error-soft hover:text-pi-error`}
						>
							<LogOut className="h-3 w-3" />
							Sign out
						</button>
					) : provider.complex ? (
						<a
							href={provider.consoleUrl}
							target="_blank"
							rel="noopener noreferrer"
							className={`inline-flex h-7 items-center gap-1 rounded-md bg-pi-surface-overlay px-2.5 text-2xs font-medium transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text`}
						>
							Set up
						</a>
					) : (
						<div className="flex items-center gap-1.5">
							{provider.oauth && (
								<button
									type="button"
									onClick={onOAuth}
									className={`inline-flex h-7 items-center gap-1 rounded-md bg-pi-accent px-2.5 text-2xs font-semibold text-white transition-hover active-press hover:bg-pi-accent-hover`}
								>
									<KeyRound className="h-3 w-3" />
									Sign in
								</button>
							)}
							<button
								type="button"
								onClick={() => setExpanded((v) => !v)}
								className={`inline-flex h-7 items-center gap-1 rounded-md bg-pi-surface-overlay px-2.5 text-2xs font-medium transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text`}
							>
								Use API key
								<ChevronDown
									className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
								/>
							</button>
						</div>
					)}
				</div>
			</div>

			{!signedIn && provider.complex && provider.envVars.length > 0 && (
				<div className="space-y-1.5 border-t border-pi-border bg-pi-bg/50 px-4 py-2.5 transition-smooth hover:bg-pi-bg/60">
					<p className="text-2xs text-pi-text-muted">
						This provider reads from environment variables. Set one of:
					</p>
					<div className="flex flex-wrap gap-1.5">
						{provider.envVars.map((v) => (
							<code
								key={v}
								className={`rounded bg-pi-surface-overlay px-1.5 py-0.5 font-mono text-3xs text-pi-text transition-smooth hover:bg-pi-surface-raised`}
							>
								{v}
							</code>
						))}
					</div>
				</div>
			)}

			{!signedIn && expanded && !provider.complex && (
				<div className="space-y-2 border-t border-pi-border bg-pi-bg/50 px-4 py-3 transition-smooth">
					<p className="text-2xs text-pi-text-muted">
						Get an API key from{" "}
						<a
							href={provider.consoleUrl}
							target="_blank"
							rel="noopener noreferrer"
							className={`transition-hover hover:underline`}
						>
							{provider.label}'s website
						</a>{" "}
						and paste it here. It stays on your machine.
						{provider.envVars.length > 0 && (
							<>
								{" "}
								Or set{" "}
								<code className="font-mono text-pi-text">
									{provider.envVars[0]}
								</code>{" "}
								in your shell.
							</>
						)}
					</p>
					<div className="flex gap-2">
						<div className="relative flex-1">
							<input
								type={showKey ? "text" : "password"}
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder="Paste API key…"
								spellCheck={false}
								autoComplete="off"
								className={`w-full rounded-md bg-pi-surface-raised py-1.5 pl-3 pr-9 text-xs font-mono text-pi-text placeholder:text-pi-text-faint shadow-ring transition-smooth focus:shadow-focus focus:outline-none`}
							/>
							<button
								type="button"
								onClick={() => setShowKey((v) => !v)}
								className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-pi-text-faint transition-hover active-press hover:text-pi-text`}
								title={showKey ? "Hide key" : "Show key"}
							>
								{showKey ? (
									<EyeOff className="h-3.5 w-3.5" />
								) : (
									<Eye className="h-3.5 w-3.5" />
								)}
							</button>
						</div>
						<button
							type="button"
							disabled={!apiKey.trim()}
							onClick={() => {
								onPasteKey(apiKey);
								setApiKey("");
								setExpanded(false);
							}}
							className={`inline-flex h-8 items-center gap-1 rounded-md bg-pi-accent px-3 text-xs font-semibold text-white transition-hover active-press hover:bg-pi-accent-hover disabled:cursor-not-allowed disabled:opacity-50`}
						>
							Save key
						</button>
						<button
							type="button"
							onClick={() => {
								setApiKey("");
								setExpanded(false);
							}}
							className={`inline-flex h-8 items-center rounded-md px-2 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised`}
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
					{saveStatus && (
						<div
							className={`rounded-md px-3 py-2 text-2xs transition-smooth ${
								saveStatus.kind === "success"
									? "bg-pi-success/15 text-pi-success"
									: "bg-pi-error-soft text-pi-error"
							}`}
						>
							<div className="flex items-start justify-between gap-2">
								<span>{saveStatus.message}</span>
								<button
									type="button"
									onClick={onClearSaveStatus}
									className="shrink-0 rounded p-0.5 text-current/70 transition-hover active-press hover:bg-pi-surface-raised"
									aria-label="Dismiss"
								>
									<X className="h-3 w-3" />
								</button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
