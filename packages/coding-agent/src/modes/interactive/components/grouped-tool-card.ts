/**
 * GroupedToolCard — collapsed summary for a run of consecutive read-only
 * tool calls (read, grep, ls). Mirrors easy-agent's GroupedReadSearchCard:
 * a turn that reads 6 files + greps twice + lists a dir shouldn't print
 * 9 separate cards.
 *
 * Header: "Read 5 files · Searched 3 patterns · Listed 2 directories"
 * Preview: first few targets, "+N more" if truncated.
 */

import { Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

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

	constructor(members: CollapsedToolInfo[]) {
		super();
		this.members = members;
		this.rerender();
	}

	private rerender(): void {
		this.clear();
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
