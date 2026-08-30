import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import {
	buildStreamJsonInit,
	buildStreamJsonResult,
	emptyUsageState,
	mapEventToStreamJson,
	type StreamJsonUsageState,
} from "../src/modes/stream-json.ts";

function parse(line: string): Record<string, unknown> {
	return JSON.parse(line) as Record<string, unknown>;
}

describe("stream-json envelope", () => {
	it("builds the system/init line", () => {
		const line = parse(
			buildStreamJsonInit({ sessionId: "s1", cwd: "/w", model: "anthropic/x", tools: ["read", "bash"] }),
		);
		expect(line).toMatchObject({ type: "system", subtype: "init", session_id: "s1", cwd: "/w" });
	});

	it("maps assistant/user message_end events and folds message_start/update/turn_end", () => {
		const state = emptyUsageState();
		const assistant = parse(
			mapEventToStreamJson(
				{
					type: "message_end",
					message: {
						role: "assistant",
						model: "x",
						content: [{ type: "text", text: "hi" }],
						stopReason: "stop",
					},
				} as unknown as AgentSessionEvent,
				state,
			)[0]!,
		);
		expect(assistant.type).toBe("assistant");

		const user = parse(
			mapEventToStreamJson(
				{
					type: "message_end",
					message: { role: "user", content: "hello" },
				} as unknown as AgentSessionEvent,
				state,
			)[0]!,
		);
		expect(user.type).toBe("user");

		expect(
			mapEventToStreamJson({ type: "message_start", message: {} } as unknown as AgentSessionEvent, state),
		).toEqual([]);

		const passthrough = parse(
			mapEventToStreamJson(
				{ type: "queue_update", steering: [], followUp: [] } as unknown as AgentSessionEvent,
				state,
			)[0]!,
		);
		expect(passthrough.type).toBe("event");
	});

	it("accumulates usage across turns and builds a result line", async () => {
		const state: StreamJsonUsageState = emptyUsageState();
		const turnEnd: AgentSessionEvent = {
			type: "turn_end",
			message: {} as never,
			toolResults: [],
			usage: {
				input: 10,
				output: 5,
				cacheRead: 2,
				cacheWrite: 0,
				totalTokens: 17,
				cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
			},
		} as AgentSessionEvent;
		expect(mapEventToStreamJson(turnEnd, state)).toEqual([]);

		const line = parse(
			buildStreamJsonResult({
				state,
				startedAt: Date.now() - 1500,
				resultText: "done",
				isError: false,
			}),
		);
		expect(line.type).toBe("result");
		expect(line.subtype).toBe("success");
		expect(line.num_turns).toBe(1);
		expect(line.usage).toEqual({ input: 10, output: 5, cacheRead: 2, totalTokens: 17 });
		expect(line.total_cost_usd).toBeCloseTo(0.3);

		const errLine = parse(
			buildStreamJsonResult({
				state: emptyUsageState(),
				startedAt: Date.now(),
				resultText: "",
				isError: true,
				errorMessage: "aborted",
			}),
		);
		expect(errLine.subtype).toBe("error");
		expect(errLine).toHaveProperty("error_message", "aborted");
	});
});
