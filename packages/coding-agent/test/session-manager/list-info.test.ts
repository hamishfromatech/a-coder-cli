import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

function assistant(overrides: Record<string, unknown> = {}) {
	return {
		type: "message",
		id: "a1",
		parentId: "u1",
		timestamp: "2025-01-01T00:00:02Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: {
				input: 10,
				output: 20,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 30,
				cost: { input: 0.002, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.012 },
			},
			stopReason: "stop",
			timestamp: 1,
		},
		...overrides,
	};
}

describe("SessionManager.listAll metadata", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-list-info-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("sums assistant usage and keeps the last model", async () => {
		const file = join(tempDir, "session.jsonl");
		writeFileSync(
			file,
			`${[
				{ type: "session", version: 3, id: "abc", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
				{
					type: "message",
					id: "u1",
					parentId: null,
					timestamp: "2025-01-01T00:00:01Z",
					message: { role: "user", content: "hi", timestamp: 1 },
				},
				assistant(),
				assistant({
					id: "a2",
					parentId: "a1",
					timestamp: "2025-01-01T00:00:03Z",
					message: {
						...assistant().message,
						model: "claude-opus-4",
						usage: {
							input: 5,
							output: 5,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 10,
							cost: { input: 0.001, output: 0.004, cacheRead: 0, cacheWrite: 0, total: 0.005 },
						},
					},
				}),
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n")}\n`,
		);

		const [info] = await SessionManager.listAll(tempDir);
		expect(info?.messageCount).toBe(3);
		expect(info?.model).toBe("claude-opus-4");
		expect(info?.totalTokens).toBe(40);
		expect(info?.totalCost).toBeCloseTo(0.017);
	});
});
