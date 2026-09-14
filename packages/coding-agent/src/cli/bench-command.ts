/**
 * `a-coder bench` subcommand: interactive A-Coder Bench wizard.
 *
 * Handled before parseArgs so `bench` is never mistaken for a prompt.
 * Flow: model selection -> runs -> tasks -> briefing -> health & safety
 * confirmation -> live progress -> summary + leaderboard.
 */

import fs from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { Model } from "@earendil-works/pi-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Markdown,
	ProcessTerminal,
	SelectList,
	Spacer,
	Text,
	TUI,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import {
	ensureBenchDir,
	loadResults,
	loadTasks,
	materializeStarterTasks,
	parseBenchModelSpec,
	resolveBenchChildCommand,
	runTaskOnce,
} from "../bench/core.ts";
import { buildLeaderboard } from "../bench/report-core.ts";
import type { BenchChildCommand, BenchRunResult, BenchTask } from "../bench/types.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRegistry } from "../core/model-registry.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { DynamicBorder } from "../modes/interactive/components/dynamic-border.ts";
import { getMarkdownTheme, getSelectListTheme, initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.ts";

// ---------------------------------------------------------------------------
// Flags / help
// ---------------------------------------------------------------------------

interface BenchFlags {
	help: boolean;
	model?: string;
	endpoint?: string;
	api: string;
	apiKey: string;
	runs?: number;
	tasks?: string;
	benchDir?: string;
	json: boolean;
}

function parseBenchFlags(args: string[]): BenchFlags {
	const flags: BenchFlags = { help: false, api: "openai-completions", apiKey: "bench", json: false };
	const valueFlags = new Set(["--model", "--endpoint", "--api", "--api-key", "--runs", "--tasks", "--bench-dir"]);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			flags.help = true;
		} else if (arg === "--json") {
			flags.json = true;
		} else if (valueFlags.has(arg)) {
			const value = args[i + 1] ?? "";
			i += 1;
			if (arg === "--model") flags.model = value;
			else if (arg === "--endpoint") flags.endpoint = value;
			else if (arg === "--api") flags.api = value;
			else if (arg === "--api-key") flags.apiKey = value;
			else if (arg === "--runs") flags.runs = Math.max(1, Number.parseInt(value, 10) || 1);
			else if (arg === "--tasks") flags.tasks = value;
			else if (arg === "--bench-dir") flags.benchDir = value;
		}
	}
	return flags;
}

function printBenchHelp(): void {
	console.log(
		`A-Coder Bench — benchmark models against this harness

Usage:
  a-coder bench                            Interactive wizard (model -> options -> run)
  a-coder bench init [--bench-dir <dir>]   Scaffold the embedded starter tasks (bench/tasks/)
  a-coder bench run --model <p>/<id>       Headless run (no UI); use with --json for machines
  a-coder bench --model <provider>/<id>    Skip model selection
  a-coder bench --endpoint <url>           Benchmark a self-hosted endpoint
      [--api <api>]                        openai-completions | openai-responses | anthropic-messages
      [--api-key <key>]                    Written into a per-run models.json (default: "bench")
  a-coder bench --runs <n>                 Runs per task (default: 1)

Run-mode flags:
  --tasks <id,id|all>    Task subset (default: all)
  --bench-dir <dir>      Bench directory (default: auto-detect from cwd)
  --json                 Emit NDJSON bench_progress / bench_summary events

Without a repository checkout, the wizard and 'bench init' scaffold the
embedded starter tasks into ./bench (existing files are never overwritten).
The wizard always shows the health & safety confirmation before any model
is invoked. Headless 'bench run' is for hosts that show their own warning
(the desktop settings panel does).

Bench artifacts live under bench/ in an a-coder-cli checkout:
  bench/tasks/     task definitions (repo snapshot + hidden grader each)
  bench/runs/      per-run sandboxes and raw event streams
  bench/results.jsonl + bench/leaderboard.md`,
	);
}

// ---------------------------------------------------------------------------
// Wizard component
// ---------------------------------------------------------------------------

