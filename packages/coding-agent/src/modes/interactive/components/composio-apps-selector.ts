/**
 * Composio apps selector — interactive gallery of Composio toolkits ("apps").
 * Lists every toolkit with a connected (✓) / not-connected marker; selecting
 * a not-connected app starts a connect flow, selecting a connected one offers
 * to disconnect. Backed by the apps-gallery service in core/composio-apps.ts.
 * Mirrors the permission-rules selector's shape.
 */

import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@earendil-works/pi-tui";
import type { ComposioApp } from "../../../core/composio-apps.ts";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const APPS_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 16,
	maxPrimaryColumnWidth: 44,
};

export interface ComposioAppsCallbacks {
	/** Selected a not-connected app — start its connect flow. */
	onConnect: (slug: string) => void;
	/** Selected a connected app — disconnect its connected account. */
	onDisconnect: (connectedAccountId: string) => void;
	onCancel: () => void;
}

export class ComposioAppsSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(apps: ComposioApp[], callbacks: ComposioAppsCallbacks) {
		super();

		const items: SelectItem[] = apps.map((app) => {
			const value = app.connected ? `disconnect:${app.connectedAccountId}` : `connect:${app.slug}`;
			const label = `${app.connected ? "✓ " : ""}${app.name}`;
			const description = app.connected
				? "connected — select to disconnect"
				: app.description
					? app.description.slice(0, 64)
					: "select to connect";
			return { value, label, description };
		});

		this.addChild(new DynamicBorder());

		this.selectList = new SelectList(
			items,
			Math.min(Math.max(items.length, 1), 16),
			getSelectListTheme(),
			APPS_SELECT_LIST_LAYOUT,
		);

		this.selectList.onSelect = (item) => {
			const value = item.value;
			if (value.startsWith("connect:")) {
				callbacks.onConnect(value.slice("connect:".length));
				return;
			}
			if (value.startsWith("disconnect:")) {
				callbacks.onDisconnect(value.slice("disconnect:".length));
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
