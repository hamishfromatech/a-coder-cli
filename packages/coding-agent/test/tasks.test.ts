import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_TASKS_DIR } from "../src/config.ts";
import {
	blockTask,
	createTask,
	deleteTask,
	getTask,
	getTaskListId,
	isReady,
	listTasks,
	resetTaskList,
	sanitizePathComponent,
	updateTask,
} from "../src/core/tasks/task-store.ts";
import { createTaskCreateTool, createTaskUpdateTool } from "../src/core/tools/tasks.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "a-coder-tasks-"));
	process.env[ENV_TASKS_DIR] = dir;
});

afterEach(async () => {
	delete process.env[ENV_TASKS_DIR];
	await rm(dir, { recursive: true, force: true });
});

function baseTask(subject: string) {
	return { subject, description: `Do ${subject}`, status: "pending" as const, blocks: [], blockedBy: [] };
}

describe("task-store", () => {
	it("sanitizes path components", () => {
		expect(sanitizePathComponent("../etc/passwd")).toBe("---etc-passwd");
		expect(sanitizePathComponent("session-123_ABC")).toBe("session-123_ABC");
	});

	it("creates tasks with stable incrementing ids", async () => {
		const listId = getTaskListId("sess-a");
		const id1 = await createTask(listId, baseTask("First"));
		const id2 = await createTask(listId, baseTask("Second"));
		expect(id1).toBe("1");
		expect(id2).toBe("2");
		expect((await getTask(listId, "1"))?.subject).toBe("First");
		expect(await listTasks(listId)).toHaveLength(2);
	});

	it("high water mark prevents id reuse after delete and reset", async () => {
		const listId = getTaskListId("sess-b");
		await createTask(listId, baseTask("A"));
		await createTask(listId, baseTask("B"));
		await deleteTask(listId, "2");
		const id3 = await createTask(listId, baseTask("C"));
		expect(id3).toBe("3");

		await resetTaskList(listId);
		expect(await listTasks(listId)).toHaveLength(0);
		const id4 = await createTask(listId, baseTask("D"));
		expect(id4).toBe("4");
	});

	it("maintains blocks/blockedBy bidirectionally", async () => {
		const listId = getTaskListId("sess-c");
		await createTask(listId, baseTask("Upstream"));
		await createTask(listId, baseTask("Downstream"));
		const ok = await blockTask(listId, "1", "2");
		expect(ok).toBe(true);
		const upstream = await getTask(listId, "1");
		const downstream = await getTask(listId, "2");
		expect(upstream?.blocks).toEqual(["2"]);
		expect(downstream?.blockedBy).toEqual(["1"]);
		// Idempotent duplicate.
		await blockTask(listId, "1", "2");
		expect((await getTask(listId, "1"))?.blocks).toEqual(["2"]);
	});

	it("delete cascades references in siblings", async () => {
		const listId = getTaskListId("sess-d");
		await createTask(listId, baseTask("Upstream"));
		await createTask(listId, baseTask("Downstream"));
		await blockTask(listId, "1", "2");
		await deleteTask(listId, "1");
		const downstream = await getTask(listId, "2");
		expect(downstream?.blockedBy).toEqual([]);
	});

	it("isReady requires pending status and completed blockers", async () => {
		const listId = getTaskListId("sess-e");
		await createTask(listId, baseTask("A"));
		await createTask(listId, baseTask("B"));
		await blockTask(listId, "1", "2");
		const tasks = await listTasks(listId);
		const a = tasks.find((t) => t.id === "1");
		const b = tasks.find((t) => t.id === "2");
		expect(a && isReady(a, tasks)).toBe(true);
		expect(b && isReady(b, tasks)).toBe(false);
		await updateTask(listId, "1", { status: "completed" });
		const after = await listTasks(listId);
		const bAfter = after.find((t) => t.id === "2");
		expect(bAfter && isReady(bAfter, after)).toBe(true);
	});
});

describe("task tools", () => {
	it("task_create persists and snapshots the list in details", async () => {
		const tool = createTaskCreateTool();
		const result = await tool.execute("t1", {
			subject: "Fix bug",
			description: "Fix the login bug",
		});
		expect(result.content[0]).toMatchObject({ type: "text" });
		const details = result.details as { tasks: Array<{ subject: string }>; taskId: string };
		expect(details.taskId).toBe("1");
		expect(details.tasks).toHaveLength(1);
		expect(details.tasks[0].subject).toBe("Fix bug");
	});

	it("task_update status=deleted removes the task", async () => {
		const create = createTaskCreateTool();
		await create.execute("t1", { subject: "A", description: "Do A" });
		const update = createTaskUpdateTool();
		const result = await update.execute("t2", { taskId: "1", status: "deleted" });
		const details = result.details as { tasks: unknown[] };
		expect(details.tasks).toHaveLength(0);
		expect(await listTasks(getTaskListId("default"))).toHaveLength(0);
	});
});
