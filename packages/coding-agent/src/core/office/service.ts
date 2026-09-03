/**
 * The Office service — owns coworker sessions, huddle drives, and errands.
 *
 * One service per engine process. It sits on top of the session runtime host:
 * each coworker gets its own side runtime per project (created through the
 * host's runtime factory, outside the active/detached registries), bound with
 * an office UI context so supervised prompts route to the office event sink
 * instead of the console. The host (RPC mode / TUI) provides the sink; the
 * desktop renders the roster and huddles from the pushed snapshots.
 *
 * Coordination model (see rounds.ts): user sends trigger bounded round-robin
 * drives; each coworker runs its turn in its own session and is fed only the
 * room messages new since its last turn. "(pass)" is silence. Errands fire on
 * a 30s ticker and deliver into DMs or huddles — with continuity, they run in
 * the coworker's canonical session so the coworker learns between runs.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { withKeyedLock } from "../../utils/async-mutex.ts";
import type { AgentSession } from "../agent-session.ts";
import type { AgentSessionRuntime } from "../agent-session-runtime.ts";
import { noOpUIContext } from "../extensions/runner.ts";
import type { ExtensionUIContext, UserQuestionOption } from "../extensions/types.ts";
import { getDefaultSessionDir, SessionManager } from "../session-manager.ts";
import { describeSchedule, isDue, nextRunAt } from "./errands.ts";
import {
	buildDmTurnPrompt,
	buildHuddleTurnPrompt,
	classifyHoldDirective,
	coworkerAuthor,
	deltaFor,
	formatRoomLine,
	heldWatermarkAdvance,
	isEchoOfLastEntry,
	isPassText,
	mintMessageId,
	parseMentions,
	pickReply,
	resolveResponders,
	rotateSpeakers,
	shouldCommitTurn,
	systemAuthor,
	unaddressedMentions,
	userAuthor,
} from "./rounds.ts";
import { composeSoul, handleFromName, identityReminder } from "./soul.ts";
import * as store from "./store.ts";
import {
	type Coworker,
	type CoworkerStatus,
	type Errand,
	type ErrandSchedule,
	type Face,
	type Huddle,
	type HuddleData,
	type HuddleSummary,
	OFFICE_MAX_CONTINUATIONS,
	OFFICE_MAX_MESSAGES,
	OFFICE_MAX_ROUNDS,
	OFFICE_PASS_TEXT,
	OFFICE_TURN_HARD_CAP_MS,
	type OfficeActivityEvent,
	type OfficeAttachment,
	type OfficeEventSink,
	type OfficeHuddlePayload,
	type OfficeMessage,
	type OfficePrompt,
	type OfficeSnapshot,
} from "./types.ts";

const ERRAND_TICK_MS = 30_000;
const PROMPT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;
/** Background poll cadence for late replies that outlived a drive. */
const STRANDED_HARVEST_INTERVAL_MS = 5_000;
const STRANDED_HARVEST_MAX_TRIES = 60;

/**_DM huddle id for a coworker. */
export function dmHuddleId(coworkerId: string): string {
	return `dm:${coworkerId}`;
}

/** Split a data URL into base64 payload + mime type; null when not a data URL. */
function parseDataUrl(dataUrl: string): { data: string; mimeType: string } | null {
	const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(dataUrl.trim());
	if (!match) return null;
	return { mimeType: match[1] || "image/png", data: match[2] };
}

interface AssistantLike {
	role: string;
	text: string;
}

/** Flatten session messages into {role, text} rows (text parts only). */
function flattenMessages(messages: readonly AgentMessage[]): AssistantLike[] {
	return messages.map((message) => {
		const base = message as { role?: string; content?: unknown };
		const role = base.role ?? "assistant";
		const content: unknown = base.content;
		if (typeof content === "string") {
			return { role, text: content };
		}
		const text = Array.isArray(content)
			? content
					.map((part) => {
						if (typeof part === "object" && part !== null && (part as { type?: string }).type === "text") {
							return (part as { text?: string }).text ?? "";
						}
						return "";
					})
					.join("")
			: "";
		return { role, text };
	});
}

export interface CreateCoworkerInput {
	name: string;
	title?: string;
	description?: string;
	soul?: string;
	face?: Partial<Face>;
	model?: string;
	autonomy?: Coworker["autonomy"];
}

export interface OfficeServiceOptions {
	runtime: AgentSessionRuntime;
	sink: OfficeEventSink;
	/** Idle timeout before a coworker side runtime is disposed (tests override). */
	idleTimeoutMs?: number;
}

