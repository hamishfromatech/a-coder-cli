/**
 * PlanExitDialog — approval UI shown when the model exits plan mode
 * (easy-agent PlanApprovalDialog parity):
 *
 *   ┌ Plan approval ─────────────────────────────
 *   │ <first lines of the plan preview>
 *   └────────────────────────────────────────────
 *     Yes, proceed — start implementing
 *     Yes, switch to ask mode — approve each edit
 *     No, keep planning — with feedback
 *
 * ↑/↓ navigate, Enter confirms, Esc cancels (same as "keep planning" with no
 * feedback). Choosing "keep planning" swaps to a feedback input: type, Enter
 * submits, Esc submits empty.
 */

import { Container, getKeybindings, type SelectItem, SelectList, Text, type TUI } from "@earendil-works/pi-tui";
import type { PlanExitDecision } from "../../../core/tools/plan-mode.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const MAX_PREVIEW_LINES = 8;

export class PlanExitDialogComponent extends Container {
	private selectList: SelectList;
	private onDecision: (decision: PlanExitDecision) => void;
	private onCancel: () => void;
	private ui: TUI;
	/** Present while the user is typing feedback for "keep planning". */
	private feedbackMode = false;
	private feedbackText = "";
	private feedbackDisplay = new Text("", 1, 0);

	constructor(
		ui: TUI,
		planPreview: string | undefined,
		onDecision: (decision: PlanExitDecision) => void,
		onCancel: () => void,
	) {
		super();
		this.ui = ui;
		this.onDecision = onDecision;
		this.onCancel = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.fg("accent", theme.bold("Plan approval")), 1, 0));

		if (planPreview) {
			const lines = planPreview.split("\n");
			const shown = lines.slice(0, MAX_PREVIEW_LINES);
			if (lines.length > MAX_PREVIEW_LINES) {
				shown.push(`… ${lines.length - MAX_PREVIEW_LINES} more lines in the plan file`);
			}
			for (const line of shown) {
				this.addChild(new Text(theme.fg("text", line), 1, 0));
			}
			this.addChild(new Text("", 1, 0));
		}

		const items: SelectItem[] = [
			{ value: "proceed", label: "Yes, proceed", description: "Exit plan mode and start implementing" },
			{
				value: "proceed-ask",
				label: "Yes, switch to ask mode",
				description: "Exit plan mode, but approve each edit/command as you go",
			},
			{
				value: "keep-planning",
				label: "No, keep planning",
				description: "Stay in plan mode and send feedback to the agent",
			},
		];

		this.selectList = new SelectList(items, items.length, {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		});

		this.selectList.onSelect = (item) => {
			if (item.value === "proceed") {
				this.onDecision({ decision: "proceed" });
				return;
			}
			if (item.value === "proceed-ask") {
				this.onDecision({ decision: "proceed", mode: "ask" });
				return;
			}
			// keep-planning → switch to the feedback input.
			this.feedbackMode = true;
			this.removeChild(this.selectList);
			this.addChild(new Text(theme.fg("accent", "Feedback for the agent (Enter to send, Esc to skip):"), 1, 0));
			this.feedbackDisplay.setText(theme.fg("text", "") + theme.inverse(" "));
			this.addChild(this.feedbackDisplay);
			this.ui.requestRender();
		};

		this.selectList.onCancel = () => {
			this.onCancel();
		};

		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		if (this.feedbackMode) {
			const kb = getKeybindings();
			if (kb.matches(data, "tui.select.cancel")) {
				this.onDecision({ decision: "keep-planning" });
				return;
			}
			if (data === "\r" || data === "\n") {
				this.onDecision({
					decision: "keep-planning",
					...(this.feedbackText ? { feedback: this.feedbackText } : {}),
				});
				return;
			}
			if (data === "\x7f" || data === "\b") {
				this.feedbackText = this.feedbackText.slice(0, -1);
			} else if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.feedbackText += data;
			} else {
				return;
			}
			this.feedbackDisplay.setText(theme.fg("text", this.feedbackText) + theme.inverse(" "));
			this.ui.requestRender();
			return;
		}
		this.selectList.handleInput(data);
	}
}
