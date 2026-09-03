import { Box, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { parseTaskNotificationMessage, type TaskNotificationNote } from "./task-notification-pill.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;

	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme(), outputPad = 1) {
		super();
		this.text = text;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.rebuild();
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();

		// Background-task notifications render as compact pills above the actual
		// user text instead of raw multi-line notes inside the bubble.
		const parsed = parseTaskNotificationMessage(this.text);
		if (parsed.notes.length > 0) {
			for (const note of parsed.notes) {
				this.addChild(new Text(this.formatNotificationPill(note), this.outputPad, 0));
			}
			if (parsed.userText.trim()) {
				this.addChild(new Spacer(1));
			}
		}
		if (parsed.userText.trim().length > 0) {
			const contentBox = new Box(this.outputPad, 1, (content: string) => theme.bg("userMessageBg", content));
			contentBox.addChild(
				new Markdown(
					parsed.userText,
					0,
					0,
					this.markdownTheme,
					{
						color: (content: string) => theme.fg("userMessageText", content),
					},
					{ preserveOrderedListMarkers: true, preserveBackslashEscapes: true },
				),
			);
			this.addChild(contentBox);
		}
	}

	private formatNotificationPill(note: TaskNotificationNote): string {
		const glyph =
			note.status === "completed"
				? theme.fg("success", "\u2713")
				: note.status === "failed"
					? theme.fg("error", "\u2717")
					: note.status === "killed"
						? theme.fg("warning", "\u2298")
						: theme.fg("accent", "\u25cf");
		return `${glyph} ${note.header}`;
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}
}