/** A pending supervised prompt and its resolver. */
interface PendingPrompt {
	prompt: OfficePrompt;
	resolve: (choice: string | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class OfficeService {
	private readonly runtime: AgentSessionRuntime;
	private readonly sink: OfficeEventSink;
	private readonly idleTimeoutMs: number;

	/** Live coworker side runtimes, keyed `<coworkerId>::<cwd>`. */
	private sessions = new Map<string, AgentSession>();
	/** Per-coworker turn queues — one turn at a time per coworker. */
	private queues = new Map<string, Promise<unknown>>();
	/** Idle reaper timers, keyed like `sessions`. */
	private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Serialization chains for huddle drives, keyed by huddle id: each new
	 *  drive runs after the previous one exits (a user send during a long turn
	 *  bumps the epoch — the running loop bails at its next boundary, then the
	 *  queued drive takes the room). */
	private driveChains = new Map<string, Promise<unknown>>();
	/** Queued + running drive count, keyed by huddle id (idle checks). */
	private driveCounts = new Map<string, number>();
	/** Background harvest timers for late stranded replies, keyed by huddle id. */
	private strandedTimers = new Map<string, ReturnType<typeof setInterval>>();
	/** Pending supervised prompts by request id. */
	private pendingPrompts = new Map<string, PendingPrompt>();
	/** Live coworker statuses (working / needsInput). */
	private statuses = new Map<string, CoworkerStatus>();
	/** Activity unsubscriptions per session key. */
	private activityUnsubs = new Map<string, () => void>();
	private ticker: ReturnType<typeof setInterval> | undefined;
	private disposed = false;

	constructor(options: OfficeServiceOptions) {
		this.runtime = options.runtime;
		this.sink = options.sink;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	}

	/** Start the errand ticker. */
	start(): void {
		if (this.ticker) return;
		this.ticker = setInterval(() => {
			void this.tickErrands();
		}, ERRAND_TICK_MS);
		this.ticker.unref?.();
	}

	/** Stop the ticker and dispose coworker runtimes. */
	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
		for (const timer of this.idleTimers.values()) {
			clearTimeout(timer);
		}
		this.idleTimers.clear();
		for (const timer of this.strandedTimers.values()) {
			clearInterval(timer);
		}
		this.strandedTimers.clear();
		for (const unsub of this.activityUnsubs.values()) {
			unsub();
		}
		this.activityUnsubs.clear();
		const aborts: Promise<void>[] = [];
		for (const session of this.sessions.values()) {
			if (session.isStreaming) {
				aborts.push(session.abort().catch(() => {}));
			}
			session.dispose();
		}
		this.sessions.clear();
		await Promise.allSettled(aborts);
	}

	// ── snapshots ─────────────────────────────────────────────────────────────

	async snapshot(): Promise<OfficeSnapshot> {
		const [coworkers, huddles, errands] = await Promise.all([
			store.listCoworkers(),
			store.listHuddles(),
			store.listErrands(),
		]);
		const statuses: Record<string, CoworkerStatus> = {};
		for (const coworker of coworkers) {
			statuses[coworker.id] = this.statuses.get(coworker.id) ?? { working: false, needsInput: false };
		}
		const summaries: HuddleSummary[] = [];
		for (const huddle of huddles) {
			summaries.push(await this.summarizeHuddle(huddle));
		}
		return {
			coworkers,
			statuses,
			huddles: summaries,
			errands,
			pendingPrompts: [...this.pendingPrompts.values()].map((p) => p.prompt),
		};
	}

	private async summarizeHuddle(huddle: Huddle): Promise<HuddleSummary> {
		try {
			const data = await store.loadHuddleData(huddle.id);
			const last = data.log[data.log.length - 1];
			return {
				id: huddle.id,
				name: huddle.name,
				members: huddle.members,
				pinned: huddle.pinned,
				preview: last?.text.slice(0, 120),
				lastActive: last?.at,
			};
		} catch {
			return { id: huddle.id, name: huddle.name, members: huddle.members, pinned: huddle.pinned };
		}
	}

	private async emitUpdate(): Promise<void> {
		try {
			this.sink.update(await this.snapshot());
		} catch {
			// A failing sink must not break office operations.
		}
	}

	private async emitHuddle(huddleId: string, data?: HuddleData): Promise<void> {
		try {
			const huddleData = data ?? (await store.loadHuddleData(huddleId));
			const working: Record<string, boolean> = {};
			for (const [id, status] of this.statuses) {
				working[id] = status.working;
			}
			this.sink.huddle({ huddleId, data: huddleData, working });
		} catch {
			// ignore
		}
	}

	// ── roster: coworkers ─────────────────────────────────────────────────────

	async createCoworker(input: CreateCoworkerInput): Promise<Coworker> {
		const name = input.name.trim();
		if (!name) throw new Error("Name is required");
		const roster = await store.listCoworkers();
		const handle = handleFromName(name);
		if (roster.some((c) => c.handle === handle)) {
			throw new Error(`A coworker named "${name}" already exists`);
		}
		const coworker: Coworker = {
			id: randomUUID(),
			name,
			handle,
			title: input.title?.trim() || undefined,
			description: input.description?.trim() || undefined,
			soul: composeSoul({
				name,
				title: input.title,
				description: input.description,
				handle,
				roster,
				customSoul: input.soul,
			}),
			face: {
				shape: input.face?.shape ?? "circle",
				color: input.face?.color,
				image: input.face?.image,
			},
			model: input.model?.trim() || undefined,
			autonomy: input.autonomy ?? "supervised",
			createdAt: Date.now(),
			sessions: {},
		};
		await store.saveCoworker(coworker);
		// Seed the DM huddle so the roster shows a chat target immediately.
		await store.saveHuddle({
			id: dmHuddleId(coworker.id),
			name: coworker.name,
			members: [coworker.id],
			createdAt: Date.now(),
		});
		await this.emitUpdate();
		return coworker;
	}

	async updateCoworker(
		id: string,
		input: CreateCoworkerInput & { soulText?: string; keepSoul?: boolean },
	): Promise<Coworker | undefined> {
		const existing = (await store.listCoworkers()).find((c) => c.id === id);
		if (!existing) return undefined;
		const roster = await store.listCoworkers();
		const name = input.name.trim() || existing.name;
		const handle = name === existing.name ? existing.handle : handleFromName(name);
		if (handle !== existing.handle && roster.some((c) => c.handle === handle && c.id !== id)) {
			throw new Error(`A coworker named "${name}" already exists`);
		}
		const updated: Coworker = {
			...existing,
			name,
			handle,
			title: input.title?.trim() || undefined,
			description: input.description?.trim() || undefined,
			model: input.model?.trim() || undefined,
			autonomy: input.autonomy ?? existing.autonomy,
			face: {
				shape: input.face?.shape ?? existing.face.shape,
				color: input.face?.color,
				image: input.face?.image,
			},
		};
		if (!input.keepSoul) {
			updated.soul = composeSoul({
				name,
				title: updated.title,
				description: updated.description,
				handle,
				roster,
				customSoul: input.soulText,
			});
		}
		await store.saveCoworker(updated);
		await this.applyCoworkerSessionConfig(updated);
		await this.emitUpdate();
		return updated;
	}

	async deleteCoworker(id: string): Promise<void> {
		await store.deleteCoworkerEverywhere(id, dmHuddleId(id));
		// Drop the side runtime if live.
		for (const [key, session] of this.sessions) {
			if (key.startsWith(`${id}::`)) {
				this.clearIdleTimer(key);
				this.detachActivity(key);
				session.dispose();
				this.sessions.delete(key);
			}
		}
		this.statuses.delete(id);
		await this.emitUpdate();
	}

	// ── roster: huddles ───────────────────────────────────────────────────────

	async createHuddle(name: string, memberIds: string[]): Promise<Huddle> {
		const trimmed = name.trim();
		if (!trimmed) throw new Error("Name is required");
		if (memberIds.length === 0) throw new Error("Pick at least one coworker");
		const huddle: Huddle = {
			id: randomUUID(),
			name: trimmed,
			members: memberIds,
			createdAt: Date.now(),
		};
		await store.saveHuddle(huddle);
		await this.emitUpdate();
		return huddle;
	}

	async updateHuddle(id: string, name: string, memberIds: string[]): Promise<void> {
		const huddles = await store.listHuddles();
		const huddle = huddles.find((h) => h.id === id);
		if (!huddle) return;
		await store.saveHuddle({ ...huddle, name: name.trim() || huddle.name, members: memberIds });
		await this.emitUpdate();
	}

	async deleteHuddle(id: string): Promise<void> {
		await store.deleteHuddle(id);
		this.driveChains.delete(id);
		this.driveCounts.delete(id);
		this.clearStrandedTimer(id);
		await this.emitUpdate();
	}

	// ── messaging ─────────────────────────────────────────────────────────────

	/**
	 * User send into a huddle (or DM). Appends the message, applies hold
	 * directives, and starts a drive in the background — returns once the
	 * message is durably logged. Use `waitForHuddleIdle` to block on the drive.
	 */
	async sendToHuddle(huddleId: string, text: string, images?: OfficeAttachment[]): Promise<OfficeMessage> {
		const huddle = (await store.listHuddles()).find((h) => h.id === huddleId);
		if (!huddle) throw new Error("Huddle not found");
		const trimmed = text.trim();
		if (!trimmed && !images?.length) throw new Error("Message is empty");

		const message: OfficeMessage = {
			id: mintMessageId(),
			at: Date.now(),
			from: userAuthor(),
			text: trimmed,
			images,
		};

		// Hold directives from user sends only. Every send also bumps the room
		// epoch: a send during a running drive supersedes it at the next member
		// boundary (stale in-flight turns drop instead of committing over the
		// redirect), and a queued drive takes the room once the old one exits.
		const members = await this.membersOf(huddle);
		const parsed = parseMentions(trimmed, members);
		const directive = classifyHoldDirective(
			trimmed,
			parsed.mentioned,
			parsed.everyone,
			members.map((m) => m.id),
		);
		const data = await store.updateHuddleData(huddleId, (room) => {
			room.log.push(message);
			room.epoch += 1;
			for (const id of directive.hold) {
				room.holds[id] = Date.now();
			}
			for (const id of directive.release) {
				delete room.holds[id];
			}
		});
		await this.emitHuddle(huddleId, data);
		this.startDrive(huddleId).catch(() => {});
		return message;
	}

	/** Resolve when the huddle has no queued or running drive (bounded wait). */
	async waitForHuddleIdle(huddleId: string, timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (!(this.driveCounts.get(huddleId) ?? 0)) return true;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
		return !(this.driveCounts.get(huddleId) ?? 0);
	}

	/** Ensure the DM huddle for a coworker exists (idempotent). */
	async ensureDmHuddle(coworkerId: string): Promise<string> {
		const dmId = dmHuddleId(coworkerId);
		const huddles = await store.listHuddles();
		if (!huddles.some((h) => h.id === dmId)) {
			const coworker = (await store.listCoworkers()).find((c) => c.id === coworkerId);
			await store.saveHuddle({
				id: dmId,
				name: coworker?.name ?? coworkerId,
				members: [coworkerId],
				createdAt: Date.now(),
			});
			await this.emitUpdate();
		}
		return dmId;
	}

	/** Full huddle payload for a client fetch (null when unknown). */
	async getHuddle(huddleId: string): Promise<OfficeHuddlePayload | null> {
		const huddles = await store.listHuddles();
		if (!huddles.some((h) => h.id === huddleId)) return null;
		const data = await store.loadHuddleData(huddleId);
		const working: Record<string, boolean> = {};
		for (const [id, status] of this.statuses) {
			working[id] = status.working;
		}
		return { huddleId, data, working };
	}

	/** Append a system line (drive lifecycle notes visible in the room). */
	async appendSystemLine(huddleId: string, text: string): Promise<void> {
		const message: OfficeMessage = {
			id: mintMessageId(),
			at: Date.now(),
			from: systemAuthor(),
			text,
		};
		const data = await store.updateHuddleData(huddleId, (room) => {
			room.log.push(message);
		});
		await this.emitHuddle(huddleId, data);
	}

	/** Stop a huddle's drive: bump the epoch, hold every member until
	 *  re-addressed, and abort in-flight turns (release = re-mention or
	 *  "@all resume"). */
	async stopHuddle(huddleId: string): Promise<void> {
		const huddle = (await store.listHuddles()).find((h) => h.id === huddleId);
		if (huddle) {
			for (const member of huddle.members) {
				for (const [key, session] of this.sessions) {
					if (key.startsWith(`${member}::`) && session.isStreaming) {
						await session.abort().catch(() => {});
					}
				}
			}
		}
		await store.updateHuddleData(huddleId, (room) => {
			room.epoch += 1;
			const at = Date.now();
			for (const member of huddle?.members ?? []) {
				room.holds[member] = at;
			}
		});
		await this.appendSystemLine(huddleId, 'Stopped. Re-mention a coworker or say "@all resume" to bring them back.');
	}

	// ── drives ────────────────────────────────────────────────────────────────

	private async membersOf(huddle: Huddle): Promise<Coworker[]> {
		const roster = await store.listCoworkers();
		return huddle.members.map((id) => roster.find((c) => c.id === id)).filter((c): c is Coworker => c !== undefined);
	}

	private enqueueTurn<T>(coworkerId: string, task: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(coworkerId) ?? Promise.resolve();
		const next = previous.then(task, task);
		this.queues.set(
			coworkerId,
			next.catch(() => undefined),
		);
		return next;
	}

	private startDrive(huddleId: string): Promise<void> {
		const previous = this.driveChains.get(huddleId) ?? Promise.resolve();
		this.driveCounts.set(huddleId, (this.driveCounts.get(huddleId) ?? 0) + 1);
		const drive = previous
			.catch(() => {})
			.then(() => this.runDrive(huddleId))
			.finally(() => {
				const remaining = (this.driveCounts.get(huddleId) ?? 1) - 1;
				if (remaining <= 0) {
					this.driveCounts.delete(huddleId);
				} else {
					this.driveCounts.set(huddleId, remaining);
				}
			});
		this.driveChains.set(
			huddleId,
			drive.catch(() => undefined),
		);
		return drive;
	}
	private async runDrive(huddleId: string): Promise<void> {
		const huddle = (await store.listHuddles()).find((h) => h.id === huddleId);
		if (!huddle) return;
		const members = await this.membersOf(huddle);
		if (members.length === 0) return;
		const isDm = huddle.id === dmHuddleId(members[0].id);

		const start = await store.updateHuddleData(huddleId, (room) => {
			room.running = { startedAt: Date.now(), thread: room.epoch };
		});
		const startEpoch = start.epoch;
		await this.emitHuddle(huddleId, start);

		let posted = 0;
		let continuations = 0;
		try {
			for (let round = 0; round < OFFICE_MAX_ROUNDS; round++) {
				await this.harvestStranded(huddleId, members);

				const data = await store.loadHuddleData(huddleId);
				if (data.epoch !== startEpoch) return;

				const stranded = data.stranded ?? {};
				const responders = rotateSpeakers(resolveResponders(data.log, members), round).filter(
					(member) => !Object.hasOwn(stranded, member.id),
				);

				let spoke = 0;
				for (const member of responders) {
					if (posted >= OFFICE_MAX_MESSAGES) return;
					const outcome = await this.runMemberTurn(huddleId, huddle.name, isDm, members, member, startEpoch);
					if (outcome.cancelled) return;
					if (outcome.spoke) {
						posted += 1;
						spoke += 1;
					}
				}

				if (spoke === 0) {
					// A quiet round is not always consensus: an @mention handoff
					// inside a coworker reply can strand the cited coworker (the
					// round loop exits before their turn). Run one bounded
					// continuation for exactly those members; if it also goes
					// quiet, the room genuinely settled.
					continuations += 1;
					const fresh = await store.loadHuddleData(huddleId);
					if (fresh.epoch !== startEpoch) return;
					const pending = unaddressedMentions(fresh.log, members);
					if (pending.length && continuations <= OFFICE_MAX_CONTINUATIONS && posted < OFFICE_MAX_MESSAGES) {
						const strandedNow = fresh.stranded ?? {};
						const cited = members
							.filter((m) => pending.includes(m.id))
							.filter((m) => !Object.hasOwn(strandedNow, m.id));
						for (const member of cited) {
							if (posted >= OFFICE_MAX_MESSAGES) break;
							const outcome = await this.runMemberTurn(huddleId, huddle.name, isDm, members, member, startEpoch);
							if (outcome.cancelled) return;
							if (outcome.spoke) {
								posted += 1;
								spoke += 1;
							}
						}
					}
					if (spoke === 0) {
						// Genuinely nothing left to say — the conversation settled.
						break;
					}
				}
			}
		} finally {
			const data = await store.updateHuddleData(huddleId, (room) => {
				room.running = undefined;
			});
			await this.emitHuddle(huddleId, data);
			await this.emitUpdate();
			// Late replies that outlived the loop: poll in the background
			// (bounded) so long work is late, never lost.
			const leftover = await store.loadHuddleData(huddleId);
			if (Object.keys(leftover.stranded ?? {}).length > 0) {
				this.scheduleStrandedHarvest(huddleId, members);
			}
		}
	}

	/** Run one member's turn inside a drive: skip conditions, prompt build,
	 *  session turn, commit. Shared by the main round loop and continuation
	 *  rounds. `cancelled` means the drive went stale (epoch moved) and must
	 *  exit; `spoke` means the coworker posted a reply to the room. */
	private async runMemberTurn(
		huddleId: string,
		huddleName: string,
		isDm: boolean,
		members: Coworker[],
		member: Coworker,
		startEpoch: number,
	): Promise<{ cancelled: boolean; spoke: boolean }> {
		const fresh = await store.loadHuddleData(huddleId);
		if (fresh.epoch !== startEpoch) return { cancelled: true, spoke: false };

		// A coworker the user told to stop is HELD — no turn until an explicit
		// release (re-mention / "@all resume"). Consume the delta exactly once
		// so the same entries never re-trigger this skip.
		if (fresh.holds[member.id]) {
			const advance = heldWatermarkAdvance(fresh.watermarks[member.id], fresh.log.length);
			if (advance !== null) {
				await store.updateHuddleData(huddleId, (room) => {
					room.watermarks[member.id] = advance;
				});
			}
			return { cancelled: false, spoke: false };
		}

		const delta = deltaFor(fresh, member.id);
		if (delta.length === 0) return { cancelled: false, spoke: false };
		const logLengthAtDispatch = fresh.log.length;

		const prompt = isDm
			? buildDmTurnPrompt(
					member,
					delta[delta.length - 1]?.from.name ?? "User",
					delta.map((entry) => formatRoomLine(entry, member.id)).join("\n"),
				)
			: buildHuddleTurnPrompt({
					coworker: member,
					groupName: huddleName,
					members: seatOf(members),
					deltaLines: delta.map((entry) => formatRoomLine(entry, member.id)),
				});

		this.statuses.set(member.id, {
			...(this.statuses.get(member.id) ?? { working: false, needsInput: false }),
			working: true,
		});
		await store.updateHuddleData(huddleId, (room) => {
			if (room.running) room.running.current = member.name;
		});
		await this.emitUpdate();
		await this.emitHuddle(huddleId);

		const deltaImages = delta.flatMap((entry) => entry.images ?? []);
		const outcome = await this.enqueueTurn(member.id, () => this.runCoworkerTurn(member, prompt, deltaImages));

		const currentStatus = this.statuses.get(member.id);
		if (currentStatus) {
			this.statuses.set(member.id, { ...currentStatus, working: false });
		}
		await this.emitUpdate();

		const commit = await store.updateHuddleData(huddleId, (room) => {
			room.watermarks[member.id] = room.log.length;
		});

		if (outcome.timedOut) {
			await store.updateHuddleData(huddleId, (room) => {
				room.stranded = {
					...(room.stranded ?? {}),
					[member.id]: { before: commit.log.length, thread: startEpoch },
				};
			});
			return { cancelled: false, spoke: false };
		}

		// A failed turn is a pass, never a room error — but the room should see
		// why the coworker went silent (a bare "(pass)"-like silence reads as
		// having nothing to add).
		if (outcome.error) {
			const reason = outcome.error.length > 160 ? `${outcome.error.slice(0, 160)}…` : outcome.error;
			await this.appendSystemLine(huddleId, `${member.name}'s turn failed: ${reason}`);
			await this.emitHuddle(huddleId);
			return { cancelled: false, spoke: false };
		}

		let spoke = false;
		if (outcome.reply && !isPassText(outcome.reply)) {
			const epochNow = (await store.loadHuddleData(huddleId)).epoch;
			// Yield the reply to a user redirect: a user message landed in the
			// room after this turn was dispatched (the newer send's drive covers
			// it; committing here would double-deliver).
			const newerUserEntry = commit.log.slice(logLengthAtDispatch).some((entry) => entry.from.kind === "user");
			if (!shouldCommitTurn(startEpoch, epochNow, newerUserEntry)) {
				return { cancelled: true, spoke: false };
			}
			if (!isEchoOfLastEntry(commit.log, member.id, outcome.reply)) {
				const reply: OfficeMessage = {
					id: mintMessageId(),
					at: Date.now(),
					from: coworkerAuthor(member),
					text: outcome.reply,
				};
				await store.updateHuddleData(huddleId, (room) => {
					room.log.push(reply);
					// The member has now seen its own reply too.
					room.watermarks[member.id] = room.log.length;
				});
				spoke = true;
			}
		}
		await this.emitHuddle(huddleId);
		return { cancelled: false, spoke };
	}

	/** Deliver late replies that finished after a turn timeout. Runs at the
	 *  top of each round and from the bounded background poll; sessions still
	 *  visibly working are left for a later pass. */
	private async harvestStranded(huddleId: string, members: Coworker[]): Promise<void> {
		const data = await store.loadHuddleData(huddleId);
		const stranded = data.stranded ?? {};
		for (const member of members) {
			const marker = stranded[member.id];
			if (!marker) continue;
			const session = this.sessions.get(this.sessionKey(member.id));
			if (session && (session.isStreaming || session.isCompacting)) continue;
			const messages = session ? flattenMessages(session.messages) : [];
			const reply = pickReply(messages, marker.before);
			await store.updateHuddleData(huddleId, (room) => {
				const next = { ...(room.stranded ?? {}) };
				delete next[member.id];
				room.stranded = next;
			});
			if (reply && !isPassText(reply)) {
				await store.updateHuddleData(huddleId, (room) => {
					if (isEchoOfLastEntry(room.log, member.id, reply)) return;
					room.log.push({
						id: mintMessageId(),
						at: Date.now(),
						from: coworkerAuthor(member),
						text: reply,
					});
				});
				await this.emitHuddle(huddleId);
			}
		}
	}

	/** Bounded background harvest for replies that outlived the drive loop:
	 *  polls every 5s for up to 5 minutes; stops when nothing is stranded, a
	 *  new drive takes the room over (it harvests on its own), or disposal. */
	private scheduleStrandedHarvest(huddleId: string, members: Coworker[]): void {
		if (this.strandedTimers.has(huddleId) || this.disposed) return;
		let attempts = 0;
		const timer = setInterval(() => {
			attempts += 1;
			if (this.disposed || attempts > STRANDED_HARVEST_MAX_TRIES) {
				this.clearStrandedTimer(huddleId);
				return;
			}
			// A live drive harvests at its own round boundaries.
			if ((this.driveCounts.get(huddleId) ?? 0) > 0) return;
			void (async () => {
				try {
					await this.harvestStranded(huddleId, members);
					const data = await store.loadHuddleData(huddleId);
					if (Object.keys(data.stranded ?? {}).length === 0) {
						this.clearStrandedTimer(huddleId);
					}
				} catch {
					// Best-effort: the next tick retries; the bound stops runaways.
				}
			})();
		}, STRANDED_HARVEST_INTERVAL_MS);
		timer.unref?.();
		this.strandedTimers.set(huddleId, timer);
	}

	private clearStrandedTimer(huddleId: string): void {
		const timer = this.strandedTimers.get(huddleId);
		if (timer) {
			clearInterval(timer);
			this.strandedTimers.delete(huddleId);
		}
	}

	// ── coworker sessions + turns ─────────────────────────────────────────────

	private sessionKey(coworkerId: string, cwd = this.runtime.cwd): string {
		return `${coworkerId}::${cwd}`;
	}

	private clearIdleTimer(key: string): void {
		const timer = this.idleTimers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.idleTimers.delete(key);
		}
	}

