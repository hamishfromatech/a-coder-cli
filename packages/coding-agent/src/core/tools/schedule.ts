/**
 * `schedule_task` — the model-facing surface for scheduled tasks.
 *
 * The desktop's Scheduled tasks panel and the CLI's `/cron` command manage the
 * same jobs, but people naturally ask for recurring work in conversation. This
 * tool lets the model create and manage those jobs directly, with a
 * deterministic parser for common timing phrases so date math does not depend
 * on the model.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { CronScheduleParseError, deriveScheduleName, parseNaturalSchedule } from "../cron/schedule-parser.ts";
import type { CronJobInput, CronToolService } from "../cron/service.ts";
import type { CronJob, CronJobRevision, CronSchedule, CronVariable } from "../cron/types.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { describeSchedule } from "../office/errands.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const TIME_SCHEMA = Type.String({
	description: "Local clock time in 24-hour HH:MM form.",
});

const SCHEDULE_SCHEMA = Type.Union(
	[
		Type.Object(
			{
				kind: Type.Literal("every"),
				minutes: Type.Number({ minimum: 1, description: "Interval in minutes (the service floors this at 5)." }),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				kind: Type.Literal("daily"),
				time: TIME_SCHEMA,
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				kind: Type.Literal("weekly"),
				days: Type.Array(Type.Number({ minimum: 0, maximum: 6 }), {
					minItems: 1,
					description: "JavaScript weekday numbers: 0 = Sunday through 6 = Saturday.",
				}),
				time: TIME_SCHEMA,
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				kind: Type.Literal("once"),
				at: Type.Number({ description: "Epoch milliseconds for the one-shot fire." }),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				kind: Type.Literal("event"),
				trigger: StringEnum(["turn_end", "git_commit"] as const, {
					description: "Fire after a completed turn, or once per new commit.",
				}),
				cooldownMinutes: Type.Optional(
					Type.Number({ minimum: 5, description: "Minimum quiet period for turn_end jobs." }),
				),
			},
			{ additionalProperties: false },
		),
	],
	{ description: "Structured schedule. Use this when you already know the exact schedule." },
);

const scheduleTaskSchema = Type.Object(
	{
		action: StringEnum(
			["create", "list", "update", "delete", "run", "pause", "resume", "revisions", "restore"] as const,
			{
				description: "What to do with the scheduled task.",
			},
		),
		revisionId: Type.Optional(Type.String({ description: "Revision id for the restore action." })),
		id: Type.Optional(
			Type.String({
				description: "Job id or name for update/delete/run/pause/resume. Names are matched in the current project.",
			}),
		),
		name: Type.Optional(
			Type.String({ description: "Short display name. Derived from the task when omitted on create." }),
		),
		task: Type.Optional(
			Type.String({
				description:
					"The complete instruction the agent should follow at each fire. Include the project context the task needs.",
			}),
		),
		when: Type.Optional(
			Type.String({
				description:
					'Natural-language timing, e.g. "every weekday at 9am", "daily at 6pm", "tomorrow at 2pm", "every 30 minutes", "after each turn".',
			}),
		),
		schedule: Type.Optional(SCHEDULE_SCHEMA),
		enabled: Type.Optional(Type.Boolean({ description: "Create paused, or pause/resume on update." })),
		concurrencyPolicy: Type.Optional(
			StringEnum(["skip_if_active", "coalesce_if_active", "always_enqueue"] as const, {
				description:
					"How overlapping triggers are handled. skip drops new triggers while running; coalesce queues one follow-up; always_enqueue queues every trigger.",
			}),
		),
		catchUpPolicy: Type.Optional(
			StringEnum(["run_once", "skip_missed"] as const, {
				description:
					"run_once fires once after missed windows; skip_missed ignores windows missed by more than five minutes.",
			}),
		),
		variables: Type.Optional(
			Type.Record(Type.String(), Type.String(), {
				description:
					"Non-secret values substituted into the task as {{name}}. On run, these override the stored defaults.",
			}),
		),
		isolated: Type.Optional(
			Type.Boolean({
				description:
					"Run each fire in an isolated background subagent (default true). Set false to run a normal live-session turn.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type ScheduleTaskInput = Static<typeof scheduleTaskSchema>;

export interface ScheduleTaskDetails {
	job?: CronJob;
	jobs?: CronJob[];
	revisions?: CronJobRevision[];
}

export interface ScheduleTaskOptions {
	/** The host-owned CronService, or undefined in runtimes without scheduling. */
	getService: () => CronToolService | undefined;
}

const UNAVAILABLE =
	"Scheduled tasks are not available in this session. Start the interactive CLI, RPC mode, or the Desktop app, then ask again.";

function targetLabel(job: CronJob): string {
	return job.name;
}

function formatNextRun(job: CronJob): string {
	if (!job.enabled) return "paused";
	if (job.schedule.kind === "event") return "awaiting its event";
	if (!job.nextRunAt) return "not armed";
	return new Date(job.nextRunAt).toLocaleString();
}

