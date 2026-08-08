// ============================================================================
// Declarative schema describing every settings.json key in the cli's Settings
// interface. Drives SettingsPanel so adding a new setting is one entry here.
//
// Each spec maps a dotted path in CliSettings to a widget kind:
//   toggle    — boolean
//   select    — one of `options`
//   number    — integer / float with min/max
//   text      — single-line string
//   textarea  — multi-line string
//   list      — array of strings (CSV-style editor)
//   object    — raw JSON textarea (escape hatch)
//   custom    — render a custom widget by name (Phase B widgets)
//   excluded  — not rendered (link out to raw JSON editor)
//
// Labels and hints are written for a non-technical user. The dotted `path` is
// still the source-of-truth for read/write — it's not shown in the UI except
// inside the Advanced raw JSON editor.
// ============================================================================

import type {
	CliSettings,
	ThinkingLevel,
	TransportSetting,
	DefaultProjectTrust,
	PermissionMode,
	DoubleEscapeAction,
	TreeFilterMode,
	MessageDeliveryMode,
} from "./settings.types";

export type FieldKind =
	| "toggle"
	| "select"
	| "number"
	| "text"
	| "textarea"
	| "list"
	| "path-list"
	| "object"
	| "custom"
	| "excluded";

export interface FieldOption {
	value: string;
	label: string;
}

export interface CliSettingsFieldSpec {
	/** Dotted path inside the settings object, e.g. "compaction.reserveTokens" */
	path: string;
	/** UI label — friendly, no jargon */
	label: string;
	/** Optional helper text — one short sentence */
	hint?: string;
	/** Widget kind */
	kind: FieldKind;
	/** Select-only: list of options */
	options?: FieldOption[];
	/** Number-only: min/max bounds */
	min?: number;
	max?: number;
	/** Number-only: step */
	step?: number;
	/** Custom-widget name when kind === "custom" */
	widget?: "theme" | "thinking" | "models" | "defaultModel" | "mcpServers" | "permissionPolicies" | "packages" | "resources" | "completionSound";
	/** If true, change is also pushed to the engine at runtime (not just persisted) */
	runtimeSync?:
		| "thinkingLevel"
		| "steeringMode"
		| "followUpMode"
		| "autoCompaction"
		| "autoRetry";
	/** If true, this field is tucked behind a per-card "Show advanced" disclosure */
	advanced?: boolean;
}

export type SettingsSectionId =
	| "general"
	| "account"
	| "ai-model"
	| "custom-providers"
	| "look-and-feel"
	| "chat-behaviour"
	| "privacy"
	| "tools-and-permissions"
	| "external-tools"
	| "resources"
	| "keybindings"
	| "voice"
	| "advanced";

export interface SettingsSection {
	id: SettingsSectionId;
	navId: string;
	label: string;
	description: string;
	fields?: CliSettingsFieldSpec[];
	/** Optional card grouping inside the section. Cards collapse independently. */
	cards?: SettingsCard[];
	/** If true, the section body is collapsed by default (used for Advanced). */
	defaultCollapsed?: boolean;
}

export interface SettingsCard {
	title: string;
	description?: string;
	fields: CliSettingsFieldSpec[];
	/** If true, the card body collapses behind a "Show advanced" toggle */
	defaultCollapsed?: boolean;
}

// ============================================================================
// Field option lists (friendly labels, canonical cli values)
// ============================================================================

const transportOptions: FieldOption[] = [
	{ value: "auto", label: "Automatic (recommended)" },
	{ value: "sse", label: "Server-sent events" },
	{ value: "websocket", label: "WebSocket" },
	{ value: "websocket-cached", label: "WebSocket (cached)" },
];

const deliveryOptions: FieldOption[] = [
	{ value: "one-at-a-time", label: "One at a time" },
	{ value: "all", label: "All together" },
];

const trustOptions: FieldOption[] = [
	{ value: "ask", label: "Ask each time" },
	{ value: "always", label: "Always trust" },
	{ value: "never", label: "Never trust" },
];

const permissionOptions: FieldOption[] = [
	{ value: "ask", label: "Ask before doing anything" },
	{ value: "allow", label: "Just do it" },
	{ value: "read-only", label: "Read files only" },
	{ value: "auto", label: "Use permission policies" },
];

const doubleEscapeOptions: FieldOption[] = [
	{ value: "tree", label: "Open the conversation tree" },
	{ value: "fork", label: "Fork from a previous message" },
	{ value: "none", label: "Do nothing" },
];

