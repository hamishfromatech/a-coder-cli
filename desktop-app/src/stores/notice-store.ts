import { create } from "zustand";

/**
 * Persistent, dismissible notices — the "butterbar" above the status bar.
 *
 * Toasts are for things that happened; notices are for things that are still
 * true and need a decision (engine skew, expired credentials, an MCP server
 * that cannot connect). They do not vanish on a timer. A `persistKey` makes a
 * dismissal survive restarts, so a notice the user has already judged does not
 * come back on every launch.
 *
 * Priority sorts the carousel: the highest-priority notice is shown, lower
 * ones rotate behind it.
 */

export type NoticeTone = "info" | "warning" | "error" | "success";

export interface NoticeAction {
	label: string;
	onSelect: () => void;
}

export interface NoticeInput {
	/** Stable identity: pushing the same id replaces the existing notice. */
	id: string;
	title: string;
	message?: string;
	tone?: NoticeTone;
	/** Higher wins in the carousel. Info 10, warning/error 30, custom higher. */
	priority?: number;
	/** Remember dismissal across restarts (and re-pushing is ignored after). */
	persistKey?: string;
	action?: NoticeAction;
	/** Optional second action (e.g. "Dismiss forever"). */
	secondaryAction?: NoticeAction;
}

export interface Notice extends Required<Pick<NoticeInput, "id" | "title" | "tone" | "priority">> {
	message?: string;
	persistKey?: string;
	action?: NoticeAction;
	secondaryAction?: NoticeAction;
}

const DISMISSED_STORAGE_KEY = "a-coder.notices.dismissed";

function readDismissed(): string[] {
	try {
		const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
	}
}

function writeDismissed(keys: string[]): void {
	try {
		localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(keys));
	} catch {
		/* dismissal persistence is a convenience */
	}
}

const TONE_PRIORITY: Record<NoticeTone, number> = {
	info: 10,
	success: 10,
	warning: 30,
	error: 40,
};

interface NoticeState {
	notices: Notice[];
	dismissed: string[];
	push: (notice: NoticeInput) => void;
	remove: (id: string) => void;
	dismissForever: (notice: Notice) => void;
}

export const useNoticeStore = create<NoticeState>((set, get) => ({
	notices: [],
	dismissed: readDismissed(),
	push: (input) => {
		const { dismissed } = get();
		if (input.persistKey && dismissed.includes(input.persistKey)) return;
		const notice: Notice = {
			id: input.id,
			title: input.title,
			message: input.message,
			tone: input.tone ?? "info",
			priority: input.priority ?? TONE_PRIORITY[input.tone ?? "info"],
			persistKey: input.persistKey,
			action: input.action,
			secondaryAction: input.secondaryAction,
		};
		set((state) => {
			const existing = state.notices.findIndex((n) => n.id === notice.id);
			if (existing >= 0) {
				// Same notice re-reported (e.g. the same error twice): keep one,
				// refresh its content, don't duplicate the strip.
				const next = [...state.notices];
				next[existing] = notice;
				return { notices: next };
			}
			return { notices: [...state.notices, notice] };
		});
	},
	remove: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
	dismissForever: (notice) => {
		if (notice.persistKey) {
			const dismissed = [...new Set([...get().dismissed, notice.persistKey])];
			writeDismissed(dismissed);
			set({ dismissed });
		}
		get().remove(notice.id);
	},
}));

/** Push a notice from anywhere (stores, event pipelines, settings). */
export function notice(input: NoticeInput): void {
	useNoticeStore.getState().push(input);
}
