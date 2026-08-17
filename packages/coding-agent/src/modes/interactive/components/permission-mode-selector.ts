/**
 * Permission mode selector component.
 *
 * Lets the user switch between ask / allow / read-only / auto permission modes.
 */

import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@earendil-works/pi-tui";
import type { PermissionMode } from "../../../core/settings-manager.ts";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const PERMISSION_MODE_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 18,
};

const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
	ask: "Ask for confirmation before every tool call",
	allow: "Run all tool calls automatically",
	"read-only": "Only use read and inspect tools; block commands and edits",
	auto: "Use your permission policies to decide what needs approval",
};

const MODE_ITEMS: SelectItem[] = [
	{ value: "ask", label: "Ask", description: MODE_DESCRIPTIONS.ask },
	{ value: "allow", label: "Allow", description: MODE_DESCRIPTIONS.allow },
	{ value: "read-only", label: "Read-only", description: MODE_DESCRIPTIONS["read-only"] },
	{ value: "auto", label: "Auto", description: MODE_DESCRIPTIONS.auto },
];

/**
 * Component that renders a permission mode selector with borders.
 */
export class PermissionModeSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(currentMode: PermissionMode, onSelect: (mode: PermissionMode) => void, onCancel: () => void) {
		super();

		// Add top border
		this.addChild(new DynamicBorder());

		// Create selector
		this.selectList = new SelectList(
			MODE_ITEMS,
			MODE_ITEMS.length,
			getSelectListTheme(),
			PERMISSION_MODE_SELECT_LIST_LAYOUT,
		);

		// Preselect current mode
		const currentIndex = MODE_ITEMS.findIndex((item) => item.value === currentMode);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = (item) => {
			onSelect(item.value as PermissionMode);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}

	handleInput(keyData: string): void {
		this.selectList.handleInput(keyData);
	}
}
