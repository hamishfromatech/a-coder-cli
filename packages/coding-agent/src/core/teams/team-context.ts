/**
 * In-process active-team registry.
 *
 * Encodes "this process is currently leading team X" — one team per process,
 * source-aligned (TeamCreate refuses while a context is set). The team
 * metadata itself lives on disk (TeamFile); this is the in-memory cache that
 * lets tools and the runner answer "what team am I in?" without a disk read.
 */

export interface TeamContext {
	/** Canonical team name (equals TeamFile.name). */
	teamName: string;
	/** Lead's deterministic agentId (`<TEAM_LEAD_NAME>@<teamName>`). */
	leadAgentId: string;
	/** Absolute path to team.json. */
	teamFilePath: string;
	/** ms since epoch when the team was created. */
	createdAt: number;
}

let current: TeamContext | null = null;

type Listener = (ctx: TeamContext | null) => void;
const listeners = new Set<Listener>();

function notify(): void {
	for (const l of listeners) {
		try {
			l(current);
		} catch {
			// Never let a UI subscriber break a state transition.
		}
	}
}

/** Set the active team. Throws when a different team is already active. */
export function setActiveTeam(ctx: TeamContext): void {
	if (current !== null && current.teamName !== ctx.teamName) {
		throw new Error(`Already in team "${current.teamName}". Run TeamDelete before creating a new team.`);
	}
	current = ctx;
	notify();
}

/** Clear the active team. */
export function clearActiveTeam(): void {
	if (current === null) return;
	current = null;
	notify();
}

/** Current team context, or null when no team is active. */
export function getActiveTeam(): TeamContext | null {
	return current;
}

/** Cheap "are we in a team right now?" check. */
export function isInActiveTeam(): boolean {
	return current !== null;
}

/** Subscribe to team-context changes. Returns an unsubscribe handle. */
export function subscribeActiveTeam(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
