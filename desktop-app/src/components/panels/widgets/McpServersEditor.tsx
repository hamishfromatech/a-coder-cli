import {
	AlertTriangle,
	CheckCircle2,
	ExternalLink,
	Loader2,
	Plus,
	Power,
	RefreshCw,
	Server,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as rpc from "../../../lib/rpc";
import { toast } from "../../../stores/toast-store";
import { Card } from "../../ui/Card";
import { Switch } from "../../ui/Switch";

type McpTransport = "stdio" | "sse" | "http";

interface McpOAuthConfig {
	scopes?: string[];
	clientId?: string;
	clientSecret?: string;
	clientMetadataUrl?: string;
}

interface McpServerConfig {
	name?: string;
	transport?: McpTransport;
	commandOrUrl?: string;
	args?: string[];
	env?: Record<string, string>;
	headers?: Record<string, string>;
	disabled?: boolean;
	oauth?: boolean | McpOAuthConfig;
	[key: string]: unknown;
}

interface McpServerUi {
	name?: string;
	transport?: McpTransport;
	command?: string;
	url?: string;
	args?: string[];
	env?: Record<string, string>;
	headers?: Record<string, string>;
	disabled?: boolean;
	oauth?: boolean | McpOAuthConfig;
	/**
	 * Extra keys that don't fit the typed shape are preserved verbatim so the
	 * cli's full MCP server config survives round-trips through the desktop UI.
	 */
	[key: string]: unknown;
}

interface Props {
	value: McpServerConfig[] | undefined;
	onChange: (next: McpServerConfig[] | undefined) => void;
	/** Which settings file this editor edits — project files merge with globals on the engine. */
	scope?: "global" | "project";
}

const TRANSPORT_OPTIONS: { value: McpTransport; label: string }[] = [
	{ value: "stdio", label: "Command (stdio)" },
	{ value: "sse", label: "Server-Sent Events" },
	{ value: "http", label: "HTTP streamable" },
];

const KNOWN_KEYS = new Set([
	"name",
	"transport",
	"commandOrUrl",
	"command",
	"url",
	"args",
	"env",
	"headers",
	"disabled",
	"oauth",
]);

function cliToUi(server: McpServerConfig): McpServerUi {
	const transport = server.transport ?? inferTransport(server);
	const ui: McpServerUi = {
		name: server.name,
		transport,
		args: server.args ? [...server.args] : [],
		env: server.env ? { ...server.env } : {},
		headers: server.headers ? { ...server.headers } : {},
		disabled: server.disabled,
		oauth: server.oauth,
	};

	if (transport === "stdio") {
		ui.command = server.commandOrUrl ?? "";
	} else {
		ui.url = server.commandOrUrl ?? (server as McpServerUi).url ?? "";
	}

	for (const [key, val] of Object.entries(server)) {
		if (!KNOWN_KEYS.has(key)) {
			ui[key] = val;
		}
	}

	return ui;
}

function uiToCli(server: McpServerUi): McpServerConfig {
	const transport = server.transport ?? inferTransport(server);
	const cli: McpServerConfig = {
		name: server.name,
		transport,
		commandOrUrl:
			transport === "stdio"
				? server.command?.trim() || undefined
				: server.url?.trim() || undefined,
		args: server.args?.length ? [...server.args] : undefined,
		env: server.env && Object.keys(server.env).length ? { ...server.env } : undefined,
		headers:
			server.headers && Object.keys(server.headers).length
				? { ...server.headers }
				: undefined,
		disabled: server.disabled,
		oauth: server.oauth,
	};

	for (const [key, val] of Object.entries(server)) {
		if (!KNOWN_KEYS.has(key)) {
			cli[key] = val;
		}
	}

	return cli;
}

function inferTransport(server: McpServerConfig | McpServerUi): McpTransport {
	if (server.transport) return server.transport;
	if (("commandOrUrl" in server || "command" in server) && !("url" in server)) {
		const value =
			((server as McpServerConfig).commandOrUrl ?? (server as McpServerUi).command ?? "")
				.trim();
		if (value.startsWith("http://") || value.startsWith("https://")) return "sse";
	}
	if (("url" in server && (server as McpServerUi).url?.trim()) || "headers" in server) {
		return "http";
	}
	return "stdio";
}

export function McpServersEditor({ value, onChange, scope = "global" }: Props) {
	const servers = value?.map(cliToUi) ?? [];
	const [expanded, setExpanded] = useState<number | null>(servers.length > 0 ? 0 : null);
	const [states, setStates] = useState<Record<string, rpc.McpServerState>>({});
	const [catalog, setCatalog] = useState<rpc.McpCatalogEntry[]>([]);
	const [reconnecting, setReconnecting] = useState<string | null>(null);
	const [applying, setApplying] = useState(false);
	const [oauthFlows, setOauthFlows] = useState<
		Record<string, { phase: "starting" | "browser" | "success" | "error"; error?: string }>
	>({});

	const refreshStatus = useCallback(async () => {
		try {
			const { servers: live } = await rpc.getMcpStatus();
			setStates(Object.fromEntries(live.map((state) => [state.name, state])));
		} catch {
			// Engine not connected yet / older engine: keep the editor usable.
		}
	}, []);

	useEffect(() => {
		void refreshStatus();
	}, [refreshStatus]);

	useEffect(() => {
		void rpc
			.getMcpCatalog()
			.then(({ servers: entries }) => setCatalog(entries))
			.catch(() => {
				// Older engine: the catalog section simply stays hidden.
			});
	}, []);

	useEffect(() => {
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<rpc.McpOAuthStatusEvent>).detail;
			if (!detail?.name) return;
			setOauthFlows((current) => ({
				...current,
				[detail.name]: { phase: detail.phase, error: detail.error },
			}));
			if (detail.phase === "success") void refreshStatus();
		};
		window.addEventListener("a-coder:mcp-oauth-status", handler);
		return () => window.removeEventListener("a-coder:mcp-oauth-status", handler);
	}, [refreshStatus]);

	const reconnect = useCallback(
		async (name: string) => {
			if (!name || reconnecting) return;
			setReconnecting(name);
			try {
				const result = await rpc.reconnectMcp(name);
				if (result.deferred) toast.info("Reconnect queued", "It will run when the current turn finishes.");
				else if (!result.ok) toast.error("MCP reconnect failed", result.error ?? name);
				else toast.success("MCP server reconnected", name);
				await refreshStatus();
			} catch (error) {
				toast.error("MCP reconnect failed", error instanceof Error ? error.message : String(error));
			} finally {
				setReconnecting(null);
			}
		},
		[reconnecting, refreshStatus],
	);

	const emit = useCallback(
		(nextUi: McpServerUi[]) => {
			const nextCli = nextUi.map(uiToCli);
			onChange(nextCli.length ? nextCli : undefined);
		},
		[onChange],
	);

	const applyChanges = useCallback(async () => {
		if (applying) return;
		setApplying(true);
		try {
			// The settings panel debounces its disk write; let that land before
			// reloading, because reload re-reads settings.json.
			await new Promise((resolve) => setTimeout(resolve, 650));
			await rpc.reloadEngine();
			toast.success("MCP servers reloaded");
			await refreshStatus();
		} catch (error) {
			toast.error("MCP reload failed", error instanceof Error ? error.message : String(error));
		} finally {
			setApplying(false);
		}
	}, [applying, refreshStatus]);

	const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
	const configuredNames = new Set(servers.map((server) => server.name).filter((name): name is string => Boolean(name)));
	const availableCatalog = catalog.filter((entry) => !configuredNames.has(entry.name));
	const enabledCount = servers.filter((server) => server.name && !server.disabled).length;
	const errorCount = Object.values(states).filter((state) => state.status === "error").length;

	const startOAuth = useCallback(async (name: string) => {
		if (!name) return;
		setOauthFlows((current) => ({ ...current, [name]: { phase: "starting" } }));
		try {
			// The settings panel debounces its disk write; start after it lands.
			await new Promise((resolve) => setTimeout(resolve, 650));
			await rpc.startMcpOAuth(name);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setOauthFlows((current) => ({ ...current, [name]: { phase: "error", error: message } }));
			toast.error("MCP sign-in failed", message);
		}
	}, []);

	const resetOAuth = useCallback(
		async (name: string) => {
			if (!name) return;
			try {
				await rpc.disconnectMcpOAuth(name);
				setOauthFlows((current) => {
					const next = { ...current };
					delete next[name];
					return next;
				});
				toast.success("MCP sign-in cleared", name);
				await refreshStatus();
			} catch (error) {
				toast.error("Could not clear MCP sign-in", error instanceof Error ? error.message : String(error));
			}
		},
		[refreshStatus],
	);

	const addCatalogEntry = useCallback(
		(entry: rpc.McpCatalogEntry) => {
			if (servers.some((server) => server.name === entry.name)) return;
			const next = [...servers, cliToUi({ ...entry.config, disabled: true })];
			emit(next);
			setExpanded(next.length - 1);
		},
		[servers, emit],
	);

	const addAllCatalog = useCallback(() => {
		const missing = availableCatalog.filter(
			(entry) => !servers.some((server) => server.name === entry.name),
		);
		if (missing.length === 0) return;
		const next = [
			...servers,
			...missing.map((entry) => cliToUi({ ...entry.config, disabled: true })),
		];
		emit(next);
		setExpanded(servers.length);
	}, [availableCatalog, servers, emit]);

	const addServer = useCallback(() => {
		const next: McpServerUi[] = [...servers, { command: "", args: [], env: {}, headers: {} }];
		emit(next);
		setExpanded(next.length - 1);
	}, [servers, emit]);

	const removeServer = useCallback(
		(idx: number) => {
			const next = servers.filter((_, i) => i !== idx);
			emit(next);
			setExpanded((cur) => {
				if (cur === null) return null;
				if (cur === idx) return next.length > 0 ? Math.max(0, idx - 1) : null;
				return cur > idx ? cur - 1 : cur;
			});
		},
		[servers, emit],
	);

	const updateServer = useCallback(
		(idx: number, patch: Partial<McpServerUi>) => {
			const next = servers.map((s, i) => (i === idx ? { ...s, ...patch } : s));
			emit(next);
		},
		[servers, emit],
	);

	return (
		<div className="w-full space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					{scope === "project" ? (
						<p className="text-2xs text-pi-text-muted">
							Project-defined servers. These load alongside your global list;
							a same-name server here replaces the global one and shows a
							"(project)" label in the CLI's /mcp view.
						</p>
					) : (
						<p className="text-2xs text-pi-text-muted">
							Global MCP servers. Project workspaces can add more via
							.a-coder-cli/settings.json — they load together with these
							(project wins on same-name conflicts).
						</p>
					)}
					<p className="text-2xs text-pi-text-faint">
						{servers.length} configured · {enabledCount} enabled
						{errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? "" : "s"}` : ""}
						{" · "}toggle a server, then Apply
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={() => void applyChanges()}
						disabled={applying}
						className="flex items-center gap-1 rounded-md border border-pi-border px-2 py-1 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-50"
						title="Reload the engine so server changes take effect"
					>
						{applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
						Apply
					</button>
					<button
						type="button"
						onClick={() => void refreshStatus()}
						className="flex items-center gap-1 rounded-md border border-pi-border px-2 py-1 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						title="Refresh MCP status"
					>
						<RefreshCw className="h-3 w-3" />
						Status
					</button>
				</div>
			</div>
			{servers.length === 0 && (
				<p className="text-2xs text-pi-text-muted">
					No MCP servers configured. Add one to let the AI talk to external
					tools and data sources.
				</p>
			)}

			{servers.map((server, idx) => {
				const catalogEntry = catalogByName.get(server.name ?? "");
				const flow = oauthFlows[server.name ?? ""];
				return (
				<Card key={idx}>
					<div
						role="button"
						tabIndex={0}
						onClick={() => setExpanded((cur) => (cur === idx ? null : idx))}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								setExpanded((cur) => (cur === idx ? null : idx));
							}
						}}
						className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-hover hover:bg-pi-surface-overlay focus-visible:shadow-focus focus-visible:outline-none"
					>
						<Server className="h-3.5 w-3.5 text-pi-accent" />
						<span className="min-w-0 flex-1 truncate text-xs font-medium text-pi-text">
							{server.name || `Server ${idx + 1}`}
						</span>
						<span
							className="shrink-0"
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => event.stopPropagation()}
						>
							<Switch
								size="sm"
								checked={!server.disabled}
								disabled={!server.name}
								ariaLabel={
									server.disabled
										? `Enable ${server.name || `server ${idx + 1}`}`
										: `Disable ${server.name || `server ${idx + 1}`}`
								}
								onChange={() => updateServer(idx, { disabled: !server.disabled })}
							/>
						</span>
						{server.disabled ? (
							<span className="rounded bg-pi-surface-overlay px-1.5 py-0.5 text-3xs text-pi-text-muted">
								disabled
							</span>
						) : (
							<StatusBadge state={server.name ? states[server.name] : undefined} />
						)}
						<button
							type="button"
							disabled={!server.name || server.disabled || reconnecting === server.name}
							onClick={(e) => {
								e.stopPropagation();
								void reconnect(server.name ?? "");
							}}
							className="rounded p-1 text-pi-text-muted transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-30"
							title={server.name ? `Reconnect ${server.name}` : "Name the server first"}
							aria-label={server.name ? `Reconnect ${server.name}` : "Reconnect MCP server"}
						>
							{reconnecting === server.name ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<RefreshCw className="h-3 w-3" />
							)}
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								removeServer(idx);
							}}
							className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-error-soft hover:text-pi-error focus-visible:shadow-focus focus-visible:outline-none"
							title="Remove server"
							aria-label="Remove server"
						>
								<Trash2 className="h-3 w-3" />
							</button>
					</div>

					{expanded === idx && (
						<div className="space-y-3 border-t border-pi-border px-3 py-3">
							<LabeledInput
								label="Name"
								value={server.name ?? ""}
								placeholder="e.g. chrome-devtools"
								onChange={(v) => updateServer(idx, { name: v })}
							/>

							{catalogEntry && (
								<div className="rounded-md border border-pi-border bg-pi-bg p-2 text-2xs leading-relaxed">
									<p className="text-pi-text-muted">
										<span className="font-medium text-pi-text">Setup:</span>{" "}
										{catalogEntry.requirements}
									</p>
									<a
										href={catalogEntry.docsUrl}
										target="_blank"
										rel="noreferrer"
										className="mt-1 inline-flex items-center gap-1 text-pi-accent hover:underline"
									>
										<ExternalLink className="h-3 w-3" />
										Setup guide
									</a>
								</div>
							)}
							{server.name && states[server.name]?.status === "error" && (
								<div className="rounded-md bg-pi-error-soft p-2 text-2xs text-pi-error">
									{states[server.name]?.error ?? "MCP server failed to connect."}
								</div>
							)}

							<LabeledSelect
								label="Transport"
								value={server.transport ?? inferTransport(server)}
								options={TRANSPORT_OPTIONS}
								onChange={(transport) => updateServer(idx, { transport })}
							/>

							{(server.transport ?? inferTransport(server)) !== "stdio" && (
								<div className="rounded-md border border-pi-border bg-pi-bg p-2">
									<label className="flex cursor-pointer items-start justify-between gap-3">
										<span className="min-w-0">
											<span className="block text-2xs font-medium text-pi-text">OAuth sign-in</span>
											<span className="mt-0.5 block text-3xs leading-relaxed text-pi-text-faint">
												Use OAuth 2.1 + PKCE instead of a static bearer token.
											</span>
										</span>
										<Switch
											size="sm"
											checked={Boolean(server.oauth)}
											onChange={() => updateServer(idx, { oauth: server.oauth ? undefined : true })}
										/>
									</label>
									{server.oauth && (
										<div className="mt-2 space-y-1.5">
											<div className="flex flex-wrap items-center gap-2">
												<button
													type="button"
													onClick={() => void startOAuth(server.name ?? "")}
													disabled={
														!server.name ||
														server.disabled ||
														flow?.phase === "starting" ||
														flow?.phase === "browser"
													}
													className="inline-flex h-7 items-center gap-1.5 rounded-md bg-pi-accent px-2.5 text-2xs font-medium text-[var(--pi-accent-foreground)] transition-hover active-press disabled:opacity-40"
												>
													{flow?.phase === "starting" ? (
														<Loader2 className="h-3 w-3 animate-spin" />
													) : (
														<Power className="h-3 w-3" />
													)}
													{flow?.phase === "browser"
														? "Waiting for browser…"
														: flow?.phase === "starting"
															? "Starting…"
															: "Connect"}
												</button>
												<button
													type="button"
													onClick={() => void resetOAuth(server.name ?? "")}
													disabled={
														!server.name ||
														flow?.phase === "starting" ||
														flow?.phase === "browser"
													}
													className="rounded-md border border-pi-border px-2 py-1 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:opacity-40"
												>
													Reset sign-in
												</button>
												{server.disabled && (
													<span className="text-3xs text-pi-text-faint">Enable the server and Apply first.</span>
												)}
											</div>
											{flow?.phase === "error" && (
												<div className="text-3xs text-pi-error">{flow.error ?? "Sign-in failed."}</div>
											)}
											{flow?.phase === "success" && (
												<div className="text-3xs text-pi-success">Authorization saved locally.</div>
											)}
											<p className="text-3xs leading-relaxed text-pi-text-faint">
												Tokens are stored under the agent data directory, never in settings.json.
												Advanced: edit <code>oauth</code> in Extra JSON for scopes or a
												pre-registered client ID/secret.
											</p>
										</div>
									)}
								</div>
							)}

							{(server.transport ?? inferTransport(server)) === "stdio" ? (
								<LabeledInput
									label="Command"
									value={server.command ?? ""}
									placeholder="npx"
									onChange={(v) => updateServer(idx, { command: v })}
								/>
							) : (
								<LabeledInput
									label="URL"
									value={server.url ?? ""}
									placeholder="http://localhost:3000/sse"
									onChange={(v) => updateServer(idx, { url: v })}
								/>
							)}

							<StringListEditor
								label="Arguments"
								values={server.args ?? []}
								onChange={(args) => updateServer(idx, { args })}
								placeholder="-y chrome-devtools-mcp@latest"
							/>

							<KeyValueEditor
								label="Environment variables"
								entries={server.env ?? {}}
								onChange={(env) => updateServer(idx, { env })}
							/>

							<KeyValueEditor
								label="Headers"
								entries={server.headers ?? {}}
								onChange={(headers) => updateServer(idx, { headers })}
							/>

							<RawJsonEditor
								label="Extra JSON"
								value={server}
								keysToOmit={[
									"name",
									"transport",
									"commandOrUrl",
									"command",
									"url",
									"args",
									"env",
									"headers",
									"disabled",
								]}
								onChange={(raw) => {
									updateServer(idx, raw as McpServerUi);
								}}
							/>
						</div>
					)}
				</Card>
				);
			})}

			{availableCatalog.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-start justify-between gap-3">
						<div>
							<div className="text-xs font-semibold text-pi-text">App integrations</div>
							<p className="text-2xs text-pi-text-muted">
								Bundled servers for 3D, game and design apps. They are added disabled;
								flip the switch when the app is ready.
							</p>
						</div>
						<button
							type="button"
							onClick={addAllCatalog}
							className="shrink-0 rounded-md border border-pi-border px-2 py-1 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						>
							Add all
						</button>
					</div>
					<div className="grid gap-2">
						{availableCatalog.map((entry) => (
							<div key={entry.id} className="rounded-lg border border-pi-border p-2.5">
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-medium text-pi-text">{entry.title}</span>
									<button
										type="button"
										onClick={() => addCatalogEntry(entry)}
										className="inline-flex items-center gap-1 rounded-md bg-pi-surface-overlay px-2 py-1 text-2xs font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
									>
										<Plus className="h-3 w-3" />
										Add
									</button>
								</div>
								<p className="mt-0.5 text-2xs text-pi-text-muted">{entry.description}</p>
								<p className="mt-1 text-3xs leading-relaxed text-pi-text-faint">{entry.requirements}</p>
								<a
									href={entry.docsUrl}
									target="_blank"
									rel="noreferrer"
									className="mt-1 inline-flex items-center gap-1 text-2xs text-pi-accent hover:underline"
								>
									<ExternalLink className="h-3 w-3" />
									Setup guide
								</a>
							</div>
						))}
					</div>
				</div>
			)}

			<button
				type="button"
				onClick={addServer}
				className="inline-flex h-7 items-center gap-1.5 rounded-md bg-pi-surface-overlay px-2.5 text-2xs font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
			>
				<Plus className="h-3 w-3" />
				Add MCP server
			</button>
		</div>
	);
}

function LabeledInput({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className="space-y-1">
			<label className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				spellCheck={false}
				autoComplete="off"
				className="w-full rounded-md bg-pi-bg px-2.5 py-1.5 text-2xs text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none"
			/>
		</div>
	);
}

function LabeledSelect<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
}) {
	return (
		<div className="space-y-1">
			<label className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as T)}
				className="w-full rounded-md bg-pi-bg px-2.5 py-1.5 text-2xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
			>
				{options.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
		</div>
	);
}

function StringListEditor({
	label,
	values,
	onChange,
	placeholder,
}: {
	label: string;
	values: string[];
	onChange: (next: string[]) => void;
	placeholder?: string;
}) {
	const [text, setText] = useState(() => values.join("\n"));
	const commit = useCallback(
		(raw: string) => {
			setText(raw);
			onChange(
				raw
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		},
		[onChange],
	);

	return (
		<div className="space-y-1">
			<label className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<textarea
				value={text}
				placeholder={placeholder ?? "One entry per line"}
				onChange={(e) => commit(e.target.value)}
				rows={Math.max(2, Math.min(values.length + 1, 4))}
				spellCheck={false}
				className="w-full rounded-md bg-pi-bg p-2 font-mono text-2xs text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none"
			/>
		</div>
	);
}

function KeyValueEditor({
	label,
	entries,
	onChange,
}: {
	label: string;
	entries: Record<string, string>;
	onChange: (next: Record<string, string>) => void;
}) {
	const pairs = Object.entries(entries);

	const update = useCallback(
		(nextPairs: Array<[string, string]>) => {
			const next: Record<string, string> = {};
			for (const [k, v] of nextPairs) {
				if (k.trim()) next[k.trim()] = v;
			}
			onChange(next);
		},
		[onChange],
	);

	return (
		<div className="space-y-1.5">
			<label className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			{pairs.length === 0 && (
				<p className="text-2xs text-pi-text-faint">No entries.</p>
			)}
			{pairs.map(([k, v], i) => (
				<div key={i} className="flex gap-2">
					<input
						type="text"
						value={k}
						onChange={(e) => {
							const next = [...pairs];
							next[i][0] = e.target.value;
							update(next);
						}}
						placeholder="KEY"
						className="min-w-0 flex-1 rounded-md bg-pi-bg px-2.5 py-1.5 font-mono text-2xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
					/>
					<input
						type="text"
						value={v}
						onChange={(e) => {
							const next = [...pairs];
							next[i][1] = e.target.value;
							update(next);
						}}
						placeholder="value"
						className="min-w-0 flex-1 rounded-md bg-pi-bg px-2.5 py-1.5 text-2xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none"
					/>
					<button
						type="button"
						onClick={() => update(pairs.filter((_, j) => j !== i))}
						className="flex h-7 w-7 items-center justify-center rounded text-pi-text-muted transition-hover hover:bg-pi-error-soft hover:text-pi-error"
					>
						<X className="h-3 w-3" />
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={() => update([...pairs, ["", ""]])}
				className="inline-flex h-6 items-center gap-1 rounded bg-pi-surface-overlay px-2 text-3xs font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
			>
				<Plus className="h-3 w-3" />
				Add
			</button>
		</div>
	);
}

/**
 * Preserves any additional JSON keys the user has set on an MCP server while
 * letting the form edit the common typed fields. The "Extra JSON" textarea
 * shows the object minus the keys already handled by the form.
 */
function RawJsonEditor({
	label,
	value,
	keysToOmit,
	onChange,
}: {
	label: string;
	value: Record<string, unknown>;
	keysToOmit: string[];
	onChange: (next: Record<string, unknown>) => void;
}) {
	const filtered = Object.fromEntries(Object.entries(value).filter(([k]) => !keysToOmit.includes(k)));
	const [text, setText] = useState(() => safeStringify(filtered));
	const [error, setError] = useState<string | null>(null);

	const commit = useCallback(
		(raw: string) => {
			setText(raw);
			try {
				const parsed = raw.trim() === "" ? {} : JSON.parse(raw);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					setError(null);
					onChange({ ...value, ...parsed });
				} else {
					setError("Must be an object");
				}
			} catch (e) {
				setError((e as Error).message);
			}
		},
		[value, onChange],
	);

	return (
		<div className="space-y-1">
			<label className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<textarea
				value={text}
				onChange={(e) => commit(e.target.value)}
				onBlur={() => commit(text)}
				rows={3}
				spellCheck={false}
				className={`w-full rounded-md bg-pi-bg p-2 font-mono text-2xs text-pi-text shadow-ring focus:shadow-focus focus:outline-none ${error ? "shadow-ring-error" : ""}`}
			/>
			{error && <p className="text-3xs text-pi-error">{error}</p>}
		</div>
	);
}

function safeStringify(value: unknown): string {
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "";
	}
}

function StatusBadge({ state }: { state: rpc.McpServerState | undefined }) {
	if (!state) {
		return <span className="rounded bg-pi-surface-overlay px-1.5 py-0.5 text-3xs text-pi-text-faint">unknown</span>;
	}

	if (state.status === "ok") {
		return (
			<span className="flex items-center gap-1 rounded bg-pi-success/15 px-1.5 py-0.5 text-3xs text-pi-success">
				<CheckCircle2 className="h-3 w-3" />
				{state.toolCount !== undefined ? `${state.toolCount} tools` : "connected"}
				{state.source === "project" && <span className="text-pi-text-faint">· project</span>}
			</span>
		);
	}

	if (state.authRequired) {
		return (
			<span
				className="flex items-center gap-1 rounded bg-pi-warning/15 px-1.5 py-0.5 text-3xs text-pi-warning"
				title="OAuth sign-in required"
			>
				<AlertTriangle className="h-3 w-3" />
				sign in
			</span>
		);
	}

	if (state.status === "error") {
		return (
			<span
				className="flex items-center gap-1 rounded bg-pi-error-soft px-1.5 py-0.5 text-3xs text-pi-error"
				title={state.error}
			>
				<AlertTriangle className="h-3 w-3" />
				error
			</span>
		);
	}

	if (state.status === "connecting") {
		return (
			<span className="flex items-center gap-1 rounded bg-pi-warning/15 px-1.5 py-0.5 text-3xs text-pi-warning">
				<Loader2 className="h-3 w-3 animate-spin" />
				connecting
			</span>
		);
	}

	return <span className="rounded bg-pi-surface-overlay px-1.5 py-0.5 text-3xs text-pi-text-muted">disabled</span>;
}