type WizardStep = "model" | "runs" | "tasks" | "briefing" | "safety" | "running" | "summary";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<string>;
}

type JobState = "pending" | "running" | "pass" | "fail" | "timeout";

interface JobProgress {
	label: string;
	state: JobState;
	detail: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const EMBED_MODEL_PATTERN = /(^|[-_])(embed|bge-|minilm|rerank)|(^|[-_])embed/i;
const KEYLESS_PROVIDERS = new Set(["ollama", "lm-studio", "llama-cpp"]);
const STEP_TITLES: Record<WizardStep, string> = {
	model: "1/4 · select model",
	runs: "2/4 · runs per task",
	tasks: "3/4 · tasks",
	briefing: "4/4 · briefing",
	safety: "confirmation",
	running: "running",
	summary: "summary",
};

class BenchWizardComponent extends Container implements Focusable {
	focused = false;
	private ui: TUI;
	private registry: ModelRegistry;
	private benchDir: string;
	private tasks: BenchTask[];
	private flags: BenchFlags;
	private child: BenchChildCommand;
	private notice?: string;
	private onFinish: () => void;

	private step: WizardStep;
	private searchInput = new Input();
	private selectList: SelectList | undefined;
	private models: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];

	private chosenModel?: { provider: string; modelId: string };
	private runs: number;
	private allTasks = true;
	private chosenTask?: BenchTask;

	private progress: JobProgress[] = [];
	private spinnerFrame = 0;
	private spinnerTimer: NodeJS.Timeout | undefined;
	private results: BenchRunResult[] = [];
	private summaryMarkdown?: Markdown;

	constructor(
		ui: TUI,
		options: {
			benchDir: string;
			tasks: BenchTask[];
			registry: ModelRegistry;
			flags: BenchFlags;
			child: BenchChildCommand;
			notice?: string;
			onFinish: () => void;
		},
	) {
		super();
		this.ui = ui;
		this.benchDir = options.benchDir;
		this.tasks = options.tasks;
		this.registry = options.registry;
		this.flags = options.flags;
		this.child = options.child;
		this.notice = options.notice;
		this.onFinish = options.onFinish;
		this.runs = options.flags.runs ?? 1;

		if (options.flags.model) {
			const spec = parseBenchModelSpec(options.flags.model);
			this.chosenModel = { provider: spec.provider, modelId: spec.modelId };
			this.step = options.flags.runs ? "briefing" : "runs";
		} else {
			this.step = "model";
		}

		this.searchInput.onSubmit = () => {
			const first = this.filteredModels[0];
			if (first) this.selectModel(first);
		};

		this.rebuild();
		if (this.step === "model") void this.loadModels();
	}

	// -- data ----------------------------------------------------------------

	private async loadModels(): Promise<void> {
		// Local providers (ollama, LM Studio, llama.cpp) are only discovered by
		// probing the local server; refresh before painting the catalog.
		try {
			await this.registry.refreshDynamicModels();
		} catch {
			// best-effort: fall back to the cached catalog
		}
		try {
			this.models = this.registry
				.getAvailable()
				.filter((m) => !EMBED_MODEL_PATTERN.test(m.id))
				.map((model) => ({ provider: model.provider, id: model.id, model }))
				.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
		} catch {
			this.models = [];
		}
		if (this.step === "model") {
			this.applyModelFilter();
			this.ui.requestRender();
		}
	}

	private applyModelFilter(): void {
		const query = this.searchInput.getValue();
		this.filteredModels = query
			? fuzzyFilter(this.models, query, ({ id, provider, model }) => `${provider}/${id} ${model.name ?? ""}`)
			: this.models;
		this.selectList?.setItems(
			this.filteredModels.map((m) => ({
				value: `${m.provider}/${m.id}`,
				label: `${m.provider}/${m.id}`,
				description: this.describeModel(m),
			})),
		);
	}

