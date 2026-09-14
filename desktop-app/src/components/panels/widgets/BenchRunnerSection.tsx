import { AlertCircle, Eye, EyeOff, FlaskConical, Loader2, Play, Square, Trophy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	benchListTasks,
	benchStart,
	benchStop,
	onBenchExit,
	onBenchLine,
	type BenchEvent,
	type BenchTaskInfo,
} from "../../../lib/bench";
import { useSettingsStore } from "../../../stores/settings-store";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";

/**
 * A-Coder Bench runner inside the settings panel. Config persists in the
 * local settings store; runs execute the CLI headlessly (`bench run --json`)
 * via the tauri bench commands, streaming progress events back here.
 */

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader className="flex items-center gap-2 py-2.5">
				{icon}
				<h3 className="text-xs font-semibold text-pi-text">{title}</h3>
			</CardHeader>
			<CardBody className="space-y-3 py-3">{children}</CardBody>
		</Card>
	);
}

function LabeledInput({
	label,
	value,
	onChange,
	placeholder,
	type = "text",
	hint,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: "text" | "password";
	hint?: string;
}) {
	const [show, setShow] = useState(false);
	const isPassword = type === "password";
	return (
		<label className="block space-y-1">
			<span className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">{label}</span>
			<div className="relative">
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					type={isPassword && !show ? "password" : "text"}
					className="w-full pr-8 font-mono text-xs"
				/>
				{isPassword && (
					<button
						type="button"
						onClick={() => setShow((v) => !v)}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-pi-text-faint hover:text-pi-text"
						tabIndex={-1}
					>
						{show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
					</button>
				)}
			</div>
			{hint && <span className="block text-2xs text-pi-text-muted">{hint}</span>}
		</label>
	);
}

function renderEventLine(event: BenchEvent): string {
	switch (event.type) {
		case "bench_progress":
			return `${stateGlyph(event.state ?? "")} ${event.taskId} · run ${event.runIndex}${event.detail ? ` — ${event.detail}` : ""}`;
		case "bench_log":
			return event.message ?? "";
		case "bench_stderr":
			return `stderr: ${event.message ?? ""}`;
		default:
			return JSON.stringify(event);
	}
}

function stateGlyph(state: string): string {
	switch (state) {
		case "running":
			return "…";
		case "pass":
			return "✓";
		case "timeout":
			return "⏱";
		case "fail":
			return "✗";
		default:
			return "○";
	}
}

export function BenchRunnerSection() {
	const s = useSettingsStore();
	const workspace = useWorkspaceStore((w) => w.current);

	const [tasks, setTasks] = useState<BenchTaskInfo[] | null>(null);
	const [taskError, setTaskError] = useState<string | null>(null);
	const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
	const [ack, setAck] = useState(false);
	const [running, setRunning] = useState(false);
	const [lines, setLines] = useState<BenchEvent[]>([]);
	const [summary, setSummary] = useState<{ passed: number; total: number; leaderboardPath: string } | null>(null);
	const [startError, setStartError] = useState<string | null>(null);
	const logRef = useRef<HTMLDivElement>(null);

	const benchDir = s.benchDir.trim() || (workspace ? `${workspace.replace(/\/$/, "")}/bench` : "");

	// Stream listeners: bound once; keep the last 200 lines.
	useEffect(() => {
		const unlisteners: Array<() => void> = [];
		let disposed = false;
		void onBenchLine((event) => {
			setLines((prev) => [...prev.slice(-199), event]);
		}).then((un) => {
			if (disposed) un();
			else unlisteners.push(un);
		});
		void onBenchExit((code) => {
			setRunning(false);
			if (code !== 0 && code !== 1) {
				setStartError(`Benchmark process exited with code ${code}.`);
			}
		}).then((un) => {
			if (disposed) un();
			else unlisteners.push(un);
		});
		return () => {
			disposed = true;
			for (const un of unlisteners) un();
		};
	}, []);

	// Auto-scroll the log.
	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
	}, [lines]);

	const loadTasks = useCallback(async () => {
		if (!benchDir.trim()) {
			setTaskError("Open a project (or set a bench directory) first.");
			return;
		}
		setTaskError(null);
		setTasks(null);
		try {
			const list = await benchListTasks(benchDir.trim());
			setTasks(list);
			setSelectedTasks(new Set(list.map((t) => t.id)));
		} catch (e) {
			setTasks(null);
			setTaskError(e instanceof Error ? e.message : String(e));
		}
	}, [benchDir]);

	const toggleTask = (id: string) => {
		setSelectedTasks((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const start = async () => {
		setStartError(null);
		setSummary(null);
		setLines([]);
		const model = s.benchModel.trim();
		if (!model.includes("/")) {
			setStartError("Model must be provider/model-id (e.g. ollama/qwen3:1.7b).");
			return;
		}
		if (!benchDir.trim()) {
			setStartError("No bench directory. Open a project with bench/tasks/ or set it below.");
			return;
		}
		if (!ack) {
			setStartError("Confirm the health & safety notes first.");
			return;
		}
		setRunning(true);
		try {
			await benchStart({
				bench_dir: benchDir.trim(),
				model,
				endpoint: s.benchEndpoint.trim() || undefined,
				api_key: s.benchApiKey.trim() || undefined,
				runs: s.benchRuns,
				tasks: selectedTasks.size > 0 ? [...selectedTasks].join(",") : undefined,
			});
		} catch (e) {
			setRunning(false);
			setStartError(e instanceof Error ? e.message : String(e));
		}
	};

	const stop = async () => {
		try {
			await benchStop();
		} finally {
			setRunning(false);
		}
	};

	const openLeaderboard = () => {
		if (summary?.leaderboardPath) {
			void import("@tauri-apps/api/core").then(({ invoke }) =>
				invoke("open_file_in_editor", { path: summary.leaderboardPath }).catch(() => undefined),
			);
		}
	};

	// Derive the latest summary event from the stream.
	const streamSummary = [...lines].reverse().find((l) => l.type === "bench_summary");

	return (
		<section className="space-y-3">
			<header>
				<h2 className="text-[15px] font-semibold tracking-tight">A-Coder Bench</h2>
				<p className="mt-0.5 text-2xs text-pi-text-muted">
					Benchmark models against this harness: each run works in an isolated copy of a task repo, is graded by a
					hidden checker, and every outcome is recorded. Requires a checkout with <code className="font-mono">bench/tasks/</code>.
				</p>
			</header>

			<SectionCard title="Model under test" icon={<FlaskConical className="h-4 w-4 text-pi-text-muted" />}>
				<LabeledInput
					label="Model"
					value={s.benchModel}
					onChange={s.setBenchModel}
					placeholder="ollama/qwen3:1.7b"
					hint="provider/model-id, as shown by the CLI model picker."
				/>
				<LabeledInput
					label="Custom endpoint (optional)"
					value={s.benchEndpoint}
					onChange={s.setBenchEndpoint}
					placeholder="http://localhost:1234/v1"
					hint="Self-hosted OpenAI-compatible server (vLLM, SGLang, LM Studio). Leave empty to use ambient auth."
				/>
				{s.benchEndpoint.trim() !== "" && (
					<LabeledInput
						label="Endpoint API key"
						value={s.benchApiKey}
						onChange={s.setBenchApiKey}
						placeholder="dummy"
						type="password"
					/>
				)}
				<label className="block space-y-1">
					<span className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Runs per task</span>
					<div className="flex gap-1.5">
						{[1, 3, 5].map((n) => (
							<button
								key={n}
								type="button"
								disabled={running}
								onClick={() => s.setBenchRuns(n)}
								className={`rounded-md px-3 py-1 text-2xs font-medium transition-colors ${
									s.benchRuns === n
										? "bg-pi-accent text-white"
										: "bg-pi-surface-raised text-pi-text-muted hover:text-pi-text"
								}`}
							>
								{n}
							</button>
						))}
					</div>
					<span className="text-2xs text-pi-text-muted">More runs give more stable pass rates (and cost more tokens).</span>
				</label>
				<LabeledInput
					label="Bench directory"
					value={s.benchDir}
					onChange={s.setBenchDir}
					placeholder={workspace ? `${workspace}/bench` : "/path/to/a-coder-cli/bench"}
					hint="Leave empty to use the open project's bench/ folder."
				/>
				<Button variant="secondary" className="w-fit" disabled={running} onClick={() => void loadTasks()}>
					{tasks === null && !taskError ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
					Load tasks
				</Button>
				{taskError && (
					<p className="flex items-start gap-1.5 text-2xs text-amber-400">
						<AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
						{taskError}
					</p>
				)}
			</SectionCard>

			{tasks && tasks.length > 0 && (
				<SectionCard title="Tasks" icon={<FlaskConical className="h-4 w-4 text-pi-text-muted" />}>
					<p className="text-2xs text-pi-text-muted">
						{selectedTasks.size === 0 ? "All tasks will run." : `${selectedTasks.size} of ${tasks.length} tasks selected.`}
					</p>
					<div className="max-h-48 space-y-1 overflow-y-auto pr-1">
						{tasks.map((task) => (
							<label
								key={task.id}
								className="flex cursor-pointer items-center gap-2.5 rounded-md bg-pi-surface-raised px-3 py-2 hover:bg-pi-surface-hover"
							>
								<input
									type="checkbox"
									checked={selectedTasks.has(task.id)}
									onChange={() => toggleTask(task.id)}
									disabled={running}
									className="h-3.5 w-3.5 accent-pi-accent"
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-xs font-medium text-pi-text">{task.id}</span>
									<span className="block truncate text-2xs text-pi-text-muted">
										{task.title} · {task.timeout_seconds}s timeout
									</span>
								</span>
							</label>
						))}
					</div>
				</SectionCard>
			)}

			<SectionCard title="Health & safety" icon={<AlertCircle className="h-4 w-4 text-amber-400" />}>
				<ul className="list-disc space-y-1.5 pl-4 text-2xs leading-relaxed text-pi-text-muted">
					<li>
						The benchmark agent runs with tools in <span className="font-semibold text-pi-text">allow mode</span>: it can
						read, write, edit, and execute bash — inside the per-run sandbox copy.
					</li>
					<li>
						The sandbox is a <span className="font-semibold text-pi-text">working directory, not a security boundary</span>.
						Only benchmark models and endpoints you trust.
					</li>
					<li>
						Paid providers consume <span className="font-semibold text-pi-text">real tokens</span>; a full run can be
						significant. Local models (Ollama, LM Studio) are free.
					</li>
					<li>The grader runs outside the agent workspace and is never shown to the model.</li>
					<li>Results are written locally under bench/ (runs/, results.jsonl, leaderboard.md).</li>
					<li>Avoid running benchmarks with production credentials in the environment.</li>
				</ul>
				<label className="flex cursor-pointer items-center gap-2.5 rounded-md bg-pi-surface-raised px-3 py-2.5">
					<input
						type="checkbox"
						checked={ack}
						onChange={(e) => setAck(e.target.checked)}
						disabled={running}
						className="h-3.5 w-3.5 accent-pi-accent"
					/>
					<span className="text-xs font-medium text-pi-text">I understand — allow the benchmark to run</span>
				</label>
			</SectionCard>

			<div className="flex items-center gap-2">
				{running ? (
					<Button variant="danger" onClick={() => void stop()}>
						<Square className="h-3.5 w-3.5" />
						Stop
					</Button>
				) : (
					<Button
						onClick={() => void start()}
						disabled={!ack || !s.benchModel.trim() || tasks === null}
					>
						<Play className="h-3.5 w-3.5" />
						Run benchmark
					</Button>
				)}
				{streamSummary && (
					<span className="text-2xs text-pi-text-muted">
						{streamSummary.passed}/{streamSummary.total} passed
					</span>
				)}
				{streamSummary?.leaderboardPath && (
					<Button variant="ghost" onClick={openLeaderboard}>
						<Trophy className="h-3.5 w-3.5" />
						View leaderboard
					</Button>
				)}
			</div>

			{startError && (
				<p className="flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-2xs text-red-400">
					<AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
					{startError}
				</p>
			)}

			{lines.length > 0 && (
				<Card>
					<CardHeader className="flex items-center justify-between py-2.5">
						<span className="text-xs font-semibold text-pi-text">Run output</span>
						{!running && (
							<button type="button" onClick={() => setLines([])} className="text-2xs text-pi-text-faint hover:text-pi-text">
								Clear
							</button>
						)}
					</CardHeader>
					<CardBody className="py-2">
						<div ref={logRef} className="max-h-64 overflow-y-auto font-mono text-2xs leading-relaxed text-pi-text-muted">
							{lines.map((event, i) => (
								<div key={`${event.type}-${i}`} className={event.type === "bench_stderr" ? "text-red-400/80" : undefined}>
									{renderEventLine(event)}
								</div>
							))}
						</div>
					</CardBody>
				</Card>
			)}
		</section>
	);
}