	private armIdleTimer(key: string): void {
		this.clearIdleTimer(key);
		this.idleTimers.set(
			key,
			setTimeout(() => {
				this.idleTimers.delete(key);
				const session = this.sessions.get(key);
				if (!session) return;
				if (session.isStreaming || session.isCompacting) {
					this.armIdleTimer(key);
					return;
				}
				session.dispose();
				this.sessions.delete(key);
			}, this.idleTimeoutMs),
		);
	}

	/**
	 * Resolve the model a coworker session should run: an explicit override,
	 * else the active session's model (the model picker in the composer) so
	 * coworkers work on whatever model the user picked. The max output is
	 * clamped to a quarter of the context window — some models ship maxTokens
	 * that eat the context, and providers count output against the limit, so
	 * real input (tools alone are ~30K tokens) overflows and every turn 400s.
	 */
	private resolveCoworkerModel(coworker: Coworker): Model<any> | undefined {
		const registry = this.runtime.services.modelRegistry;
		let model: Model<any> | undefined;
		if (coworker.model) {
			const [provider, ...rest] = coworker.model.split("/");
			model = registry.find(provider, rest.join("/")) ?? undefined;
		}
		model ??= this.runtime.session.model ?? undefined;
		if (!model) return undefined;

		const quarter = Math.floor((model.contextWindow ?? 0) / 4);
		if (quarter > 0 && (model.maxTokens ?? Infinity) > quarter) {
			return { ...model, maxTokens: quarter };
		}
		return model;
	}

