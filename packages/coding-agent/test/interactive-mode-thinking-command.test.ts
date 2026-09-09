import { beforeAll, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type ThinkingCommandContext = {
	session: {
		getAvailableThinkingLevels: () => string[];
		thinkingLevel: string;
		setThinkingLevel: (level: string, options?: { persist?: boolean }) => void;
	};
	settingsManager: { getDefaultThinkingLevel: () => string | undefined };
	showSelector: (create: (done: () => void) => { component: unknown; focus: unknown }) => void;
	showThinkingSelector: () => void;
	selectThinkingLevel: (level: string, persist: boolean) => void;
	footer: { invalidate: () => void };
	updateEditorBorderColor: () => void;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	ui: { requestRender: () => void };
};

type InteractiveModePrototype = {
	handleThinkingCommand(this: ThinkingCommandContext, searchTerm?: string): void;
	selectThinkingLevel(this: ThinkingCommandContext, level: string, persist: boolean): void;
	showThinkingSelector(this: ThinkingCommandContext): void;
	showSelector(
		this: ThinkingCommandContext,
		create: (done: () => void) => { component: unknown; focus: unknown },
	): void;
	showSelector(
		this: ThinkingCommandContext,
		create: (done: () => void) => { component: unknown; focus: unknown },
	): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

function makeContext(overrides?: Partial<ThinkingCommandContext>): ThinkingCommandContext & {
	setThinkingLevel: ReturnType<typeof vi.fn>;
	showStatus: ReturnType<typeof vi.fn>;
	showError: ReturnType<typeof vi.fn>;
} {
	const setThinkingLevel = vi.fn();
	const showStatus = vi.fn();
	const showError = vi.fn();
	const context = {
		session: {
			getAvailableThinkingLevels: () => ["off", "minimal", "low", "medium", "high", "xhigh"],
			thinkingLevel: "medium",
			setThinkingLevel,
			...overrides?.session,
		},
		settingsManager: { getDefaultThinkingLevel: () => "low", ...overrides?.settingsManager },
		showSelector: vi.fn(),
		showThinkingSelector:
			interactiveModePrototype.showThinkingSelector as unknown as ThinkingCommandContext["showThinkingSelector"],
		selectThinkingLevel:
			interactiveModePrototype.selectThinkingLevel as unknown as ThinkingCommandContext["selectThinkingLevel"],
		footer: { invalidate: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		showStatus,
		showError,
		ui: { requestRender: vi.fn() },
		...overrides,
	};
	return { ...context, setThinkingLevel, showStatus, showError } as never;
}

describe("InteractiveMode /thinking", () => {
	beforeAll(() => {
		initTheme("dark");
	});
	it("opens the selector when called without an argument", () => {
		const context = makeContext();
		const showSelector = context.showSelector as ReturnType<typeof vi.fn>;

		interactiveModePrototype.handleThinkingCommand.call(context, undefined);

		expect(showSelector).toHaveBeenCalledTimes(1);
	});

	it("sets an explicit level session-only by default", () => {
		const context = makeContext();

		interactiveModePrototype.handleThinkingCommand.call(context, "HIGH");

		expect(context.setThinkingLevel).toHaveBeenCalledWith("high", { persist: false });
		expect(context.showStatus).toHaveBeenCalledWith("Thinking level: high");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("reports unknown levels without changing anything", () => {
		const context = makeContext();

		interactiveModePrototype.handleThinkingCommand.call(context, "bogus");

		expect(context.setThinkingLevel).not.toHaveBeenCalled();
		expect(context.showError).toHaveBeenCalledWith(
			'Unknown thinking level "bogus". Available levels: off, minimal, low, medium, high, xhigh.',
		);
	});

	it("persists only through the explicit save path", () => {
		const context = makeContext();

		interactiveModePrototype.selectThinkingLevel.call(context, "high", true);

		expect(context.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
		expect(context.showStatus).toHaveBeenCalledWith("Default thinking level: high");
	});

	it("passes session-only select and default save into the selector", () => {
		const context = makeContext();
		const showSelector = context.showSelector as ReturnType<typeof vi.fn>;

		interactiveModePrototype.showThinkingSelector.call(context);

		expect(showSelector).toHaveBeenCalledTimes(1);
		const create = showSelector.mock.calls[0][0] as (done: () => void) => {
			component: { allItems: Array<{ value: string; description?: string }> };
		};
		const created = create(() => {});

		// Default level is flagged in the item list.
		const lowItem = created.component.allItems.find((item) => item.value === "low");
		expect(lowItem?.description).toContain("default");
	});
});
