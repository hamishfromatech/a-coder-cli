/**
 * Background a running bash tool call — the desktop mirror of the CLI's
 * Ctrl+B. The engine's bash tool polls the background-request flag and
 * detaches the process; the tool result reports a "backgrounded" state and
 * the agent keeps going.
 */

import { toast } from "../stores/toast-store";
import { useToolProgressStore } from "../stores/tool-progress-store";
import { sendCommand } from "./rpc";

/** The latest running bash tool call (engine tool_start/tool_end streams). */
export function findRunningBashToolCallId(): string | null {
	const streams = useToolProgressStore.getState().streams;
	let latest: string | null = null;
	for (const [id, stream] of Object.entries(streams)) {
		if (stream.toolName === "bash" && !stream.ended) latest = id;
	}
	return latest;
}

export async function backgroundRunningBash(): Promise<boolean> {
	const toolCallId = findRunningBashToolCallId();
	if (!toolCallId) {
		toast.warning("No running bash command");
		return false;
	}
	try {
		await sendCommand({ type: "background_bash", toolCallId });
		toast.success("Backgrounded", "The command keeps running; the agent continues.");
		return true;
	} catch (e) {
		toast.error("Background failed", e instanceof Error ? e.message : String(e));
		return false;
	}
}