	private emitActivity(coworkerId: string, event: Omit<OfficeActivityEvent, "coworkerId" | "at">): void {
		try {
			this.sink.activity?.({ ...event, coworkerId, at: Date.now() });
		} catch {
			// A failing sink must not break office operations.
		}
	}

	/** Translate a coworker session's agent events into office activity:
	 *  turn lifecycle, tool calls, and completed assistant speech. Streaming
	 *  deltas are deliberately dropped — speech arrives per message. */
	private attachActivity(session: AgentSession, coworkerId: string): () => void {
		return session.subscribe((event) => {
			switch (event.type) {
				case "agent_start":
					this.emitActivity(coworkerId, { kind: "turn_start" });
					break;
				case "tool_execution_start":
					this.emitActivity(coworkerId, { kind: "tool_start", toolName: event.toolName });
					break;
				case "tool_execution_end":
					this.emitActivity(coworkerId, { kind: "tool_end", toolName: event.toolName });
					break;
				case "message_end": {
					// Only assistant messages are speech — user-role message_end fires
					// for the turn prompt itself and would echo the whole room delta
					// as the coworker "speaking".
					const flattened = flattenMessages([event.message])[0];
					const text = flattened?.role === "assistant" ? (flattened.text ?? "") : "";
					if (text.trim()) {
						this.emitActivity(coworkerId, { kind: "speaking", text });
					}
					break;
				}
				case "agent_end":
					// Composer stop-reason parity: carry how the turn stopped so
					// clients can chime on natural ends only (not aborts, errors, or
					// retryable failures that will re-enter the loop).
					this.emitActivity(coworkerId, {
						kind: "turn_end",
						stopReason: [...event.messages].reverse().find((m) => m.role === "assistant")?.stopReason,
						willRetry: event.willRetry === true ? true : undefined,
					});
					break;
				default:
					break;
			}
		});
	}

