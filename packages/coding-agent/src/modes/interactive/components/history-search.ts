/**
 * Reverse prompt-history search (Ctrl+R parity).
 *
 * Opens over the editor with every prompt from this session, most recent
 * first. Typing filters on the full prompt text; ↑/↓ move, Enter inserts the
 * selection back into the editor, Esc closes.
 */

import { Container, getKeybindings, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

function firstLine(text: string, max = 84): string {
	const line = text.split("\n")[0]?.trim() ?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function describe(text: string): string | undefined {
	const lines = text.split("\n");
	if (lines.length > 1) {
		const extra = lines.length - 1;
		const next = lines[1]?.trim() ?? "";
		const preview = next.length > 56 ? `${next.slice(0, 55)}…` : next;
		return `+${extra} line${extra === 1 ? "" : "s"}${preview ? ` · ${preview}` : ""}`;
	}
	return undefined;
}

export class HistorySearchComponent extends Container {
	private items: SelectItem[];
	private list: SelectList;
	private prompt: Text;
	private query = "";
	private onSelect: (text: string) => void;
	private onCancel: () => void;

	constructor(history: string[], onSelect: (text: string) => void, onCancel: () => void) {
		super();
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.items = history.map((text) => ({
			value: text,
			label: firstLine(text),
			description: describe(text),
		}));

		this.addChild(new DynamicBorder());
		this.prompt = new Text("", 1, 0);
		this.addChild(this.prompt);

		this.list = new SelectList(this.items, Math.min(this.items.length, 8), getSelectListTheme());
		this.list.onSelect = (item) => this.onSelect(item.value);
		this.list.onCancel = () => this.onCancel();
		this.addChild(this.list);

		this.addChild(
			new Text(`${keyHint("tui.select.confirm", "insert")}  ${keyHint("tui.select.cancel", "close")}`, 1, 0),
		);
		this.addChild(new DynamicBorder());

		this.refresh();
	}

	private refresh(): void {
		const needle = this.query.trim().toLowerCase();
		const matches = needle ? this.items.filter((item) => item.value.toLowerCase().includes(needle)) : this.items;
		this.list.setItems(matches);
		const count = needle ? theme.fg("muted", `  ${matches.length} match${matches.length === 1 ? "" : "es"}`) : "";
		const query = this.query ? theme.fg("text", this.query) + theme.inverse(" ") : theme.fg("dim", "type to filter");
		this.prompt.setText(`${theme.fg("accent", "Search history")} ${theme.fg("dim", "›")} ${query}${count}`);
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (data === "\x1b" || kb.matches(data, "tui.select.cancel")) {
			this.onCancel();
			return;
		}
		if (data === "\r" || data === "\n") {
			this.list.handleInput("\r");
			return;
		}
		if (data === "\x7f" || data === "\b") {
			if (this.query.length === 0) {
				this.onCancel();
				return;
			}
			this.query = this.query.slice(0, -1);
			this.refresh();
			return;
		}
		// Ctrl+U clears the query.
		if (data === "\x15") {
			this.query = "";
			this.refresh();
			return;
		}
		// Navigation keys belong to the list.
		if (
			data === "\x1b[A" ||
			data === "\x1b[B" ||
			data === "\x1b[5~" ||
			data === "\x1b[6~" ||
			data === "\x1b[H" ||
			data === "\x1b[F"
		) {
			this.list.handleInput(data);
			return;
		}
		const printable = Array.from(data)
			.filter((ch) => ch >= " ")
			.join("");
		if (printable) {
			this.query += printable;
			this.refresh();
			return;
		}
		this.list.handleInput(data);
	}
}
