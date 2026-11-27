/**
 * The `computer` tool — desktop control via cua-driver (macOS/Windows/Linux).
 *
 * One consolidated tool with an `action` discriminator. Vision models should
 * capture (mode "som": screenshot with numbered element overlays + the
 * accessibility tree) and click by element index; pixel coordinates remain
 * supported. Input is background-first: it routes to the target window
 * without stealing the user's focus; `delivery_mode: "foreground"` is an
 * escalation with its own approval weight. Read actions (capture, list, wait)
 * are free; every input action goes through the normal permission flow like
 * a mutating tool.
 *
 * Safety: destructive system shortcuts (logout/lock/empty-trash) and
 * dangerous `type` payloads (curl|bash, sudo rm -rf, fork bombs) are
 * hard-blocked before approval. A sticky target guards input routing: input
 * always lands on the app from the last capture/focus, and a mismatched
 * `app` argument is refused instead of typing into the wrong window while
 * claiming success.
 */

import { createHash } from "node:crypto";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../utils/ansi.ts";
import type { ToolDefinition } from "../../extensions/types.ts";
import { getTextOutput } from "../render-utils.ts";
import { formatHeadline } from "../result-headline.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import {
	CuaDriverClient,
	type DriverInstallGuidance,
	getDriverInstallGuidance,
	resolveDriverCommand,
} from "./driver.ts";

// ---------------------------------------------------------------------------
// Schema (model-facing; keep stable — it rides every turn)
// ---------------------------------------------------------------------------