	private detachActivity(key: string): void {
		const unsub = this.activityUnsubs.get(key);
		if (unsub) {
			unsub();
			this.activityUnsubs.delete(key);
		}
	}

	/**
	 * The coworker's canonical session for the active project. Created lazily
	 * on first contact; the soul is pinned in the first turn's prompt header.
	 */
	async ensureCoworkerSession(coworker: Coworker): Promise<AgentSession> {
		const cwd = this.runtime.cwd;
		const key = this.sessionKey(coworker.id, cwd);
		const live = this.sessions.get(key);
		if (live) {
			this.armIdleTimer(key);
			return live;
		}

		return withKeyedLock(`office-session:${key}`, async () => {
			const existing = this.sessions.get(key);
			if (existing) {
				this.armIdleTimer(key);
				return existing;
			}

			const stored = coworker.sessions[cwd];
			let sessionManager: SessionManager;
			if (stored && existsSync(stored)) {
				sessionManager = SessionManager.open(stored);
			} else {
				sessionManager = SessionManager.create(cwd, getDefaultSessionDir(cwd, this.runtime.services.agentDir));
			}

			const result = await this.runtime.createSideRuntime({ cwd, sessionManager });
			const session = result.session;

			await session.bindExtensions({
				uiContext: this.createOfficeUIContext(coworker),
				mode: "rpc",
				permissionPromptHandler: async (toolName, reason) => {
					const choice = await this.askUser(coworker, {
						kind: "approval",
						title: `Allow ${toolName}?`,
						message: reason ?? `Permission required for "${toolName}"`,
						choices: ["Allow", "Deny"],
					});
					return choice === "Allow";
				},
				onError: () => {
					this.emitActivity(coworker.id, { kind: "error" });
				},
			});

			session.setPermissionMode(coworker.autonomy === "auto" ? "auto" : "ask");

			const model = this.resolveCoworkerModel(coworker);
			if (model) {
				await session.setModel(model).catch(() => {});
			}

			// Persist the session pointer for future runs.
			if (session.sessionFile) {
				const fresh = (await store.listCoworkers()).find((c) => c.id === coworker.id);
				if (fresh) {
					await store.saveCoworker({ ...fresh, sessions: { ...fresh.sessions, [cwd]: session.sessionFile } });
				}
			}

			this.sessions.set(key, session);
			this.armIdleTimer(key);
			this.detachActivity(key);
			this.activityUnsubs.set(key, this.attachActivity(session, coworker.id));
			return session;
		});
	}

