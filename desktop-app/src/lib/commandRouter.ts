// ============================================================================
// Slash-command router.
//
// Each entry in BUILTIN_COMMANDS maps a `/name` to a RoutedCommand:
//   - "rpc"     — call the matching engine RPC immediately
//   - "edit"    — fill the Composer text and let the user finish it
//   - "open"    — open a desktop UI (model picker, etc.)
//
// Extension/skill commands returned by `rpc.getCommands` that aren't in this
// table fall back to "send as prompt".
// ============================================================================

import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import * as rpc from "./rpc";
import { toast } from "../stores/toast-store";

export type RoutedAction =
	| { kind: "rpc"; call: () => Promise<unknown>; label: string }
	| { kind: "edit"; text: string; label: string }
	| { kind: "open"; open: () => void; label: string };

export interface BuiltinCommand {
	name: string;
	description: string;
	route: (args: string, helpers: CommandHelpers) => RoutedAction;
}

export interface CommandHelpers {
	openModelPicker: () => void;
	openSessionPicker: () => void;
	copyLastReply: () => Promise<void>;
	copyToClipboard: (text: string) => Promise<void>;
	/** Current engine working directory (from session store). */
	getCwd: () => string | null;
}

const PERM_CYCLE = ["ask", "allow", "read-only", "auto"] as const;

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
	{
		name: "settings",
		description: "Open settings",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:open-settings")),
			label: "Open Settings",
		}),
	},
	{
		name: "model",
		description: "Select model",
		route: (_args, h) => ({
			kind: "open",
			open: h.openModelPicker,
			label: "Select Model…",
		}),
	},
	{
		name: "permission",
		description: "Cycle permission mode (ask → allow → read-only → auto)",
		route: () => ({
			kind: "rpc",
			call: async () => {
				const cur = await rpc.getPermissionMode();
				const idx = PERM_CYCLE.indexOf(cur.mode);
				const next = PERM_CYCLE[(idx + 1) % PERM_CYCLE.length];
				await rpc.setPermissionMode(next);
				toast.info("Permission mode", next);
			},
			label: "Cycle permission mode",
		}),
	},
	{
		name: "scoped-models",
		description: "Manage which models appear in Ctrl+P cycling",
		route: () => ({
			kind: "open",
			open: () =>
				window.dispatchEvent(
					new CustomEvent("a-coder:open-settings", { detail: { section: "ai-model" } }),
				),
			label: "Open Settings → Model…",
		}),
	},
	{
		name: "export",
		description: "Export session as HTML or JSONL",
		route: (args) => ({
			kind: "rpc",
			call: async () => {
				const asJsonl = /\bjsonl\b/i.test(args);
				const ext = asJsonl ? "jsonl" : "html";
				const path = await saveDialog({
					defaultPath: `session.${ext}`,
					filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
				});
				if (!path) return;
				const res = asJsonl ? await rpc.exportJsonl(path) : await rpc.exportHtml(path);
				toast.success("Session exported", res.path);
			},
			label: "Export session…",
		}),
	},
	{
		name: "import",
		description: "Import and resume a session from a JSONL file",
		route: () => ({
			kind: "rpc",
			call: async () => {
				const path = await openDialog({
					multiple: false,
					filters: [{ name: "JSONL", extensions: ["jsonl"] }],
				});
				if (!path || typeof path !== "string") return;
				await rpc.importJsonl(path);
				toast.success("Session imported", path);
			},
			label: "Import session…",
		}),
	},
	{
		name: "share",
		description: "Share session as a secret GitHub gist (requires gh CLI)",
		route: (args) => ({
			kind: "rpc",
			call: async () => {
				const publicGist = /\bpublic\b/i.test(args);
				const tmp = `/tmp/a-coder-share-${Date.now()}.jsonl`;
				await rpc.exportJsonl(tmp);
				try {
					const res = await rpc.shareSessionGist(tmp, publicGist);
					await navigator.clipboard.writeText(res.url).catch(() => {});
					toast.success("Gist created (URL copied)", res.url);
				} finally {
					// Best-effort cleanup; ignore errors.
					await rpc.bash(`rm -f ${JSON.stringify(tmp)}`, true).catch(() => {});
				}
			},
			label: "Share as gist…",
		}),
	},
	{
		name: "copy",
		description: "Copy last agent reply",
		route: (_args, h) => ({
			kind: "rpc",
			call: async () => {
				await h.copyLastReply();
				toast.success("Copied last reply");
			},
			label: "Copy last reply",
		}),
	},
	{
		name: "name",
		description: "Set session display name",
		route: (args) => ({
			kind: "rpc",
			call: async () => {
				const name = args.trim() || "Untitled";
				await rpc.setSessionName(name);
				toast.success("Session renamed", name);
			},
			label: args.trim() ? `Rename session → "${args.trim()}"` : "Set session name…",
		}),
	},
	{
		name: "session",
		description: "Show session info and stats",
		route: () => ({
			kind: "rpc",
			call: async () => {
				const s = await rpc.getSessionStats();
				const parts: string[] = [];
				if (typeof s.tokens === "number") parts.push(`${s.tokens.toLocaleString()} tokens`);
				if (typeof s.cost === "number") parts.push(`$${s.cost.toFixed(4)}`);
				if (typeof s.durationMs === "number")
					parts.push(`${Math.round(s.durationMs / 1000)}s`);
				if (typeof s.messageCount === "number") parts.push(`${s.messageCount} msgs`);
				toast.info("Session stats", parts.join(" · ") || "No stats available");
			},
			label: "Show session info",
		}),
	},
	{
		name: "changelog",
		description: "Show changelog entries",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:show-changelog")),
			label: "Show changelog",
		}),
	},
	{
		name: "hotkeys",
		description: "Show all keyboard shortcuts",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:show-hotkeys")),
			label: "Show keyboard shortcuts",
		}),
	},
	{
		name: "fork",
		description: "Create a new fork from a previous user message",
		route: (args) => ({
			kind: "edit",
			text: `/fork ${args}`.trim(),
			label: args ? "Fork from message…" : "Fork…",
		}),
	},
	{
		name: "clone",
		description: "Duplicate the current session",
		route: () => ({
			kind: "rpc",
			call: async () => {
				await rpc.clone();
				toast.success("Session cloned");
			},
			label: "Clone session",
		}),
	},
	{
		name: "tree",
		description: "Navigate session tree (focuses the Session sidebar)",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:focus-tree")),
			label: "Focus session tree",
		}),
	},
	{
		name: "trust",
		description: "Save project trust decision for this project",
		route: (_args, h) => ({
			kind: "rpc",
			call: async () => {
				const cwd = h.getCwd();
				if (!cwd) {
					toast.warning("No project open", "Connect to a project first");
					return;
				}
				await rpc.setProjectTrust(cwd, true);
				toast.success("Project trusted", cwd);
			},
			label: "Trust this project",
		}),
	},
	{
		name: "login",
		description: "Configure provider authentication",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:open-account")),
			label: "Configure auth…",
		}),
	},
	{
		name: "logout",
		description: "Remove provider authentication",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:open-account")),
			label: "Manage auth (remove keys)…",
		}),
	},
	{
		name: "new",
		description: "Start a new session",
		route: () => ({
			kind: "rpc",
			call: async () => {
				await rpc.newSession();
				toast.success("New session");
			},
			label: "New session",
		}),
	},
	{
		name: "compact",
		description: "Manually compact the session context",
		route: (args) => ({
			kind: "rpc",
			call: async () => {
				await rpc.compact(args.trim() || undefined);
				toast.success("Context compacted");
			},
			label: args.trim() ? "Compact (with instructions)" : "Compact context",
		}),
	},
	{
		name: "resume",
		description: "Resume a different session",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:open-resume")),
			label: "Resume session…",
		}),
	},
	{
		name: "reload",
		description: "Reload keybindings, extensions, skills, prompts, themes",
		route: () => ({
			kind: "rpc",
			call: async () => {
				await rpc.reloadAuth().catch(() => {});
				window.dispatchEvent(new CustomEvent("a-coder:reload"));
				toast.success("Resources reloaded");
			},
			label: "Reload resources",
		}),
	},
	{
		name: "subagents",
		description: "Open subagent manager UI",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:open-subagents")),
			label: "Open Subagents",
		}),
	},
	{
		name: "teams",
		description: "Open Agent Teams roster UI",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:open-teams")),
			label: "Open Teams",
		}),
	},
	{
		name: "bash",
		description: "Run a shell command via the cli",
		route: (args) => ({
			kind: "rpc",
			call: async () => {
				const cmd = args.trim();
				if (!cmd) {
					toast.warning("/bash", "Provide a command to run");
					return;
				}
				const res = (await rpc.bash(cmd)) as rpc.BashResult;
				const out = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
				if (out) toast.info(`bash (exit ${res.exitCode})`, out.slice(0, 500));
				else toast.success(`bash completed (exit ${res.exitCode})`);
			},
			label: args.trim() ? `Run: ${args.trim()}` : "Run bash…",
		}),
	},
	{
		name: "todos",
		description: "Show the current task list",
		route: () => ({
			kind: "open",
			open: () => window.dispatchEvent(new CustomEvent("a-coder:focus-todos")),
			label: "Show tasks",
		}),
	},
	{
		name: "quit",
		description: "Quit A-Coder",
		route: () => ({
			kind: "rpc",
			call: async () => {
				window.dispatchEvent(new CustomEvent("a-coder:quit"));
			},
			label: "Quit",
		}),
	},
];

