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

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { CuaDriverClient, resolveDriverCommand } from "./driver.ts";

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
				"wait",
				"list_apps",
				"list_windows",
				"focus_app",
			],
			{
				description:
					"Which action to perform. capture (free, no side effects) returns a screenshot plus interactable elements; prefer clicking elements by index over pixel coordinates. All other actions except list/wait/focus require approval.",
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
	alt: "option",
	"⌘": "cmd",
	"⌥": "option",
	windows: "win",
	super: "win",
	meta: "win",
};

/** Destructive system shortcuts, hard-blocked regardless of approval level. */
const BLOCKED_KEY_COMBOS: ReadonlySet<string> = new Set(
	[
		["cmd", "shift", "backspace"], // empty trash
		["cmd", "option", "backspace"], // force delete
		["cmd", "ctrl", "q"], // log out
		["cmd", "shift", "q"], // log out (macOS)
		["cmd", "option", "shift", "q"], // force log out
		["win", "l"], // lock screen
		["ctrl", "option", "delete"], // force quit dialog / log out
		["option", "f4"], // close app / shutdown dialog
	].map((combo) => [...combo].sort().join("+")),
);

/** Canonicalize a key combo: aliases resolved, split on + AND -, order-insensitive. */
export function canonKeyCombo(keys: string): string[] {
	return keys
		.split(/[+-]/)
		.map((part) => KEY_ALIASES[part.trim().toLowerCase()] ?? part.trim().toLowerCase())
		.filter((part) => part.length > 0)
		.sort();
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
/** Cap on the element list surfaced in the response (dense UIs exceed context). */
const MAX_VISIBLE_ELEMENTS = 100;

// ---------------------------------------------------------------------------
// Session-cached driver + sticky target
// ---------------------------------------------------------------------------

interface UiElement {
	index: number;
	role: string;
	label: string;
	frame: { x: number; y: number; w: number; h: number } | null;
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

function getClient(): CuaDriverClient {
	cachedClient ??= new CuaDriverClient();
	return cachedClient;
}

function clearTarget(): void {
	stickyTarget = null;
	snapshotTokens = new Map();
}

function positiveInt(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
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
		let frame: UiElement["frame"] = null;
		if (typeof rec.frame === "object" && rec.frame !== null) {
			const f = rec.frame as Record<string, unknown>;
			const x = positiveInt(f.x) ?? 0;
			const y = positiveInt(f.y) ?? 0;
			const w = positiveInt(f.w) ?? 0;
			const h = positiveInt(f.h) ?? 0;
			frame = { x, y, w, h };
		}
		elements.push({ index, role, label, frame, token });
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
}

function classifyVerdict(result: { isError: boolean; structured: Record<string, unknown> | null }): Verdict {
	const structured = result.structured ?? {};
	if (result.isError) {
		const code = typeof structured.code === "string" ? structured.code : "";
		if (code.endsWith("outcome_unknown")) {
			return {
				decision: "escalate",
				hint: "The action's outcome is unknown — it may have landed. Capture fresh state before any retry; do not repeat the input.",
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
	const where = element.frame
		? ` @ ${element.frame.x},${element.frame.y} ${element.frame.w}x${element.frame.h}`
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
		verdict: classifyVerdict(result),
		...(result.structured ?? {}),
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
	const callArgs: Record<string, unknown> = { pid: target.pid, max_elements: MAX_AX_ELEMENTS };
	if (target.window_id !== null) {
		callArgs.window_id = target.window_id;
	}
	let result = await client.callTool("get_window_state", callArgs);
	if (result.isError && !result.images.length) {
		return textResult(actionPayload("capture", result));
	}
	// vision: pixels only — prefer the cheaper standalone screenshot tool when advertised.
	if (mode === "vision" && client.hasTool("screenshot")) {
		const shot = await client.callTool("screenshot", { window_id: target.window_id, format: "jpeg", quality: 85 });
		if (!shot.isError && shot.images.length > 0) {
			result = shot;
		}
	}
	// Sticky target + snapshot tokens are set by ANY successful capture.
	stickyTarget = target;
	snapshotTokens = new Map();
	const elements = mode === "vision" ? [] : parseElements(result.structured?.elements);
	for (const element of elements) {
		if (element.token) {
			snapshotTokens.set(element.index, element.token);
		}
	}
	const visible = elements.slice(0, MAX_VISIBLE_ELEMENTS);
	const image = result.images[0];
	const truncated = elements.length - visible.length;
	const lines = [
		`capture mode=${mode} app=${JSON.stringify(target.app || "frontmost")}`,
		`${elements.length} interactable element(s):`,
		...visible.map(elementLine),
	];
	if (truncated > 0) {
		lines.push(`  (+${truncated} more; pass app= to narrow)`);
	}
	if (mode === "ax") {
		lines.push("(ax mode: tree only — no image; element indices still work for input actions)");
	}
	const content: AgentToolResult<Record<string, unknown>>["content"] = [{ type: "text", text: lines.join("\n") }];
	if (image && mode !== "ax") {
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
	const base: Record<string, unknown> = { pid: stickyTarget.pid };
	if (stickyTarget.window_id !== null) {
		base.window_id = stickyTarget.window_id;
	}

	let tool = action;
	const toolArgs: Record<string, unknown> = { ...base };

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
			toolArgs.text = args.text;
			break;
		}
		case "key": {
			if (typeof args.keys !== "string" || args.keys.length === 0) {
				return textResult({ ok: false, action, error: "key requires keys (e.g. 'return', 'cmd+s')." });
			}
			const parts = canonKeyCombo(args.keys);
			if (parts.length === 0) {
				return textResult({ ok: false, action, error: `Could not parse key from '${args.keys}'.` });
			}
			const chordRoots = new Set(["cmd", "option", "ctrl", "win", "shift", "fn"]);
			const key = parts[parts.length - 1];
			const mods = parts.slice(0, -1);
			if (mods.length > 0 || chordRoots.has(key)) {
				// hotkey requires at least one modifier + one key.
				if (mods.length === 0) {
					return textResult({
						ok: false,
						action,
						error: "hotkey requires a non-modifier key alongside the modifier (e.g. 'cmd+s').",
					});
				}
				tool = "hotkey";
				toolArgs.keys = [...mods, key];
			} else {
				tool = "press_key";
				toolArgs.key = key;
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

	// Snapshot freshness: attach the element's token so the driver reports an
	// explicit "stale" instead of silently re-resolving to a different element.
	if (typeof toolArgs.element_index === "number") {
		const token = snapshotTokens.get(toolArgs.element_index);
		if (token && client.supportsInputProperty(tool, "element_token")) {
			toolArgs.element_token = token;
		}
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

	const result = await client.callTool(tool, toolArgs);
	const payload = actionPayload(action, result);

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
	return doInput(params);
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
			"state-changing actions (or pass capture_after=true). Never repeat confirmed input, and re-capture to verify an " +
			"unverifiable one before retrying. Destructive system shortcuts and dangerous shell-payload typing are hard-blocked.",
		promptSnippet: "Control the desktop (screenshots, mouse, keyboard) via cua-driver",
		parameters: computerSchema,
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
				// as tool results with an install hint, not thrown errors.
				return textResult({
					ok: false,
					action,
					code: "backend_unavailable",
					error: error instanceof Error ? error.message : String(error),
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

/**
 * Opt-in gate: the computer tool only registers when explicitly enabled.
 * Desktop control is a high-trust capability — never ship it on by default.
 */
export function computerUseEnabled(): boolean {
	return process.env.A_CODER_CLI_COMPUTER_USE === "1";
}