	private async applyCoworkerSessionConfig(coworker: Coworker): Promise<void> {
		const model = this.resolveCoworkerModel(coworker);
		for (const [key, session] of this.sessions) {
			if (!key.startsWith(`${coworker.id}::`)) continue;
			session.setPermissionMode(coworker.autonomy === "auto" ? "auto" : "ask");
			if (model) {
				await session.setModel(model).catch(() => {});
			}
		}
	}

	/** Office UI context for a coworker's side runtime: dialogs route to the
	 *  event sink as supervised prompts; TUI-only surfaces no-op. */
	private createOfficeUIContext(coworker: Coworker): ExtensionUIContext {
		const context: ExtensionUIContext = {
			...noOpUIContext,
			select: async (title: string, options: string[]) => {
				if (options.length === 0) return undefined;
				const choice = await this.askUser(coworker, { kind: "question", title, message: title, choices: options });
				return choice ?? undefined;
			},
			confirm: async (title: string, message: string) => {
				const choice = await this.askUser(coworker, {
					kind: "approval",
					title,
					message,
					choices: ["Allow", "Deny"],
				});
				return choice === "Allow";
			},
			requestUserQuestion: async (payload: {
				questions: Array<{ header: string; question: string; options: UserQuestionOption[] }>;
			}) => {
				const answers: Record<string, string> = {};
				for (const question of payload.questions) {
					const labels = question.options.map((option: UserQuestionOption) => option.label);
					const choice = await this.askUser(coworker, {
						kind: "question",
						title: question.header,
						message: question.question,
						choices: labels,
					});
					if (choice === null) return undefined;
					answers[question.header] = choice;
				}
				return { answers };
			},
		};
		return context;
	}

