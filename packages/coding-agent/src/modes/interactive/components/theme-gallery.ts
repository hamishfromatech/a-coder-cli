/**
 * Theme gallery with live preview.
 *
 * Moving the selection applies the theme immediately (the whole TUI repaints
 * in it); Enter persists the choice, Esc restores the theme that was active
 * when the picker opened. The sample block shows the palette the user is
 * about to commit to.
 */

import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { getSelectListTheme, type ThemeInfo, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export interface ThemeSelectorOptions {
	themes: ThemeInfo[];
	/** Theme setting active before the picker opened (used for the check mark). */
	current: string | undefined;
	/** Apply a theme without persisting it. */
	onPreview: (name: string) => void;
	/** Persist the chosen theme. */
	onConfirm: (name: string) => void;
	onCancel: () => void;
}

/** A compact palette sample drawn with the theme that is currently applied. */
function previewBlock(name: string): string {
	const swatches = ["accent", "success", "warning", "error", "muted", "dim"]
		.map((color) => theme.fg(color as Parameters<typeof theme.fg>[0], color))
		.join("  ");
	const body = [
		`${theme.fg("accent", theme.bold(name))}`,
		swatches,
		theme.fg("text", "The quick brown fox jumps over the lazy dog."),
		`${theme.fg("muted", "›")} ${theme.fg("accent", "assistant")} ${theme.fg("text", "Reading src/index.ts…")}`,
		theme.bg("toolPendingBg", theme.fg("toolTitle", " ● read · 1.2s ")),
		`${theme.fg("success", "+ added line")}   ${theme.fg("error", "- removed line")}`,
	].join("\n");
	return body;
}

export class ThemeGalleryComponent extends Container {
	private readonly list: SelectList;
	private readonly preview: Text;
	private readonly themes: ThemeInfo[];

	constructor(opts: ThemeSelectorOptions) {
		super();
		this.themes = opts.themes;
		const items: SelectItem[] = opts.themes.map((info) => ({
			value: info.name,
			label: `${info.name === opts.current ? "✓ " : "  "}${info.name}`,
			description: info.path ?? "system (follows terminal)",
		}));

		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.fg("accent", theme.bold("Theme")), 1, 0));

		this.list = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());
		const initial = opts.themes.find((info) => info.name === opts.current)?.name ?? opts.themes[0]?.name;
		this.preview = new Text(initial ? previewBlock(initial) : "", 1, 0);
		this.list.onSelectionChange = (item) => {
			opts.onPreview(item.value);
			this.preview.setText(previewBlock(item.value));
		};
		this.list.onSelect = (item) => opts.onConfirm(item.value);
		this.list.onCancel = () => opts.onCancel();
		this.addChild(this.list);
		this.addChild(this.preview);
		this.addChild(
			new Text(
				`${rawKeyHint("↑↓", "preview")}  ${keyHint("tui.select.confirm", "apply")}  ${keyHint("tui.select.cancel", "cancel")}`,
				1,
				0,
			),
		);
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
	}
}
