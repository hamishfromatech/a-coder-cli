import { Plus, Server, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";

type McpTransport = "stdio" | "sse" | "http";

interface McpServerConfig {
	name?: string;
	transport?: McpTransport;
	commandOrUrl?: string;
	args?: string[];
	env?: Record<string, string>;
	headers?: Record<string, string>;
	disabled?: boolean;
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
	/**
	 * Extra keys that don't fit the typed shape are preserved verbatim so the
	 * cli's full MCP server config survives round-trips through the desktop UI.
	 */
	[key: string]: unknown;
}

interface Props {
	value: McpServerConfig[] | undefined;
	onChange: (next: McpServerConfig[] | undefined) => void;
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

export function McpServersEditor({ value, onChange }: Props) {
	const servers = value?.map(cliToUi) ?? [];
	const [expanded, setExpanded] = useState<number | null>(servers.length > 0 ? 0 : null);

	const emit = useCallback(
		(nextUi: McpServerUi[]) => {
			const nextCli = nextUi.map(uiToCli);
			onChange(nextCli.length ? nextCli : undefined);
		},
		[onChange],
	);

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
			{servers.length === 0 && (
				<p className="text-[11px] text-pi-text-muted">
					No MCP servers configured. Add one to let the AI talk to external
					tools and data sources.
				</p>
			)}

			{servers.map((server, idx) => (
				<div
					key={idx}
					className="overflow-hidden rounded-lg bg-pi-surface-raised shadow-[0_0_0_1px_var(--pi-border)]"
				>
					<button
						type="button"
						onClick={() => setExpanded((cur) => (cur === idx ? null : idx))}
						className="flex w-full items-center gap-3 px-3 py-2 text-left transition-hover hover:bg-pi-surface-overlay"
					>
						<Server className="h-3.5 w-3.5 text-pi-accent" />
						<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-pi-text">
							{server.name || `Server ${idx + 1}`}
						</span>
						{server.disabled && (
							<span className="rounded bg-pi-surface-overlay px-1.5 py-0.5 text-[10px] text-pi-text-muted">
								disabled
							</span>
						)}
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
					</button>

					{expanded === idx && (
						<div className="space-y-3 border-t border-pi-border px-3 py-3">
							<LabeledInput
								label="Name"
								value={server.name ?? ""}
								placeholder="e.g. chrome-devtools"
								onChange={(v) => updateServer(idx, { name: v })}
							/>

							<div className="grid grid-cols-2 gap-2">
								<LabeledSelect
									label="Transport"
									value={server.transport ?? inferTransport(server)}
									options={TRANSPORT_OPTIONS}
									onChange={(transport) => updateServer(idx, { transport })}
								/>
								<div className="flex items-end">
									<label className="flex cursor-pointer items-center gap-2 rounded-md bg-pi-bg px-2.5 py-2 shadow-[0_0_0_1px_var(--pi-border)]">
										<input
											type="checkbox"
											checked={!server.disabled}
											onChange={(e) =>
												updateServer(idx, { disabled: !e.target.checked })
											}
											className="h-3.5 w-3.5 accent-pi-accent"
										/>
										<span className="text-[11.5px] text-pi-text">Enabled</span>
									</label>
								</div>
							</div>

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
				</div>
			))}

			<button
				type="button"
				onClick={addServer}
				className="inline-flex h-7 items-center gap-1.5 rounded-md bg-pi-surface-overlay px-2.5 text-[11.5px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
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
			<label className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				spellCheck={false}
				autoComplete="off"
				className="w-full rounded-md bg-pi-bg px-2.5 py-1.5 text-[11.5px] text-pi-text placeholder:text-pi-text-faint shadow-[0_0_0_1px_var(--pi-border)] focus:shadow-focus focus:outline-none"
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
			<label className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as T)}
				className="w-full rounded-md bg-pi-bg px-2.5 py-1.5 text-[11.5px] text-pi-text shadow-[0_0_0_1px_var(--pi-border)] focus:shadow-focus focus:outline-none"
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
			<label className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<textarea
				value={text}
				placeholder={placeholder ?? "One entry per line"}
				onChange={(e) => commit(e.target.value)}
				rows={Math.max(2, Math.min(values.length + 1, 4))}
				spellCheck={false}
				className="w-full rounded-md bg-pi-bg p-2 font-mono text-[11px] text-pi-text placeholder:text-pi-text-faint shadow-[0_0_0_1px_var(--pi-border)] focus:shadow-focus focus:outline-none"
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
			<label className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			{pairs.length === 0 && (
				<p className="text-[11px] text-pi-text-faint">No entries.</p>
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
						className="min-w-0 flex-1 rounded-md bg-pi-bg px-2.5 py-1.5 font-mono text-[11px] text-pi-text shadow-[0_0_0_1px_var(--pi-border)] focus:shadow-focus focus:outline-none"
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
						className="min-w-0 flex-1 rounded-md bg-pi-bg px-2.5 py-1.5 text-[11px] text-pi-text shadow-[0_0_0_1px_var(--pi-border)] focus:shadow-focus focus:outline-none"
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
				className="inline-flex h-6 items-center gap-1 rounded bg-pi-surface-overlay px-2 text-[10.5px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
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
			<label className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<textarea
				value={text}
				onChange={(e) => commit(e.target.value)}
				onBlur={() => commit(text)}
				rows={3}
				spellCheck={false}
				className={`w-full rounded-md bg-pi-bg p-2 font-mono text-[11px] text-pi-text shadow-[0_0_0_1px_var(--pi-border)] focus:shadow-focus focus:outline-none ${error ? "shadow-[0_0_0_1px_var(--pi-error)]" : ""}`}
			/>
			{error && <p className="text-[10px] text-pi-error">{error}</p>}
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
