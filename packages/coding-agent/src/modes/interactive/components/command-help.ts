/**
 * Searchable slash-command help (also the command palette behind `/help`).
 *
 * Unlike `/hotkeys`, this browses commands rather than key bindings. Entering
 * a result puts the command back in the editor so arguments can be added
 * before submitting; Escape returns to the editor unchanged.
 */

import { Container, getKeybindings, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

export interface CommandHelpItem {
	name: string;
	description?: string;
	argumentHint?: string;
	source?: "builtin" | "prompt" | "extension" | "skill";
}

function describe(item: CommandHelpItem): string | undefined {
	const source = item.source && item.source !== "builtin" ? `[${item.source}] ` : "";
	const description = `${source}${item.description ?? ""}`.trim();
	return description.length > 0 ? description : undefined;
}

export class CommandHelpComponent extends Container {
	private readonly items: SelectItem[];
	private readonly list: SelectList;
	private readonly prompt: Text;
	private readonly onSelect: (name: string) => void;
	private readonly onCancel: () => void;
	private query: string;

	constructor(commands: CommandHelpItem[], onSelect: (name: string) => void, onCancel: () => void, initialQuery = "") {
		super();
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.query = initialQuery;
		this.items = commands.map((command) => ({
			value: command.name,
			label: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`,
			description: describe(command),
		}));

		this.addChild(new DynamicBorder());
		this.prompt = new Text("", 1, 0);
		this.addChild(this.prompt);

		this.list = new SelectList(this.items.slice(0, 10), Math.min(this.items.length, 10), getSelectListTheme());
		this.list.onSelect = (item) => this.onSelect(item.value);
		this.list.onCancel = () => this.onCancel();
		this.addChild(this.list);

		this.addChild(
			new Text(
				`${keyHint("tui.select.confirm", "insert")}  ${keyHint("tui.select.cancel", "close")}  ${theme.fg("dim", "↑↓ select")}`,
				1,
				0,
			),
		);
		this.addChild(new DynamicBorder());

		this.refresh();
	}

	private refresh(): void {
		const needle = this.query.trim().toLowerCase();
		const matches = needle
			? this.items
					.filter(
						(item) =>
							item.value.toLowerCase().includes(needle) ||
							(item.description ?? "").toLowerCase().includes(needle),
					)
					.sort((a, b) => {
						const rank = (item: SelectItem): number => {
							const name = item.value.toLowerCase();
							if (name.startsWith(needle)) return 0;
							if (name.includes(needle)) return 1;
							return 2;
						};
						return rank(a) - rank(b);
					})
			: this.items;
		this.list.setItems(matches);
		const count = theme.fg("muted", `  ${matches.length} command${matches.length === 1 ? "" : "s"}`);
		const query = this.query ? theme.fg("text", this.query) + theme.inverse(" ") : theme.fg("dim", "type to filter");
		this.prompt.setText(`${theme.fg("accent", "Commands")} ${theme.fg("dim", "›")} ${query}${count}`);
	}

	handleInput(data: string): void {
		if (data === "\x1b" || getKeybindings().matches(data, "tui.select.cancel")) {
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
		if (data === "\x15") {
			this.query = "";
			this.refresh();
			return;
		}
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
