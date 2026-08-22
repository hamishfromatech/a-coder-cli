/**
 * Interactive multiple-choice question prompt (ask_user_question tool).
 *
 * Renders questions one at a time with a header chip and 2-4 options. Keys:
 * ↑/↓ navigate, Enter selects (single-select advances immediately; multi-select
 * toggles and Enter-with-selection advances), Escape declines all questions.
 */

import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import type { UserQuestion } from "../../../core/extensions/types.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export class QuestionPromptComponent extends Container {
	private questions: UserQuestion[];
	private currentIndex = 0;
	private selectedIndex = 0;
	private selectedLabels: Set<string> = new Set();
	private answers: Record<string, string> = {};
	private onComplete: (answers: Record<string, string> | undefined) => void;
	private bodyContainer: Container;
	private headerText: Text;

	constructor(questions: UserQuestion[], onComplete: (answers: Record<string, string> | undefined) => void) {
		super();

		this.questions = questions;
		this.onComplete = onComplete;

		this.addChild(new Spacer(1));
		this.headerText = new Text("", 1, 0);
		this.addChild(this.headerText);
		this.bodyContainer = new Container();
		this.addChild(this.bodyContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("tui.select.confirm", "select") +
					"  " +
					keyHint("tui.select.cancel", "decline"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));

		this.renderQuestion();
	}

	private renderQuestion(): void {
		const q = this.questions[this.currentIndex];
		if (!q) return;

		const progress = this.questions.length > 1 ? ` ${this.currentIndex + 1}/${this.questions.length}` : "";
		this.headerText.setText(theme.fg("accent", theme.bold(` ${q.header} `)) + theme.fg("dim", progress));

		this.bodyContainer.clear();
		this.bodyContainer.addChild(new Text(theme.fg("text", q.question), 1, 1));
		this.bodyContainer.addChild(new Spacer(1));

		for (let i = 0; i < q.options.length; i++) {
			const opt = q.options[i];
			const isCursor = i === this.selectedIndex;
			const isChecked = q.multiSelect ? this.selectedLabels.has(opt.label) : false;
			const check = q.multiSelect ? (isChecked ? theme.fg("success", "[x] ") : theme.fg("dim", "[ ] ")) : "";
			const cursor = isCursor ? theme.fg("accent", "→ ") : "  ";
			const label = isCursor ? theme.fg("accent", opt.label) : theme.fg("text", opt.label);
			const desc = opt.description ? ` ${theme.fg("muted", `— ${opt.description}`)}` : "";
			this.bodyContainer.addChild(new Text(`${cursor}${check}${label}${desc}`, 1, 1));
		}
		if (q.multiSelect) {
			this.bodyContainer.addChild(new Spacer(1));
			this.bodyContainer.addChild(
				new Text(theme.fg("dim", "Select all that apply, then press Enter to continue."), 1, 1),
			);
		}
	}

	private advance(): void {
		const q = this.questions[this.currentIndex];
		if (!q) return;
		if (q.multiSelect && this.selectedLabels.size > 0) {
			this.answers[q.question] = [...this.selectedLabels].join(", ");
		}
		this.currentIndex++;
		this.selectedIndex = 0;
		this.selectedLabels = new Set();
		if (this.currentIndex >= this.questions.length) {
			this.onComplete(this.answers);
		} else {
			this.renderQuestion();
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		const q = this.questions[this.currentIndex];
		if (!q) return;

		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.renderQuestion();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.selectedIndex = Math.min(q.options.length - 1, this.selectedIndex + 1);
			this.renderQuestion();
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n" || keyData === "\r") {
			const opt = q.options[this.selectedIndex];
			if (!opt) return;
			if (q.multiSelect) {
				// Enter submits whenever a selection exists; otherwise it picks the current option.
				if (this.selectedLabels.size > 0) {
					this.advance();
					return;
				}
				this.selectedLabels.add(opt.label);
				this.renderQuestion();
			} else {
				this.answers[q.question] = opt.label;
				this.advance();
			}
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onComplete(undefined);
		} else if (keyData === " ") {
			// Space toggles in multi-select mode.
			if (q.multiSelect) {
				const opt = q.options[this.selectedIndex];
				if (opt) {
					if (this.selectedLabels.has(opt.label)) {
						this.selectedLabels.delete(opt.label);
					} else {
						this.selectedLabels.add(opt.label);
					}
					this.renderQuestion();
				}
			}
		}
	}
}
