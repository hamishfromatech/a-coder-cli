/**
 * Memory picker component.
 *
 * Lists the persistent memory files the `memory` tool reads and writes
 * (easy-agent's MemoryPicker parity): global MEMORY.md, project (workspace)
 * MEMORY.md and the current session's memory file. Selecting a row opens the
 * file in the external editor; files that do not exist yet are marked "(new)"
 * and created with a minimal template on open.
 *
 * Pure presentation — keyboard handling lives in SelectList, and the editor
 * launch is performed by InteractiveMode (the same $EDITOR path the composer
 * external-editor feature uses).
 */

import { Container, type SelectItem, SelectList } from "@earendil-works/pi-tui";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

export interface MemoryFileEntry {
	/** Stable key used as the SelectItem value. */
	key: "global" | "workspace" | "session";
	/** Row label, e.g. "Global memory". */
	label: string;
	/** Absolute file path. */
	path: string;
	/** True when the file does not exist yet (marked "(new)" in the description). */
	isNew: boolean;
}

export const MEMORY_NEW_FILE_TEMPLATE = "# Memory\n";

export function buildMemoryItems(entries: MemoryFileEntry[]): SelectItem[] {
	return entries.map((entry) => ({
		value: entry.key,
		label: entry.label,
		description: `${entry.isNew ? "(new) " : ""}${entry.path}`,
	}));
}

/**
 * Component that renders the memory file picker with borders.
 */
export class MemoryPickerComponent extends Container {
	private selectList: SelectList;

	constructor(items: SelectItem[], onSelect: (key: string) => void, onCancel: () => void) {
		super();

		this.addChild(new DynamicBorder());

		this.selectList = new SelectList(items, Math.min(items.length, 6), getSelectListTheme());

		this.selectList.onSelect = (item) => {
			onSelect(item.value);
		};
		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);

		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}

	handleInput(keyData: string): void {
		this.selectList.handleInput(keyData);
	}
}