	/** Route a supervised prompt to the user; resolves with the chosen choice,
	 *  or null on timeout. */
	private async askUser(
		coworker: Coworker,
		input: { kind: OfficePrompt["kind"]; title: string; message: string; choices: string[] },
	): Promise<string | null> {
		const prompt: OfficePrompt = {
			requestId: randomUUID(),
			coworkerId: coworker.id,
			coworkerName: coworker.name,
			kind: input.kind,
			title: input.title,
			message: input.message,
			choices: input.choices,
			at: Date.now(),
		};
		const status = this.statuses.get(coworker.id);
		if (status) {
			this.statuses.set(coworker.id, { ...status, needsInput: true });
		}
		this.sink.prompt?.(prompt);
		await this.emitUpdate();

		try {
			return await new Promise<string | null>((resolve) => {
				const timer = setTimeout(() => {
					this.pendingPrompts.delete(prompt.requestId);
					resolve(null);
				}, PROMPT_TIMEOUT_MS);
				this.pendingPrompts.set(prompt.requestId, { prompt, resolve, timer });
			});
		} finally {
			const after = this.statuses.get(coworker.id);
			if (after) {
				this.statuses.set(coworker.id, { ...after, needsInput: false });
			}
			await this.emitUpdate();
		}
	}

	/** Answer a pending supervised prompt (from a client command). */
	async respondPrompt(requestId: string, choice: string | null): Promise<boolean> {
		const pending = this.pendingPrompts.get(requestId);
		if (!pending) return false;
		clearTimeout(pending.timer);
		this.pendingPrompts.delete(requestId);
		pending.resolve(choice);
		return true;
	}

	/** Run one coworker turn: prompt the session, await completion, extract the
	 *  reply text. Returns the reply (or null on pass/failure) plus whether the
	 *  turn hit the hard cap. */
	private async runCoworkerTurn(
		coworker: Coworker,
		prompt: string,
		images?: OfficeAttachment[],
	): Promise<{ reply: string | null; timedOut: boolean; error?: string }> {
		let session: AgentSession;
		try {
			session = await this.ensureCoworkerSession(coworker);
		} catch (e) {
			return { reply: null, timedOut: false, error: e instanceof Error ? e.message : String(e) };
		}
		if (session.isStreaming || session.isCompacting) {
			// Defensive: queues should prevent this; treat as busy-pass.
			return { reply: null, timedOut: false };
		}

		const before = session.messages.length;
		let timedOut = false;

		// Image attachments ride the prompt as real vision content; files are
		// named in the prompt text (the transcript line) only.
		const imageContent = (images ?? [])
			.map((attachment) => (attachment.kind === "image" ? parseDataUrl(attachment.data) : null))
			.filter((parsed): parsed is { data: string; mimeType: string } => parsed !== null)
			.map((parsed): ImageContent => ({ type: "image", data: parsed.data, mimeType: parsed.mimeType }));

		// `prompt` resolves when the whole turn settles (tool loops and retries
		// included), so it IS the turn — the hard cap aborts a run that outlives
		// its window, and whatever landed by then is still harvested below.
		const hardCap = setTimeout(() => {
			timedOut = true;
			void session.abort().catch(() => {});
		}, OFFICE_TURN_HARD_CAP_MS);
		try {
			await session.prompt(prompt, imageContent.length ? { images: imageContent } : undefined);
		} catch (e) {
			return { reply: null, timedOut, error: e instanceof Error ? e.message : String(e) };
		} finally {
			clearTimeout(hardCap);
		}

		const texts = flattenMessages(session.messages);
		return { reply: pickReply(texts, before), timedOut };
	}

	// ── errands ───────────────────────────────────────────────────────────────

	private async tickErrands(): Promise<void> {
		if (this.disposed) return;
		const errands = await store.listErrands();
		const now = Date.now();
		for (const errand of errands) {
			if (!isDue(errand, now)) continue;
			try {
				await this.fireErrand(errand);
			} catch (error) {
				await store.updateErrand(errand.id, (e) => {
					e.lastRunAt = now;
					e.lastStatus = "error";
					e.lastError = error instanceof Error ? error.message : String(error);
					e.nextRunAt = nextRunAt(e.schedule, Date.now());
				});
				await this.emitUpdate();
			}
		}
	}

	/** Run one errand now (also used by the "run now" client action). */
	async runErrandNow(id: string): Promise<void> {
		const errand = (await store.listErrands()).find((e) => e.id === id);
		if (!errand) throw new Error("Errand not found");
		await this.fireErrand(errand);
	}

