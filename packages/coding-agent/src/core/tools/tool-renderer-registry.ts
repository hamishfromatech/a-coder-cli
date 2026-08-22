/**
 * Tool renderer override registry.
 *
 * Pi-mono's ToolDefinition already embeds renderCall/renderResult per tool.
 * This registry adds a lightweight override layer: extensions or themes can
 * customize how a tool *looks* without redefining the tool's behavior.
 *
 * Mirrors easy-agent's toolRenderers registry pattern, adapted to pi-mono's
 * existing ToolDefinition architecture. The ToolExecutionComponent checks
 * the registry before falling back to the tool definition's renderer.
 *
 * Use cases:
 * - MCP tools that want custom rendering
 * - Extensions that override how a built-in tool is displayed
 * - Themes that customize tool card appearance
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolRenderContext, ToolRenderResultOptions } from "../extensions/types.ts";

/** Arguments type for renderer overrides (loosely typed for generic registry). */
type RendererArgs = Record<string, unknown>;
type RendererResult = AgentToolResult<unknown>;
type RendererState = Record<string, unknown>;

export interface ToolRendererOverride {
	/** Override the tool call display. */
	renderCall?: (
		args: RendererArgs,
		theme: Theme,
		context: ToolRenderContext<RendererState, RendererArgs>,
	) => Component;

	/** Override the tool result display. */
	renderResult?: (
		result: RendererResult,
		options: ToolRenderResultOptions,
		theme: Theme,
		context: ToolRenderContext<RendererState, RendererArgs>,
	) => Component;

	/** Override the render shell ("default" = colored box, "self" = tool-owned). */
	renderShell?: "default" | "self";
}

type Listener = () => void;

const overrides = new Map<string, ToolRendererOverride>();
const listeners = new Set<Listener>();

/** Register a renderer override for a tool name. Replaces any existing override. */
export function registerToolRendererOverride(toolName: string, override: ToolRendererOverride): () => void {
	overrides.set(toolName, override);
	notifyListeners();
	return () => {
		// Only remove if the same override is still registered (not replaced).
		if (overrides.get(toolName) === override) {
			overrides.delete(toolName);
			notifyListeners();
		}
	};
}

/** Get the renderer override for a tool name, if any. */
export function getToolRendererOverride(toolName: string): ToolRendererOverride | undefined {
	return overrides.get(toolName);
}

/** Remove a renderer override for a tool name. */
export function unregisterToolRendererOverride(toolName: string): void {
	if (overrides.delete(toolName)) {
		notifyListeners();
	}
}

/** Clear all renderer overrides. */
export function clearToolRendererOverrides(): void {
	if (overrides.size === 0) return;
	overrides.clear();
	notifyListeners();
}

/** Subscribe to registry changes. Returns an unsubscribe function. */
export function subscribeToolRendererOverrides(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function notifyListeners(): void {
	for (const listener of listeners) {
		try {
			listener();
		} catch {
			// Never let a subscriber break the registry.
		}
	}
}