	private describeModel(item: ModelItem): string {
		const ctx = item.model.contextWindow > 0 ? `${Math.round(item.model.contextWindow / 1000)}k ctx` : "ctx ?";
		const local = KEYLESS_PROVIDERS.has(item.provider) ? " · local" : "";
		const reasoning = item.model.reasoning ? " · reasoning" : "";
		return `${ctx}${local}${reasoning}`;
	}

	// -- step transitions ----------------------------------------------------

	private selectModel(item: ModelItem): void {
		this.chosenModel = { provider: item.provider, modelId: item.id };
		this.step = this.flags.runs ? "briefing" : "runs";
		this.rebuild();
	}

	private back(): void {
		switch (this.step) {
			case "runs":
				this.step = "model";
				break;
			case "tasks":
				this.step = "runs";
				break;
			case "briefing":
				this.step = "tasks";
				break;
			case "safety":
				this.step = "briefing";
				break;
			default:
				this.finish();
				return;
		}
		this.rebuild();
	}

	private finish(): void {
		this.stopSpinner();
		this.onFinish();
	}

	// -- rendering -----------------------------------------------------------

	private rebuild(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(`${chalk.bold("A-Coder Bench")}${chalk.dim(` · ${STEP_TITLES[this.step]}`)}`, 0, 0));
		this.addChild(new Spacer(1));
		switch (this.step) {
			case "model":
				this.renderModelStep();
				break;
			case "runs":
				this.renderRunsStep();
				break;
			case "tasks":
				this.renderTasksStep();
				break;
			case "briefing":
				this.renderBriefingStep();
				break;
			case "safety":
				this.renderSafetyStep();
				break;
			case "running":
				this.renderRunningStep();
				break;
			case "summary":
				this.renderSummaryStep();
				break;
		}
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	private makeSelectList(
		items: Array<{ value: string; label: string; description?: string }>,
		onSelect: (value: string) => void,
	): SelectList {
		const list = new SelectList(items, Math.max(6, Math.min(12, this.ui.terminal.rows - 10)), getSelectListTheme());
		list.onSelect = (item) => onSelect(item.value);
		list.onCancel = () => this.back();
		this.addChild(list);
		this.selectList = list;
		return list;
	}

	private renderModelStep(): void {
		if (this.notice) {
			this.addChild(new Text(chalk.yellow(this.notice), 0, 0));
			this.addChild(new Spacer(1));
		}
		this.addChild(new Text(chalk.dim("Type to filter · ↑/↓ to move · Enter to select · Esc to quit"), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));
		this.makeSelectList([], (value) => {
			const item = this.filteredModels.find((m) => `${m.provider}/${m.id}` === value);
			if (item) this.selectModel(item);
		});
		this.applyModelFilter();
		this.searchInput.focused = true;
	}

	private renderRunsStep(): void {
		const chosen = this.chosenModel ? chalk.bold(`${this.chosenModel.provider}/${this.chosenModel.modelId}`) : "";
		this.addChild(new Text(`Model: ${chosen}`, 0, 0));
		this.addChild(new Text(chalk.dim("How many runs per task? (more runs = more stable pass@k, more tokens)"), 0, 0));
		this.addChild(new Spacer(1));
		this.makeSelectList(
			[1, 3, 5].map((n) => ({
				value: String(n),
				label: `${n} run${n > 1 ? "s" : ""} per task`,
				description: n === 1 ? "fastest" : n === 3 ? "recommended" : "thorough",
			})),
			(value) => {
				this.runs = Number.parseInt(value, 10);
				this.step = "tasks";
				this.rebuild();
			},
		);
	}

	private renderTasksStep(): void {
		this.addChild(new Text(chalk.dim(`${this.tasks.length} task(s) available · pick one or run all`), 0, 0));
		this.addChild(new Spacer(1));
		this.makeSelectList(
			[
				{
					value: "__all__",
					label: `All tasks (${this.tasks.length})`,
					description: "full benchmark run",
				},
				...this.tasks.map((t) => ({
					value: t.id,
					label: t.id,
					description: `${t.title} · ${t.tags.join(", ")} · ${t.timeoutSeconds}s timeout`,
				})),
			],
			(value) => {
				this.allTasks = value === "__all__";
				this.chosenTask = this.allTasks ? undefined : this.tasks.find((t) => t.id === value);
				this.step = "briefing";
				this.rebuild();
			},
		);
	}