const treeFilterOptions: FieldOption[] = [
	{ value: "default", label: "Default" },
	{ value: "no-tools", label: "Hide tool activity" },
	{ value: "user-only", label: "Show only your messages" },
	{ value: "labeled-only", label: "Show only labeled messages" },
	{ value: "all", label: "Show everything" },
];

// ============================================================================
// Sections (nav order = array order)
// ============================================================================

export const SETTINGS_SECTIONS: SettingsSection[] = [
	// ---- General ----------------------------------------------------------
	{
		id: "general",
		navId: "general",
		label: "General",
		description: "Theme and startup behaviour.",
		fields: [
			{
				path: "theme",
				label: "Appearance",
				hint: "Pick how the app looks.",
				kind: "custom",
				widget: "theme",
			},
			{
				path: "reopenLastProject",
				label: "Reopen last project",
				hint: "Open your last project automatically when you launch the app.",
				kind: "toggle",
			},
			{
				path: "quietStartup",
				label: "Skip welcome banner",
				hint: "Start straight into the chat instead of showing the welcome screen.",
				kind: "toggle",
			},
			{
				path: "collapseChangelog",
				label: "Show short update notes",
				hint: "Keep the changelog brief after each update.",
				kind: "toggle",
			},
			{
				path: "minimizeToTray",
				label: "Keep running in the menu bar",
				hint: "When you close the window, A-Coder stays in the menu bar so you can reopen it quickly.",
				kind: "toggle",
			},
		],
	},

	// ---- Account ----------------------------------------------------------
	// No fields — the Account section is fully custom (sign-in cards).
	{
		id: "account",
		navId: "account",
		label: "Account",
		description: "Sign in to AI providers so the assistant can talk to them.",
	},

	// ---- AI model ---------------------------------------------------------
	{
		id: "ai-model",
		navId: "ai-model",
		label: "AI model",
		description: "Choose which AI model to use and how hard it thinks.",
		fields: [
			{
				path: "defaultProvider",
				label: "Default model",
				hint: "Pick the AI you chat with by default.",
				kind: "custom",
				widget: "defaultModel",
			},
			{
				path: "defaultThinkingLevel",
				label: "Reasoning",
				hint: "How carefully the AI thinks before answering.",
				kind: "custom",
				widget: "thinking",
				runtimeSync: "thinkingLevel",
			},
			{
				path: "transport",
				label: "Connection",
				hint: "Leave on Automatic unless an IT department told you otherwise.",
				kind: "select",
				options: transportOptions,
				advanced: true,
			},
			{
				path: "enabledModels",
				label: "Models you can switch between",
				hint: "Pick which models appear when you cycle through them.",
				kind: "custom",
				widget: "models",
			},
		],
	},

	// ---- Custom providers -------------------------------------------------
	// No fields — fully custom UI editing models.json (not settings.json).
	{
		id: "custom-providers",
		navId: "custom-providers",
		label: "Custom AI",
		description: "Connect your own AI model or a service that isn't in the built-in list.",
	},

	// ---- Look & feel ------------------------------------------------------
	{
		id: "look-and-feel",
		navId: "look-and-feel",
		label: "Look & feel",
		description: "How messages, images and the editor look.",
		fields: [
			{
				path: "completionSound",
				label: "Turn feedback",
				hint: "A chime and an optional trackpad tap when a turn starts and finishes.",
				kind: "custom",
				widget: "completionSound",
			},
			{
				path: "terminal.showImages",
				label: "Show images in chat",
				hint: "Render images next to the AI's replies.",
				kind: "toggle",
			},
			{
				path: "images.autoResize",
				label: "Auto-shrink large images",
				hint: "Resize big images so they fit on screen.",
				kind: "toggle",
			},
			{
				path: "images.blockImages",
				label: "Don't upload images to the AI",
				hint: "Keep images on your screen only — never sent to a model.",
				kind: "toggle",
			},
			{
				path: "hideThinkingBlock",
				label: "Hide the AI's working notes",
				hint: "Don't show the step-by-step thinking behind each reply.",
				kind: "toggle",
			},
			{
				path: "autocompleteMaxVisible",
				label: "Autocomplete suggestions",
				hint: "How many suggestions to show while you type.",
				kind: "number",
				min: 1,
				max: 50,
			},
			{
				path: "showHardwareCursor",
				label: "Use the system cursor in the editor",
				kind: "toggle",
				advanced: true,
			},
			{
				path: "outputPad",
				label: "Message padding",
				hint: "Small gap on the left of each message.",
				kind: "number",
				min: 0,
				max: 1,
				advanced: true,
			},
			{
				path: "editorPaddingX",
				label: "Editor side padding",
				hint: "Horizontal space inside the prompt editor.",
				kind: "number",
				min: 0,
				advanced: true,
			},
			{
				path: "markdown.codeBlockIndent",
				label: "Code-block indent",
				hint: "Spaces used to indent code blocks in chat.",
				kind: "text",
				advanced: true,
			},
			{
				path: "terminal.imageWidthCells",
				label: "Image width",
				hint: "Preferred width for inline images.",
				kind: "number",
				min: 10,
				max: 200,
				advanced: true,
			},
			{
				path: "terminal.clearOnShrink",
				label: "Clear empty rows",
				hint: "When output shrinks, drop blank lines.",
				kind: "toggle",
				advanced: true,
			},
			{
				path: "terminal.showTerminalProgress",
				label: "Show terminal progress",
				hint: "Display a progress bar in supported terminals.",
				kind: "toggle",
				advanced: true,
			},
		],
	},

	// ---- Chat behaviour ---------------------------------------------------
	{
		id: "chat-behaviour",
		navId: "chat-behaviour",
		label: "Chat behaviour",
		description: "How new messages join an ongoing chat, and what to do when things go long.",
		cards: [
			{
				title: "While the AI is replying",
				description: "What happens when you type a message while the AI is still streaming.",
				fields: [
					{
						path: "steeringMode",
						label: "New messages while replying",
						hint: "Queue them up and deliver them one at a time, or send them all at once.",
						kind: "select",
						options: deliveryOptions,
						runtimeSync: "steeringMode",
					},
				],
			},
			{
				title: "After the AI finishes",
				description: "What happens when you type a message after the reply is complete.",
				fields: [
					{
						path: "followUpMode",
						label: "New messages after replying",
						hint: "Send the next message straight away, or wait for the current one to finish.",
						kind: "select",
						options: deliveryOptions,
						runtimeSync: "followUpMode",
					},
				],
			},
			{
				title: "Long chats",
				description: "A-Coder can summarise older messages to keep the chat responsive.",
				defaultCollapsed: true,
				fields: [
					{
						path: "compaction.enabled",
						label: "Summarise older messages automatically",
						hint: "Compress old messages when the conversation gets very long.",
						kind: "toggle",
						runtimeSync: "autoCompaction",
					},
					{
						path: "compaction.reserveTokens",
						label: "Space reserved for the prompt and reply",
						hint: "Roughly how much room stays free for the next question and answer.",
						kind: "number",
						min: 0,
						step: 1024,
						advanced: true,
					},
					{
						path: "compaction.keepRecentTokens",
						label: "Recent conversation to keep unsummarised",
						hint: "How much of the latest chat stays in full detail.",
						kind: "number",
						min: 0,
						step: 1024,
						advanced: true,
					},
					{
						path: "branchSummary.reserveTokens",
						label: "Space reserved for branched summaries",
						hint: "Room set aside when saving a copy of a long conversation.",
						kind: "number",
						min: 0,
						step: 1024,
						advanced: true,
					},
					{
						path: "branchSummary.skipPrompt",
						label: "Don't ask before summarising a branch",
						kind: "toggle",
					},
				],
			},
			{
				title: "When something goes wrong",
				description: "How to recover from network blips and provider errors.",
				defaultCollapsed: true,
				fields: [
					{
						path: "retry.enabled",
						label: "Try again when a request fails",
						hint: "Automatically retry transient errors.",
						kind: "toggle",
						runtimeSync: "autoRetry",
					},
					{
						path: "retry.maxRetries",
						label: "How many times to retry",
						kind: "number",
						min: 0,
						max: 20,
						advanced: true,
					},
					{
						path: "retry.baseDelayMs",
						label: "Wait between retries (ms)",
						kind: "number",
						min: 100,
						step: 100,
						advanced: true,
					},
					{
						path: "retry.provider.timeoutMs",
						label: "Give up after (ms)",
						kind: "number",
						min: 0,
						step: 1000,
						advanced: true,
					},
					{
						path: "retry.provider.maxRetries",
						label: "Provider retries",
						kind: "number",
						min: 0,
						max: 20,
						advanced: true,
					},
					{
						path: "retry.provider.maxRetryDelayMs",
						label: "Max delay between retries (ms)",
						kind: "number",
						min: 0,
						step: 1000,
						advanced: true,
					},
				],
			},
		],
	},

	// ---- Privacy ----------------------------------------------------------
	{
		id: "privacy",
		navId: "privacy",
		label: "Privacy",
		description: "What we send out, and how the network behaves.",
		fields: [
			{
				path: "enableInstallTelemetry",
				label: "Tell us when you install",
				hint: "Anonymous ping on first launch so we know the app is being used.",
				kind: "toggle",
			},
			{
				path: "enableAnalytics",
				label: "Share anonymous usage",
				hint: "Opt-in to anonymised usage data. You can switch this off any time.",
				kind: "toggle",
			},
			{
				path: "warnings.anthropicExtraUsage",
				label: "Warn before using Anthropic's paid plan",
				hint: "Show a warning if a request would use Anthropic's extra-usage quota.",
				kind: "toggle",
			},
			{
				path: "httpProxy",
				label: "Network proxy",
				hint: "Proxy URL applied to outbound requests (leave empty for none).",
				kind: "text",
				advanced: true,
			},
			{
				path: "httpIdleTimeoutMs",
				label: "Disconnect after idle (ms)",
				hint: "0 to disable.",
				kind: "number",
				min: 0,
				step: 1000,
				advanced: true,
			},
			{
				path: "websocketConnectTimeoutMs",
				label: "Real-time connection timeout (ms)",
				hint: "0 to disable.",
				kind: "number",
				min: 0,
				step: 1000,
				advanced: true,
			},
		],
	},

	// ---- Tools & permissions ---------------------------------------------
	{
		id: "tools-and-permissions",
		navId: "tools-and-permissions",
		label: "Tools & permissions",
		description: "Decide what the AI is allowed to do on your computer.",
		fields: [
			{
				path: "defaultProjectTrust",
				label: "When you open a new project",
				hint: "Should A-Coder automatically trust it, never trust it, or ask?",
				kind: "select",
				options: trustOptions,
			},
			{
				path: "permissionMode",
				label: "What the AI can do without asking",
				hint: "Read files only, ask first, or just go ahead.",
				kind: "select",
				options: permissionOptions,
			},
			{
				path: "doubleEscapeAction",
				label: "Pressing Escape twice with an empty prompt",
				hint: "What should happen when you press Escape twice in a row?",
				kind: "select",
				options: doubleEscapeOptions,
			},
			{
				path: "treeFilterMode",
				label: "Conversation tree default",
				hint: "What the conversation tree shows by default.",
				kind: "select",
				options: treeFilterOptions,
			},
			{
				path: "externalEditor",
				label: "Editor opened with Ctrl+G",
				hint: "Leave empty to use your system's default editor.",
				kind: "text",
			},
			{
				path: "shellPath",
				label: "Use a different shell",
				hint: "Path to a shell other than the system default.",
				kind: "text",
			},
			{
				path: "shellCommandPrefix",
				label: "Run before every shell command",
				hint: "Useful for setting up aliases before each command.",
				kind: "textarea",
				advanced: true,
			},
			{
				path: "npmCommand",
				label: "npm command",
				hint: "How to run npm for installing extensions.",
				kind: "object",
				advanced: true,
			},
			{
				path: "sessionDir",
				label: "Where to save conversations",
				hint: "Folder where chat history is stored.",
				kind: "text",
				advanced: true,
			},
			{
				path: "enableSkillCommands",
				label: "Show skills as /commands",
				kind: "toggle",
				advanced: true,
			},
		],
	},

	// ---- Voice -----------------------------------------------------------
	{
		id: "voice",
		navId: "voice",
		label: "Voice",
		description: "Speech-to-text and text-to-speech endpoints (OpenAI-compatible).",
	},

	// ---- Advanced ---------------------------------------------------------
	{
		id: "advanced",
		navId: "advanced",
		label: "Advanced",
		description: "Everything else. Edit settings.json directly when you need fine-grained control.",
		defaultCollapsed: true,
		fields: [
			{
				path: "extensions",
				label: "Local extensions",
				hint: "One path per line.",
				kind: "path-list",
			},
			{
				path: "skills",
				label: "Local skills",
				hint: "One path per line.",
				kind: "path-list",
			},
			{
				path: "prompts",
				label: "Local prompt templates",
				hint: "One path per line.",
				kind: "path-list",
			},
			{
				path: "themes",
				label: "Local themes",
				hint: "One path per line.",
				kind: "path-list",
			},
			{
				path: "permissionPolicies",
				label: "Permission policies",
				hint: "Detailed rules for what the AI may do, used when 'Use permission policies' is on.",
				kind: "custom",
				widget: "permissionPolicies",
			},
			{
				path: "packages",
				label: "Skill packs & add-ons",
				hint: "Sources for extra skills, themes, prompts and extensions.",
				kind: "custom",
				widget: "packages",
			},
			{
				path: "thinkingBudgets",
				label: "Custom thinking budgets",
				hint: "Fine-tune how long the AI thinks at each reasoning level (minimal/low/medium/high).",
				kind: "object",
			},
			{
				path: "lastChangelogVersion",
				label: "Last shown changelog version",
				kind: "text",
			},
		],
	},

	// ---- External tools ---------------------------------------------------
	{
		id: "external-tools",
		navId: "external-tools",
		label: "External tools",
		description: "Connect the assistant to other apps and data sources.",
		fields: [
			{
				path: "mcpServers",
				label: "External tools & data sources",
				hint: "Let the assistant use extra tools or read files from other apps.",
				kind: "custom",
				widget: "mcpServers",
			},
		],
	},

	// ---- Skills -----------------------------------------------------------
	// No fields — fully custom UI for managing skills and advanced resources.
	{
		id: "resources",
		navId: "resources",
		label: "Skills",
		description: "Teach the assistant new abilities by turning skills on or off and adding skill packs.",
	},

	// ---- Keybindings ------------------------------------------------------
	// No fields — fully custom UI editing keybindings.json (not settings.json).
	{
		id: "keybindings",
		navId: "keybindings",
		label: "Keybindings",
		description: "Edit keyboard shortcuts for the interactive terminal UI.",
	},
];

