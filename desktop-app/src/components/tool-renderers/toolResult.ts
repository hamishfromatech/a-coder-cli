import type { ToolResultMessage } from "@earendil-works/pi-ai";

/**
 * Pure helpers for the tool card. Kept out of the component so the summary,
 * payload and verdict logic can be unit-tested without rendering.
 */

/** Text blocks of a tool result, joined. */
export function resultText(result: ToolResultMessage | undefined): string {
	if (!result) return "";
	return result.content
		.map((c) => (c.type === "text" ? c.text : ""))
		.join("")
		.trim();
}

export interface ResultImageRef {
	/** Inline base64 (contract-1 history and live results). */
	data?: string;
	mimeType?: string;
	/** Out-of-band ref (contract-2 history): fetch once, then reuse. */
	attachment?: { id: string; mimeType: string; bytes: number };
}

/**
 * Image blocks of a tool result. The RPC history path replaces inline base64
 * with an attachment ref, so both shapes are accepted here.
 */
export function resultImages(result: ToolResultMessage | undefined): ResultImageRef[] {
	if (!result) return [];
	const images: ResultImageRef[] = [];
	for (const block of result.content) {
		if (block.type !== "image") continue;
		const raw = block as unknown as {
			data?: unknown;
			mimeType?: unknown;
			bytes?: unknown;
			attachment?: { id?: unknown; mimeType?: unknown; bytes?: unknown };
		};
		const mimeType = typeof raw.mimeType === "string" ? raw.mimeType : "image/png";
		const attachment =
			raw.attachment && typeof raw.attachment.id === "string"
				? {
						id: raw.attachment.id,
						mimeType: typeof raw.attachment.mimeType === "string" ? raw.attachment.mimeType : mimeType,
						bytes: typeof raw.attachment.bytes === "number" ? raw.attachment.bytes : 0,
					}
				: undefined;
		const data = typeof raw.data === "string" && raw.data.length > 0 ? raw.data : undefined;
		if (!data && !attachment) continue;
		images.push({ ...(data ? { data, mimeType } : {}), ...(attachment ? { attachment } : {}) });
	}
	return images;
}

/** Pretty-printed payload when the result text is a JSON object/array. */
export function parseJsonPayload(text: string): { value: unknown; pretty: string } | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	const first = trimmed[0];
	if (first !== "{" && first !== "[") return null;
	try {
		const value: unknown = JSON.parse(trimmed);
		if (typeof value !== "object" || value === null) return null;
		return { value, pretty: JSON.stringify(value, null, 2) };
	} catch {
		return null;
	}
}

export type VerdictDecision = "done" | "verify_fresh_state" | "escalate";

export interface ToolVerdict {
	decision: VerdictDecision;
	hint?: string;
	code?: string;
}

function isVerdictDecision(value: unknown): value is VerdictDecision {
	return value === "done" || value === "verify_fresh_state" || value === "escalate";
}

/**
 * The `computer` tool's semantic verdict, from `details.verdict` or the JSON
 * payload. Null for tools that do not emit one.
 */
export function readToolVerdict(result: ToolResultMessage | undefined, payload: unknown): ToolVerdict | null {
	const details = result?.details as { verdict?: unknown } | undefined;
	const raw = details?.verdict ?? (payload as { verdict?: unknown } | null | undefined)?.verdict;
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	if (!isVerdictDecision(record.decision)) return null;
	return {
		decision: record.decision,
		...(typeof record.hint === "string" && record.hint ? { hint: record.hint } : {}),
		...(typeof record.code === "string" && record.code ? { code: record.code } : {}),
	};
}

export type ComputerResultTone = "success" | "warning" | "error" | "muted";

