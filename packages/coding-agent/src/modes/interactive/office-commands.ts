/**
 * Your Office — TUI slash-command surface (`/office`).
 *
 * Text-first: the roster prints as a formatted block; `tell` and `say` send
 * into the office engine, wait for the drive to settle (bounded), and print
 * what landed. The rich surface is the desktop's Office panel.
 */

import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import { OfficeService } from "../../core/office/service.ts";
import type { OfficeSnapshot } from "../../core/office/types.ts";
import { theme } from "./theme/theme.ts";

const TELL_TIMEOUT_MS = 10 * 60_000;

function dim(text: string): string {
	return theme.fg("dim", text);
}

function bold(text: string): string {
	return theme.bold(text);
}

export function formatOfficeRoster(snapshot: OfficeSnapshot): string {
	const lines: string[] = [bold("Your Office"), ""];

	lines.push(bold("Coworkers"));
	if (snapshot.coworkers.length === 0) {
		lines.push(`${dim("  (none — hire one:")} /office hire Atlas ${dim("| Scout | Watches the repo")}`);
	}
	for (const coworker of snapshot.coworkers) {
		const status = snapshot.statuses[coworker.id];
		const flags: string[] = [];
		if (status?.working) flags.push("working");
		if (status?.needsInput) flags.push("needs you");
		lines.push(
			`  ${`@${coworker.handle}`} ${dim(coworker.title ? `· ${coworker.title}` : "")}${flags.length ? dim(`  [${flags.join(", ")}]`) : ""}`,
		);
	}

	lines.push("", bold("Huddles"));
	const groupHuddles = snapshot.huddles.filter((h) => !h.id.startsWith("dm:"));
	if (groupHuddles.length === 0) {
		lines.push(dim('  (none — /office huddle "Launch room" @atlas @scout)'));
	}
	for (const huddle of groupHuddles) {
		const members = huddle.members
			.map((id) => snapshot.coworkers.find((c) => c.id === id)?.handle)
			.filter(Boolean)
			.map((handle) => `@${handle}`)
			.join(" ");
		lines.push(`  ${huddle.name} ${dim(members)}${huddle.preview ? dim(`  — ${huddle.preview.slice(0, 60)}`) : ""}`);
	}

	lines.push("", bold("Errands"));
	if (snapshot.errands.length === 0) {
		lines.push(dim("  (none — schedule standing work from the desktop Office panel)"));
	}
	for (const errand of snapshot.errands) {
		const owner = snapshot.coworkers.find((c) => c.id === errand.coworkerId);
		const schedule =
			errand.schedule.kind === "every"
				? `every ${errand.schedule.minutes}m`
				: errand.schedule.kind === "daily"
					? `daily ${errand.schedule.time}`
					: "once";
		lines.push(
			`  ${errand.name} ${dim(`${schedule} · @${owner?.handle ?? "?"}${errand.continuity ? " · continuity" : ""}${errand.lastStatus === "error" ? " · failed" : ""}${errand.enabled ? "" : " · paused"}`)}`,
		);
	}

	lines.push(
		"",
		dim("  tell: /office tell @atlas <message>"),
		dim('  speak in a huddle: /office say "Launch room" <message>'),
	);
	return lines.join("\n");
}

export class OfficeTui {
	private service: OfficeService | undefined;
	private readonly runtimeHost: AgentSessionRuntime;
	private readonly print: (text: string) => void;

	constructor(runtimeHost: AgentSessionRuntime, print: (text: string) => void) {
		this.runtimeHost = runtimeHost;
		this.print = print;
	}

	private get(): OfficeService {
		if (!this.service) {
			this.service = new OfficeService({
				runtime: this.runtimeHost,
				sink: {
					update: () => {},
					huddle: () => {},
				},
			});
			this.service.start();
		}
		return this.service;
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
			this.print(formatOfficeRoster(await service.snapshot()));
			return;
		}

		const [verb] = trimmed.split(/\s+/);
		const remainder = trimmed.slice(verb.length).trim();

		if (verb === "hire") {
			const [name, title, description] = remainder.split("|").map((part) => part.trim());
			if (!name) {
				this.print(`${theme.fg("error", "Usage:")} /office hire <name> [| role] [| description]`);
				return;
			}
			const coworker = await service.createCoworker({ name, title, description });
			this.print(
				`${bold(coworker.name)} hired. ${dim(`@${coworker.handle} — DM with /office tell @${coworker.handle} <message>`)}`,
			);
			return;
		}