// ============================================================================
// Lookup helpers
// ============================================================================

export function findSection(navId: string): SettingsSection | undefined {
	return SETTINGS_SECTIONS.find((s) => s.navId === navId);
}

export function listNavItems(): { id: string; label: string }[] {
	return SETTINGS_SECTIONS.map((s) => ({ id: s.navId, label: s.label }));
}

// ============================================================================
// Resolve a value at a dotted path inside CliSettings.
// ============================================================================
export function readPath(settings: CliSettings, path: string): unknown {
	const parts = path.split(".");
	let cursor: unknown = settings;
	for (const key of parts) {
		if (cursor == null || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor;
}

/**
 * Write a value at a dotted path, returning a new CliSettings object.
 * Auto-creates nested objects along the way (handles "compaction.enabled" → {}).
 */
export function writePath(
	settings: CliSettings,
	path: string,
	value: unknown,
): CliSettings {
	const parts = path.split(".");
	if (parts.length === 0) return settings;

	const result: Record<string, unknown> = { ...settings };
	let cursor: Record<string, unknown> = result;

	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		const existing = cursor[key];
		const next: Record<string, unknown> =
			existing && typeof existing === "object" && !Array.isArray(existing)
				? { ...(existing as Record<string, unknown>) }
				: {};
		cursor[key] = next;
		cursor = next;
	}

	const lastKey = parts[parts.length - 1];
	if (value === undefined) {
		delete cursor[lastKey];
	} else {
		cursor[lastKey] = value;
	}

	// Tidy empty objects so we don't write `{ "compaction": {} }`.
	for (let i = parts.length - 2; i >= 0; i--) {
		const key = parts[i];
		const parent = i === 0 ? result : walkPath(result, parts.slice(0, i));
		const child = (parent as Record<string, unknown>)[key];
		if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0) {
			delete (parent as Record<string, unknown>)[key];
		}
	}

	return result as CliSettings;
}

