/**
 * Your Office — domain model.
 *
 * A society of named agents ("coworkers") with faces, persistent memory, and
 * huddles (group conversations) where coworkers talk to each other and to the
 * user like a team. Scheduled work travels as "errands" — jobs that fire into
 * a coworker's session, optionally with continuity so the coworker learns
 * between runs.
 *
 * The model is deliberately plain JSON: every record round-trips through the
 * office store as-is, so all fields need stable, serializable shapes.
 */

/** How much rope a coworker gets when it runs tools. */
export type Autonomy = "supervised" | "auto";

/** Procedural avatar geometry (rendered by the desktop/TUI from these fields). */
export type FaceShape = "circle" | "hexagon" | "squircle" | "triangle" | "drop" | "cloud";

export interface Face {
	/** Hex color. Missing = deterministic color derived from the handle. */
	color?: string;
	shape: FaceShape;
	/** Data URL (user upload). Overrides the procedural face when present. */
	image?: string;
}

/** A named agent on the roster. */
export interface Coworker {
	/** Stable slug id; handles and storage keys derive from it. */
	id: string;
	/** Display name (e.g. "Atlas"). */
	name: string;
	/** @mention slug, lowercase (e.g. "atlas"). Defaults to a slug of the name. */
	handle: string;
	/** Role in one line (e.g. "Scout"). */
	title?: string;
	/** What this coworker is for (shown in the roster + fed to teammates). */
	description?: string;
	/** Persona text pinned into the coworker's session at birth. */
	soul: string;
	face: Face;
	/** Model override as "provider/modelId". Inherited when absent. */
	model?: string;
	autonomy: Autonomy;
	createdAt: number;
	/**
	 * The coworker's canonical forever-chat, one session per project cwd.
	 * Sessions are created lazily on first contact in a project; the map keys
	 * are resolved cwds. Session memory lives in the session file — this record
	 * only holds the pointer.
	 */
	sessions: Record<string, string>;
	hidden?: boolean;
}

/** One message in a huddle log. */
export interface OfficeMessage {
	id: string;
	/** ms since epoch. */
	at: number;
	from: OfficeMessageAuthor;
	text: string;
	/** Attachments ride as data URLs; staged into each coworker turn. */
	images?: OfficeAttachment[];
}

export interface OfficeMessageAuthor {
	kind: "user" | "coworker" | "system";
	/** Coworker id; absent for user/system entries. */
	id?: string;
	/** Display name at post time. */
	name: string;
}

export interface OfficeAttachment {
	name: string;
	kind: "image" | "file";
	/** Data URL. */
	data: string;
}

/** Huddle metadata (persisted in huddles.json; the log lives beside it). */
export interface Huddle {
	id: string;
	name: string;
	/** Coworker ids seated in the huddle. */
	members: string[];
	createdAt: number;
	pinned?: boolean;
}

/**
 * Per-huddle runtime state: the ordered room log plus per-coworker read
 * pointers. One file per huddle under huddles-data/<id>.json.
 *
 * DMs are huddles too — id `dm:<coworkerId>`, a single member — so the chat
 * renderer and drive logic stay uniform.
 */
export interface HuddleData {
	/** Bumped to abandon in-flight turns from a previous drive. */
	epoch: number;
	log: OfficeMessage[];
	/** Log index each coworker has read up to (`<huddleId>::<coworkerId>` is
	 *  not needed — watermarks are per huddle file). Keys are coworker ids. */
	watermarks: Record<string, number>;
	/** Coworkers the user told to stop; held until re-addressed. Value = ms. */
	holds: Record<string, number>;
	/** Live drive state, present while a drive is running. */
	running?: { startedAt: number; current?: string; thread: number };
	/** Late-reply markers: coworker id → { log index at dispatch, drive id }. */
	stranded?: Record<string, { before: number; thread: number }>;
}

/** Schedule kinds for errands. */
export type ErrandSchedule =
	| { kind: "every"; minutes: number }
	| { kind: "daily" /** "HH:MM" local time. */; time: string }
	| { kind: "once"; at: number };

/** Where an errand's output lands. */
export type ErrandDelivery = "dm" | "huddle";

/** A scheduled job assigned to one coworker. */
export interface Errand {
	id: string;
	coworkerId: string;
	name: string;
	/** What to do — delivered as a task message to the coworker. */
	prompt: string;
	schedule: ErrandSchedule;
	/**
	 * continuity: run in the coworker's canonical session so it keeps the full
	 * history and learns between runs. Otherwise each run is a fresh ephemeral
	 * session ("fresh eyes"), still delivered to the same place.
	 */
	continuity: boolean;
	delivery: ErrandDelivery;
	/** Target huddle when delivery === "huddle". */
	huddleId?: string;
	enabled: boolean;
	createdAt: number;
	lastRunAt?: number;
	lastStatus?: "ok" | "error" | "timeout";
	lastError?: string;
	nextRunAt?: number;
}

