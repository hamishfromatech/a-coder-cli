import { create } from "zustand";

// Extension-driven UI surfaces: status lines and widget blocks set via the
// extension UI RPC (setStatus / setWidget). These are fire-and-forget updates
// from the engine; the desktop mirrors them so extensions that use these
// surfaces keep working in headless mode.

export interface ExtensionWidget {
	key: string;
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
}

export interface WidgetState {
	/** Named status slots, e.g. setStatus("git", "main ✓"). */
	status: Record<string, string | undefined>;
	/** Widget blocks keyed by their key. */
	widgets: Record<string, ExtensionWidget>;
	/** Ordered widget keys for stable rendering. */
	widgetOrder: string[];
	setStatus: (key: string, text: string | undefined) => void;
	setWidget: (key: string, lines: string[] | undefined, placement: ExtensionWidget["placement"]) => void;
	clear: () => void;
}

export const useWidgetStore = create<WidgetState>((set) => ({
	status: {},
	widgets: {},
	widgetOrder: [],
	setStatus: (key, text) =>
		set((state) => {
			const next = { ...state.status };
			if (text === undefined) delete next[key];
			else next[key] = text;
			return { status: next };
		}),
	setWidget: (key, lines, placement) =>
		set((state) => {
			const nextWidgets = { ...state.widgets };
			const nextOrder = state.widgetOrder.filter((k) => k !== key);
			if (lines === undefined || lines.length === 0) {
				delete nextWidgets[key];
			} else {
				nextWidgets[key] = { key, lines, placement };
				nextOrder.push(key);
			}
			return { widgets: nextWidgets, widgetOrder: nextOrder };
		}),
	clear: () => set({ status: {}, widgets: {}, widgetOrder: [] }),
}));