import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTask, interruptLiveTasks, loadTasks, removeTask, upsertTask } from "../src/storage.ts";
import type { CloudTask } from "../src/types.ts";

let cloudDir = "";

function makeTask(id: string, status: CloudTask["status"] = "queued"): CloudTask {
	const now = new Date().toISOString();
	return {
		id,
		createdAt: now,
		updatedAt: now,
		repoSource: "/tmp/repo",
		workspacePath: join(cloudDir, "workspaces", id),
		baseBranch: "HEAD",
		baseSha: "abc123",
		branch: `ac-cloud/${id}`,
		prompt: "test prompt",
		timeoutMinutes: 30,
		push: false,
		status,
		commits: [],
		changedFiles: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			turns: 0,
			toolCalls: 0,
			toolErrors: 0,
		},
		warnings: [],
	};
}

beforeAll(() => {
	cloudDir = mkdtempSync(join(tmpdir(), "pi-cloud-store-"));
	process.env.A_CODER_CLI_CLOUD_DIR = cloudDir;
});

afterAll(() => {
	rmSync(cloudDir, { recursive: true, force: true });
	delete process.env.A_CODER_CLI_CLOUD_DIR;
});

describe("task store", () => {
	it("persists, reads, and updates tasks without duplicating", () => {
		const task = makeTask("task1");
		upsertTask(task);
		expect(getTask("task1")?.prompt).toBe("test prompt");

		upsertTask({ ...task, status: "running" });
		upsertTask({ ...task, status: "running" });
		expect(getTask("task1")?.status).toBe("running");
		expect(loadTasks().filter((t) => t.id === "task1")).toHaveLength(1);
	});

	it("interrupts live tasks on daemon restart", () => {
		upsertTask(makeTask("task2", "running"));
		upsertTask(makeTask("task3", "done"));
		const interrupted = interruptLiveTasks();
		expect(interrupted.map((t) => t.id)).toContain("task2");
		expect(getTask("task2")?.status).toBe("queued");
		expect(getTask("task2")?.warnings.some((w) => w.includes("re-queued"))).toBe(true);
		expect(getTask("task3")?.status).toBe("done");
	});

	it("removes tasks", () => {
		upsertTask(makeTask("task4"));
		removeTask("task4");
		expect(getTask("task4")).toBeUndefined();
	});
});
