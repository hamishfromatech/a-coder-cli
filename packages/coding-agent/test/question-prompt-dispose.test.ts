import { Container } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { QuestionPromptComponent } from "../src/modes/interactive/components/question-prompt.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

/**
 * Regression: answering the last ask_user_question question crashed pi with
 * `TypeError: this.extensionSelector?.dispose is not a function`.
 *
 * Root cause: showUserQuestionPrompt stored a QuestionPromptComponent in the
 * `extensionSelector` field (which previously held an ExtensionSelectorComponent)
 * via an unsafe cast. QuestionPromptComponent has no dispose() method, so
 * hideExtensionSelector() — invoked from the prompt's onComplete callback —
 * threw an uncaught TypeError and killed the process.
 *
 * Fix: type the overlay slot as `Container & { dispose?(): void }` and call
 * dispose defensively (`dispose?.()`).
 */
describe("hideExtensionSelector with a QuestionPromptComponent overlay", () => {
	beforeAll(() => {
		initTheme("dark");
	});
	it("does not throw when the overlay lacks dispose()", () => {
		const editor = { render: () => ["editor"], invalidate: () => {} };
		const editorContainer = new Container();
		const setFocus = vi.fn();
		const requestRender = vi.fn();

		const fakeThis = {
			extensionSelector: new QuestionPromptComponent(
				[
					{
						question: "Pick one",
						header: "Pick",
						options: [
							{ label: "A", description: "first" },
							{ label: "B", description: "second" },
						],
					},
				],
				() => {},
			),
			editorContainer,
			editor,
			ui: { setFocus, requestRender },
		};

		expect(() =>
			(InteractiveMode.prototype as unknown as { hideExtensionSelector: () => void }).hideExtensionSelector.call(
				fakeThis,
			),
		).not.toThrow();

		// Overlay cleared and editor restored as the focused element.
		expect(fakeThis.extensionSelector).toBeUndefined();
		expect(setFocus).toHaveBeenCalledWith(editor);
		expect(requestRender).toHaveBeenCalledTimes(1);
	});

	it("still disposes overlays that implement dispose()", () => {
		const editor = { render: () => ["editor"], invalidate: () => {} };
		const editorContainer = new Container();
		const dispose = vi.fn();
		// An overlay that DOES hold resources and implements dispose().
		const overlay = Object.assign(new Container(), { dispose });

		const fakeThis = {
			extensionSelector: overlay,
			editorContainer,
			editor,
			ui: { setFocus: vi.fn(), requestRender: vi.fn() },
		};

		(InteractiveMode.prototype as unknown as { hideExtensionSelector: () => void }).hideExtensionSelector.call(
			fakeThis,
		);

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(fakeThis.extensionSelector).toBeUndefined();
	});
});
