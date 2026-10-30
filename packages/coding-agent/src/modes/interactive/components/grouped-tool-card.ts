/**
 * GroupedToolCard — collapsed summary for a run of consecutive read-only
 * tool calls (read, grep, ls). Mirrors easy-agent's GroupedReadSearchCard:
 * a turn that reads 6 files + greps twice + lists a dir shouldn't print
 * 9 separate cards.
 *
 * Header: "Read 5 files · Searched 3 patterns · Listed 2 directories"
 * Preview: first few targets, "+N more" if truncated.
 *
 * The member components are RETAINED: expanding the group (click or the
 * expand-recent key) re-renders them in place, so the summary is a view,
 * not a permanent replacement.
 */

import {
	Container,
	Spacer,
	Text,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";

const COLLAPSIBLE_TOOLS = new Set(["read", "grep", "ls"]);
const TARGET_PREVIEW = 4;

export interface CollapsedToolInfo {
	toolName: string;
	target: string;
}

function classifyTarget(toolName: string, args: Record<string, unknown>): string {
	const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : "";
	switch (toolName) {
		case "read":
			return path || "(unknown)";
		case "grep": {
			const pattern = typeof args.pattern === "string" ? args.pattern : "";
			return pattern ? `"${pattern}"` : "(unknown)";
		}
		case "ls":
			return path || ".";
		default:
			return path || "(unknown)";
	}
}

export function isCollapsibleTool(toolName: string): boolean {
	return COLLAPSIBLE_TOOLS.has(toolName);
}

export function extractToolTarget(toolName: string, args: Record<string, unknown>): string {
	return classifyTarget(toolName, args);
}

function computeSummary(members: CollapsedToolInfo[]): string {
	const counts: Record<string, number> = {};
	for (const m of members) {
		counts[m.toolName] = (counts[m.toolName] ?? 0) + 1;
	}
	const parts: string[] = [];
	if (counts.read) parts.push(`Read ${counts.read} ${counts.read === 1 ? "file" : "files"}`);
	if (counts.grep) parts.push(`Searched ${counts.grep} ${counts.grep === 1 ? "pattern" : "patterns"}`);
	if (counts.ls) parts.push(`Listed ${counts.ls} ${counts.ls === 1 ? "directory" : "directories"}`);
	return parts.join(" · ");
}

export class GroupedToolCardComponent extends Container {
	private readonly members: CollapsedToolInfo[];
	private readonly components: ToolExecutionComponent[];
	private expanded = false;

	constructor(members: CollapsedToolInfo[], components: ToolExecutionComponent[] = []) {
		super();
		this.members = members;
		this.components = components;
		this.rerender();
	}

	/** Global expansion flow: refreshes members to the group's new state. */
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		for (const component of this.components) {
			component.setExpanded(expanded);
		}
		this.rerender();
	}

	/** Per-card toggle (click / "expand most recent" key). */
	toggleExpanded(): void {
		this.setExpanded(!this.expanded);
	}

	/**
	 * Collapsed: a left click expands the group. Expanded: clicks fall through
	 * to the member cards (Container hit-testing), whose own click expands the
	 * individual tool result.
	 */
	override handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		if (this.expanded) return undefined;
		this.toggleExpanded();
		return {
			handled: true,
			target: { component: this, originX: 0, originY: 0, width: event.width, height: event.height },
		};
	}

	/** Fold newly completed collapsible cards into this group (merge run). */
	absorb(infos: CollapsedToolInfo[], components: ToolExecutionComponent[]): void {
		this.members.push(...infos);
		this.components.push(...components);
		for (const component of components) {
			component.setExpanded(this.expanded);
		}
		this.rerender();
	}

	private rerender(): void {
		this.clear();
		if (this.expanded && this.components.length > 0) {
			for (const component of this.components) {
				this.addChild(component);
			}
			return;
		}
		const label = computeSummary(this.members);
		this.addChild(new Text(`${theme.fg("accent", "● ")}${theme.fg("text", theme.bold(label))}`, 1, 1));

		const targets = this.members.map((m) => m.target);
		const preview = targets.slice(0, TARGET_PREVIEW);
		const hidden = targets.length - preview.length;
		if (preview.length > 0) {
			const summary = preview.join(", ") + (hidden > 0 ? `, +${hidden} more` : "");
			this.addChild(new Text(truncateToWidth(theme.fg("muted", `  ${summary}`), 120, "…"), 1, 1));
		}
		this.addChild(new Spacer(0));
	}
}