	private async fireErrand(errand: Errand): Promise<void> {
		const coworker = (await store.listCoworkers()).find((c) => c.id === errand.coworkerId);
		if (!coworker) {
			await store.updateErrand(errand.id, (e) => {
				e.lastStatus = "error";
				e.lastError = "Coworker no longer on the roster";
				e.enabled = false;
			});
			await this.emitUpdate();
			return;
		}

		const head = `[Errand: ${errand.name}] ${identityReminder(coworker)} A scheduled errand from the user. Do the work, then report the result plainly — your reply is delivered${errand.delivery === "huddle" ? " to the huddle" : " to your DM with the user"}.`;
		const prompt = `${head}\n\n${errand.prompt}`;

		let reply: string | null = null;
		let status: "ok" | "error" | "timeout" = "ok";
		let error: string | undefined;
		try {
			if (errand.continuity) {
				const outcome = await this.enqueueTurn(coworker.id, () => this.runCoworkerTurn(coworker, prompt));
				reply = outcome.reply;
				if (outcome.timedOut) {
					status = "timeout";
				}
			} else {
				// Fresh eyes: ephemeral side session, disposed after the run.
				reply = await this.runEphemeralTurn(coworker, prompt);
			}
		} catch (e) {
			status = "error";
			error = e instanceof Error ? e.message : String(e);
		}

		if (reply && !isPassText(reply)) {
			await this.deliverErrandOutput(coworker, errand, reply);
		}

		await store.updateErrand(errand.id, (e) => {
			e.lastRunAt = Date.now();
			e.lastStatus = status;
			e.lastError = error;
			const next = nextRunAt(e.schedule, Date.now());
			e.nextRunAt = next;
			if (e.schedule.kind === "once") {
				e.enabled = false;
			}
		});
		await this.emitUpdate();
	}

	private async deliverErrandOutput(coworker: Coworker, errand: Errand, text: string): Promise<void> {
		const message: OfficeMessage = {
			id: mintMessageId(),
			at: Date.now(),
			from: coworkerAuthor(coworker),
			text,
		};
		if (errand.delivery === "huddle" && errand.huddleId) {
			const huddle = (await store.listHuddles()).find((h) => h.id === errand.huddleId);
			if (!huddle) return;
			await store.updateHuddleData(huddle.id, (room) => {
				room.log.push(message);
			});
			await this.emitHuddle(huddle.id);
			this.startDrive(huddle.id).catch(() => {});
			return;
		}
		// DM delivery: log into the coworker's DM huddle.
		const dmId = dmHuddleId(coworker.id);
		const huddles = await store.listHuddles();
		if (!huddles.some((h) => h.id === dmId)) {
			await store.saveHuddle({ id: dmId, name: coworker.name, members: [coworker.id], createdAt: Date.now() });
		}
		await store.updateHuddleData(dmId, (room) => {
			room.log.push(message);
			room.watermarks[coworker.id] = room.log.length;
		});
		await this.emitHuddle(dmId);
	}

	/** One-off turn in an ephemeral session (fresh-eyes errands). The soul is
	 *  pinned in the first prompt so the persona holds even without history. */
	private async runEphemeralTurn(coworker: Coworker, prompt: string): Promise<string | null> {
		const cwd = this.runtime.cwd;
		const sessionManager = SessionManager.create(cwd, getDefaultSessionDir(cwd, this.runtime.services.agentDir));
		const result = await this.runtime.createSideRuntime({ cwd, sessionManager });
		const session = result.session;
		const detach = this.attachActivity(session, coworker.id);
		try {
			await session.bindExtensions({ uiContext: noOpUIContext, mode: "rpc", onError: () => {} });
			session.setPermissionMode(coworker.autonomy === "auto" ? "auto" : "ask");
			const before = session.messages.length;
			const withSoul = `${coworker.soul}\n\n---\n\n${prompt}`;
			await session.prompt(withSoul);
			const texts = flattenMessages(session.messages);
			return pickReply(texts, before);
		} finally {
			detach();
			session.dispose();
		}
	}

	// ── errand CRUD ───────────────────────────────────────────────────────────

	async createErrand(input: {
		coworkerId: string;
		name: string;
		prompt: string;
		schedule: ErrandSchedule;
		continuity: boolean;
		delivery: Errand["delivery"];
		huddleId?: string;
	}): Promise<Errand> {
		if (!input.name.trim()) throw new Error("Name is required");
		if (!input.prompt.trim()) throw new Error("Prompt is required");
		const errand: Errand = {
			id: randomUUID(),
			coworkerId: input.coworkerId,
			name: input.name.trim(),
			prompt: input.prompt.trim(),
			schedule: input.schedule,
			continuity: input.continuity,
			delivery: input.delivery,
			huddleId: input.huddleId,
			enabled: true,
			createdAt: Date.now(),
			nextRunAt: nextRunAt(input.schedule, Date.now()),
		};
		await store.saveErrand(errand);
		await this.emitUpdate();
		return errand;
	}

	async updateErrand(
		id: string,
		input: Partial<Pick<Errand, "name" | "prompt" | "schedule" | "continuity" | "delivery" | "huddleId" | "enabled">>,
	): Promise<void> {
		await store.updateErrand(id, (errand) => {
			if (input.name !== undefined) errand.name = input.name;
			if (input.prompt !== undefined) errand.prompt = input.prompt;
			if (input.schedule !== undefined) {
				errand.schedule = input.schedule;
				errand.nextRunAt = nextRunAt(input.schedule, Date.now());
			}
			if (input.continuity !== undefined) errand.continuity = input.continuity;
			if (input.delivery !== undefined) errand.delivery = input.delivery;
			if (input.huddleId !== undefined) errand.huddleId = input.huddleId;
			if (input.enabled !== undefined) {
				errand.enabled = input.enabled;
				if (input.enabled) {
					errand.nextRunAt = nextRunAt(errand.schedule, Date.now());
				}
			}
		});
		await this.emitUpdate();
	}

	async deleteErrand(id: string): Promise<void> {
		await store.deleteErrand(id);
		await this.emitUpdate();
	}

	/** Describe an errand's schedule for the roster UI. */
	describeErrand(errand: Errand): string {
		return describeSchedule(errand.schedule);
	}
}

function seatOf(members: Coworker[]): Coworker[] {
	return members;
}

/** Silence marker text (re-exported for hosts). */
export const PASS_TEXT = OFFICE_PASS_TEXT;