/** Snapshot of one coworker's live state, for roster badges. */
export interface CoworkerStatus {
	/** A turn is in flight on the coworker's session. */
	working: boolean;
	/** A supervised prompt is waiting for the user. */
	needsInput: boolean;
}

/** Summary row for the roster: huddle without the full log. */
export interface HuddleSummary {
	id: string;
	name: string;
	members: string[];
	/** Last log entry preview + time, for the roster. */
	preview?: string;
	lastActive?: number;
	/** Unread count for the viewer — computed client-side when a read pointer
	 *  exists; the service leaves it unset. */
	unread?: number;
	pinned?: boolean;
}

/** What a supervisor prompt (approval / question) looks like to clients. */
export interface OfficePrompt {
	requestId: string;
	coworkerId: string;
	coworkerName: string;
	kind: "approval" | "question";
	title: string;
	message: string;
	choices: string[];
	at: number;
}

/** Live per-coworker activity, for office visualizations (floor views).
 *  Emitted while a coworker's turn runs; `text` carries assistant speech
 *  (per message, already complete — never streaming deltas). */
export type OfficeActivityKind = "turn_start" | "tool_start" | "tool_end" | "speaking" | "turn_end" | "error";

export interface OfficeActivityEvent {
	coworkerId: string;
	kind: OfficeActivityKind;
	toolName?: string;
	text?: string;
	/** Present on turn_end: how the coworker's turn stopped (composer-style
	 *  stop reason — "aborted"/"error" vs natural "stop"/"toolUse"/"length").
	 *  Clients use it to decide whether a completion cue should play. */
	stopReason?: string;
	/** Present on turn_end: the turn failed retryably and will re-enter the loop. */
	willRetry?: boolean;
	at: number;
}

/** Full state snapshot pushed to clients on every change. */
export interface OfficeSnapshot {
	coworkers: Coworker[];
	statuses: Record<string, CoworkerStatus>;
	huddles: HuddleSummary[];
	errands: Errand[];
	pendingPrompts: OfficePrompt[];
}

/** Per-huddle payload pushed on log changes. */
export interface OfficeHuddlePayload {
	huddleId: string;
	data: HuddleData;
	/** Members' current working flags, for the typing indicator. */
	working: Record<string, boolean>;
}

/** The event sink the host (RPC mode / TUI) provides to the service. */
export interface OfficeEventSink {
	/** Roster-level snapshot changed. */
	update: (snapshot: OfficeSnapshot) => void;
	/** A huddle's log changed. */
	huddle: (payload: OfficeHuddlePayload) => void;
	/** A supervised prompt opened (snapshot also carries it). */
	prompt?: (prompt: OfficePrompt) => void;
	/** Live coworker activity (turn/tool/speech), for office visualizations. */
	activity?: (event: OfficeActivityEvent) => void;
}

/** Identity + collaboration reminder prepended to every coworker turn. */
export const OFFICE_TURN_RULES = [
	"- Reply with ONE conversational message ONLY if you have something new worth adding: build on what was said, claim or hand off work, answer a question aimed at you, or report a real result. Keep chatter short (1-3 sentences) — but when you are delivering a result, an answer the user asked for, or substantive work, give it at full quality and length; never thin out real content to fit the room.",
	'- If you have nothing new to add, reply with exactly "(pass)". Passing is good — it lets the conversation settle.',
	"- Mention a teammate as @handle to pull them into the conversation; mention @user only for judgment calls or results the user needs.",
	"- Your reply goes to the room verbatim — no preamble, no meta-commentary, no sign-off.",
].join("\n");

/** Engine caps for one drive (inspired by bounded round-robin coordination). */
export const OFFICE_MAX_ROUNDS = 3;
export const OFFICE_MAX_MESSAGES = 10;
/** Bounded continuation rounds for cited-but-unanswered @mention handoffs. */
export const OFFICE_MAX_CONTINUATIONS = 2;
export const OFFICE_HISTORY_LIMIT = 24;
export const OFFICE_MAX_MEMBERS = 6;
export const OFFICE_TURN_TIMEOUT_MS = 180_000;
/** A visibly-working turn keeps its slot up to this hard cap before abort. */
export const OFFICE_TURN_HARD_CAP_MS = 20 * 60_000;
/** Silence marker: a reply that means "nothing to add". */
export const OFFICE_PASS_TEXT = "(pass)";
