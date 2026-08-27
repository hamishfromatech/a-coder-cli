/**
 * Composio apps selector — interactive gallery of Composio toolkits ("apps").
 * Lists every toolkit with a connected (✓) / not-connected marker; selecting
 * a not-connected app starts a connect flow, selecting a connected one offers
 * to disconnect. Backed by the apps-gallery service in core/composio-apps.ts.
 * Includes a search input (like the session selector) to filter the gallery.
 */

import {
	Container,
	type Focusable,
	getKeybindings,
	Input,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
} from "@earendil-works/pi-tui";
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

export class ComposioAppsSelectorComponent extends Container implements Focusable {
	private allItems: SelectItem[];
	private searchInput: Input;
	private selectList: SelectList;

	// Focusable - propagate to the search input for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(apps: ComposioApp[], callbacks: ComposioAppsCallbacks) {
		super();

		this.allItems = apps.map((app) => {
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

		this.searchInput = new Input();
		this.addChild(this.searchInput);

		this.selectList = new SelectList(
			this.allItems,
			Math.min(Math.max(this.allItems.length, 1), 16),
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

	private filterApps(query: string): void {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) {
			this.selectList.setItems(this.allItems);
			return;
		}
		// The item value carries the slug or connected-account id — search it
		// alongside the display label and description.
		this.selectList.setItems(
			this.allItems.filter(
				(item) =>
					item.label.toLowerCase().includes(trimmed) ||
					item.value.toLowerCase().includes(trimmed) ||
					(item.description ?? "").toLowerCase().includes(trimmed),
			),
		);
	}

	getSelectList(): SelectList {
		return this.selectList;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();

		// Navigation, selection, and cancellation go to the list; everything
		// else edits the search query.
		if (
			kb.matches(keyData, "tui.select.up") ||
			kb.matches(keyData, "tui.select.down") ||
			kb.matches(keyData, "tui.select.pageUp") ||
			kb.matches(keyData, "tui.select.pageDown") ||
			kb.matches(keyData, "tui.select.confirm") ||
			kb.matches(keyData, "tui.select.cancel")
		) {
			this.selectList.handleInput(keyData);
			return;
		}

		this.searchInput.handleInput(keyData);
		this.filterApps(this.searchInput.getValue());
	}
}