// ============================================================================
// Lookup
// ============================================================================

const builtinByName = new Map(BUILTIN_COMMANDS.map((c) => [c.name, c]));

export function findBuiltin(name: string): BuiltinCommand | undefined {
	return builtinByName.get(name);
}

/**
 * Resolve a `/name args…` invocation. Tries the built-in table first; if
 * unknown, falls back to sending the slash text through `rpc.prompt` (which is
 * what the cli does for extension commands it doesn't recognize).
 */
export function routeCommand(
	fullText: string,
	helpers: CommandHelpers,
): RoutedAction {
	const trimmed = fullText.replace(/^\//, "").trim();
	const space = trimmed.indexOf(" ");
	const name = space === -1 ? trimmed : trimmed.slice(0, space);
	const args = space === -1 ? "" : trimmed.slice(space + 1);
	const builtin = findBuiltin(name);
	if (builtin) {
		return builtin.route(args, helpers);
	}
	// Fallback: send as a prompt — the cli's extension system will dispatch.
	return {
		kind: "rpc",
		call: () => rpc.prompt(fullText),
		label: fullText,
	};
}

// ============================================================================
// Fuzzy filter — used by the popover
// ============================================================================

export interface SlashEntry {
	name: string;
	description?: string;
	source: "builtin" | "extension" | "prompt" | "skill";
}

export function filterSlashEntries(
	entries: SlashEntry[],
	query: string,
): SlashEntry[] {
	const q = query.toLowerCase();
	if (!q) return entries.slice(0, 50);
	return entries
		.filter((e) => {
			const name = e.name.toLowerCase();
			const desc = (e.description ?? "").toLowerCase();
			return name.includes(q) || desc.includes(q) || fuzzyMatch(name, q);
		})
		.sort((a, b) => {
			// Prefer entries where the name starts with the query.
			const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
			const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
			if (aStarts !== bStarts) return aStarts - bStarts;
			return a.name.localeCompare(b.name);
		})
		.slice(0, 50);
}

// Subsequence match — every char of `q` appears in order in `s`.
function fuzzyMatch(s: string, q: string): boolean {
	let i = 0;
	for (const ch of s) {
		if (ch === q[i]) i++;
		if (i === q.length) return true;
	}
	return false;
}