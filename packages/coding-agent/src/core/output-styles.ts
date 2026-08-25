/**
 * Output styles — extra system-prompt overlays that reshape HOW the agent
 * answers (tone, structure, teaching behaviour) without changing WHAT tools
 * it has. Three styles ship built-in; users can add their own as Markdown
 * files under:
 *
 *   <agentDir>/output-styles/<name>.md   (user scope)
 *   <cwd>/.a-coder-cli/output-styles/<name>.md   (project scope, wins)
 *
 * The active style is a single piece of process-global state, flipped at
 * runtime via `/output-style <name>` and persisted to settings as
 * `outputStyle`. `_buildSystemPrompt` reads the active style's prompt each
 * turn so a switch takes effect on the very next request.
 *
 * Custom file format: the whole file is the prompt, except an optional first
 * line that is a Markdown H1 (`# Description`) — it becomes the style's
 * description and is stripped from the prompt. This keeps the files readable
 * as Markdown while giving the selector a one-line label.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";

export type OutputStyleSource = "built-in" | "user" | "project";

export interface OutputStyleConfig {
	/** Style identifier — what the user passes to `/output-style <name>`. */
	name: string;
	/** One-line description shown in the `/output-style` selector. */
	description: string;
	/** Extra system-prompt text appended after the base prompt. Empty for `default`. */
	prompt: string;
	/** Where this style came from. Project overrides user overrides built-in. */
	source: OutputStyleSource;
}

const EXPLANATORY_PROMPT = `After answering, add a short "Insight" section that explains a concept the user can learn from the work just done. Keep it to 2-3 sentences and only include it when there is a genuine teaching moment — never pad a simple answer.`;

const LEARNING_PROMPT = `You are a teaching assistant. After laying out a plan or explanation, pause and hand a small, concrete piece of the implementation back to the user to write themselves. Describe what they should write and why, then wait for their attempt before continuing. Keep the hand-off small enough to be approachable.`;

const BUILT_IN_STYLES: OutputStyleConfig[] = [
	{
		name: "default",
		description: "No extra instructions; the agent behaves as designed",
		prompt: "",
		source: "built-in",
	},
	{
		name: "Explanatory",
		description: "Add a short teaching Insight block after answers",
		prompt: EXPLANATORY_PROMPT,
		source: "built-in",
	},
	{
		name: "Learning",
		description: "Hand small pieces of code back to the user to write",
		prompt: LEARNING_PROMPT,
		source: "built-in",
	},
];

const registry: Map<string, OutputStyleConfig> = new Map();
let activeName = "default";
let loaded = false;

/** Parse a custom `.md` file into a style. The first line may be `# Description`. */
function parseStyleFile(name: string, content: string, source: OutputStyleSource): OutputStyleConfig {
	const lines = content.split("\n");
	let description = "Custom style";
	let prompt = content;

	const firstLine = lines[0]?.trim() ?? "";
	if (firstLine.startsWith("# ")) {
		description = firstLine.slice(2).trim() || description;
		prompt = lines.slice(1).join("\n").replace(/^\n+/, "");
	}

	return { name, description, prompt, source };
}

/** Load `*.md` styles from a directory into the registry (later calls override). */
function loadDir(dir: string, source: OutputStyleSource): void {
	if (!existsSync(dir)) return;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const name = entry.slice(0, -3);
		const filePath = join(dir, entry);
		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}
		registry.set(name, parseStyleFile(name, content, source));
	}
}

/**
 * (Re)load built-in + custom output styles. Idempotent; safe to call on
 * `/reload`. Project-scope files override user-scope files of the same name.
 */
export function loadOutputStyles(options: { agentDir?: string; cwd?: string } = {}): void {
	const agentDir = options.agentDir ?? getAgentDir();
	const cwd = options.cwd ?? process.cwd();

	registry.clear();
	for (const style of BUILT_IN_STYLES) {
		registry.set(style.name, style);
	}
	loadDir(join(agentDir, "output-styles"), "user");
	loadDir(join(cwd, CONFIG_DIR_NAME, "output-styles"), "project");
	loaded = true;

	// If the active style disappeared after a reload, fall back to default.
	if (!registry.has(activeName)) {
		activeName = "default";
	}
}

function ensureLoaded(): void {
	if (!loaded) {
		loadOutputStyles();
	}
}

/** Look up a style by name (built-in or custom). */
export function getOutputStyle(name: string): OutputStyleConfig | undefined {
	ensureLoaded();
	return registry.get(name);
}

/** All registered styles, built-in first then custom, sorted by name within each source. */
export function listOutputStyles(): OutputStyleConfig[] {
	ensureLoaded();
	return [...registry.values()].sort((a, b) => {
		const sourceRank = a.source === "built-in" ? 0 : a.source === "user" ? 1 : 2;
		const otherRank = b.source === "built-in" ? 0 : b.source === "user" ? 1 : 2;
		if (sourceRank !== otherRank) return sourceRank - otherRank;
		return a.name.localeCompare(b.name);
	});
}

/** The currently active style's name. */
export function getActiveOutputStyleName(): string {
	ensureLoaded();
	return activeName;
}

/** The currently active style. */
export function getActiveOutputStyle(): OutputStyleConfig {
	ensureLoaded();
	return registry.get(activeName) ?? BUILT_IN_STYLES[0]!;
}

/** The active style's extra prompt, or "" when it adds nothing. */
export function getOutputStylePrompt(): string {
	return getActiveOutputStyle().prompt ?? "";
}

/**
 * Switch the active style at runtime. Returns true on success, false if the
 * name is unknown (the caller surfaces the error). Does not persist the
 * choice — the caller writes `settings.outputStyle` so the pick survives.
 */
export function setActiveOutputStyleName(name: string): boolean {
	ensureLoaded();
	if (!registry.has(name)) return false;
	activeName = name;
	return true;
}

/** Apply a persisted preference at startup. Unknown values silently fall back. */
export function applyPersistedOutputStyle(name: string | undefined): void {
	ensureLoaded();
	if (name && registry.has(name)) {
		activeName = name;
	} else {
		activeName = "default";
	}
}
