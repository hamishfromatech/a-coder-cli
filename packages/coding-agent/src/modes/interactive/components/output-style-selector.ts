/**
 * Output style selector component.
 *
 * Lets the user switch the active output style (built-in default/Explanatory/
 * Learning, or custom `.md` styles loaded from disk). Mirrors the permission
 * mode selector's shape: a bordered SelectList preselecting the current style.
 */

import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@earendil-works/pi-tui";
import { listOutputStyles, type OutputStyleConfig } from "../../../core/output-styles.ts";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const OUTPUT_STYLE_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 28,
};

const SOURCE_BADGE: Record<OutputStyleConfig["source"], string> = {
	"built-in": "",
	user: " (user)",
	project: " (project)",
};

/**
 * Component that renders an output style selector with borders.
 */
export class OutputStyleSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(currentStyle: string, onSelect: (styleName: string) => void, onCancel: () => void) {
		super();

		const styles = listOutputStyles();
		const items: SelectItem[] = styles.map((style) => ({
			value: style.name,
			label: style.name,
			description: `${style.description}${SOURCE_BADGE[style.source]}`,
		}));

		this.addChild(new DynamicBorder());

		this.selectList = new SelectList(
			items,
			Math.min(styles.length, 10),
			getSelectListTheme(),
			OUTPUT_STYLE_SELECT_LIST_LAYOUT,
		);

		const currentIndex = styles.findIndex((style) => style.name === currentStyle);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

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