function walkPath(obj: Record<string, unknown>, parts: string[]): Record<string, unknown> {
	let cursor: unknown = obj;
	for (const key of parts) {
		if (cursor == null || typeof cursor !== "object") return {};
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return (cursor as Record<string, unknown>) ?? {};
}

// ============================================================================
// Runtime-sync map: which setting keys also need an engine RPC call.
// ============================================================================
import * as rpc from "./rpc";

export type RuntimeSyncHandler = (path: string, value: unknown) => void;

export function applyRuntimeSync(path: string, value: unknown): void {
	switch (path) {
		case "defaultThinkingLevel":
			void rpc.setThinkingLevel(value as ThinkingLevel).catch(() => {});
			return;
		case "steeringMode":
			void rpc.setSteeringMode(value as MessageDeliveryMode).catch(() => {});
			return;
		case "followUpMode":
			void rpc.setFollowUpMode(value as MessageDeliveryMode).catch(() => {});
			return;
		case "compaction.enabled":
			void rpc.setAutoCompaction(Boolean(value)).catch(() => {});
			return;
		case "retry.enabled":
			void rpc.setAutoRetry(Boolean(value)).catch(() => {});
			return;
	}
}

// Helper to silence unused-variable warnings on type-only imports.
export type {
	TransportSetting,
	DefaultProjectTrust,
	PermissionMode,
	DoubleEscapeAction,
	TreeFilterMode,
};
