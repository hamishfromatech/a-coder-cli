import { create } from "zustand";

/**
 * One confirmation primitive for the whole app.
 *
 * `confirm()` is invocable from anywhere (event handlers, menus, stores) and
 * renders a single focus-trapped dialog via `ConfirmHost`. The dialog owns the
 * interaction laws: focus lands on Confirm at open, Enter confirms, Esc
 * cancels, the confirm action runs with a pending state, a failure keeps the
 * dialog open with the error inline, and a successful action plays a short
 * done beat before closing.
 */

export interface ConfirmSecondaryAction {
	label: string;
	onSelect: () => void;
}

export interface ConfirmOptions {
	title: string;
	message?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** Destructive styling for the confirm button. */
	danger?: boolean;
	/** Rendered inside the dialog (e.g. a scope note). */
	detail?: string;
	/** Runs before the dialog closes; throwing keeps it open with the error. */
	onConfirm?: () => Promise<void> | void;
	/** Extra dismissive action besides Cancel (e.g. "Open settings"). */
	secondaryAction?: ConfirmSecondaryAction;
}

export interface ConfirmRequest extends ConfirmOptions {
	id: number;
	resolve: (confirmed: boolean) => void;
}

interface ConfirmState {
	request: ConfirmRequest | null;
	pending: boolean;
	done: boolean;
	error: string | null;
	ask: (options: ConfirmOptions) => Promise<boolean>;
	confirm: () => Promise<void>;
	cancel: () => void;
	runSecondary: () => void;
}

let nextId = 1;

const DONE_BEAT_MS = 180;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
	request: null,
	pending: false,
	done: false,
	error: null,
	ask: (options) =>
		new Promise<boolean>((resolve) => {
			// A newer request supersedes an unanswered one; the old promise must
			// not hang forever.
			get().request?.resolve(false);
			set({ request: { ...options, id: nextId++, resolve }, pending: false, done: false, error: null });
		}),
	confirm: async () => {
		const { request, pending, done } = get();
		if (!request || pending || done) return;
		set({ pending: true, error: null });
		try {
			await request.onConfirm?.();
		} catch (e) {
			set({
				pending: false,
				error: e instanceof Error ? e.message : String(e),
			});
			return;
		}
		set({ pending: false, done: true });
		const id = request.id;
		window.setTimeout(() => {
			// A request that arrived during the beat owns the dialog now.
			if (get().request?.id !== id) return;
			set({ request: null, done: false, error: null });
			request.resolve(true);
		}, DONE_BEAT_MS);
	},
	cancel: () => {
		const { request, pending } = get();
		if (!request || pending) return;
		set({ request: null, done: false, error: null });
		request.resolve(false);
	},
	runSecondary: () => {
		const { request, pending } = get();
		if (!request?.secondaryAction || pending) return;
		const action = request.secondaryAction;
		set({ request: null, done: false, error: null });
		request.resolve(false);
		action.onSelect();
	},
}));

/** Ask for confirmation; resolves true when the confirm action succeeded. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
	return useConfirmStore.getState().ask(options);
}
