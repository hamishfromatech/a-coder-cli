import { create } from "zustand";
import { triggerHaptic } from "../lib/haptics";

export type ToastKind = "info" | "warning" | "error" | "success";

export interface Toast {
	id: string;
	kind: ToastKind;
	title: string;
	message?: string;
	/** Auto-dismiss after this many ms; 0 keeps it until dismissed. */
	timeoutMs: number;
}

export interface ToastState {
	toasts: Toast[];
	push: (toast: Omit<Toast, "id" | "timeoutMs"> & { timeoutMs?: number }) => string;
	dismiss: (id: string) => void;
	clear: () => void;
}

const DEFAULT_TIMEOUT: Record<ToastKind, number> = {
	info: 4000,
	success: 3000,
	warning: 6000,
	error: 0,
};

export const useToastStore = create<ToastState>((set, get) => ({
	toasts: [],
	push: (toast) => {
		const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const timeoutMs = toast.timeoutMs ?? DEFAULT_TIMEOUT[toast.kind];
		const full: Toast = { id, timeoutMs, ...toast };
		// Haptic only for attention-worthy toasts (errors, warnings). Info and
		// success toasts are frequent and would buzz on every positive event.
		if (toast.kind === "error") triggerHaptic("error");
		else if (toast.kind === "warning") triggerHaptic("warning");
		set((state) => ({ toasts: [...state.toasts, full] }));
		if (timeoutMs > 0) {
			setTimeout(() => {
				get().dismiss(id);
			}, timeoutMs);
		}
		return id;
	},
	dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
	clear: () => set({ toasts: [] }),
}));

/** Convenience helpers for the most common kinds. */
export const toast = {
	info: (title: string, message?: string) => useToastStore.getState().push({ kind: "info", title, message }),
	success: (title: string, message?: string) => useToastStore.getState().push({ kind: "success", title, message }),
	warning: (title: string, message?: string) => useToastStore.getState().push({ kind: "warning", title, message }),
	error: (title: string, message?: string) => useToastStore.getState().push({ kind: "error", title, message }),
};