	private renderBriefingStep(): void {
		const modelLine = this.chosenModel
			? `${chalk.bold(`${this.chosenModel.provider}/${this.chosenModel.modelId}`)}${
					this.flags.endpoint ? chalk.dim(` via ${this.flags.endpoint}`) : ""
				}`
			: "?";
		const taskCount = this.allTasks ? this.tasks.length : 1;
		const jobCount = taskCount * this.runs;
		const lines = [
			`${chalk.bold("How this benchmark works")}`,
			"",
			`  Model:      ${modelLine}`,
			`  Tasks:      ${this.allTasks ? `all ${this.tasks.length} tasks` : (this.chosenTask?.id ?? "?")}`,
			`  Runs:       ${this.runs} per task → ${jobCount} total agent run${jobCount === 1 ? "" : "s"}`,
			"",
			"  1. Each run copies the task repo into a fresh sandbox under bench/runs/",
			"  2. The agent runs headless with tools (read, write, edit, bash) in that copy only",
			"  3. A wall-clock timeout applies; the run is killed and marked TIMEOUT if exceeded",
			"  4. A hidden grader (never visible to the agent) checks the outcome: PASS / FAIL",
			"  5. Every run is recorded to bench/results.jsonl; the leaderboard is rebuilt at the end",
			"",
			chalk.dim("Enter to continue · Esc to go back"),
		];
		for (const line of lines) this.addChild(new Text(line, 0, 0));
	}

	private renderSafetyStep(): void {
		const lines = [
			`${chalk.yellow(chalk.bold("Health & safety — read before running"))}`,
			"",
			`  ${chalk.yellow("•")} The benchmark agent runs with tools in ${chalk.bold("allow mode")}: it can read,`,
			"    write, edit, and execute bash — inside the per-run sandbox copy.",
			`  ${chalk.yellow("•")} The sandbox is a ${chalk.bold("working directory, not a security boundary")}.`,
			"    Only benchmark models and endpoints you trust.",
			`  ${chalk.yellow("•")} Paid providers consume ${chalk.bold("real tokens")}; a full run can be significant.`,
			"    Local models (Ollama, LM Studio) are free.",
			"  • The grader runs outside the agent workspace and is never shown to the model.",
			"  • Results are written locally under bench/ (runs/, results.jsonl, leaderboard.md).",
			"  • Avoid running benchmarks with production credentials in the environment.",
		];
		for (const line of lines) this.addChild(new Text(line, 0, 0));
		this.addChild(new Spacer(1));
		this.makeSelectList(
			[
				{
					value: "run",
					label: "I understand — run the benchmark",
					description: `${(this.allTasks ? this.tasks.length : 1) * this.runs} agent runs`,
				},
				{ value: "cancel", label: "Cancel", description: "exit without running anything" },
			],
			(value) => {
				if (value === "run") this.startRun();
				else this.finish();
			},
		);
	}

	private renderRunningStep(): void {
		const modelLine = this.chosenModel ? `${this.chosenModel.provider}/${this.chosenModel.modelId}` : "?";
		this.addChild(
			new Text(
				`Benchmarking ${chalk.bold(modelLine)}${this.flags.endpoint ? chalk.dim(` via ${this.flags.endpoint}`) : ""}`,
				0,
				0,
			),
		);
		this.addChild(new Text(chalk.dim("Ctrl+C aborts everything"), 0, 0));
		this.addChild(new Spacer(1));
		for (const job of this.progress) {
			this.addChild(new Text(renderJobLine(job, this.spinnerFrame), 0, 0));
		}
	}

