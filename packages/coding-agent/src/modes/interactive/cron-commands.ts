/**
 * Scheduled tasks — TUI slash-command surface (`/cron`, `/schedule`).
 *
 * Text-first: scheduled tasks for the main coding agent. The rich surface is
 * the desktop's Cron panel; here you list, add, run, pause/resume, and remove
 * jobs from the terminal.
 *
 * Schedules: `every:30m`, `daily:HH:MM`, `once:<ISO-or-epoch>`,
 * `on:turn-end`, `on:commit` (event triggers).
 */

import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import { formatWeeklySchedule, parseDayList } from "../../core/cron/schedule-parser.ts";
import { type CronJobInput, CronService } from "../../core/cron/service.ts";
import type { CronJob, CronSchedule, CronSnapshot } from "../../core/cron/types.ts";
import { isValidDailyTime } from "../../core/office/errands.ts";
import { theme } from "./theme/theme.ts";

function dim(text: string): string {
	return theme.fg("dim", text);
}

function bold(text: string): string {
	return theme.bold(text);
}

function errorText(text: string): string {
	return theme.fg("error", text);
}

function scheduleText(schedule: CronSchedule): string {
	if (schedule.kind === "every") return `every ${Math.max(5, Math.floor(schedule.minutes))}m`;
	if (schedule.kind === "daily") return `daily ${schedule.time}`;
	if (schedule.kind === "weekly") return formatWeeklySchedule(schedule.days, schedule.time);
	if (schedule.kind === "event") {
		return schedule.trigger === "turn_end" ? "on turn end" : "on commit";
	}
	return `once at ${new Date(schedule.at).toLocaleString()}`;
}

function triageText(job: CronJob): string {
	const triage = job.lastTriage;
	if (!triage) return "";
	if (triage.outcome === "unavailable") return " · triage unavailable";
	if (triage.recommendedAction === "pause") return " · pause suggested";
	if (triage.recommendedAction === "retry") return " · retry suggested";
	if (triage.recommendedAction === "notify") return " · needs attention";
	return " · quiet";
}

function formatCronList(snapshot: CronSnapshot, cwd: string): string {
	const lines: string[] = [bold("Scheduled tasks"), ""];
	const here = snapshot.jobs.filter((j) => j.cwd === cwd);
	const elsewhere = snapshot.jobs.filter((j) => j.cwd !== cwd);

	if (snapshot.jobs.length === 0) {
		lines.push(dim('  (none — ask naturally: "schedule a task every weekday at 9am to ...")'));
	}
	const renderJob = (job: CronJob) => {
		const isEvent = job.schedule.kind === "event";
		const next = job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : isEvent ? "awaiting event" : "—";
		const status =
			job.lastStatus === "error" || job.lastStatus === "timeout"
				? ` · ${job.lastStatus}${job.lastError ? `: ${job.lastError.slice(0, 60)}` : ""}`
				: job.lastStatus === "ok"
					? " · ok"
					: "";
		const policy = [
			job.concurrencyPolicy && job.concurrencyPolicy !== "coalesce_if_active"
				? `overlap ${job.concurrencyPolicy}`
				: "",
			job.catchUpPolicy && job.catchUpPolicy !== "run_once" ? `missed ${job.catchUpPolicy}` : "",
			job.variables && job.variables.length > 0
				? `vars ${job.variables.map((variable) => variable.name).join(",")}`
				: "",
		].filter(Boolean);
		lines.push(
			`  ${job.name} ${dim(`${scheduleText(job.schedule)} · next ${next}${status}${triageText(job)}${policy.length ? ` · ${policy.join(" · ")}` : ""}${job.enabled ? "" : " · paused"}`)}`,
		);
	};
	if (here.length > 0) {
		lines.push(bold("This project"));
		for (const job of here) renderJob(job);
	}
	if (elsewhere.length > 0) {
		lines.push(bold("Other projects"));
		for (const job of elsewhere) {
			lines.push(
				`  ${job.name} ${dim(`${scheduleText(job.schedule)} · ${job.cwd}${triageText(job)}${job.enabled ? "" : " · paused"}`)}`,
			);
		}
	}
	lines.push(
		"",
		dim('  ask: "Schedule a task every weekday at 9am to ..." (the agent creates it for you)'),
		dim("  advanced: /cron add <name> every:30m|daily:HH:MM|weekly:mon,wed@HH:MM|once:<ISO> <prompt>"),
		dim("  run/pause/resume/remove: /cron run|pause|resume|remove <name>"),
		dim("  scheduled model: /cron model <provider/model|clear>"),
		dim("  history/restore: /cron history <name> · /cron restore <name> <revision-id|vN>"),
	);
	return lines.join("\n");
}