const computerSchema = Type.Object(
	{
		action: StringEnum(
			[
				"capture",
				"click",
				"double_click",
				"right_click",
				"middle_click",
				"drag",
				"scroll",
				"type",
				"key",
				"set_value",
				"zoom",
				"wait",
				"list_apps",
				"list_windows",
				"focus_app",
				"doctor",
			],
			{
				description:
					"Which action to perform. capture (free, no side effects) returns a screenshot plus interactable elements; prefer clicking elements by index over pixel coordinates. zoom (free) crops a region of the last capture at native resolution for reading small text. doctor (free) reports driver health + TCC grants. All other actions except list/wait/focus/zoom/doctor require approval.",
			},
		),
		mode: Type.Optional(
			StringEnum(["som", "vision", "ax"], {
				description:
					"Capture mode: som (default) = screenshot with numbered overlays + element list; vision = plain screenshot; ax = accessibility tree only, no image.",
			}),
		),
		app: Type.Optional(
			Type.String({
				description: "Optional app name or bundle id to target (e.g. 'Safari'). Omitted = frontmost window.",
			}),
		),
		pid: Type.Optional(Type.Number({ description: "Optional exact process id for capture (pair with window_id)." })),
		window_id: Type.Optional(
			Type.Number({ description: "Optional exact native window id for capture (pair with pid)." }),
		),
		element: Type.Optional(
			Type.Number({ description: "Element index from the last capture — preferred over pixel coordinates." }),
		),
		coordinate: Type.Optional(
			Type.Array(Type.Number(), {
				minItems: 2,
				maxItems: 2,
				description: "Pixel [x, y] in the captured screenshot. Use only when no element index is available.",
			}),
		),
		button: Type.Optional(StringEnum(["left", "right", "middle"], { description: "Mouse button (default left)." })),
		modifiers: Type.Optional(
			Type.Array(Type.String(), { description: "Modifier keys held during the action (e.g. ['cmd', 'shift'])." }),
		),
		from_coordinate: Type.Optional(
			Type.Array(Type.Number(), { minItems: 2, maxItems: 2, description: "Drag source [x, y]." }),
		),
		to_coordinate: Type.Optional(
			Type.Array(Type.Number(), { minItems: 2, maxItems: 2, description: "Drag target [x, y]." }),
		),
		direction: Type.Optional(
			StringEnum(["up", "down", "left", "right"], { description: "Scroll direction (default down)." }),
		),
		amount: Type.Optional(Type.Number({ description: "Scroll wheel ticks (default 3, max 50)." })),
		value: Type.Optional(
			Type.String({
				description:
					"For set_value: the option label (dropdowns) or value (sliders/text fields) to set on the element.",
			}),
		),
		text: Type.Optional(Type.String({ description: "Text to type (action='type')." })),
		delay_ms: Type.Optional(
			Type.Number({
				description:
					"type only: milliseconds between characters (Linux, 0–200) for debounced search boxes and autocomplete.",
			}),
		),
		keys: Type.Optional(
			Type.String({ description: "Key or combo, e.g. 'return', 'escape', 'cmd+s'. Use '+' to combine a chord." }),
		),
		seconds: Type.Optional(Type.Number({ description: "wait: seconds to pause (max 30, default 1)." })),
		raise_window: Type.Optional(
			Type.Boolean({
				description:
					"focus_app only: bring the window to front. Disruptive — default false (input routes without raising).",
			}),
		),
		delivery_mode: Type.Optional(
			StringEnum(["background", "foreground"], {
				description:
					"Input actions: background (default) delivers without raising or stealing focus; foreground briefly fronts the window — a visible change. Use it only when a result's verdict recommends escalating.",
			}),
		),
		capture_after: Type.Optional(
			Type.Boolean({
				description:
					"Take a follow-up capture after a successful input action (saves a round-trip when verifying an effect).",
			}),
		),
		since_last: Type.Optional(
			Type.Boolean({
				description:
					"capture only: ask the driver for a diff since the previous snapshot of this window (changed elements only). A diff is for checking what changed — re-capture without this before clicking an element that is not listed.",
			}),
		),
		zoom_rect: Type.Optional(
			Type.Array(Type.Number(), {
				minItems: 4,
				maxItems: 4,
				description:
					"zoom: region [x1, y1, x2, y2] in the captured screenshot's pixels (top-left, bottom-right). Max 500px wide; the driver adds 20% padding.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type ComputerToolInput = Static<typeof computerSchema>;

// ---------------------------------------------------------------------------
// Hard blocks (pre-approval, model-agnostic)
// ---------------------------------------------------------------------------

const KEY_ALIASES: Record<string, string> = {
	command: "cmd",
	control: "ctrl",
	option: "alt",
	"⌘": "cmd",
	"⌥": "alt",
	windows: "super",
	win: "super",
	super: "super",
	meta: "super",
};
const MODIFIER_KEYS = new Set(["cmd", "ctrl", "alt", "shift", "super", "fn"]);

/** Destructive system shortcuts, hard-blocked regardless of approval level. */
const BLOCKED_KEY_COMBOS: ReadonlySet<string> = new Set(
	[
		["cmd", "shift", "backspace"], // empty trash
		["cmd", "alt", "backspace"], // force delete
		["cmd", "ctrl", "q"], // log out
		["cmd", "shift", "q"], // log out (macOS)
		["cmd", "alt", "shift", "q"], // force log out
		["super", "l"], // lock screen (Linux / Windows)
		["ctrl", "alt", "delete"], // force quit dialog / log out
		["alt", "f4"], // close app / shutdown dialog
	].map((combo) => [...combo].sort().join("+")),
);

interface ParsedKeyCombo {
	mods: string[];
	key: string;
}

/** Parse a combo without sorting so the non-modifier key cannot be mistaken for one. */
function parseKeyCombo(keys: string): ParsedKeyCombo | null {
	const parts = keys
		.split(/[+-]/)
		.map((part) => KEY_ALIASES[part.trim().toLowerCase()] ?? part.trim().toLowerCase())
		.filter((part) => part.length > 0);
	const mods = parts.filter((part) => MODIFIER_KEYS.has(part));
	const nonModifiers = parts.filter((part) => !MODIFIER_KEYS.has(part));
	if (nonModifiers.length !== 1) return null;
	return { mods, key: nonModifiers[0] };
}

/** Canonicalize a key combo for comparison: aliases resolved, split on + AND -, sorted. */
export function canonKeyCombo(keys: string): string[] {
	const parsed = parseKeyCombo(keys);
	return parsed ? [...parsed.mods, parsed.key].sort() : [];
}

/** Translate canonical modifiers to the connected platform's driver vocabulary. */
function driverModifiers(mods: string[]): string[] {
	return mods.map((mod) => {
		if (mod === "alt") return process.platform === "darwin" ? "option" : "alt";
		if (mod === "super") {
			return process.platform === "win32" ? "win" : process.platform === "darwin" ? "cmd" : "super";
		}
		// Linux has no Command key. Command-style agents on Linux conventionally
		// mean Super; on Windows they mean Ctrl.
		if (mod === "cmd") {
			return process.platform === "linux" ? "super" : process.platform === "win32" ? "ctrl" : "cmd";
		}
		return mod;
	});
}

const BLOCKED_TYPE_PATTERNS = [
	{ pattern: /curl\s+[^|]*\|\s*(bash|sh)/i, label: "pipe-to-shell" },
	{ pattern: /wget\s+[^|]*\|\s*(bash|sh)/i, label: "pipe-to-shell" },
	{ pattern: /\bsudo\s+rm\s+-[rf]/i, label: "sudo rm" },
	{ pattern: /\brm\s+-rf\s+\/\s*$/i, label: "rm -rf /" },
	{ pattern: /:\s*\(\)\s*\{\s*:\|:\s*&\s*\}/, label: "fork bomb" },
];

/** JSON error string for hard-blocked input, else null. Runs BEFORE approval. */
export function rejectUnsafe(action: string, args: ComputerToolInput): string | null {
	if (action === "type" && typeof args.text === "string") {
		for (const { pattern, label } of BLOCKED_TYPE_PATTERNS) {
			if (pattern.test(args.text)) {
				return JSON.stringify({
					error: `blocked pattern in type text: ${label}`,
					hint: "Dangerous shell patterns cannot be typed via computer.",
				});
			}
		}
	}
	if (action === "key" && typeof args.keys === "string") {
		const combo = canonKeyCombo(args.keys).join("+");
		if (combo && BLOCKED_KEY_COMBOS.has(combo)) {
			return JSON.stringify({
				error: `blocked key combo: ${combo}`,
				hint: "Destructive system shortcuts are hard-blocked.",
			});
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Action classification
// ---------------------------------------------------------------------------

/** Actions that deliver native input (or visibly change focus) — approval-weighted. */
export const COMPUTER_INPUT_ACTIONS: ReadonlySet<string> = new Set([
	"click",
	"double_click",
	"right_click",
	"middle_click",
	"drag",
	"scroll",
	"type",
	"key",
	"set_value",
	"focus_app",
]);

/** Default accessibility-walk bound (driver-side `max_elements`). */
const MAX_AX_ELEMENTS = 200;
/**
 * AX-walk budget for a capture. The driver defaults to 1000 ms (2000 ms cold
 * start), which truncates a MAX_AX_ELEMENTS walk on large apps; the tree is
 * bounded anyway, so the wider budget only buys completeness.
 */
const AX_WALK_TIMEOUT_MS = 2_000;
/** Cap on the element list surfaced in the response (dense UIs exceed context). */
const MAX_VISIBLE_ELEMENTS = 100;
/** What a degraded snapshot means for the next step (driver `degraded_reason`). */
const DEGRADED_HINTS: Record<string, string> = {
	ax_window_unresolved:
		"the accessibility window could not be resolved — retry, or capture with mode='vision' for pixels only.",
	ax_app_launching: "the app is still launching — wait a moment and capture again.",
	screen_locked: "the screen is locked — nothing can be clicked until it is unlocked.",
	px_frame_mismatch: "the pixel frame does not match the tree — capture again before using coordinates.",
	px_capture_unavailable:
		"pixel capture failed (check Screen Recording permission); the element list may still be usable.",
};

// ---------------------------------------------------------------------------
// Session-cached driver + sticky target
// ---------------------------------------------------------------------------

interface UiElement {
	index: number;
	role: string;
	label: string;
	/** Screen coordinates (the driver's `frame`), not screenshot pixels. */
	frame: { x: number; y: number; w: number; h: number } | null;
	/** The same box in the delivered PNG's pixels — the only space x/y accepts. */
	screenshotFrame: { x: number; y: number; w: number; h: number } | null;
	token: string | null;
}

interface WindowEntry {
	app_name: string;
	pid: number;
	window_id: number;
	title: string;
	z_index: number;
	off_screen: boolean;
}

let cachedClient: CuaDriverClient | null = null;
let stickyTarget: { pid: number; window_id: number | null; app: string } | null = null;
let snapshotTokens = new Map<number, string>();
/** Last snapshot published for `lastSnapshotTarget`, for `since` diffs and zoom context. */
let lastSnapshotId: string | null = null;
let lastSnapshotTarget = "";
/**
 * Capture the next coordinate action may be admitted against (`capture_id`).
 * Scoped to the target it was taken from and consumed by the first action.
 */
let captureBinding: { key: string; id: string } | null = null;
/**
 * Tree revision from the latest `get_window_state` for this target. Element
 * actions send it back so the driver can refuse a tree that changed after the
 * read, before any input is delivered.
 */
let treeRevisionBinding: { key: string; revision: number } | null = null;
/** Target key whose pixels came from a `zoom` crop (coordinate actions set `from_zoom`). */
let zoomActiveFor = "";

// Screenshot dedup: a tight capture→act→capture loop on a static screen resends the
// same image every step. When a capture of the SAME target (app, window) returns
// bytes identical to the last DELIVERED frame, the image block is omitted in favor
// of an explicit "screen unchanged" note. Append-only (no transcript rewriting),
// and bounded by a streak cap so full pixels are re-delivered after at most
// MAX_UNCHANGED_STREAK consecutive omissions.
let lastCaptureDigest: string | null = null;
let lastCaptureTarget = "";
let unchangedStreak = 0;
const MAX_UNCHANGED_STREAK = 2;

function getClient(): CuaDriverClient {
	cachedClient ??= new CuaDriverClient();
	return cachedClient;
}

function clearTarget(): void {
	stickyTarget = null;
	snapshotTokens = new Map();
	lastSnapshotId = null;
	captureBinding = null;
	treeRevisionBinding = null;
	lastSnapshotTarget = "";
	zoomActiveFor = "";
	lastCaptureDigest = null;
	lastCaptureTarget = "";
	unchangedStreak = 0;
}

function targetKeyOf(target: { pid: number; window_id: number | null }): string {
	return `${target.pid}:${target.window_id}`;
}

/**
 * Per-call target. Current drivers prefer `target: {kind, pid, window_id}` and
 * reject it combined with legacy `pid`/`window_id`; older schemas do not
 * advertise it, so the legacy flat form stays the fallback.
 */
function targetArgs(
	client: CuaDriverClient,
	tool: string,
	target: { pid: number; window_id: number | null },
): Record<string, unknown> {
	if (target.window_id !== null && client.supportsInputProperty(tool, "target")) {
		return { target: { kind: "window", pid: target.pid, window_id: target.window_id } };
	}
	return { pid: target.pid, ...(target.window_id !== null ? { window_id: target.window_id } : {}) };
}

function positiveInt(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseRect(raw: unknown): { x: number; y: number; w: number; h: number } | null {
	if (typeof raw !== "object" || raw === null) {
		return null;
	}
	const f = raw as Record<string, unknown>;
	const num = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
	return { x: num(f.x), y: num(f.y), w: num(f.w), h: num(f.h) };
}

function parseElements(raw: unknown): UiElement[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const elements: UiElement[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) {
			continue;
		}
		const index = positiveInt((entry as Record<string, unknown>).element_index);
		if (index === null) {
			continue;
		}
		const rec = entry as Record<string, unknown>;
		const role = typeof rec.role === "string" ? rec.role : "";
		const label = typeof rec.label === "string" ? rec.label : "";
		const token = typeof rec.element_token === "string" && rec.element_token ? rec.element_token : null;
		elements.push({
			index,
			role,
			label,
			frame: parseRect(rec.frame),
			screenshotFrame: parseRect(rec.screenshot_frame),
			token,
		});
	}
	return elements;
}

function parseWindows(raw: unknown): WindowEntry[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const windows: WindowEntry[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) {
			continue;
		}
		const rec = entry as Record<string, unknown>;
		const pid = positiveInt(rec.pid);
		const windowId = positiveInt(rec.window_id);
		if (pid === null || windowId === null) {
			continue;
		}
		windows.push({
			app_name: typeof rec.app_name === "string" ? rec.app_name : "",
			pid,
			window_id: windowId,
			title: typeof rec.title === "string" ? rec.title : "",
			z_index: typeof rec.z_index === "number" ? rec.z_index : 0,
			off_screen: rec.is_on_screen === false,
		});
	}
	return windows.sort((a, b) => b.z_index - a.z_index); // frontmost first
}

// ---------------------------------------------------------------------------
// Verdict classification (semantic ladder for the model)
// ---------------------------------------------------------------------------

interface Verdict {
	decision: "done" | "verify_fresh_state" | "escalate";
	hint?: string;
	code?: string;
}

function classifyVerdict(result: {
	isError: boolean;
	structured: Record<string, unknown> | null;
	message?: string;
}): Verdict {
	const structured = result.structured ?? {};
	if (result.isError) {
		const code = typeof structured.code === "string" ? structured.code : "";
		if (code.endsWith("outcome_unknown")) {
			return {
				decision: "escalate",
				hint: "The action's outcome is unknown — it may have landed. Capture fresh state before any retry; do not repeat the input.",
			};
		}
		if (code === "background_unavailable") {
			return {
				decision: "escalate",
				code,
				hint: "Background delivery could not land on this target (occluded, or a surface that drops posted events). Nothing was executed — re-issue the same action with delivery_mode: 'foreground' (separate approval), then capture to verify.",
			};
		}
		if (code === "stale_element_token") {
			return {
				decision: "verify_fresh_state",
				code,
				hint: "The element token is stale — a newer snapshot replaced it. Capture again and use the new element index/token.",
			};
		}
		if (code === "stale_revision") {
			return {
				decision: "verify_fresh_state",
				code,
				hint: "The accessibility tree changed since this action was planned, so the driver refused before sending input. Capture again and re-plan.",
			};
		}
		if (code === "session_owned_by_other_transport") {
			const owner =
				typeof structured.owner_transport === "string" ? structured.owner_transport : "another transport";
			return {
				decision: "verify_fresh_state",
				code,
				hint: `Another driver connection (${owner}) holds this session label, so nothing was executed. Close that connection or retry once it is released.`,
			};
		}
		if (code === "ambiguous_window_target") {
			const candidates = Array.isArray(structured.candidates) ? structured.candidates : null;
			return {
				decision: "verify_fresh_state",
				code,
				hint: `The pid owns several windows, so no input was sent.${candidates ? ` Candidates: ${JSON.stringify(candidates)}.` : ""} Retry with an exact window_id from list_windows.`,
			};
		}
		if (
			code === "window_id_not_found" ||
			code === "window_target_not_found" ||
			code === "window_owner_pid_mismatch"
		) {
			return {
				decision: "verify_fresh_state",
				code,
				hint: "The target window is gone or belongs to a different pid. Call list_windows, then capture the window again before acting.",
			};
		}
		if (code === "screenshot_context_missing") {
			return {
				decision: "verify_fresh_state",
				code,
				hint: "No current screenshot for this window in the session, so the driver refused. Capture the window, then retry the coordinate action (or the zoom).",
			};
		}
		if (code === "zoom_context_missing") {
			return {
				decision: "verify_fresh_state",
				code,
				hint: "The zoom this action referred to was replaced. Capture, then zoom again before clicking inside the crop.",
			};
		}
		// Explicit refusals execute nothing, so no capture is needed before choosing
		// another approach.
		if (structured.effect === "refused") {
			return {
				decision: "verify_fresh_state",
				...(code ? { code } : {}),
				hint: "The driver refused before executing, so nothing changed. Capture to confirm state, then choose another approach.",
			};
		}
		// Driver-side authorization refusals happen BEFORE execution (no side
		// effects, no capture needed) — explain the mode boundary instead.
		const message = result.message ?? "";
		if (/no reviewed risk classification/.test(message)) {
			return {
				decision: "verify_fresh_state",
				code: "driver_permission_refused",
				hint: "The driver's permission mode refuses this tool (no reviewed risk classification in standard mode). Nothing was executed; run the driver with a permission mode that allows it, or use a different approach.",
			};
		}
		if (/outside the capability manifest/.test(message)) {
			return {
				decision: "verify_fresh_state",
				code: "driver_permission_refused",
				hint: "The driver runs in bounded mode and this tool is outside its capability manifest. Nothing was executed; widen the manifest or use an allowed tool.",
			};
		}
		if (/unbounded_operation_requires_unrestricted|requires unrestricted/.test(message)) {
			return {
				decision: "verify_fresh_state",
				code: "driver_permission_refused",
				hint: "This operation is unbounded and requires the driver to run in unrestricted mode (trusted launch-time risk acceptance). Nothing was executed.",
			};
		}
		return {
			decision: "verify_fresh_state",
			hint: "The action failed. Capture to see the current state, then choose a different approach.",
		};
	}
	const effect = typeof structured.effect === "string" ? structured.effect : "";
	if (effect === "confirmed" || structured.verified === true) {
		return { decision: "done" };
	}
	if (effect === "suspected_noop") {
		return {
			decision: "escalate",
			hint: "The input likely did not land. Re-capture and retry by pixel coordinate, or escalate delivery_mode to 'foreground' (separate approval).",
		};
	}
	return {
		decision: "verify_fresh_state",
		hint: "Input was delivered but not confirmed. Re-capture and check the result BEFORE any retry — do not repeat confirmed input.",
	};
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

function elementLine(element: UiElement): string {
	const label = element.label.replace(/\s+/g, " ").slice(0, 60);
	// `frame` is screen coordinates; only `screenshot_frame` may be handed back
	// as a coordinate, so prefer it and label the fallback so it is not copied.
	const box = element.screenshotFrame ?? element.frame;
	const where = box
		? ` @ ${box.x},${box.y} ${box.w}x${box.h} ${element.screenshotFrame ? "px" : "screen-px"}`
		: " @ bounds-unknown";
	return `  #${element.index} ${element.role} ${JSON.stringify(label)}${where}`;
}

function actionPayload(
	action: string,
	result: { isError: boolean; structured: Record<string, unknown> | null; message: string },
): Record<string, unknown> {
	return {
		ok: !result.isError,
		action,
		...(result.message ? { message: result.message } : {}),
		...(result.structured ?? {}),
		verdict: classifyVerdict(result),
	};
}

// ---------------------------------------------------------------------------
// Capture + dispatch
// ---------------------------------------------------------------------------

async function resolveTarget(
	client: CuaDriverClient,
	args: ComputerToolInput,
): Promise<{ target: { pid: number; window_id: number | null; app: string } | null; error?: string }> {
	const pid = positiveInt(args.pid);
	const windowId = positiveInt(args.window_id);
	if (pid !== null) {
		return { target: { pid, window_id: windowId, app: args.app ?? "" } };
	}
	const listing = await client.callTool("list_windows", {});
	if (listing.isError) {
		return { target: null, error: `list_windows failed: ${listing.message}` };
	}
	const rawWindows = (listing.structured ?? {}) as { windows?: unknown; data?: { windows?: unknown } };
	const windows = parseWindows(rawWindows.windows ?? rawWindows.data?.windows);
	const onScreen = windows.filter((w) => !w.off_screen);
	if (onScreen.length === 0) {
		return {
			target: null,
			error: "No on-screen windows found. Call list_apps to see available app names, or run the computer-use doctor for display reachability.",
		};
	}
	if (args.app) {
		const wanted = args.app.trim().toLowerCase();
		const matches = onScreen.filter(
			(w) => w.app_name.toLowerCase().includes(wanted) || wanted.includes(w.app_name.toLowerCase()),
		);
		if (matches.length === 0) {
			return {
				target: null,
				error: `No on-screen window matched app=${JSON.stringify(args.app)}; call list_windows to see available app names (macOS may report localized names).`,
			};
		}
		const match = matches[0];
		return { target: { pid: match.pid, window_id: match.window_id, app: match.app_name } };
	}
	const frontmost = onScreen[0];
	return { target: { pid: frontmost.pid, window_id: frontmost.window_id, app: frontmost.app_name } };
}

async function doCapture(args: ComputerToolInput): Promise<AgentToolResult<Record<string, unknown>>> {
	const mode = args.mode ?? "som";
	const client = getClient();
	const { target, error } = await resolveTarget(client, args);
	if (!target) {
		return textResult({ ok: false, action: "capture", error });
	}
	const callArgs: Record<string, unknown> = { pid: target.pid };
	if (target.window_id !== null) {
		callArgs.window_id = target.window_id;
	}
	// Current cua-driver returns the structured element list only when asked: its
	// default `tree_format: "markdown"` carries no `elements`, which would leave
	// click-by-index with nothing to target. Older builds do not advertise these
	// properties, so each one is gated on the live schema.
	const supports = (property: string) => client.supportsInputProperty("get_window_state", property);
	if (supports("tree_format")) callArgs.tree_format = "elements";
	if (supports("max_elements")) callArgs.max_elements = MAX_AX_ELEMENTS;
	if (supports("timeout_ms")) callArgs.timeout_ms = AX_WALK_TIMEOUT_MS;
	if (supports("include_screenshot")) callArgs.include_screenshot = mode !== "ax";
	if (mode === "vision" && supports("include_accessibility_tree")) callArgs.include_accessibility_tree = false;
	// `since` returns only what changed since a previous snapshot of this window.
	// It needs that snapshot to still be the one this tool published.
	const key = targetKeyOf(target);
	const diffSince =
		args.since_last === true && lastSnapshotTarget === key && lastSnapshotId !== null && supports("since")
			? lastSnapshotId
			: null;
	if (diffSince) callArgs.since = diffSince;
	let result = await client.callTool("get_window_state", callArgs);
	if (result.isError && !result.images.length) {
		return textResult(actionPayload("capture", result));
	}
	// The standalone screenshot fallback below drops structuredContent, so read
	// the capture handle from the window-state result that actually produced it.
	let captureId = typeof result.structured?.capture_id === "string" ? result.structured.capture_id : null;
	const rawRevision = result.structured?.ui_tree_revision;
	const treeRevision =
		typeof rawRevision === "number" && Number.isInteger(rawRevision) && rawRevision >= 0 ? rawRevision : null;
	// vision: pixels only — prefer the cheaper standalone screenshot tool when advertised.
	// That image is a different capture, so it must not inherit the window-state
	// capture id: coordinates read from it would be admitted against the wrong PNG.
	if (mode === "vision" && client.hasTool("screenshot")) {
		const shot = await client.callTool("screenshot", { window_id: target.window_id, format: "jpeg", quality: 85 });
		if (!shot.isError && shot.images.length > 0) {
			result = shot;
			captureId = null;
		}
	}
	// Sticky target + snapshot tokens are set by ANY successful capture. A diff
	// does not re-list unchanged rows, so it merges into the existing token map
	// instead of replacing it.
	stickyTarget = target;
	zoomActiveFor = "";
	// Bind the next coordinate action to this exact capture: the driver admits
	// x/y against that PNG and refuses stale/mismatched points before dispatch.
	captureBinding = captureId ? { key, id: captureId } : null;
	treeRevisionBinding = treeRevision !== null ? { key, revision: treeRevision } : null;
	const elements = mode === "vision" ? [] : parseElements(result.structured?.elements);
	if (!diffSince) snapshotTokens = new Map();
	for (const element of elements) {
		if (element.token) {
			snapshotTokens.set(element.index, element.token);
		}
	}
	const visible = elements.slice(0, MAX_VISIBLE_ELEMENTS);
	const image = result.images[0];
	const truncated = elements.length - visible.length;
	const structured = result.structured ?? {};
	const snapshotId = typeof structured.snapshot_id === "string" ? structured.snapshot_id : null;
	const degradedReason = typeof structured.degraded_reason === "string" ? structured.degraded_reason : null;
	// `truncated` is the legacy flag; `elements_complete:false` is the explicit
	// "this tree is partial" claim (with a reason) on current builds.
	const treePartial = structured.truncated === true || structured.elements_complete === false;
	const truncationReason = typeof structured.truncation_reason === "string" ? structured.truncation_reason : null;
	const sinceStatus = typeof structured.since_status === "string" ? structured.since_status : null;
	if (snapshotId) {
		lastSnapshotId = snapshotId;
		lastSnapshotTarget = key;
	}
	// Dedup gate: omit the image when this frame is byte-identical to the last
	// delivered one for the same target and the omission streak is under cap.
	let omittedAsUnchanged = false;
	const targetKey = `${target.pid}:${target.window_id}`;
	if (image && mode !== "ax") {
		const digest = createHash("sha256").update(`${image.mimeType}:${image.data}`).digest("hex");
		if (digest === lastCaptureDigest && targetKey === lastCaptureTarget && unchangedStreak < MAX_UNCHANGED_STREAK) {
			unchangedStreak += 1;
			omittedAsUnchanged = true;
		} else {
			lastCaptureDigest = digest;
			lastCaptureTarget = targetKey;
			unchangedStreak = 0;
		}
	}
	const lines = [
		`capture mode=${mode} app=${JSON.stringify(target.app || "frontmost")}${diffSince ? ` diff-since=${diffSince}` : ""}`,
		`${elements.length} interactable element(s):`,
		...visible.map(elementLine),
	];
	if (diffSince) {
		lines.push(
			`diff: only changed rows are listed${sinceStatus ? ` (since_status=${sinceStatus})` : ""}. The driver publishes a new snapshot with this read, so tokens from the previous one are stale — re-capture without since_last before clicking an element that is not listed here.`,
		);
	}
	if (truncated > 0) {
		lines.push(`  (+${truncated} more; pass app= to narrow)`);
	}
	if (treePartial) {
		lines.push(
			`note: the element tree is partial${truncationReason ? ` (${truncationReason})` : ` at max_elements=${MAX_AX_ELEMENTS}`} — element indices are incomplete; narrow with app=/window_id, or capture mode='vision' for pixels only.`,
		);
	}
	if (degradedReason) {
		lines.push(
			`warning: degraded snapshot (${degradedReason}) — ${DEGRADED_HINTS[degradedReason] ?? "the view may be incomplete; verify before acting."}`,
		);
	}
	if (omittedAsUnchanged) {
		lines.push(
			`screen unchanged (${unchangedStreak === 1 ? "identical" : `identical for the ${unchangedStreak}th consecutive capture`}) — image omitted to save context; element indices and tokens above are still current.`,
		);
	}
	if (mode === "ax") {
		lines.push("(ax mode: tree only — no image; element indices still work for input actions)");
	}
	const content: AgentToolResult<Record<string, unknown>>["content"] = [{ type: "text", text: lines.join("\n") }];
	if (image && mode !== "ax" && !omittedAsUnchanged) {
		content.push({ type: "image", data: image.data, mimeType: image.mimeType });
	}
	return {
		content,
		details: {
			action: "capture",
			mode,
			app: target.app,
			pid: target.pid,
			windowId: target.window_id,
			elementCount: elements.length,
			...(snapshotId ? { snapshotId } : {}),
			...(diffSince ? { since: diffSince, diff: true } : {}),
			...(degradedReason ? { degradedReason } : {}),
		},
	};
}

async function doList(kind: "apps" | "windows"): Promise<AgentToolResult<Record<string, unknown>>> {
	const tool = kind === "apps" ? "list_apps" : "list_windows";
	const result = await getClient().callTool(tool, {});
	if (result.isError) {
		return textResult(actionPayload(tool, result));
	}
	const raw = (result.structured ?? {}) as {
		apps?: unknown;
		windows?: unknown;
		data?: { apps?: unknown; windows?: unknown };
	};
	const payload = raw[kind] ?? raw.data?.[kind] ?? [];
	return textResult({ ok: true, action: tool, [kind]: payload, count: Array.isArray(payload) ? payload.length : 0 });
}

/**
 * Read-only self-diagnosis: driver health_report when the connected build
 * advertises it (schema_version 1 contract), with a minimal fallback from
 * check_permissions. No input actions, no capture — safe to run any time.
 */
async function doDoctor(): Promise<AgentToolResult<Record<string, unknown>>> {
	const client = getClient();
	// hasTool reads the discovery map, which is populated on first connect —
	// doctor may be the very first call of the session, so start explicitly.
	await client.start();
	if (client.hasTool("health_report")) {
		const result = await client.callTool("health_report", {});
		if (result.isError) {
			return textResult(actionPayload("doctor", result));
		}
		const sc = (result.structured ?? {}) as {
			driver_version?: string;
			overall?: string;
			checks?: Array<{ name: string; status: string; message?: string; hint?: string }>;
		};
		const lines = [
			`doctor overall=${sc.overall ?? "unknown"} driver=${sc.driver_version ?? "?"}`,
			...(sc.checks ?? []).map(
				(c) =>
					`  [${c.status}] ${c.name}${c.message ? ` — ${c.message}` : ""}${c.hint ? `\n         hint: ${c.hint}` : ""}`,
			),
		];
		return textResult({
			ok: sc.overall === "ok",
			action: "doctor",
			overall: sc.overall,
			driverVersion: sc.driver_version,
			checks: sc.checks,
			message: lines.join("\n"),
		});
	}
	// Older builds: assemble a minimal report from what they do advertise.
	if (client.hasTool("check_permissions")) {
		const perms = await client.callTool("check_permissions", { prompt: false });
		const sc = (perms.structured ?? {}) as {
			accessibility?: boolean;
			screen_recording?: boolean;
			source?: string;
		};
		const lines = [
			"doctor overall=degraded driver=<pre-health_report build>",
			`  [${sc.accessibility ? "pass" : "fail"}] tcc_accessibility`,
			`  [${sc.screen_recording ? "pass" : "fail"}] tcc_screen_recording`,
			...(sc.source ? [`  (reported by ${sc.source})`] : []),
		];
		return textResult({
			ok: sc.accessibility === true && sc.screen_recording === true,
			action: "doctor",
			checks: [
				{ name: "tcc_accessibility", status: sc.accessibility ? "pass" : "fail" },
				{ name: "tcc_screen_recording", status: sc.screen_recording ? "pass" : "fail" },
			],
			message: lines.join("\n"),
		});
	}
	return textResult({
		ok: false,
		action: "doctor",
		error: "The connected cua-driver advertises neither health_report nor check_permissions; cannot self-diagnose.",
	});
}

/**
 * Crop a region of the last capture at native resolution (driver `zoom`).
 * Free and read-only: it publishes no new snapshot, so element tokens stay
 * valid. A coordinate action after a zoom sets `from_zoom` so the driver
 * translates the point back into window space.
 */
async function doZoom(args: ComputerToolInput): Promise<AgentToolResult<Record<string, unknown>>> {
	const client = getClient();
	if (!stickyTarget) {
		return textResult({
			ok: false,
			action: "zoom",
			code: "no_target",
			error: "No active window — call capture(app=...) first.",
		});
	}
	if (!client.hasTool("zoom")) {
		return textResult({
			ok: false,
			action: "zoom",
			code: "driver_tool_unavailable",
			error: "The connected cua-driver does not advertise a 'zoom' tool; update the driver to read small text at native resolution.",
		});
	}
	const raw = args.zoom_rect;
	const rect =
		Array.isArray(raw) &&
		raw.length === 4 &&
		raw.every((value) => typeof value === "number" && Number.isFinite(value))
			? raw
			: null;
	if (!rect) {
		return textResult({
			ok: false,
			action: "zoom",
			error: "zoom requires zoom_rect=[x1, y1, x2, y2] in the last capture's pixels (corners, not size).",
		});
	}
	if (stickyTarget.window_id === null) {
		return textResult({
			ok: false,
			action: "zoom",
			error: "zoom needs an exact window; capture with app= or pid+window_id first.",
		});
	}
	const callArgs: Record<string, unknown> = {
		window_id: stickyTarget.window_id,
		x1: rect[0],
		y1: rect[1],
		x2: rect[2],
		y2: rect[3],
	};
	if (client.supportsInputProperty("zoom", "pid")) callArgs.pid = stickyTarget.pid;
	const result = await client.callTool("zoom", callArgs);
	if (result.isError) {
		return textResult(actionPayload("zoom", result));
	}
	zoomActiveFor = targetKeyOf(stickyTarget);
	const image = result.images[0];
	const text = [
		`zoom ${rect.join(",")} on ${JSON.stringify(stickyTarget.app)} — native resolution crop; coordinates in this image are zoom-local.`,
		"A coordinate click after this sets from_zoom automatically; element indices and tokens are unchanged.",
	].join("\n");
	return {
		content: image
			? [
					{ type: "text", text },
					{ type: "image", data: image.data, mimeType: image.mimeType },
				]
			: [{ type: "text", text }],
		details: {
			action: "zoom",
			rect,
			app: stickyTarget.app,
			pid: stickyTarget.pid,
			windowId: stickyTarget.window_id,
		},
	};
}

async function doInput(args: ComputerToolInput): Promise<AgentToolResult<Record<string, unknown>>> {
	const client = getClient();
	const action = args.action;
	if (!stickyTarget) {
		return textResult({
			ok: false,
			action,
			code: "no_target",
			error: "No active window — call capture(app=...) first.",
		});
	}
	// Sticky-target guard: refuse a provable app mismatch rather than typing into the wrong window.
	if (typeof args.app === "string" && args.app.trim()) {
		const current = stickyTarget.app.trim().toLowerCase();
		const wanted = args.app.trim().toLowerCase();
		if (current && wanted && !current.includes(wanted) && !wanted.includes(current)) {
			return textResult({
				ok: false,
				action,
				code: "input_target_mismatch",
				error:
					`"${action}" would go to the current target ${JSON.stringify(stickyTarget.app)}, not ${JSON.stringify(args.app)} — ` +
					"input always hits the sticky target from the last capture/focus_app. Capture the requested app first, then retry.",
			});
		}
	}
	let tool = action;
	const toolArgs: Record<string, unknown> = {};

	switch (action) {
		case "click":
		case "double_click":
		case "right_click":
		case "middle_click": {
			tool = action === "double_click" ? "double_click" : "click";
			const button =
				action === "right_click" ? "right" : action === "middle_click" ? "middle" : (args.button ?? "left");
			toolArgs.button = button;
			if (args.element !== undefined) {
				toolArgs.element_index = args.element;
			} else if (Array.isArray(args.coordinate) && args.coordinate.length === 2) {
				toolArgs.x = args.coordinate[0];
				toolArgs.y = args.coordinate[1];
			} else {
				return textResult({ ok: false, action, error: "click requires element= or coordinate=[x, y]." });
			}
			if (args.modifiers?.length) {
				toolArgs.modifier = args.modifiers;
			}
			break;
		}
		case "drag": {
			if (
				args.element === undefined &&
				!(Array.isArray(args.from_coordinate) && Array.isArray(args.to_coordinate))
			) {
				return textResult({
					ok: false,
					action,
					error: "drag requires from_coordinate/to_coordinate or an element pair.",
				});
			}
			if (args.element !== undefined) {
				return textResult({
					ok: false,
					action,
					error: "drag supports coordinates only in this build; use from_coordinate/to_coordinate.",
				});
			}
			toolArgs.from_x = args.from_coordinate?.[0];
			toolArgs.from_y = args.from_coordinate?.[1];
			toolArgs.to_x = args.to_coordinate?.[0];
			toolArgs.to_y = args.to_coordinate?.[1];
			toolArgs.button = args.button ?? "left";
			break;
		}
		case "scroll": {
			toolArgs.direction = args.direction ?? "down";
			toolArgs.amount = Math.max(1, Math.min(50, Math.trunc(args.amount ?? 3)));
			if (args.element !== undefined) {
				toolArgs.element_index = args.element;
			} else if (Array.isArray(args.coordinate) && args.coordinate.length === 2) {
				toolArgs.x = args.coordinate[0];
				toolArgs.y = args.coordinate[1];
			}
			break;
		}
		case "type": {
			if (typeof args.text !== "string" || args.text.length === 0) {
				return textResult({ ok: false, action, error: "type requires text." });
			}
			tool = "type_text";
			toolArgs.text = args.text;
			// Windows XAML / WinUI3 / UWP controls need the UIA element; background
			// WM_CHAR does not reach their CoreInput dispatcher.
			if (args.element !== undefined) toolArgs.element_index = args.element;
			// Linux/Electron inputs that the AX path cannot focus: pixel-click the
			// field first, then type into it.
			if (
				Array.isArray(args.coordinate) &&
				args.coordinate.length === 2 &&
				client.supportsInputProperty(tool, "x") &&
				client.supportsInputProperty(tool, "y")
			) {
				toolArgs.x = args.coordinate[0];
				toolArgs.y = args.coordinate[1];
			}
			if (typeof args.delay_ms === "number" && client.supportsInputProperty(tool, "delay_ms")) {
				toolArgs.delay_ms = Math.max(0, Math.min(200, Math.trunc(args.delay_ms)));
			}
			break;
		}
		case "key": {
			if (typeof args.keys !== "string" || args.keys.length === 0) {
				return textResult({ ok: false, action, error: "key requires keys (e.g. 'return', 'cmd+s')." });
			}
			const combo = parseKeyCombo(args.keys);
			if (!combo) {
				return textResult({ ok: false, action, error: `Could not parse key from '${args.keys}'.` });
			}
			const mods = driverModifiers(combo.mods);
			if (mods.length > 0) {
				tool = "hotkey";
				toolArgs.keys = [...mods, combo.key];
			} else {
				tool = "press_key";
				toolArgs.key = combo.key;
			}
			break;
		}
		case "set_value": {
			if (args.element === undefined) {
				return textResult({ ok: false, action, error: "set_value requires element= (element index)." });
			}
			if (typeof args.value !== "string") {
				return textResult({ ok: false, action, error: "set_value requires value." });
			}
			toolArgs.element_index = args.element;
			toolArgs.value = args.value;
			break;
		}
		case "focus_app": {
			if (!args.app) {
				return textResult({ ok: false, action, error: "focus_app requires app." });
			}
			const { target, error } = await resolveTarget(client, args);
			if (!target) {
				return textResult({ ok: false, action, error });
			}
			stickyTarget = target;
			snapshotTokens = new Map();
			treeRevisionBinding = null;
			if (args.raise_window === true && client.hasTool("bring_to_front") && target.window_id !== null) {
				const focused = await client.callTool("bring_to_front", { pid: target.pid, window_id: target.window_id });
				if (focused.isError) {
					return textResult(actionPayload("focus_app", focused));
				}
			}
			return textResult({
				ok: true,
				action: "focus_app",
				app: target.app,
				pid: target.pid,
				window_id: target.window_id,
			});
		}
		default:
			return textResult({ ok: false, action, error: `unknown action ${action}` });
	}

	// Older Windows builds expose `click` with a count but no `double_click`
	// tool. Prefer the dedicated tool when present, otherwise express the same
	// action as `click(count: 2)`.
	if (tool === "double_click" && !client.hasTool("double_click") && client.supportsInputProperty("click", "count")) {
		tool = "click";
		toolArgs.count = 2;
	}

	// Snapshot freshness: attach the element's token so the driver reports an
	// explicit "stale" instead of silently re-resolving to a different element.
	if (typeof toolArgs.element_index === "number") {
		const token = snapshotTokens.get(toolArgs.element_index);
		const acceptsToken = client.supportsInputProperty(tool, "element_token");
		// Current drivers identify elements on action tools by snapshot token and
		// refuse a bare `element_index` (indices are snapshot-scoped). Prefer the
		// token; when none is held, fail closed with the fix instead of sending an
		// index the driver cannot resolve.
		if (token && acceptsToken) {
			toolArgs.element_token = token;
			delete toolArgs.element_index;
		} else if (acceptsToken) {
			return textResult({
				ok: false,
				action,
				code: "stale_element_token",
				error: `No current element token for #${toolArgs.element_index} — a newer snapshot (or a since_last diff) retired it. Capture again without since_last, then use the new element index.`,
			});
		} else if (
			typeof lastSnapshotId === "string" &&
			lastSnapshotTarget === targetKeyOf(stickyTarget) &&
			client.supportsInputProperty(tool, "snapshot_id")
		) {
			// Older builds take index + snapshot_id, which pins the same snapshot.
			toolArgs.snapshot_id = lastSnapshotId;
		}
	}
	// A driver build may rename tools (e.g. "type" → "type_text"); calling an
	// unadvertised name surfaces as a confusing permission refusal downstream,
	// so fail here with the actionable name mismatch instead.
	if (!client.hasTool(tool)) {
		return textResult({
			ok: false,
			action,
			code: "driver_tool_unavailable",
			error: `The connected cua-driver does not advertise a '${tool}' tool — its build may have renamed it. Check the driver version and update this tool's action mapping.`,
		});
	}
	// Foreground delivery is only sent when the live schema accepts it; older
	// drivers must not silently downgrade to background.
	if (args.delivery_mode === "foreground") {
		if (!client.supportsInputProperty(tool, "delivery_mode")) {
			return textResult({
				ok: false,
				action,
				code: "foreground_unsupported",
				error: "The connected cua-driver does not accept delivery_mode; foreground delivery is unavailable.",
			});
		}
		toolArgs.delivery_mode = "foreground";
	}

	// Target addressing is per-tool: current drivers take `target`, older ones
	// take legacy pid/window_id (the two cannot be combined).
	const callArgs = { ...targetArgs(client, tool, stickyTarget), ...toolArgs };
	// A coordinate after a zoom refers to the zoom crop; let the driver translate
	// it back to window space.
	if (
		typeof toolArgs.x === "number" &&
		zoomActiveFor === targetKeyOf(stickyTarget) &&
		client.supportsInputProperty(tool, "from_zoom")
	) {
		callArgs.from_zoom = true;
	}
	// The tree revision protects element actions the same way capture_id protects
	// coordinates: if a later read changed the tree, refuse before delivering input.
	const usesElement =
		typeof callArgs.element_token === "string" ||
		typeof callArgs.element_index === "number" ||
		typeof callArgs.snapshot_id === "string";
	if (
		usesElement &&
		treeRevisionBinding !== null &&
		treeRevisionBinding.key === targetKeyOf(stickyTarget) &&
		client.supportsInputProperty(tool, "ui_tree_revision")
	) {
		callArgs.ui_tree_revision = treeRevisionBinding.revision;
	}

	// Coordinate actions are admitted against the exact capture they were planned
	// from (stale, mismatched, or out-of-bounds points are refused before any
	// input). The driver consumes the id, so the binding is one-shot; zoom-relative
	// points are not capture-bound and keep `from_zoom` instead.
	const sendsPoint = typeof callArgs.x === "number" && typeof callArgs.y === "number";
	const boundCapture =
		sendsPoint &&
		callArgs.from_zoom !== true &&
		stickyTarget.window_id !== null &&
		captureBinding !== null &&
		captureBinding.key === targetKeyOf(stickyTarget) &&
		client.supportsInputProperty(tool, "capture_id")
			? captureBinding.id
			: null;
	if (boundCapture) {
		callArgs.capture_id = boundCapture;
		captureBinding = null;
	}
	const result = await client.callTool(tool, callArgs);
	const payload = {
		...actionPayload(action, result),
		// Make the card and the model's own result text name the window that
		// actually received the input, not just the optional app argument.
		app: stickyTarget.app,
		pid: stickyTarget.pid,
		...(stickyTarget.window_id !== null ? { windowId: stickyTarget.window_id } : {}),
	};

	// Optional follow-up capture — never after a failure (a normal-looking
	// screenshot would suggest success).
	if (args.capture_after === true && !result.isError) {
		const followUp = await doCapture({ ...args, action: "capture", mode: "som" });
		const captureText = followUp.content[0];
		const text = `${JSON.stringify(payload)}\n\n${captureText?.type === "text" ? captureText.text : ""}`;
		const image = followUp.content.find((block) => block.type === "image");
		return {
			content: image ? [{ type: "text", text }, image] : [{ type: "text", text }],
			details: { ...payload, followUpCapture: followUp.details },
		};
	}
	return textResult(payload);
}

function textResult(payload: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
	return { content: [{ type: "text", text: JSON.stringify(payload) }], details: payload };
}

async function dispatch(action: string, params: ComputerToolInput): Promise<AgentToolResult<Record<string, unknown>>> {
	if (action === "capture") {
		return doCapture(params);
	}
	if (action === "list_apps" || action === "list_windows") {
		return doList(action === "list_apps" ? "apps" : "windows");
	}
	if (action === "wait") {
		const seconds = Math.max(0, Math.min(30, params.seconds ?? 1));
		await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
		return textResult({ ok: true, action: "wait", seconds });
	}
	if (action === "doctor") {
		return doDoctor();
	}
	if (action === "zoom") {
		return doZoom(params);
	}
	return doInput(params);
}

// ---------------------------------------------------------------------------
// TUI rendering
// ---------------------------------------------------------------------------

type ComputerRenderResult = {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function point(value: unknown): [number, number] | undefined {
	return Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === "number" &&
		typeof value[1] === "number" &&
		Number.isFinite(value[0]) &&
		Number.isFinite(value[1])
		? [value[0], value[1]]
		: undefined;
}

function pointLabel(value: unknown): string | undefined {
	const p = point(value);
	return p ? `(${p[0]}, ${p[1]})` : undefined;
}

function rectLabel(value: unknown): string | undefined {
	if (
		!Array.isArray(value) ||
		value.length < 4 ||
		value.slice(0, 4).some((part) => typeof part !== "number" || !Number.isFinite(part))
	) {
		return undefined;
	}
	return `(${value[0]}, ${value[1]}) → (${value[2]}, ${value[3]})`;
}

function oneLine(value: string, max = 80): string {
	const plain = stripAnsi(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
	const compact = plain.replace(/\s+/g, " ").trim();
	return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function quoted(value: string, max = 36): string {
	return JSON.stringify(oneLine(value, max));
}

function computerTarget(action: string, args: Record<string, unknown>): string {
	const app = oneLine(stringField(args, "app") ?? "", 80) || undefined;
	const pid = numberField(args, "pid");
	const windowId = numberField(args, "window_id");
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

function formatComputerCall(args: Record<string, unknown>, theme: Theme): string {
	const action = oneLine(stringField(args, "action") ?? "", 32) || undefined;
	const title = theme.fg("toolTitle", theme.bold("computer"));
	if (!action) return title;
	const target = computerTarget(action, args);
	const prefix = (verb: string, targetText = target) =>
		`${title} ${theme.fg("accent", verb)}${targetText ? ` ${theme.fg("toolOutput", targetText)}` : ""}`;
	const suffix = (detail: string | undefined) => (detail ? theme.fg("muted", ` · ${detail}`) : "");
	const delivery = stringField(args, "delivery_mode") === "foreground" ? "foreground" : undefined;
	const after = args.capture_after === true ? "capture after" : undefined;
	const element = numberField(args, "element");
	const at = element !== undefined ? `#${element}` : pointLabel(args.coordinate);

	switch (action) {
		case "capture": {
			const mode = oneLine(stringField(args, "mode") ?? "som", 16).toUpperCase();
			return (
				prefix("capture") +
				suffix([mode, args.since_last === true ? "diff" : undefined].filter(Boolean).join(" · "))
			);
		}
		case "click":
		case "double_click":
		case "right_click":
		case "middle_click": {
			const button = oneLine(stringField(args, "button") ?? "", 12) || undefined;
			let verb =
				action === "double_click"
					? "double-click"
					: action === "right_click"
						? "right-click"
						: action === "middle_click"
							? "middle-click"
							: button && button !== "left"
								? `${button}-click`
								: "click";
			const modifiers = Array.isArray(args.modifiers)
				? args.modifiers
						.filter((value): value is string => typeof value === "string" && value.length > 0)
						.map((value) => oneLine(value, 12))
				: [];
			if (modifiers.length > 0) verb = `${modifiers.join("+")}+${verb}`;
			return prefix(verb) + suffix([at, delivery, after].filter(Boolean).join(" · "));
		}
		case "drag": {
			const from = pointLabel(args.from_coordinate);
			const to = pointLabel(args.to_coordinate);
			const span = from && to ? `${from} → ${to}` : undefined;
			return prefix("drag") + suffix([span, delivery, after].filter(Boolean).join(" · "));
		}
		case "scroll": {
			const direction = oneLine(stringField(args, "direction") ?? "down", 12) || "down";
			const amount = numberField(args, "amount") ?? 3;
			return prefix("scroll") + suffix([`${direction} ${amount}`, at, delivery, after].filter(Boolean).join(" · "));
		}
		case "type": {
			const text = stringField(args, "text");
			return (
				prefix("type", target ? `into ${target}` : undefined) +
				suffix([text ? quoted(text) : undefined, delivery, after].filter(Boolean).join(" · "))
			);
		}
		case "key": {
			const keys = stringField(args, "keys");
			return (
				prefix("press", target ? `in ${target}` : undefined) +
				suffix([keys ? oneLine(keys, 48) : undefined, delivery, after].filter(Boolean).join(" · "))
			);
		}
		case "set_value": {
			const value = stringField(args, "value");
			return (
				prefix("set") +
				suffix(
					[
						element !== undefined
							? `#${element}${value ? ` = ${quoted(value, 28)}` : ""}`
							: value
								? quoted(value, 28)
								: undefined,
						delivery,
						after,
					]
						.filter(Boolean)
						.join(" · "),
				)
			);
		}
		case "focus_app": {
			return prefix("focus") + suffix(args.raise_window === true ? "raise window" : undefined);
		}
		case "zoom": {
			return prefix("zoom") + suffix([rectLabel(args.zoom_rect), "native crop"].filter(Boolean).join(" · "));
		}
		case "wait": {
			const seconds = numberField(args, "seconds") ?? 1;
			return `${title} ${theme.fg("accent", "wait")} ${theme.fg("toolOutput", `${seconds}s`)}`;
		}
		case "list_apps":
			return `${title} ${theme.fg("accent", "list apps")}`;
		case "list_windows":
			return `${title} ${theme.fg("accent", "list windows")}`;
		case "doctor":
			return `${title} ${theme.fg("accent", "doctor")}`;
		default:
			return prefix(action);
	}
}

function parseResultDetails(result: ComputerRenderResult): Record<string, unknown> | undefined {
	const direct = asRecord(result.details);
	if (direct) return direct;
	const output = getTextOutput(result, false).trim();
	if (!output.startsWith("{") && !output.startsWith("[")) return undefined;
	try {
		return asRecord(JSON.parse(output));
	} catch {
		return undefined;
	}
}

function prettyComputerOutput(output: string): string {
	const trimmed = output.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return output;
	try {
		const value: unknown = JSON.parse(trimmed);
		return value && typeof value === "object" ? JSON.stringify(value, null, 2) : output;
	} catch {
		return output;
	}
}

function formatComputerResult(
	args: Record<string, unknown>,
	result: ComputerRenderResult,
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
	isError: boolean,
	showImages: boolean,
): string {
	const details = parseResultDetails(result);
	const action = oneLine(stringField(details, "action") ?? stringField(args, "action") ?? "computer", 32);
	const app = oneLine(stringField(details, "app") ?? computerTarget(action, args), 80);
	const verdict = asRecord(details?.verdict);
	const decision = stringField(verdict, "decision");
	const code = oneLine(stringField(details, "code") ?? "", 40) || undefined;
	const error = stringField(details, "error") ?? stringField(details, "message");
	const hint = stringField(verdict, "hint");
	const degradedReason = stringField(details, "degradedReason");
	const degraded = degradedReason ? oneLine(degradedReason, 60) : undefined;
	const ok = !isError && details?.ok !== false && !error;
	const hasImage = result.content.some((block) => block.type === "image");
	const elements = numberField(details, "elementCount") ?? 0;
	const count = numberField(details, "count") ?? 0;
	const seconds = numberField(details, "seconds") ?? 1;
	const mode = oneLine(stringField(details, "mode") ?? stringField(args, "mode") ?? "som", 16).toUpperCase();
	const isDiff = details?.diff === true || stringField(details, "since") !== undefined;
	let headline: string;

	if (!ok) {
		const summary = [action, app, code ?? "failed"].filter(Boolean).join(" · ");
		headline = formatHeadline("error", theme, summary);
	} else if (decision) {
		const glyph =
			decision === "done"
				? theme.fg("success", "✓")
				: decision === "escalate"
					? theme.fg("error", "!")
					: theme.fg("warning", "⚠");
		const label = decision === "done" ? "done" : decision === "escalate" ? "escalate" : "verify";
		headline = `${glyph} ${theme.fg("toolOutput", [action, label, app].filter(Boolean).join(" · "))}`;
	} else {
		let stats: string;
		switch (action) {
			case "capture":
				stats = `${app} · ${elements} ${isDiff ? "changed " : ""}element${elements === 1 ? "" : "s"} · ${mode}${hasImage ? " · screenshot" : ""}${isDiff ? " · diff" : ""}${degraded ? " · degraded" : ""}`;
				break;
			case "zoom": {
				const rect = rectLabel(details?.rect);
				stats = `${app}${rect ? ` · ${rect}` : ""} · native crop${hasImage ? " · screenshot" : ""}`;
				break;
			}
			case "list_apps":
				stats = `${count} app${count === 1 ? "" : "s"}`;
				break;
			case "list_windows":
				stats = `${count} window${count === 1 ? "" : "s"}`;
				break;
			case "wait":
				stats = `waited ${seconds}s`;
				break;
			case "focus_app":
				stats = `focused ${app}`;
				break;
			case "doctor":
				stats = "driver report";
				break;
			default:
				stats = `${action} delivered${app ? ` · ${app}` : ""}`;
				break;
		}
		headline = formatHeadline("success", theme, stats);
	}

	let text = headline;
	const detail = !ok ? [error, hint].filter(Boolean).join(" — ") : hint;
	if (detail) {
		const color = !ok || decision === "escalate" ? "error" : decision === "verify_fresh_state" ? "warning" : "muted";
		text += `\n${theme.fg(color, oneLine(detail, 160))}`;
	}
	if (options.expanded) {
		const output = getTextOutput(result, showImages).trim();
		if (output) text += `\n${theme.fg("toolOutput", prettyComputerOutput(output))}`;
	}
	return text;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createComputerToolDefinition(): ToolDefinition<typeof computerSchema, Record<string, unknown>> {
	return {
		name: "computer",
		label: "Computer",
		description:
			"Drive the desktop via cua-driver — screenshots, mouse, keyboard, scroll, drag — on macOS, Windows, and Linux. " +
			"Input is background-first: it routes to the target window without stealing the user's cursor or focus, and each " +
			"result carries a verdict telling you the next step (done / verify with a fresh capture / escalate). Workflow: " +
			"action='capture' (mode 'som' gives numbered element overlays), then click by element index; re-capture after " +
			"state-changing actions (or pass capture_after=true), and use action='zoom' when small text needs native " +
			"resolution. Never repeat confirmed input, and re-capture to verify an " +
			"unverifiable one before retrying. Destructive system shortcuts and dangerous shell-payload typing are hard-blocked.",
		promptSnippet: "Control the desktop (screenshots, mouse, keyboard) via cua-driver",
		parameters: computerSchema,
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatComputerCall(args as Record<string, unknown>, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				formatComputerResult(
					context.args as Record<string, unknown>,
					result as ComputerRenderResult,
					options,
					theme,
					context.isError,
					context.showImages,
				),
			);
			return text;
		},
		async execute(_toolCallId, params: ComputerToolInput) {
			const action = params.action;
			const blocked = rejectUnsafe(action, params);
			if (blocked) {
				return textResult(JSON.parse(blocked) as Record<string, unknown>);
			}
			try {
				return await dispatch(action, params);
			} catch (error) {
				// Backend failures (missing binary, failed MCP handshake) surface
				// as tool results with an install hint, not thrown errors. A
				// missing driver gets platform-matched install commands so the
				// user can fix it from the failure alone.
				const install: DriverInstallGuidance | undefined = resolveDriverCommand().installed
					? undefined
					: (getDriverInstallGuidance() ?? undefined);
				return textResult({
					ok: false,
					action,
					code: "backend_unavailable",
					error: error instanceof Error ? error.message : String(error),
					...(install ? { install } : {}),
					hint: install
						? "Not installed yet. Run the commands in 'install.commands' on this machine (they place the binary in 'install.binDir', which a-coder-cli checks automatically), or point A_CODER_CUA_DRIVER_CMD at the binary. Once connected, action='doctor' reports health and TCC grants."
						: "If the driver is installed, check the computerUse setting and the A_CODER_CUA_DRIVER_CMD path; once the driver connects, action='doctor' reports its health and TCC grants.",
				});
			}
		},
	};
}

export function createComputerTool(): AgentTool<typeof computerSchema> {
	return wrapToolDefinition(createComputerToolDefinition());
}

/** Reset cached driver state (test seam). */
export function resetComputerToolState(): void {
	cachedClient?.stop();
	cachedClient = null;
	clearTarget();
}

/** Driver availability probe for status surfaces. */
export function computerUseAvailability(): { installed: boolean; command?: string } {
	const availability = resolveDriverCommand();
	return { installed: availability.installed, command: availability.command };
}