	private renderSummaryStep(): void {
		const passed = this.results.filter((r) => r.pass).length;
		const headline =
			passed === this.results.length
				? chalk.green(`${passed}/${this.results.length} runs passed`)
				: `${passed}/${this.results.length} runs passed`;
		this.addChild(new Text(`${chalk.bold("Done")} — ${headline}`, 0, 0));
		if (this.summaryMarkdown) {
			this.addChild(this.summaryMarkdown);
		}
		this.addChild(new Spacer(1));
		this.addChild(new Text(chalk.dim("Raw runs: bench/runs/ · Enter or Esc to exit"), 0, 0));
	}

	// -- run loop ------------------------------------------------------------

	private startRun(): void {
		this.step = "running";
		const jobs = (this.allTasks ? this.tasks : this.chosenTask ? [this.chosenTask] : []).flatMap((task) =>
			Array.from({ length: this.runs }, (_, i) => ({ task, runIndex: i + 1 })),
		);
		this.progress = jobs.map((j) => ({ label: `${j.task.id} · run ${j.runIndex}`, state: "pending", detail: "" }));
		this.rebuild();
		this.spinnerTimer = setInterval(() => {
			this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
			// The running step's lines are built from this.progress; re-render
			// the step (not just the static tree) so state changes show live.
			if (this.step === "running") {
				this.rebuild();
			} else {
				this.ui.requestRender();
			}
		}, 120);
		void this.executeJobs(jobs);
	}

	private async executeJobs(jobs: Array<{ task: BenchTask; runIndex: number }>): Promise<void> {
		for (let i = 0; i < jobs.length; i++) {
			const job = jobs[i];
			if (!job) break;
			this.progress[i] = { label: `${job.task.id} · run ${job.runIndex}`, state: "running", detail: "" };
			const spec = this.chosenModel ?? { provider: "", modelId: "" };
			const result = await runTaskOnce({
				benchDir: this.benchDir,
				task: job.task,
				provider: spec.provider,
				modelId: spec.modelId,
				runIndex: job.runIndex,
				endpoint: this.flags.endpoint,
				apiKey: this.flags.apiKey,
				api: this.flags.api,
				child: this.child,
			});
			this.results.push(result);
			const state: JobState = result.pass ? "pass" : result.timedOut ? "timeout" : "fail";
			this.progress[i] = {
				label: `${job.task.id} · run ${job.runIndex}`,
				state,
				detail: `${Math.round(result.durationMs / 1000)}s · ${result.stats.usage.totalTokens} tok · ${result.stats.turns} turns`,
			};
			this.ui.requestRender();
		}
		this.stopSpinner();
		this.resultsToSummary();
	}

	private resultsToSummary(): void {
		this.results.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runIndex - b.runIndex);
		const leaderboard = buildLeaderboard(loadResults(this.benchDir));
		try {
			const { writeFileSync } = fs;
			writeFileSync(join(this.benchDir, "leaderboard.md"), `${leaderboard}\n`);
		} catch {
			// non-fatal: the summary still shows the leaderboard inline
		}
		this.summaryMarkdown = new Markdown(leaderboard, 0, 0, getMarkdownTheme());
		this.step = "summary";
		this.rebuild();
	}

	private stopSpinner(): void {
		if (this.spinnerTimer) {
			clearInterval(this.spinnerTimer);
			this.spinnerTimer = undefined;
		}
	}

	// -- input ---------------------------------------------------------------

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (this.step === "model") {
			if (
				kb.matches(keyData, "tui.select.up") ||
				kb.matches(keyData, "tui.select.down") ||
				kb.matches(keyData, "tui.select.confirm")
			) {
				this.selectList?.handleInput(keyData);
			} else if (kb.matches(keyData, "tui.select.cancel")) {
				this.finish();
			} else {
				this.searchInput.handleInput(keyData);
				this.applyModelFilter();
			}
			return;
		}
		if (this.step === "running") {
			return; // no input during a run; Ctrl+C kills the process
		}
		if (this.step === "summary") {
			if (kb.matches(keyData, "tui.select.confirm") || kb.matches(keyData, "tui.select.cancel")) {
				this.finish();
			}
			return;
		}
		// list-based steps
		if (kb.matches(keyData, "tui.select.cancel")) {
			this.back();
			return;
		}
		if (this.step === "briefing") {
			if (kb.matches(keyData, "tui.select.confirm")) {
				this.step = "safety";
				this.rebuild();
			}
			return;
		}
		this.selectList?.handleInput(keyData);
	}
}