function formatJob(job: CronJob): string {
	const flags = [
		`schedule: ${describeSchedule(job.schedule)}`,
		`next: ${formatNextRun(job)}`,
		job.enabled ? undefined : "paused",
		job.concurrencyPolicy ? `overlap: ${job.concurrencyPolicy}` : undefined,
		job.catchUpPolicy ? `missed: ${job.catchUpPolicy}` : undefined,
		job.variables && job.variables.length > 0
			? `variables: ${job.variables.map((variable) => variable.name).join(", ")}`
			: undefined,
		job.isolated === false ? "execution: live session" : "execution: isolated subagent",
		job.lastStatus === "error" || job.lastStatus === "timeout"
			? `last: ${job.lastStatus}${job.lastError ? ` (${job.lastError.slice(0, 120)})` : ""}`
			: undefined,
	].filter(Boolean);
	return `- ${job.name} [${job.id}]\n  ${flags.join(" · ")}\n  task: ${job.prompt}`;
}

function variablesToInput(variables: Record<string, string> | undefined): CronVariable[] | undefined {
	if (variables === undefined) return undefined;
	return Object.entries(variables).map(([name, value]) => ({ name, value }));
}

function formatList(jobs: CronJob[], cwd: string): string {
	if (jobs.length === 0) return `No scheduled tasks in ${cwd}.`;
	return [`Scheduled tasks in ${cwd}:`, ...jobs.map(formatJob)].join("\n");
}

