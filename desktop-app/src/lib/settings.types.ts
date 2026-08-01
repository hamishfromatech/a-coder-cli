// ============================================================================
// Settings types for a-coder-cli — full mirror of the cli's Settings interface
// (packages/coding-agent/src/core/settings-manager.ts).
// ============================================================================

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** How steering/follow-up messages are delivered */
export type MessageDeliveryMode = "one-at-a-time" | "all";

export type TransportSetting = "auto" | "sse" | "websocket" | "websocket-cached";

export type DefaultProjectTrust = "ask" | "always" | "never";

export type PermissionMode = "ask" | "allow" | "read-only" | "auto";

export type DoubleEscapeAction = "fork" | "tree" | "none";

export type TreeFilterMode =
	| "default"
	| "no-tools"
	| "user-only"
	| "labeled-only"
	| "all";

// ============================================================================
// Nested setting groups
// ============================================================================

export interface CompactionSettings {
	enabled?: boolean;
	reserveTokens?: number;
	keepRecentTokens?: number;
}

export interface BranchSummarySettings {
	reserveTokens?: number;
	skipPrompt?: boolean;
}

export interface ProviderRetrySettings {
	timeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
}

export interface RetrySettings {
	enabled?: boolean;
	maxRetries?: number;
	baseDelayMs?: number;
	provider?: ProviderRetrySettings;
}

export interface TerminalSettings {
	showImages?: boolean;
	imageWidthCells?: number;
	clearOnShrink?: boolean;
	showTerminalProgress?: boolean;
}

export interface ImageSettings {
	autoResize?: boolean;
	blockImages?: boolean;
}

export interface ThinkingBudgetsSettings {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export interface MarkdownSettings {
	codeBlockIndent?: string;
}

export interface WarningSettings {
	anthropicExtraUsage?: boolean;
}

export interface McpServerSettings {
	name?: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	[key: string]: unknown;
}

export type PermissionRule = string;

export interface PermissionPolicyConfig {
	allow?: PermissionRule[];
	softDeny?: PermissionRule[];
	hardDeny?: PermissionRule[];
}

export type PackageSource =
	| string
	| {
			source: string;
			extensions?: string[];
			skills?: string[];
			prompts?: string[];
			themes?: string[];
	  };

// ============================================================================
// Full settings (mirrors Settings in settings-manager.ts)
// ============================================================================

export interface CliSettings {
	lastChangelogVersion?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevel;
	transport?: TransportSetting;
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	theme?: string;
	compaction?: CompactionSettings;
	branchSummary?: BranchSummarySettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	externalEditor?: string;
	shellPath?: string;
	quietStartup?: boolean;
	defaultProjectTrust?: DefaultProjectTrust;
	shellCommandPrefix?: string;
	npmCommand?: string[];
	collapseChangelog?: boolean;
	enableInstallTelemetry?: boolean;
	enableAnalytics?: boolean;
	trackingId?: string;
	packages?: PackageSource[];
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
	enableSkillCommands?: boolean;
	terminal?: TerminalSettings;
	images?: ImageSettings;
	enabledModels?: string[];
	doubleEscapeAction?: DoubleEscapeAction;
	treeFilterMode?: TreeFilterMode;
	thinkingBudgets?: ThinkingBudgetsSettings;
	editorPaddingX?: number;
	outputPad?: 0 | 1;
	autocompleteMaxVisible?: number;
	showHardwareCursor?: boolean;
	markdown?: MarkdownSettings;
	mcpServers?: McpServerSettings[];
	warnings?: WarningSettings;
	sessionDir?: string;
	permissionMode?: PermissionMode;
	permissionPolicies?: PermissionPolicyConfig;
	httpProxy?: string;
	httpIdleTimeoutMs?: number;
	websocketConnectTimeoutMs?: number;
	/** When true, closing the window hides it to the system tray instead of quitting. */
	minimizeToTray?: boolean;
	/** Allow unknown keys so users can hand-edit raw JSON without losing data. */
	[key: string]: unknown;
}

export interface SettingsPaths {
	global: string;
	project?: string;
	auth: string;
	models: string;
	agentDir: string;
}

export interface AuthProvider {
	type: string;
	key?: string;
	env?: Record<string, string>;
	[key: string]: unknown;
}

// ============================================================================
// Runtime state — what the engine reports back.
// ============================================================================

export interface EngineState {
	model: ModelInfo | null;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: MessageDeliveryMode;
	followUpMode: MessageDeliveryMode;
	sessionFile?: string;
	sessionId?: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
	contextUsage?: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	};
}

export interface ModelInfo {
	id: string;
	name: string;
	api: string;
	provider: string;
	reasoning: boolean;
	input?: string[];
	contextWindow: number;
	maxTokens: number;
	cost?: Record<string, number>;
}
