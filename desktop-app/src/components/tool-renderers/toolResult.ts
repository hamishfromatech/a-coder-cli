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

function truncate(value: string, max: number): string {
	const oneLine = value.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
	return typeof args[key] === "number" ? (args[key] as number) : undefined;
}

function coordArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return Array.isArray(value) && value.length > 0 ? value.join(",") : undefined;
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
		case "computer": {
			const action = stringArg(args, "action") ?? "computer";
			const app = stringArg(args, "app");
			const element = numberArg(args, "element");
			const coordinate = coordArg(args, "coordinate");
			const target = element !== undefined ? `#${element}` : coordinate;
			const text = stringArg(args, "text");
			const keys = stringArg(args, "keys");
			const rect = coordArg(args, "zoom_rect");
			switch (action) {
				case "capture":
					return ["capture", app, stringArg(args, "mode") ? `(${stringArg(args, "mode")})` : ""]
						.filter(Boolean)
						.join(" ");
				case "type":
					return ["type", text ? `"${truncate(text, 24)}"` : ""].filter(Boolean).join(" ");
				case "key":
					return ["key", keys].filter(Boolean).join(" ");
				case "zoom":
					return ["zoom", rect].filter(Boolean).join(" ");
				case "drag":
					return ["drag", coordArg(args, "from_coordinate"), coordArg(args, "to_coordinate")]
						.filter(Boolean)
						.join(" → ");
				case "set_value": {
					const value = stringArg(args, "value");
					return ["set_value", target, value ? `= "${truncate(value, 20)}"` : ""].filter(Boolean).join(" ");
				}
				case "focus_app":
					return ["focus", app].filter(Boolean).join(" ");
				default:
					return [action, target, !target ? app : undefined].filter(Boolean).join(" ");
			}
		}
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
