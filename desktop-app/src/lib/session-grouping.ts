/**
 * Session grouping — group sessions by time (today, yesterday, older).
 * Mirrors OpenCode's groupSessions() pattern from home-sessions-controller.tsx.
 */

export interface GroupableSession {
	id: string;
	name: string;
	lastActive: number; // timestamp
	projectPath?: string;
	projectName?: string;
}

export type SessionGroupId = "today" | "yesterday" | "older";

export interface SessionGroup {
	id: SessionGroupId;
	label: string;
	sessions: GroupableSession[];
}

/**
 * Group sessions by time relative to now.
 * - today: same calendar day as now
 * - yesterday: same calendar day as (now - 1 day)
 * - older: everything else
 */
export function groupSessionsByTime(
	sessions: GroupableSession[],
	now: number = Date.now(),
): SessionGroup[] {
	const nowDate = new Date(now);
	const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
	const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

	const today: GroupableSession[] = [];
	const yesterday: GroupableSession[] = [];
	const older: GroupableSession[] = [];

	for (const session of sessions) {
		const lastActive = session.lastActive;
		if (lastActive >= todayStart) {
			today.push(session);
		} else if (lastActive >= yesterdayStart) {
			yesterday.push(session);
		} else {
			older.push(session);
		}
	}

	// Sort each group by lastActive descending (most recent first)
	const sortDesc = (a: GroupableSession, b: GroupableSession) => b.lastActive - a.lastActive;

	const groups: SessionGroup[] = [];

	if (today.length > 0) {
		groups.push({ id: "today", label: "Today", sessions: today.sort(sortDesc) });
	}
	if (yesterday.length > 0) {
		groups.push({ id: "yesterday", label: "Yesterday", sessions: yesterday.sort(sortDesc) });
	}
	if (older.length > 0) {
		groups.push({ id: "older", label: "Older", sessions: older.sort(sortDesc) });
	}

	return groups;
}

/**
 * Format relative time for session lastActive.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		if (days === 1) return "yesterday";
		if (days < 7) return `${days} days ago`;
		if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
		if (days < 365) return `${Math.floor(days / 30)} months ago`;
		return `${Math.floor(days / 365)} years ago`;
	}

	if (hours > 0) return `${hours}h ago`;
	if (minutes > 0) return `${minutes}m ago`;
	if (seconds > 0) return `${seconds}s ago`;
	return "just now";
}