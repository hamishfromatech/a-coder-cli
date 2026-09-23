/**
 * Cron — TUI slash-command surface (`/cron`).
 *
 * Text-first: scheduled tasks for the main coding agent. The rich surface is
 * the desktop's Cron panel; here you list, add, run, pause/resume, and remove
 * jobs from the terminal.
 *
 * Schedules: `every:30m`, `daily:HH:MM`, `once:<ISO-or-epoch>`,
 * `on:turn-end`, `on:commit` (event triggers).
 */

import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
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
	if (schedule.kind === "event") {
		return schedule.trigger === "turn_end" ? "on turn end" : "on commit";
	}
	return `once at ${new Date(schedule.at).toLocaleString()}`;
}

function formatCronList(snapshot: CronSnapshot, cwd: string): string {
	const lines: string[] = [bold("Cron — scheduled tasks"), ""];
	const here = snapshot.jobs.filter((j) => j.cwd === cwd);
	const elsewhere = snapshot.jobs.filter((j) => j.cwd !== cwd);

	if (snapshot.jobs.length === 0) {
		lines.push(dim("  (none — /cron add <name> every:30m <what to do>)"));
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
		lines.push(
			`  ${job.name} ${dim(`${scheduleText(job.schedule)} · next ${next}${status}${job.enabled ? "" : " · paused"}`)}`,
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
				`  ${job.name} ${dim(`${scheduleText(job.schedule)} · ${job.cwd}${job.enabled ? "" : " · paused"}`)}`,
			);
		}
	}
	lines.push(
		"",
		dim("  add: /cron add <name> every:30m|daily:HH:MM|once:<ISO> <prompt>"),
		dim("  run/pause/resume/remove: /cron run|pause|resume|remove <name>"),
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

	constructor(runtimeHost: AgentSessionRuntime, print: (text: string) => void) {
		this.runtimeHost = runtimeHost;
		this.print = print;
	}

	private get(): CronService {
		if (!this.service) {
			this.service = new CronService({ runtime: this.runtimeHost });
			this.service.start();
		}
		return this.service;
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
			const match = remainder.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
			if (!match) {
				this.print(errorText("Usage: /cron add <name> <every:30m|daily:HH:MM|once:<ISO>> <prompt>"));
				return;
			}
			const [, name, scheduleRaw, prompt] = match;
			const schedule = parseCronSchedule(scheduleRaw);
			if (!schedule) {
				this.print(errorText(`Invalid schedule "${scheduleRaw}" — use every:30m, daily:HH:MM, or once:<ISO date>`));
				return;
			}
			const input: CronJobInput = { name, prompt: prompt.trim(), schedule };
			const job = await service.create(input);
			this.print(
				`${bold(job.name)} scheduled — ${scheduleText(job.schedule)}. ${dim(`Next run: ${job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : "paused"}`)}`,
			);
			return;
		}

		if (verb === "run" || verb === "pause" || verb === "resume" || verb === "remove") {
			const key = remainder.trim();
			if (!key) {
				this.print(errorText(`Usage: /cron ${verb} <name>`));
				return;
			}
			const job = await this.findJob(key);
			if (!job) {
				this.print(errorText(`No cron job matching "${key}" — /cron to list.`));
				return;
			}

			if (verb === "run") {
				this.print(dim(`Running "${job.name}" now…`));
				await service.runNow(job.id);
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

		this.print(
			errorText(`Unknown subcommand "${verb}".`) + dim(" Use /cron, /cron add, /cron run|pause|resume|remove."),
		);
	}

	private async findJob(key: string): Promise<CronJob | undefined> {
		const jobs = (await this.get().snapshot()).jobs;
		const byId = jobs.find((j) => j.id === key);
		if (byId) return byId;
		const lower = key.toLowerCase();
		return jobs.find(
			(j) =>
				j.name.toLowerCase() === lower ||
				j.name.toLowerCase().includes(lower) ||
				j.id.toLowerCase().includes(lower),
		);
	}
}

const USAGE = "Usage: /cron add <name> <every:30m|daily:HH:MM|once:<ISO>|on:turn-end|on:commit> <prompt>";

export { parseCronSchedule as _parseCronScheduleForTests, USAGE as CRON_ADD_USAGE };
