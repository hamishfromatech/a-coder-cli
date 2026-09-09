import { describe, expect, it, vi } from "vitest";
import { Container, type TUI } from "../../tui/src/tui.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	RetryStatusIndicator,
	type StatusIndicator,
	type StatusIndicatorKind,
	WorkingStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type StatusEditor = {
	embedWorkingStatus: boolean;
	setWorkingStatusIndicator: (indicator: StatusIndicator | undefined) => void;
};

type ClearStatusContext = {
	activeStatusIndicator: { kind: StatusIndicatorKind; dispose: () => void } | undefined;
	activeWorkingIndicatorEmbedded: boolean;
	statusContainer: Container;
	defaultEditor: StatusEditor;
	editor: Partial<StatusEditor>;
	ui: { getClearOnShrink: () => boolean };
	idleStatus: Component;
	setEditorWorkingStatusIndicator(indicator: StatusIndicator | undefined): boolean;
};

type InteractiveModePrototype = {
	showStatusIndicator(this: ClearStatusContext, indicator: StatusIndicator): void;
	clearStatusIndicator(this: ClearStatusContext, kind?: StatusIndicatorKind): void;
	setEditorWorkingStatusIndicator(this: ClearStatusContext, indicator: StatusIndicator | undefined): boolean;
};

// Minimal Component stand-in for the idle placeholder.
type Component = {
	render: (width: number) => string[];
	invalidate: () => void;
};

// Minimal idle placeholder: only render/invalidate are touched.
const idleStatus = (): Component => ({
	render: () => [""],
	invalidate: () => {},
});

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("clear-on-shrink status spacing", () => {
	it.each([true, false])("routes every status through the editor opt-in (%s)", (embedWorkingStatus) => {
		initTheme("dark");
		const tui = { requestRender: vi.fn() } as unknown as TUI;
		const editor: StatusEditor = { embedWorkingStatus, setWorkingStatusIndicator: vi.fn() };
		const context: ClearStatusContext = {
			activeStatusIndicator: undefined,
			activeWorkingIndicatorEmbedded: false,
			statusContainer: new Container(),
			defaultEditor: { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() },
			editor,
			ui: { getClearOnShrink: () => true },
			idleStatus: idleStatus(),
			setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
		};
		const indicators = [
			new WorkingStatusIndicator(tui, "Working"),
			new CompactionStatusIndicator(tui, "manual"),
			new CompactionStatusIndicator(tui, "threshold"),
			new CompactionStatusIndicator(tui, "overflow"),
			new BranchSummaryStatusIndicator(tui),
			new RetryStatusIndicator(tui, 1, 3, 1000),
		];
		try {
			for (const indicator of indicators) {
				interactiveModePrototype.showStatusIndicator.call(context, indicator);
				expect(context.activeStatusIndicator).toBe(indicator);
				expect(context.activeWorkingIndicatorEmbedded).toBe(embedWorkingStatus);
				if (embedWorkingStatus) {
					expect(editor.setWorkingStatusIndicator).toHaveBeenLastCalledWith(indicator);
					expect(context.statusContainer.children).toHaveLength(0);
				} else {
					expect(context.statusContainer.children).toEqual([indicator]);
				}
			}
		} finally {
			for (const indicator of indicators) indicator.dispose();
		}
	});

	it.each<StatusIndicatorKind>(["working", "compaction", "branchSummary", "retry"])(
		"does not reserve separate status height for an embedded %s indicator",
		(kind) => {
			const dispose = vi.fn();
			const editor: StatusEditor = { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() };
			const context = makeClearContext(kind, dispose, editor, editor, true);

			interactiveModePrototype.clearStatusIndicator.call(context);

			expect(dispose).toHaveBeenCalledOnce();
			expect(editor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
			expect(context.statusContainer.children).toHaveLength(0);
		},
	);

	it("uses the standalone row for a custom editor that has not opted in", () => {
		const defaultEditor: StatusEditor = { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() };
		const customEditor = { embedWorkingStatus: false, setWorkingStatusIndicator: vi.fn() };
		const context = makeClearContext("working", vi.fn(), defaultEditor, customEditor, false);

		interactiveModePrototype.clearStatusIndicator.call(context);

		expect(defaultEditor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
		expect(customEditor.setWorkingStatusIndicator).not.toHaveBeenCalled();
		expect(context.statusContainer.children).toHaveLength(1);
	});
});

function makeClearContext(
	kind: StatusIndicatorKind,
	dispose: () => void,
	defaultEditor: StatusEditor,
	editor: Partial<StatusEditor>,
	embedded: boolean,
): ClearStatusContext {
	return {
		activeStatusIndicator: { kind, dispose },
		activeWorkingIndicatorEmbedded: embedded,
		statusContainer: new Container(),
		defaultEditor,
		editor,
		ui: { getClearOnShrink: () => true },
		idleStatus: idleStatus(),
		setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
	};
}
