import { describe, expect, it } from "vitest";
import { type AcpAgentRunner, startAcpServer } from "../src/core/acp/acp-server.ts";
import type { AcpRunEvent } from "../src/core/acp/types.ts";

/** A mock runner that echoes input and supports streaming events. */
function mockRunner(agents: { name: string; description?: string }[]): AcpAgentRunner {
	return {
		listAgents: () => agents.map((a) => ({ name: a.name, description: a.description })),
		runAgent: async (agentName, inputText, options) => {
			if (inputText === "FAIL") {
				return { output: "", error: "boom" };
			}
			// Stream a couple of events if requested.
			if (options?.onEvent) {
				options.onEvent({
					type: "message",
					message: { role: `agent/${agentName}`, parts: [{ content: "hi", content_type: "text/plain" }] },
				});
			}
			return { output: `${agentName} says: ${inputText}` };
		},
	};
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
	const res = await fetch(url, init);
	const body = await res.json();
	return { status: res.status, body };
}

describe("ACP server", () => {
	it("GET /health returns ok", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "echo" }]), port: 0 });
		try {
			const { status, body } = await fetchJson(`${handle.url}/health`);
			expect(status).toBe(200);
			expect(body).toEqual({ status: "ok" });
		} finally {
			await handle.close();
		}
	});

	it("GET /agents lists exposed agents", async () => {
		const handle = await startAcpServer({
			runner: mockRunner([
				{ name: "echo", description: "Echoes" },
				{ name: "explore", description: "Reads code" },
			]),
			port: 0,
		});
		try {
			const { status, body } = await fetchJson(`${handle.url}/agents`);
			expect(status).toBe(200);
			expect(body.agents).toHaveLength(2);
			expect(body.agents[0].name).toBe("echo");
		} finally {
			await handle.close();
		}
	});

	it("POST /runs sync returns the agent output", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "echo" }]), port: 0 });
		try {
			const { status, body } = await fetchJson(`${handle.url}/runs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					agent_name: "echo",
					mode: "sync",
					input: [{ role: "user", parts: [{ content: "hello", content_type: "text/plain" }] }],
				}),
			});
			expect(status).toBe(200);
			expect(body.status).toBe("completed");
			expect(body.output[0].parts[0].content).toBe("echo says: hello");
			expect(body.error).toBeNull();
		} finally {
			await handle.close();
		}
	});

	it("accepts the IDE's simplified shape (agent, no mode)", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "a-coder-cli" }]), port: 0 });
		try {
			const { status, body } = await fetchJson(`${handle.url}/runs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					agent: "a-coder-cli",
					input: [{ parts: [{ content: "do thing", content_type: "text/plain" }] }],
				}),
			});
			expect(status).toBe(200);
			expect(body.output[0].parts[0].content).toContain("do thing");
		} finally {
			await handle.close();
		}
	});

	it("returns 404 for an unknown agent", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "echo" }]), port: 0 });
		try {
			const { status } = await fetchJson(`${handle.url}/runs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agent: "nope", input: [] }),
			});
			expect(status).toBe(404);
		} finally {
			await handle.close();
		}
	});

	it("returns 400 when no agent is specified", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "echo" }]), port: 0 });
		try {
			const { status } = await fetchJson(`${handle.url}/runs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: [] }),
			});
			expect(status).toBe(400);
		} finally {
			await handle.close();
		}
	});

	it("reports a failed run as status failed", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "echo" }]), port: 0 });
		try {
			const { status, body } = await fetchJson(`${handle.url}/runs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					agent_name: "echo",
					mode: "sync",
					input: [{ parts: [{ content: "FAIL", content_type: "text/plain" }] }],
				}),
			});
			expect(status).toBe(200);
			expect(body.status).toBe("failed");
			expect(body.error.message).toBe("boom");
		} finally {
			await handle.close();
		}
	});

	it("POST /runs stream returns SSE events ending with run.completed", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "echo" }]), port: 0 });
		try {
			const res = await fetch(`${handle.url}/runs`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
				body: JSON.stringify({
					agent_name: "echo",
					mode: "stream",
					input: [{ parts: [{ content: "hi", content_type: "text/plain" }] }],
				}),
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
			const text = await res.text();
			const events: AcpRunEvent[] = text
				.split("\n\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => JSON.parse(line.slice(6)));
			const types = events.map((e) => e.type);
			expect(types[0]).toBe("run.created");
			expect(types).toContain("run.in-progress");
			expect(types).toContain("message");
			expect(types[types.length - 1]).toBe("run.completed");
		} finally {
			await handle.close();
		}
	});

	it("binds to localhost by default and reports the actual port", async () => {
		const handle = await startAcpServer({ runner: mockRunner([{ name: "echo" }]), port: 0 });
		try {
			expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect(handle.port).toBeGreaterThan(0);
		} finally {
			await handle.close();
		}
	});
});