/** Parse `every:30m` | `daily:HH:MM` | `once:<ISO-or-epoch-ms>` into a schedule. */
export function parseCronSchedule(raw: string): CronSchedule | undefined {
	const value = raw.trim().toLowerCase();
	if (value.startsWith("every:")) {
		const match = /^every:(\d+)(m|h|d)?$/.exec(value);
		if (!match) return undefined;
		const amount = Number.parseInt(match[1], 10);
		if (!Number.isFinite(amount) || amount <= 0) return undefined;
		const unit = match[2] ?? "m";
		const minutes = unit === "h" ? amount * 60 : unit === "d" ? amount * 60 * 24 : amount;
		return { kind: "every", minutes };
	}
	if (value.startsWith("daily:")) {
		const time = value.slice("daily:".length).trim();
		return isValidDailyTime(time) ? { kind: "daily", time } : undefined;
	}
	if (value.startsWith("weekly:")) {
		const body = value.slice("weekly:".length).trim();
		const separator = body.lastIndexOf("@");
		if (separator === -1) return undefined;
		const days = parseDayList(body.slice(0, separator));
		const time = body.slice(separator + 1).trim();
		return days && isValidDailyTime(time) ? { kind: "weekly", days, time } : undefined;
	}
	if (value.startsWith("once:")) {
		const raw2 = value.slice("once:".length).trim();
		const epoch = /^\d{10,}$/.test(raw2) ? Number.parseInt(raw2, 10) : Date.parse(raw2);
		if (!Number.isFinite(epoch) || epoch <= Date.now()) return undefined;
		return { kind: "once", at: epoch };
	}
	if (value.startsWith("on:")) {
		const trigger = value.slice("on:".length).trim();
		if (trigger === "turn-end" || trigger === "turn_end") return { kind: "event", trigger: "turn_end" };
		if (trigger === "commit" || trigger === "git-commit" || trigger === "git_commit") {
			return { kind: "event", trigger: "git_commit" };
		}
		return undefined;
	}
	return undefined;
}

export class CronTui {
	private service: CronService | undefined;
	private readonly runtimeHost: AgentSessionRuntime;
	private readonly print: (text: string) => void;
	private readonly naturalRequest?: (text: string) => Promise<void>;

	constructor(
		runtimeHost: AgentSessionRuntime,
		print: (text: string) => void,
		naturalRequest?: (text: string) => Promise<void>,
	) {
		this.runtimeHost = runtimeHost;
		this.print = print;
		this.naturalRequest = naturalRequest;
		// Create the service now so schedule_task is wired before the first
		// /cron command; start its ticker with the UI.
		this.get(false);
	}

	private get(start = true): CronService {
		if (!this.service) {
			this.service = new CronService({ runtime: this.runtimeHost });
			if (start) this.service.start();
		}
		this.runtimeHost.setScheduleService(this.service);
		return this.service;
	}

	/** Start the fire ticker once the interactive UI is ready. */
	start(): void {
		this.get().start();
	}

	/** Session hook: a turn ended naturally — may fire on:turn-end jobs. */
	notifyTurnEnd(): void {
		// Lazy: only spins the service up when an event-triggered job exists
		// or was created before. No service yet means nothing can match.
		if (!this.service) return;
		this.service.notifyEvent({ type: "turn_end", cwd: this.runtimeHost.cwd });
	}

	async dispose(): Promise<void> {
		if (this.service) {
			this.runtimeHost.setScheduleService(undefined);
			await this.service.dispose();
			this.service = undefined;
		}
	}