function renderJobLine(job: JobProgress, spinnerFrame: number): string {
	const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? "";
	switch (job.state) {
		case "pending":
			return chalk.dim(`  ○ ${job.label}`);
		case "running":
			return chalk.cyan(frame) + chalk.reset(` ${job.label} …`);
		case "pass":
			return chalk.green(`  ✓ ${job.label}`) + chalk.dim(` — ${job.detail}`);
		case "timeout":
			return chalk.yellow(`  ⏱ ${job.label}`) + chalk.dim(` — TIMEOUT · ${job.detail}`);
		case "fail":
			return chalk.red(`  ✗ ${job.label}`) + chalk.dim(` — ${job.detail}`);
	}
}

// ---------------------------------------------------------------------------
// Headless run mode (`bench run`) — used by hosts (desktop) that show their
// own safety UI and just want structured progress events.
// ---------------------------------------------------------------------------

/** Emit one NDJSON bench event on stdout (for headless runs). */
function emitBenchEvent(event: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function runBenchHeadless(
	benchDir: string,
	tasks: BenchTask[],
	spec: { provider: string; modelId: string },
	flags: BenchFlags,
): Promise<void> {
	const runs = flags.runs ?? 1;
	const jobs = tasks.flatMap((task) => Array.from({ length: runs }, (_, i) => ({ task, runIndex: i + 1 })));
	const emit = (event: Record<string, unknown>): void => {
		process.stdout.write(`${JSON.stringify(event)}\n`);
	};
	const log = (message: string): void => {
		if (flags.json) emit({ type: "bench_log", message });
		else console.log(message);
	};

	log(
		`A-Coder Bench: model=${spec.provider}/${spec.modelId} tasks=${tasks.map((t) => t.id).join(",")} runs=${runs}` +
			(flags.endpoint ? ` endpoint=${flags.endpoint}` : ""),
	);
	const child = resolveBenchChildCommand();
	const results: BenchRunResult[] = [];
	for (const job of jobs) {
		if (flags.json) {
			emit({ type: "bench_progress", taskId: job.task.id, runIndex: job.runIndex, state: "running" });
		}
		const result = await runTaskOnce({
			benchDir,
			task: job.task,
			provider: spec.provider,
			modelId: spec.modelId,
			runIndex: job.runIndex,
			endpoint: flags.endpoint,
			apiKey: flags.apiKey,
			api: flags.api,
			child,
		});
		results.push(result);
		const state = result.pass ? "pass" : result.timedOut ? "timeout" : "fail";
		const detail = `${Math.round(result.durationMs / 1000)}s · ${result.stats.usage.totalTokens} tok · ${result.stats.turns} turns`;
		if (flags.json) {
			emit({ type: "bench_progress", taskId: job.task.id, runIndex: job.runIndex, state, detail });
		} else {
			log(`  [${job.task.id} r${job.runIndex}] ${state.toUpperCase()} (${detail})`);
		}
	}
	const passed = results.filter((r) => r.pass).length;
	const leaderboardPath = join(benchDir, "leaderboard.md");
	try {
		const leaderboard = buildLeaderboard(loadResults(benchDir));
		fs.writeFileSync(leaderboardPath, `${leaderboard}\n`);
	} catch {
		// non-fatal: summary still reports counts
	}
	if (flags.json) {
		emit({
			type: "bench_summary",
			passed: passed,
			total: results.length,
			leaderboardPath: leaderboardPath,
		});
	} else {
		log(`done: ${passed}/${results.length} passed`);
	}
	process.exitCode = 0;
}

// ---------------------------------------------------------------------------
// Wizard bootstrap
// ---------------------------------------------------------------------------

async function runBenchWizard(benchDir: string, tasks: BenchTask[], flags: BenchFlags, notice?: string): Promise<void> {
	const cwd = process.cwd();
	const settingsManager = SettingsManager.create(cwd);
	initTheme(settingsManager.getTheme(), false);
	const registry = ModelRegistry.create(AuthStorage.create());
	const child = resolveBenchChildCommand();

	return new Promise<void>((resolve) => {
		const ui = new TUI(new ProcessTerminal(), settingsManager.getShowHardwareCursor());
		let done = false;
		const wizard = new BenchWizardComponent(ui, {
			benchDir,
			tasks,
			registry,
			flags,
			child,
			notice,
			onFinish: () => {
				if (done) return;
				done = true;
				ui.stop();
				stopThemeWatcher();
				resolve();
			},
		});
		ui.addChild(wizard);
		ui.setFocus(wizard);
		ui.start();
	});
}

// ---------------------------------------------------------------------------
// Subcommand entry
// ---------------------------------------------------------------------------

export async function handleBenchCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "bench") return false;
	if (args[1] === "init") {
		const flags = parseBenchFlags(args.slice(2));
		const target = flags.benchDir ?? join(process.cwd(), "bench");
		const summary = materializeStarterTasks(target);
		console.log(
			`A-Coder Bench: scaffolded starter tasks in ${summary.benchDir} (${summary.written} written, ${summary.skipped} already existed).`,
		);
		console.log(`Tasks: ${summary.taskIds.join(", ")}`);
		console.log(
			"Run `a-coder bench` here to start benchmarking, or point the desktop Bench panel at this directory.",
		);
		return true;
	}
	if (args[1] === "run") {
		const flags = parseBenchFlags(args.slice(2));
		if (!flags.model) {
			console.error(chalk.red("bench run requires --model <provider>/<model-id>"));
			process.exitCode = 2;
			return true;
		}
		const spec = parseBenchModelSpec(flags.model);
		const ensured = ensureBenchDir(flags.benchDir);
		if (!ensured) {
			console.error(
				chalk.red("A-Coder Bench tasks not found.") +
					" Run from a repository checkout with bench/tasks/ or pass --bench-dir.",
			);
			process.exitCode = 2;
			return true;
		}
		if (ensured.written > 0) {
			const note = `No bench/tasks found nearby - scaffolded ${ensured.written} starter task files into ${ensured.benchDir}.`;
			if (flags.json) emitBenchEvent({ type: "bench_log", message: note });
			else console.log(note);
		}
		const benchDir = ensured.benchDir;
		const tasks = loadTasks(benchDir);
		const selected =
			flags.tasks && flags.tasks !== "all"
				? tasks.filter((t) =>
						flags.tasks
							?.split(",")
							.map((s) => s.trim())
							.includes(t.id),
					)
				: tasks;
		if (selected.length === 0) {
			console.error(chalk.red("No bench tasks matched."));
			process.exitCode = 2;
			return true;
		}
		await runBenchHeadless(benchDir, selected, spec, flags);
		return true;
	}
	const flags = parseBenchFlags(args.slice(1));
	if (flags.help) {
		printBenchHelp();
		return true;
	}
	if (flags.model) {
		parseBenchModelSpec(flags.model); // fail fast on malformed specs
	}
	const ensured = ensureBenchDir();
	if (!ensured) {
		console.error(
			chalk.red("A-Coder Bench tasks not found.") +
				" Run from an a-coder-cli repository checkout that has bench/tasks/.",
		);
		return true;
	}
	let wizardNotice: string | undefined;
	if (ensured.written > 0) {
		wizardNotice = `No bench/tasks found nearby - scaffolded the 5 starter tasks into ${ensured.benchDir}.`;
	}
	const benchDir = ensured.benchDir;
	const tasks = loadTasks(benchDir);
	if (tasks.length === 0) {
		console.error(chalk.red("No bench tasks found in bench/tasks/."));
		return true;
	}
	await runBenchWizard(benchDir, tasks, flags, wizardNotice);
	return true;
}
