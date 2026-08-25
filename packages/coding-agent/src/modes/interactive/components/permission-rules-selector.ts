/**
 * Permission rules selector — interactive manager for the "auto" permission
 * mode policy rules (allow / softDeny / hardDeny). Lists every configured rule
 * grouped by category; selecting a rule confirms deletion, and the trailing
 * "Add …" rows prompt for a new rule. Backed by the existing policy engine
 * in settings-manager (PermissionPolicyConfig). Mirrors the permission mode
 * selector's shape.
 */

import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@earendil-works/pi-tui";
import type { PermissionPolicyConfig } from "../../../core/settings-manager.ts";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const RULES_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 14,
	maxPrimaryColumnWidth: 42,
};

type Category = "allow" | "softDeny" | "hardDeny";

const CATEGORY_LABEL: Record<Category, string> = {
	allow: "Allow",
	softDeny: "Soft-deny",
	hardDeny: "Hard-deny",
};

const CATEGORY_HINT: Record<Category, string> = {
	allow: "auto-approve",
	softDeny: "prompt (deny in headless)",
	hardDeny: "always deny",
};

/** The categories in evaluation/precedence order (hardDeny wins, then softDeny, then allow). */
const CATEGORIES: Category[] = ["hardDeny", "softDeny", "allow"];

export type PermissionRuleAction =
	| { kind: "delete"; category: Category; rule: string }
	| { kind: "add"; category: Category };

export interface PermissionRulesSelectorCallbacks {
	onSelect: (action: PermissionRuleAction) => void;
	onCancel: () => void;
}

export class PermissionRulesSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(policies: PermissionPolicyConfig, callbacks: PermissionRulesSelectorCallbacks) {
		super();

		const items: SelectItem[] = [];
		for (const category of CATEGORIES) {
			const rules = policies[category] ?? [];
			for (const rule of rules) {
				items.push({
					value: `delete:${category}:${rule}`,
					label: `${CATEGORY_LABEL[category]}: ${rule}`,
					description: "select to remove",
				});
			}
		}
		// Always offer the three add rows, even when empty, so a fresh config
		// can be populated without hand-editing settings.json.
		for (const category of CATEGORIES) {
			items.push({
				value: `add:${category}`,
				label: `＋ Add ${CATEGORY_LABEL[category]} rule…`,
				description: CATEGORY_HINT[category],
			});
		}

		this.addChild(new DynamicBorder());

		this.selectList = new SelectList(
			items,
			Math.min(items.length, 14),
			getSelectListTheme(),
			RULES_SELECT_LIST_LAYOUT,
		);

		this.selectList.onSelect = (item) => {
			const value = item.value;
			if (value.startsWith("add:")) {
				callbacks.onSelect({ kind: "add", category: value.slice(4) as Category });
				return;
			}
			if (value.startsWith("delete:")) {
				const parts = value.split(":");
				const category = parts[1] as Category;
				const rule = parts.slice(2).join(":");
				callbacks.onSelect({ kind: "delete", category, rule });
			}
		};

		this.selectList.onCancel = () => {
			callbacks.onCancel();
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
