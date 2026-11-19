/**
 * THE-125 regression: a live rpc-mode turn must put the tool lifecycle on the
 * wire for a client that never negotiated capabilities (the Flutter app's
 * `RpcClient` sends no `client_info`).
 *
 * This drives a real AgentSession turn through `RpcSessionEventStream` the same
 * way rpc-mode does (`session.subscribe((event) => eventStream.push(event))`),
 * with the faux provider standing in for the model. No network, no bridge.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { RpcSessionEventStream } from "../src/modes/rpc/rpc-stream.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

interface Wire {
	frames: Record<string, unknown>[];
	/** Event type of every frame, flattening `event_batch` envelopes. */
	types: string[];
}

function attach(harness: Harness, capabilities: Array<"delta" | "batch" | "tool-progress"> = []): Wire {
	const frames: Record<string, unknown>[] = [];
	const stream = new RpcSessionEventStream(
		(frame) => frames.push(frame),
		() => ({ sessionId: "s1", sessionFile: "/s1.jsonl", activationId: 1 }),
	);
	if (capabilities.length > 0) stream.setCapabilities(capabilities);
	harness.session.subscribe((event) => {
		stream.push(event as unknown as Record<string, unknown>);
	});
	const types = () => {
		const out: string[] = [];
		for (const frame of frames) {
			if (frame.type === "event_batch" && Array.isArray(frame.events)) {
				for (const inner of frame.events as Array<{ type?: string }>) out.push(String(inner.type));
				continue;
			}
			out.push(String(frame.type));
		}
		return out;
	};
	return {
		frames,
		get types() {
			return types();
		},
	} as Wire;
}

const echoTool: AgentTool = {
	name: "echo",
	label: "Echo",
	description: "Echo text back",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_toolCallId, params) => {
		const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
		return {
			content: [{ type: "text", text: `the48-tls-ok:${text}` }],
			details: { text },
		};
	},
};

describe("THE-125 tool lifecycle on the rpc wire", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function runTurn() {
		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "hi" }, { id: "tool-1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		return harness;
	}

	it("emits tool_execution_start and tool_execution_end to a capability-less client", async () => {
		const harness = await runTurn();
		const wire = attach(harness);

		await harness.session.prompt("run the echo tool");

		expect(wire.types).toContain("tool_execution_start");
		expect(wire.types).toContain("tool_execution_end");

		const start = wire.frames.find((frame) => frame.type === "tool_execution_start");
		expect(start).toMatchObject({
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "echo",
			args: { text: "hi" },
			sessionId: "s1",
			activationId: 1,
		});

		const end = wire.frames.find((frame) => frame.type === "tool_execution_end");
		expect(end).toMatchObject({ type: "tool_execution_end", toolCallId: "tool-1", isError: false });
		// The mobile tool card renders the result straight off this frame.
		expect(JSON.stringify(end?.result)).toContain("the48-tls-ok:hi");

		// Lifecycle ordering: the start precedes the end and the end precedes agent_end.
		const order = wire.types;
		expect(order.indexOf("tool_execution_start")).toBeLessThan(order.indexOf("tool_execution_end"));
		expect(order.indexOf("tool_execution_end")).toBeLessThan(order.indexOf("agent_end"));
	});

	it("keeps the compact frames for a tool-progress client and never sends both", async () => {
		const harness = await runTurn();
		const wire = attach(harness, ["tool-progress"]);

		await harness.session.prompt("run the echo tool");

		expect(wire.types).toContain("tool_start");
		expect(wire.types).toContain("tool_end");
		expect(wire.types).not.toContain("tool_execution_start");
		expect(wire.types).not.toContain("tool_execution_end");
	});
});