	async handle(arg: string | undefined): Promise<void> {
		const service = this.get();
		const trimmed = (arg ?? "").trim();

		if (!trimmed) {
			this.print(formatCronList(await service.snapshot(), this.runtimeHost.cwd));
			return;
		}

		const [verb] = trimmed.split(/\s+/);
		const remainder = trimmed.slice(verb.length).trim();

		if (verb === "add") {
			const quoted = remainder.match(/^(["'])(.+?)\1\s+(\S+)\s+([\s\S]+)$/);
			const plain = quoted ? undefined : remainder.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
			if (!quoted && !plain) {
				if (await this.handleNatural(trimmed)) return;
				this.print(
					errorText("Usage: /cron add <name> <every:30m|daily:HH:MM|weekly:mon,wed@HH:MM|once:<ISO>> <prompt>"),
				);
				return;
			}
			const name = quoted ? quoted[2] : plain![1];
			const scheduleRaw = quoted ? quoted[3] : plain![2];
			const prompt = quoted ? quoted[4] : plain![3];
			const schedule = parseCronSchedule(scheduleRaw);
			if (!schedule) {
				if (await this.handleNatural(trimmed)) return;
				this.print(
					errorText(
						`Invalid schedule "${scheduleRaw}" — use every:30m, daily:HH:MM, weekly:mon,wed@HH:MM, or once:<ISO date>`,
					),
				);
				return;
			}
			const input: CronJobInput = { name, prompt: prompt.trim(), schedule };
			const job = await service.create(input);
			this.print(
				`${bold(job.name)} scheduled — ${scheduleText(job.schedule)}. ${dim(`Next run: ${job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : "paused"}`)}`,
			);
			return;
		}

		if (verb === "history" || verb === "restore") {
			const parts = remainder.split(/\s+/).filter(Boolean);
			if (verb === "restore") {
				const revisionKey = parts.pop();
				const key = parts.join(" ");
				if (!key || !revisionKey) {
					this.print(errorText("Usage: /cron restore <name> <revision-id|vN>"));
					return;
				}
				const job = await this.findJob(key);
				if (!job) {
					this.print(errorText(`No cron job matching "${key}" — /cron to list.`));
					return;
				}
				const revisions = await service.listRevisions(job.id);
				const wanted = revisionKey.replace(/^v/i, "");
				const target = revisions.find(
					(revision) => revision.id === revisionKey || String(revision.revision) === wanted,
				);
				if (!target) {
					this.print(errorText(`No revision "${revisionKey}" for "${job.name}".`));
					return;
				}
				const restored = await service.restoreRevision(job.id, target.id);
				this.print(
					`${bold(restored.name)} restored to v${restored.revision} — ${scheduleText(restored.schedule)}.`,
				);
				return;
			}
			const key = parts.join(" ");
			if (!key) {
				this.print(errorText("Usage: /cron history <name>"));
				return;
			}
			const job = await this.findJob(key);
			if (!job) {
				this.print(errorText(`No cron job matching "${key}" — /cron to list.`));
				return;
			}
			const revisions = await service.listRevisions(job.id);
			if (revisions.length === 0) {
				this.print(dim(`No saved revisions for "${job.name}".`));
				return;
			}
			this.print(
				[
					bold(`History — ${job.name}`),
					...revisions.map(
						(revision) =>
							`  v${revision.revision} ${dim(`${revision.reason} · ${new Date(revision.createdAt).toLocaleString()} · ${revision.config.name}`)}`,
					),
				].join("\n"),
			);
			return;
		}

		if (verb === "run" || verb === "pause" || verb === "resume" || verb === "remove") {
			const tokens = remainder.split(/\s+/).filter(Boolean);
			const variableTokens = tokens.filter((token) => token.includes("="));
			const key = tokens.filter((token) => !token.includes("=")).join(" ");
			if (!key) {
				this.print(errorText(`Usage: /cron ${verb} <name>${verb === "run" ? " [key=value ...]" : ""}`));
				return;
			}
			const job = await this.findJob(key);
			if (!job) {
				this.print(errorText(`No cron job matching "${key}" — /cron to list.`));
				return;
			}

			if (verb === "run") {
				const variables = Object.fromEntries(
					variableTokens.map((token) => {
						const separator = token.indexOf("=");
						return [token.slice(0, separator), token.slice(separator + 1)];
					}),
				);
				this.print(dim(`Running "${job.name}" now…`));
				await service.runNow(job.id, variables);
				this.print(`${bold(job.name)} fired — the run lands in this session or the project's session tree.`);
				return;
			}
			if (verb === "pause" || verb === "resume") {
				const updated = await service.update(job.id, { enabled: verb === "resume" });
				this.print(
					`${bold(updated.name)} ${updated.enabled ? `resumed — next run ${updated.nextRunAt ? new Date(updated.nextRunAt).toLocaleString() : ""}` : "paused"}.`,
				);
				return;
			}
			await service.remove(job.id);
			this.print(`${bold(job.name)} removed.`);
			return;
		}

		if (verb === "model") {
			await this.handleModelCommand(remainder.trim());
			return;
		}

		if (await this.handleNatural(trimmed)) return;

		this.print(
			errorText(`Unknown subcommand "${verb}".`) +
				dim(" Use /cron, /cron add, /cron run|pause|resume|remove, or ask naturally."),
		);
	}

	/**
	 * /cron model — view, set, or clear the scheduled-task model (CLI parity
	 * with the desktop Settings picker). Validates against the registry so a
	 * typo fails here instead of failing every future fire at run time.
	 */
	async handleModelCommand(value: string): Promise<void> {
		if (!value) {
			const current = this.runtimeHost.services.settingsManager.getCronModel();
			this.print(
				[
					bold("Scheduled task model"),
					current
						? `  ${current}${this.modelStatusNote(current)}`
						: dim("  not set — runs use the delegated-work model, then the default chat model"),
					dim("  resolution: cron.model → subagent model → default chat model (never the job's pinned model)"),
					dim("  set: /cron model <provider/model> · clear: /cron model clear"),
				].join("\n"),
			);
			return;
		}

		if (value.toLowerCase() === "clear") {
			this.runtimeHost.services.settingsManager.setCronModel(undefined);
			this.print(
				dim("Scheduled task model cleared — runs use the delegated-work model, then the default chat model."),
			);
			return;
		}

		const separator = value.indexOf("/");
		if (separator <= 0 || separator === value.length - 1) {
			this.print(errorText("Model must be provider/model — e.g. anthropic/claude-sonnet-4-5."));
			return;
		}

		const provider = value.slice(0, separator);
		const modelId = value.slice(separator + 1);
		const registry = this.runtimeHost.services.modelRegistry;
		const model =
			registry.find(provider, modelId) ??
			registry.getAvailable().find((e) => e.provider === provider && e.id === modelId);
		if (!model) {
			this.print(
				errorText(
					`"${value}" is not in the model catalog. Check the provider id; dynamic providers (OpenRouter, Inception) refresh their catalogs automatically.`,
				),
			);
			return;
		}

		this.runtimeHost.services.settingsManager.setCronModel(value);
		if (!registry.hasConfiguredAuth(model)) {
			this.print(
				`${bold(value)} set — ${dim("warning: no credentials for this provider; scheduled runs will fail until it is authenticated.")}`,
			);
			return;
		}
		this.print(`${bold(value)} set as the scheduled task model.`);
	}

	/** Short suffix showing whether a configured model resolves and is authenticated. */
	private modelStatusNote(reference: string): string {
		const separator = reference.indexOf("/");
		if (separator <= 0 || separator === reference.length - 1) return dim(" · unresolvable");
		const model = this.runtimeHost.services.modelRegistry.find(
			reference.slice(0, separator),
			reference.slice(separator + 1),
		);
		if (!model) return dim(" · not in catalog");
		if (!this.runtimeHost.services.modelRegistry.hasConfiguredAuth(model)) return dim(" · no credentials");
		return "";
	}

	/** Natural-language requests are sent to the agent, which calls schedule_task. */
	async handleNatural(text: string): Promise<boolean> {
		if (!this.naturalRequest) return false;
		if (!looksLikeScheduleRequest(text)) return false;
		await this.naturalRequest(text);
		return true;
	}

	private async findJob(key: string): Promise<CronJob | undefined> {
		const query = key.trim().replace(/^(["'])(.*)\1$/, "$2");
		const jobs = (await this.get().snapshot()).jobs;
		const byId = jobs.find((j) => j.id === query);
		if (byId) return byId;
		const lower = query.toLowerCase();
		return jobs.find(
			(j) =>
				j.name.toLowerCase() === lower ||
				j.name.toLowerCase().includes(lower) ||
				j.id.toLowerCase().includes(lower),
		);
	}
}

const USAGE =
	"Usage: /cron add <name> <every:30m|daily:HH:MM|weekly:mon,wed@HH:MM|once:<ISO>|on:turn-end|on:commit> <prompt>\n       /cron history <name> · /cron restore <name> <revision-id|vN>";

/** Whether free text looks like a scheduling request rather than a typo'd verb. */
export function looksLikeScheduleRequest(text: string): boolean {
	return /\b(every|each|daily|weekly|weekday|weekend|tomorrow|today|tonight|morning|afternoon|evening|night|at|on|in|hour|minute|monday|tuesday|wednesday|thursday|friday|saturday|sunday|commit|turn|remind|schedule)\b/i.test(
		text,
	);
}

export { parseCronSchedule as _parseCronScheduleForTests, USAGE as CRON_ADD_USAGE };
