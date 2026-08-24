/**
 * ACP runner — adapts a live AgentSession (the CLI's agent runtime) to the
 * AcpAgentRunner interface so the ACP server can list agents and execute runs.
 *
 * Agents exposed:
 *   - "a-coder-cli" — the main agent (no subagent_type)
 *   - one per loaded AgentDefinition (subagent types) — run via the Agent tool
 *
 * Runs are synchronous against the shared session: each POST /runs sends the
 * user's input text as a prompt and awaits completion, then returns the last
 * assistant message's text. Streaming runs forward incremental assistant
 * text/thought/tool events via the session's subscribe() feed.
 */

import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { AgentSession } from "../agent-session.ts";
import type { AgentSessionRuntime } from "../agent-session-runtime.ts";
import { getAllAgents, isAgentsInitialized } from "../agents/registry.ts";
import type { AcpAgentRunner } from "./acp-server.ts";
import type { AcpAgent, AcpRunEvent } from "./types.ts";

/** The canonical name of the main (non-subagent) agent. */
export const MAIN_AGENT_NAME = "a-coder-cli";

/** Build the list of ACP agents from the agent registry + the main agent. */
export function listAcpAgents(): AcpAgent[] {
	const agents: AcpAgent[] = [
		{
			name: MAIN_AGENT_NAME,
			description: "The a-coder-cli coding agent — full read/edit/bash tool access.",
			input_content_types: ["text/plain", "text/markdown"],
			output_content_types: ["text/plain"],
		},
	];
	if (isAgentsInitialized()) {
		for (const def of getAllAgents()) {
			agents.push({
				name: def.agentType,
				description: def.whenToUse,
				input_content_types: ["text/plain", "text/markdown"],
				output_content_types: ["text/plain"],
			});
		}
	}
	return agents;
}

/** Extract the concatenated text from an assistant message's content parts. */
function assistantText(message: AssistantMessage): string {
	const parts: string[] = [];
	for (const content of message.content) {
		if (content.type === "text") {
			parts.push((content as TextContent).text);
		}
	}
	return parts.join("\n");
}

/**
 * Create an AcpAgentRunner backed by an AgentSession runtime. The session is
 * shared across runs (so a `session_id` resumes context). Each run sends the
 * input as a prompt and awaits the agent going idle.
 */
export function createAcpRunner(runtime: AgentSessionRuntime): AcpAgentRunner {
	const session: AgentSession = runtime.session;

	return {
		listAgents: listAcpAgents,

		runAgent: async (agentName, inputText, options) => {
			if (!inputText) {
				return { output: "", error: "No input text provided" };
			}

			// Subscribe to the agent event feed to forward streaming events.
			const onEvent = options.onEvent;
			let unsubscribe: (() => void) | undefined;
			if (onEvent) {
				unsubscribe = session.subscribe((event) => {
					// Forward streaming assistant text deltas as `message` events.
					if (event.type === "message_update") {
						const message = event.message;
						if (message?.role === "assistant") {
							const text = assistantText(message as AssistantMessage);
							if (text) {
								onEvent({ type: "message", content: text } satisfies AcpRunEvent);
							}
						}
					}
				});
			}

			try {
				// For the main agent, send the prompt directly. For a subagent,
				// dispatch via the Agent tool by wrapping the input. The CLI's
				// subagent mechanism is invoked through the model's tool calls,
				// so an ACP caller targeting a subagent gets the main agent to
				// delegate by prefixing the request. This keeps one session.
				const promptText =
					agentName === MAIN_AGENT_NAME
						? inputText
						: `Use the spawn_subagent tool with subagent_type="${agentName}" and this task: ${inputText}`;

				await session.prompt(promptText);

				const state = session.state;
				const lastMessage = state.messages[state.messages.length - 1];
				if (lastMessage?.role === "assistant") {
					const assistantMsg = lastMessage as AssistantMessage;
					if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
						return {
							output: "",
							error: assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`,
						};
					}
					return { output: assistantText(assistantMsg) };
				}
				return { output: "" };
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return { output: "", error: message };
			} finally {
				unsubscribe?.();
			}
		},
	};
}
