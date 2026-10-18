/**
 * Generic session pick list — one row per item with a secondary description
 * line. Used by `/search` (transcript hits, description = matching snippet)
 * and `/sessions archive` (store entries, description = size/date/folder).
 * Mirrors the permission-rules selector's shape so the TUI stays consistent.
 */

import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@earendil-works/pi-tui";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

export interface SessionPickItem {
	value: string;
	label: string;
	description?: string;
}

export interface SessionPickCallbacks {
	onSelect: (value: string) => void;
	onCancel: () => void;
}

const PICK_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 20,
	maxPrimaryColumnWidth: 52,
};

export class SessionPickSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(items: SessionPickItem[], callbacks: SessionPickCallbacks) {
		super();

		const selectItems: SelectItem[] = items.map((item) => ({
			value: item.value,
			label: item.label,
			description: item.description,
		}));

		this.addChild(new DynamicBorder());
		this.selectList = new SelectList(
			selectItems,
			Math.min(Math.max(selectItems.length, 1), 14),
			getSelectListTheme(),
			PICK_LAYOUT,
		);
		this.selectList.onSelect = (item) => callbacks.onSelect(item.value);
		this.selectList.onCancel = () => callbacks.onCancel();
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
