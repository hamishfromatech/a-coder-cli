/**
 * AsyncGenerator wrapper for AgentSession events.
 *
 * Pi-mono's AgentSession uses a push-based event emitter: events are emitted
 * as fast as they arrive, and listeners process them synchronously. This
 * wrapper converts that stream into a pull-based AsyncGenerator, providing:
 *
 * - Natural backpressure: the consumer controls the pace by awaiting next()
 * - Clean UI/core separation: the consumer loops with `for await` instead of
 *   registering callbacks
 * - Composability: generators can be mapped, filtered, and merged
 *
 * This is a bridge layer — it doesn't replace the existing event system. New
 * consumers (headless mode, programmatic SDK, tests) can use the generator
 * API; the interactive TUI continues to use the callback-based subscribe().
 *
 * Usage:
 *   const gen = createAgentEventGenerator(session);
 *   await session.prompt("hello");
 *   for await (const event of gen) {
 *     switch (event.type) {
 *       case "message_update": // streaming text
 *       case "tool_execution_start": // tool began
 *       case "agent_end": // turn complete
 *         break;
 *     }
 *   }
 */

import type { AgentSessionEvent, AgentSessionEventListener } from "./agent-session.ts";

/** A queued event with its resolve/reject pair for backpressure. */
interface QueuedEvent {
	event: AgentSessionEvent;
}

/**
 * Create an AsyncGenerator that yields AgentSession events.
 *
 * Events are buffered in an unbounded queue. The generator completes when:
 * - An `agent_end` event is yielded (normal completion), or
 * - The abort signal is triggered, or
 * - The generator is returned/broken from by the consumer
 *
 * The generator automatically unsubscribes from the session on completion.
 */
export async function* createAgentEventGenerator(
	subscribe: (listener: AgentSessionEventListener) => () => void,
	signal?: AbortSignal,
): AsyncGenerator<AgentSessionEvent, void, undefined> {
	const queue: QueuedEvent[] = [];
	let resolveWait: (() => void) | undefined;
	let done = false;

	const listener: AgentSessionEventListener = (event) => {
		if (done) return;
		queue.push({ event });
		if (resolveWait) {
			const resolve = resolveWait;
			resolveWait = undefined;
			resolve();
		}
	};

	const unsubscribe = subscribe(listener);

	const onAbort = () => {
		done = true;
		if (resolveWait) {
			const resolve = resolveWait;
			resolveWait = undefined;
			resolve();
		}
	};

	if (signal) {
		if (signal.aborted) {
			unsubscribe();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		while (!done) {
			if (queue.length === 0) {
				await new Promise<void>((resolve) => {
					resolveWait = resolve;
				});
				if (done && queue.length === 0) break;
			}

			while (queue.length > 0) {
				const { event } = queue.shift() as QueuedEvent;
				yield event;
				if (event.type === "agent_end") {
					done = true;
					break;
				}
			}
		}
	} finally {
		done = true;
		unsubscribe();
		if (signal) {
			signal.removeEventListener("abort", onAbort);
		}
	}
}