		if (verb === "huddle") {
			const nameMatch = remainder.match(/^"([^"]+)"\s*(.*)$/) ?? remainder.match(/^(\S+)\s*(.*)$/);
			const name = nameMatch?.[1]?.replace(/^"|"$/g, "");
			const memberHandles = (nameMatch?.[2] ?? "")
				.split(/\s+/)
				.map((token) => token.replace(/^@/, "").toLowerCase())
				.filter(Boolean);
			if (!name || memberHandles.length === 0) {
				this.print(`${theme.fg("error", "Usage:")} /office huddle "Name" @atlas @scout`);
				return;
			}
			const roster = (await service.snapshot()).coworkers;
			const memberIds = memberHandles
				.map((handle) => roster.find((c) => c.handle === handle)?.id)
				.filter((id): id is string => id !== undefined);
			if (memberIds.length === 0) {
				this.print(theme.fg("error", "No matching coworkers for those handles."));
				return;
			}
			const huddle = await service.createHuddle(name, memberIds);
			this.print(`${bold(huddle.name)} seated ${memberIds.length} coworker(s).`);
			return;
		}

		if (verb === "tell") {
			const handleMatch = remainder.match(/^@?([a-z0-9-]+)\s+([\s\S]+)$/i);
			if (!handleMatch) {
				this.print(`${theme.fg("error", "Usage:")} /office tell @atlas <message>`);
				return;
			}
			const handle = handleMatch[1].toLowerCase();
			const text = handleMatch[2].trim();
			const coworker = (await service.snapshot()).coworkers.find((c) => c.handle === handle);
			if (!coworker) {
				this.print(theme.fg("error", `No coworker @${handle}.`));
				return;
			}
			const dmId = await service.ensureDmHuddle(coworker.id);
			const before = (await service.getHuddle(dmId))?.data.log.length ?? 0;
			await service.sendToHuddle(dmId, text);
			this.print(dim(`→ @${handle} is on it…`));
			await service.waitForHuddleIdle(dmId, TELL_TIMEOUT_MS);
			const after = await service.getHuddle(dmId);
			const lines = after?.data.log.slice(before) ?? [];
			const reply = [...lines].reverse().find((message) => message.from.kind === "coworker");
			if (reply) {
				this.print(`${bold(coworker.name)}: ${reply.text}`);
			} else if (after?.data.running) {
				this.print(dim(`@${handle} is still working — check /office tell again shortly.`));
			} else {
				this.print(dim(`@${handle} had nothing to say.`));
			}
			return;
		}

		if (verb === "say") {
			const nameMatch = remainder.match(/^"([^"]+)"\s+([\s\S]+)$/) ?? remainder.match(/^(\S+)\s+([\s\S]+)$/);
			if (!nameMatch) {
				this.print(`${theme.fg("error", "Usage:")} /office say "Huddle name" <message>`);
				return;
			}
			const name = nameMatch[1].replace(/^"|"$/g, "").toLowerCase();
			const text = nameMatch[2].trim();
			const huddle = (await service.snapshot()).huddles.find(
				(h) => h.name.toLowerCase() === name && !h.id.startsWith("dm:"),
			);
			if (!huddle) {
				this.print(theme.fg("error", `No huddle named "${nameMatch[1]}".`));
				return;
			}
			const before = (await service.getHuddle(huddle.id))?.data.log.length ?? 0;
			await service.sendToHuddle(huddle.id, text);
			this.print(dim("The huddle is talking…"));
			await service.waitForHuddleIdle(huddle.id, TELL_TIMEOUT_MS);
			const after = await service.getHuddle(huddle.id);
			const fresh = after?.data.log.slice(before) ?? [];
			const replies = fresh.filter((message) => message.from.kind === "coworker");
			if (replies.length === 0) {
				this.print(dim("The room settled without replies."));
				return;
			}
			this.print(replies.map((message) => `${bold(message.from.name)}: ${message.text}`).join("\n"));
			return;
		}

		if (verb === "stop") {
			const name = remainder.replace(/^"|"$/g, "").trim().toLowerCase();
			const huddle = (await service.snapshot()).huddles.find((h) => h.name.toLowerCase() === name);
			if (!huddle) {
				this.print(theme.fg("error", `No huddle named "${remainder.trim()}".`));
				return;
			}
			await service.stopHuddle(huddle.id);
			this.print(dim(`Stopped ${huddle.name}.`));
			return;
		}

		if (verb === "errands") {
			const snapshot = await service.snapshot();
			this.print(formatOfficeRoster(snapshot));
			return;
		}

		this.print(
			[
				`${theme.fg("error", `Unknown office command: ${verb}`)}`,
				"",
				dim("  /office                     roster"),
				dim("  /office hire <name> [| role] [| description]"),
				dim('  /office huddle "Name" @a @b'),
				dim("  /office tell @handle <message>"),
				dim('  /office say "Huddle" <message>'),
				dim('  /office stop "Huddle"'),
			].join("\n"),
		);
	}
}