export interface ComputerResultSummary {
	label: string;
	detail?: string;
	tone: ComputerResultTone;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * Human-readable outcome for a `computer` card. Details carry the driver's
 * structured result; parseJsonPayload is the fallback for older sessions.
 */
export function summarizeComputerResult(
	result: ToolResultMessage | undefined,
	payload: unknown,
): ComputerResultSummary | null {
	if (!result) return null;
	const record = asRecord(result.details) ?? asRecord(payload);
	if (!record) return null;
	const action = stringArg(record, "action") ?? "computer";
	const rawApp = stringArg(record, "app");
	const app = rawApp ? truncate(rawApp, 80) : undefined;
	const verdict = readToolVerdict(result, payload);
	const rawCode = stringArg(record, "code");
	const code = rawCode ? truncate(rawCode, 40) : undefined;
	const error = stringArg(record, "error") ?? stringArg(record, "message");
	const hint = verdict?.hint ?? stringArg(record, "hint");
	const ok = result.isError !== true && record.ok !== false && !error;

	if (!ok) {
		const detail = [error, hint].filter(Boolean).join(" — ");
		return {
			label: code ? `Failed · ${truncate(code, 40)}` : "Failed",
			...(detail ? { detail: truncate(detail, 160) } : {}),
			tone: "error",
		};
	}
	if (verdict) {
		const decision = verdict.decision;
		const label = decision === "done" ? "Done" : decision === "escalate" ? "Escalate" : "Verify";
		return {
			label: app ? `${label} · ${app}` : label,
			...(hint ? { detail: truncate(hint, 160) } : {}),
			tone: decision === "done" ? "success" : decision === "escalate" ? "error" : "warning",
		};
	}

	switch (action) {
		case "capture": {
			const elements = numberArg(record, "elementCount") ?? 0;
			const mode = truncate(stringArg(record, "mode") ?? "som", 16).toUpperCase();
			const diff = record.diff === true || stringArg(record, "since") !== undefined;
			const degradedReason = stringArg(record, "degradedReason");
			const degraded = degradedReason ? truncate(degradedReason, 60) : undefined;
			return {
				label: `Captured ${app ?? "window"}`,
				detail: `${elements} ${diff ? "changed " : ""}element${elements === 1 ? "" : "s"} · ${mode}${diff ? " · diff" : ""}${degraded ? " · degraded" : ""}`,
				tone: degraded ? "warning" : "success",
			};
		}
		case "zoom": {
			const rect = computerRect(record.rect);
			return {
				label: "Native crop",
				detail: `${app ?? "window"}${rect ? ` · ${rect}` : ""}`,
				tone: "success",
			};
		}
		case "list_apps": {
			const count = numberArg(record, "count") ?? 0;
			return { label: `Listed ${count} app${count === 1 ? "" : "s"}`, tone: "success" };
		}
		case "list_windows": {
			const count = numberArg(record, "count") ?? 0;
			return { label: `Listed ${count} window${count === 1 ? "" : "s"}`, tone: "success" };
		}
		case "wait": {
			const seconds = numberArg(record, "seconds") ?? 1;
			return { label: `Waited ${seconds}s`, tone: "success" };
		}
		case "focus_app":
			return { label: `Focused ${app ?? "app"}`, tone: "success" };
		case "doctor":
			return { label: "Driver report", tone: "success" };
		default:
			return {
				label: "Delivered",
				...(app ? { detail: `${truncate(action, 40)} · ${app}` } : { detail: truncate(action, 40) }),
				tone: "success",
			};
	}
}

function sanitizeDisplay(value: string): string {
	return value
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b[@-_]/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function truncate(value: string, max: number): string {
	const oneLine = sanitizeDisplay(value).replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
	return typeof args[key] === "number" ? (args[key] as number) : undefined;
}

function computerTarget(action: string, args: Record<string, unknown>): string {
	const rawApp = stringArg(args, "app");
	const app = rawApp ? truncate(rawApp, 80) : undefined;
	const pid = numberArg(args, "pid");
	const windowId = numberArg(args, "window_id");
	let base = app;
	if (!base) {
		if (windowId !== undefined) base = `window ${windowId}`;
		else if (pid !== undefined) base = `pid ${pid}`;
		else base = action === "capture" ? "frontmost window" : "current window";
	}
	const parts = [base];
	if (app && windowId !== undefined) parts.push(`window ${windowId}`);
	else if (app && pid !== undefined) parts.push(`pid ${pid}`);
	else if (!app && windowId !== undefined && pid !== undefined) parts.push(`pid ${pid}`);
	return parts.join(" · ");
}

function computerPoint(value: unknown): string | undefined {
	return Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === "number" &&
		typeof value[1] === "number" &&
		Number.isFinite(value[0]) &&
		Number.isFinite(value[1])
		? `(${value[0]}, ${value[1]})`
		: undefined;
}

function computerRect(value: unknown): string | undefined {
	if (
		!Array.isArray(value) ||
		value.length < 4 ||
		value.slice(0, 4).some((part) => typeof part !== "number" || !Number.isFinite(part))
	) {
		return undefined;
	}
	return `(${value[0]}, ${value[1]}) → (${value[2]}, ${value[3]})`;
}

function quotedComputerText(value: string | undefined, max = 32): string | undefined {
	return value ? `"${truncate(value, max)}"` : undefined;
}

function summarizeComputerArgs(args: Record<string, unknown>): string {
	const action = stringArg(args, "action");
	if (!action) return "";
	const target = computerTarget(action, args);
	const element = numberArg(args, "element");
	const at = element !== undefined ? `#${element}` : computerPoint(args.coordinate);
	const delivery = stringArg(args, "delivery_mode") === "foreground" ? "foreground" : undefined;
	const after = args.capture_after === true ? "capture after" : undefined;
	const modifiers = Array.isArray(args.modifiers)
		? args.modifiers
				.filter((value): value is string => typeof value === "string" && value.length > 0)
				.map((value) => truncate(value, 12))
		: [];
	const details = (values: Array<string | undefined>): string => values.filter(Boolean).join(" · ");

	switch (action) {
		case "capture": {
			const mode = truncate(stringArg(args, "mode") ?? "som", 16).toUpperCase();
			return `capture ${target} · ${details([mode, args.since_last === true ? "diff" : undefined])}`;
		}
		case "click":
		case "double_click":
		case "right_click":
		case "middle_click": {
			const rawButton = stringArg(args, "button");
			const button = rawButton ? truncate(rawButton, 12) : undefined;
			const verb =
				action === "double_click"
					? "double-click"
					: action === "right_click"
						? "right-click"
						: action === "middle_click"
							? "middle-click"
							: button && button !== "left"
								? `${button}-click`
								: "click";
			const prefix = modifiers.length > 0 ? `${modifiers.join("+")}+${verb}` : verb;
			return `${prefix} ${target}${details([at, delivery, after]) ? ` · ${details([at, delivery, after])}` : ""}`;
		}
		case "drag": {
			const from = computerPoint(args.from_coordinate);
			const to = computerPoint(args.to_coordinate);
			return `drag ${target}${from && to ? ` · ${from} → ${to}` : ""}${details([delivery, after]) ? ` · ${details([delivery, after])}` : ""}`;
		}
		case "scroll": {
			const direction = truncate(stringArg(args, "direction") ?? "down", 12);
			const amount = numberArg(args, "amount") ?? 3;
			return `scroll ${target} · ${details([`${direction} ${amount}`, at, delivery, after])}`;
		}
		case "type": {
			const text = quotedComputerText(stringArg(args, "text"));
			return `type into ${target}${text ? ` · ${text}` : ""}${details([delivery, after]) ? ` · ${details([delivery, after])}` : ""}`;
		}
		case "key": {
			const keys = stringArg(args, "keys");
			return `press ${keys ? `${truncate(keys, 40)} ` : ""}in ${target}${details([delivery, after]) ? ` · ${details([delivery, after])}` : ""}`;
		}
		case "set_value": {
			const value = quotedComputerText(stringArg(args, "value"), 28);
			const targetText = element !== undefined ? `on ${target} · #${element}` : `on ${target}`;
			return `set ${value ?? "value"} ${targetText}${details([delivery, after]) ? ` · ${details([delivery, after])}` : ""}`;
		}
		case "focus_app":
			return `focus ${target}${args.raise_window === true ? " · raise window" : ""}`;
		case "zoom":
			return `zoom ${target} · ${details([computerRect(args.zoom_rect), "native crop"])}`;
		case "wait": {
			const seconds = numberArg(args, "seconds") ?? 1;
			return `wait ${seconds}s`;
		}
		case "list_apps":
			return "list apps";
		case "list_windows":
			return "list windows";
		case "doctor":
			return "doctor";
		default:
			return `${truncate(action, 32)} ${target}`;
	}
}

/** One-line human summary of a tool's arguments. */
export function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "bash":
			return stringArg(args, "command") ?? stringArg(args, "c") ?? "";
		case "read":
		case "write":
			return stringArg(args, "file_path") ?? stringArg(args, "path") ?? "";
		case "edit":
		case "str_replace_based_edit_tool":
		case "multi_edit": {
			const path = stringArg(args, "file_path") ?? stringArg(args, "path") ?? "";
			const edits = numberArg(args, "edits") ?? (Array.isArray(args.edits) ? (args.edits as unknown[]).length : undefined);
			return path ? (edits ? `${path} · ${edits} edit${edits === 1 ? "" : "s"}` : path) : "";
		}
		case "grep":
			return [stringArg(args, "pattern"), stringArg(args, "path")].filter(Boolean).join(" · ");
		case "find":
			return [stringArg(args, "pattern"), stringArg(args, "path")].filter(Boolean).join(" · ");
		case "ls":
			return stringArg(args, "path") ?? ".";
		case "todo":
			return Array.isArray(args.todos) ? `${(args.todos as unknown[]).length} tasks` : "";
		case "computer":
			return summarizeComputerArgs(args);
		default: {
			const firstKey = Object.keys(args)[0];
			if (!firstKey) return "";
			const value = args[firstKey];
			return typeof value === "string" ? value : `${firstKey}: ${JSON.stringify(value)}`;
		}
	}
}

/** Compact byte count for result metadata. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