function textResult(text: string, details: ScheduleTaskDetails = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function resolveSchedule(when: string | undefined, schedule: CronSchedule | undefined, now = Date.now()): CronSchedule {
	if (schedule) return schedule;
	if (!when?.trim()) {
		throw new Error("Provide either `when` in natural language or a structured `schedule`.");
	}
	try {
		return parseNaturalSchedule(when, now).schedule;
	} catch (error) {
		if (error instanceof CronScheduleParseError) throw new Error(error.message);
		throw error;
	}
}

async function resolveJob(service: CronToolService, cwd: string, key: string | undefined): Promise<CronJob> {
	const query = key?.trim();
	if (!query) throw new Error("Provide the job `id` (or its name) for this action.");
	const jobs = await service.listForCwd(cwd);
	const exactId = jobs.find((job) => job.id === query);
	if (exactId) return exactId;
	const lower = query.toLowerCase();
	const exactName = jobs.find((job) => job.name.toLowerCase() === lower);
	if (exactName) return exactName;
	const partial = jobs.find((job) => job.name.toLowerCase().includes(lower));
	if (partial) return partial;
	throw new Error(`No scheduled task matching "${query}" in this project.`);
}

export function createScheduleTaskToolDefinition(
	options: ScheduleTaskOptions = { getService: () => undefined },
): ToolDefinition<typeof scheduleTaskSchema, ScheduleTaskDetails | undefined> {
	return {
		name: "schedule_task",
		label: "Scheduled task",
		description:
			'Create and manage scheduled tasks for this project. Use this whenever the user asks to schedule recurring or future work, or to list, change, pause, resume, delete, or run a scheduled task. Pass the user\'s timing in `when` (for example "every weekday at 9am", "daily at 6pm", "tomorrow at 2pm", "every 30 minutes", "after each turn"); the tool parses it and uses local time. `task` is the complete instruction the agent runs at each fire. Do not tell the user to edit cron files or use /cron — do it for them.',
		promptSnippet: "Create and manage scheduled tasks from natural language",
		promptGuidelines: [
			"Use `schedule_task` when the user asks to schedule, remind, repeat, or defer work — never answer with cron syntax or ask them to use /cron.",
			"Put the real work in `task`: it is the prompt the agent receives at each fire, so include the project context and the expected result.",
			'Pass the user\'s timing phrase in `when` rather than guessing a structured schedule. If the phrase has no specific time (for example "regularly" or "every day"), ask one short clarifying question before creating.',
			"After create/update, report the parsed schedule and the next run in plain language. If a time was ambiguous, say what you chose.",
			"Use `revisions` to inspect configuration history and `restore` with a revision id to roll back. Use variables for non-secret inputs like a branch or target environment.",
			"Scheduled tasks fire while A-Coder is running; a missed time fires on the first tick after the app starts again.",
		],
		parameters: scheduleTaskSchema,
		async execute(_toolCallId, params: ScheduleTaskInput, _signal?, _onUpdate?, rawContext?: ExtensionContext) {
			const service = options.getService();
			if (!service) throw new Error(UNAVAILABLE);
			const cwd = rawContext?.cwd ?? process.cwd();

			if (params.action === "list") {
				const jobs = await service.listForCwd(cwd);
				return textResult(formatList(jobs, cwd), { jobs });
			}

			if (params.action === "create") {
				const task = params.task?.trim();
				if (!task) throw new Error("Creating a scheduled task requires `task`.");
				const schedule = resolveSchedule(params.when, params.schedule);
				const variables = variablesToInput(params.variables);
				const input: CronJobInput = {
					name: params.name?.trim() || deriveScheduleName(task),
					prompt: task,
					schedule,
					cwd,
					...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
					...(params.concurrencyPolicy ? { concurrencyPolicy: params.concurrencyPolicy } : {}),
					...(params.catchUpPolicy ? { catchUpPolicy: params.catchUpPolicy } : {}),
					...(variables ? { variables } : {}),
					...(params.isolated !== undefined ? { isolated: params.isolated } : {}),
				};
				const job = await service.create(input);
				return textResult(
					`Created scheduled task "${targetLabel(job)}" [${job.id}].\nSchedule: ${describeSchedule(job.schedule)}\nNext run: ${formatNextRun(job)}\nTask: ${job.prompt}`,
					{ job },
				);
			}

			if (params.action === "update") {
				const job = await resolveJob(service, cwd, params.id);
				const patch: Partial<
					Pick<
						CronJob,
						| "name"
						| "prompt"
						| "schedule"
						| "enabled"
						| "concurrencyPolicy"
						| "catchUpPolicy"
						| "variables"
						| "isolated"
					>
				> = {};
				if (params.name !== undefined) patch.name = params.name.trim();
				if (params.task !== undefined) patch.prompt = params.task.trim();
				if (params.schedule !== undefined || params.when !== undefined) {
					patch.schedule = resolveSchedule(params.when, params.schedule);
				}
				if (params.enabled !== undefined) patch.enabled = params.enabled;
				if (params.concurrencyPolicy !== undefined) patch.concurrencyPolicy = params.concurrencyPolicy;
				if (params.catchUpPolicy !== undefined) patch.catchUpPolicy = params.catchUpPolicy;
				if (params.variables !== undefined) patch.variables = variablesToInput(params.variables);
				if (params.isolated !== undefined) patch.isolated = params.isolated;
				const updated = await service.update(job.id, patch);
				return textResult(
					`Updated scheduled task "${targetLabel(updated)}" [${updated.id}].\nSchedule: ${describeSchedule(updated.schedule)}\nNext run: ${formatNextRun(updated)}`,
					{ job: updated },
				);
			}

			if (params.action === "delete") {
				const job = await resolveJob(service, cwd, params.id);
				await service.remove(job.id);
				return textResult(`Deleted scheduled task "${targetLabel(job)}" [${job.id}].`);
			}

			if (params.action === "run") {
				const job = await resolveJob(service, cwd, params.id);
				if (!job.enabled)
					throw new Error(`Scheduled task "${job.name}" is paused. Resume it before running it now.`);
				await service.runNow(job.id, params.variables);
				return textResult(
					`Ran scheduled task "${targetLabel(job)}" now. Its result lands in this session when the project is open, or in the project's session tree otherwise.`,
					{ job },
				);
			}

			if (params.action === "revisions") {
				const job = await resolveJob(service, cwd, params.id);
				const revisions = await service.listRevisions(job.id);
				const text =
					revisions.length === 0
						? `No revision history for "${job.name}".`
						: [
								`Revision history for "${job.name}" (newest first):`,
								...revisions.map(
									(revision) =>
										`- v${revision.revision} ${revision.reason} · ${new Date(revision.createdAt).toLocaleString()} [${revision.id}]`,
								),
							].join("\n");
				return textResult(text, { job, revisions });
			}

			if (params.action === "restore") {
				const job = await resolveJob(service, cwd, params.id);
				if (!params.revisionId) throw new Error("Restoring a scheduled task requires `revisionId`.");
				const updated = await service.restoreRevision(job.id, params.revisionId);
				return textResult(
					`Restored "${updated.name}" to v${updated.revision}.\nSchedule: ${describeSchedule(updated.schedule)}\nNext run: ${formatNextRun(updated)}`,
					{ job: updated },
				);
			}

			const job = await resolveJob(service, cwd, params.id);
			const updated = await service.update(job.id, { enabled: params.action === "resume" });
			return textResult(
				`${updated.enabled ? "Resumed" : "Paused"} scheduled task "${targetLabel(updated)}" [${updated.id}].\nNext run: ${formatNextRun(updated)}`,
				{ job: updated },
			);
		},
		renderCall(args, theme) {
			const text = new Text("", 0, 0);
			const target = args?.name ?? args?.id ?? args?.task?.slice(0, 48) ?? "";
			text.setText(
				`${theme.fg("toolTitle", theme.bold("schedule_task"))} ${theme.fg("accent", args?.action ?? "list")}${target ? ` ${theme.fg("muted", target)}` : ""}`,
			);
			return text;
		},
		renderResult(result, _options, theme) {
			const text = new Text("", 0, 0);
			const output = result.content
				.filter((content): content is { type: "text"; text: string } => content.type === "text")
				.map((content) => content.text)
				.join("\n");
			text.setText(theme.fg("toolOutput", output));
			return text;
		},
	};
}

export function createScheduleTaskTool(options?: ScheduleTaskOptions): AgentTool<typeof scheduleTaskSchema> {
	return wrapToolDefinition(createScheduleTaskToolDefinition(options));
}
