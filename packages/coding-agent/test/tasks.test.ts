import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_TASKS_DIR } from "../src/config.ts";
import {
	blockTask,
	createTask,
	deleteTask,
	gcStaleTaskLists,
	getTask,
	getTaskListId,
	isReady,
	listTasks,
	listTasksWithArchive,
	resetTaskList,
	sanitizePathComponent,
	updateTask,
	VISIBLE_COMPLETED_LIMIT,
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
			tasks: [{ subject: "Fix bug", description: "Fix the login bug" }],
		});
		expect(result.content[0]).toMatchObject({ type: "text" });
		const details = result.details as { tasks: Array<{ subject: string }>; taskId: string };
		expect(details.taskId).toBe("1");
		expect(details.tasks).toHaveLength(1);
		expect(details.tasks[0].subject).toBe("Fix bug");
	});

	it("task_create batch-creates a full task list in one call", async () => {
		const tool = createTaskCreateTool();
		const result = await tool.execute("t1", {
			tasks: [
				{ subject: "First", description: "Do first" },
				{ subject: "Second", description: "Do second", activeForm: "Doing second" },
				{ subject: "Third", description: "Do third" },
			],
		});
		const details = result.details as { tasks: Array<{ subject: string; activeForm?: string }>; taskId?: string };
		expect(details.tasks).toHaveLength(3);
		expect(details.tasks.map((t) => t.subject)).toEqual(["First", "Second", "Third"]);
		expect(details.tasks[1].activeForm).toBe("Doing second");
		// Batch creation has no single affected task.
		expect(details.taskId).toBeUndefined();
		expect(await listTasks(getTaskListId("default"))).toHaveLength(3);
	});

	it("task_update status=deleted removes the task", async () => {
		const create = createTaskCreateTool();
		await create.execute("t1", { tasks: [{ subject: "A", description: "Do A" }] });
		const update = createTaskUpdateTool();
		const result = await update.execute("t2", { taskId: "1", status: "deleted" });
		const details = result.details as { tasks: unknown[] };
		expect(details.tasks).toHaveLength(0);
		expect(await listTasks(getTaskListId("default"))).toHaveLength(0);
	});
});

describe("completed-task archive", () => {
	it("archives completed tasks past the visible window and keeps ids resolvable", async () => {
		const listId = getTaskListId("sess-archive");
		for (let i = 1; i <= 20; i++) {
			const id = await createTask(listId, baseTask(`T${i}`));
			await updateTask(listId, id, { status: "completed" });
		}
		// All 20 were completed; the 15 most recent stay live.
		expect(await listTasks(listId)).toHaveLength(15);
		const { archived } = await listTasksWithArchive(listId);
		expect(archived.map((t) => t.id)).toEqual(["1", "2", "3", "4", "5"]);
		expect(archived.every((t) => t.status === "completed")).toBe(true);

		// Read-through resolution.
		const resolved = await getTask(listId, "1");
		expect(resolved?.archived).toBe(true);
	});

	it("refuses to update archived tasks; explicit deleted prunes history", async () => {
		const listId = getTaskListId("sess-arch-ro");
		await createTask(listId, baseTask("A"));
		await updateTask(listId, "1", { status: "completed" });
		await createTask(listId, baseTask("B"));
		await updateTask(listId, "2", { status: "completed" });
		// Force archival by pushing B's completion older than the window edge.
		const { archived } = await listTasksWithArchive(listId);
		if (archived.length === 0) {
			// Simulate: hand-write a task beyond the cap.
			await createTask(listId, baseTask("C"));
			await updateTask(listId, "3", { status: "completed" });
		}
		// Archive everything completed via direct repeated complete + new tasks
		// is overkill — force by reducing: delete two tasks and re-create.
		const createCount = VISIBLE_COMPLETED_LIMIT + 1;
		const listId2 = getTaskListId("sess-arch-ro2");
		for (let i = 0; i < createCount; i++) {
			const id = await createTask(listId2, baseTask(`T${i}`));
			await updateTask(listId2, id, { status: "completed" });
		}
		const oldestArchived = (await listTasksWithArchive(listId2)).archived[0];
		expect(oldestArchived).toBeTruthy();
		await expect(updateTask(listId2, oldestArchived!.id, { subject: "nope" })).rejects.toThrow(/archived/);

		// Explicit delete removes an archived row.
		expect(await deleteTask(listId2, oldestArchived!.id)).toBe(true);
		expect(await getTask(listId2, oldestArchived!.id)).toBeNull();
	});

	it("delete cascades into archived references", async () => {
		const listId = getTaskListId("sess-arch-cascade");
		// Wire the link while both tasks are live, then let the upstream
		// complete into history first (it is the oldest completion).
		const upstreamId = await createTask(listId, baseTask("Upstream"));
		const downstreamId = await createTask(listId, baseTask("Downstream"));
		await blockTask(listId, upstreamId, downstreamId);
		// Complete the upstream FIRST (earliest completion → archived first).
		await updateTask(listId, upstreamId, { status: "completed" });
		// Then push more completions through the visible window so it archives.
		for (let i = 0; i < VISIBLE_COMPLETED_LIMIT + 1; i++) {
			const id = await createTask(listId, baseTask(`Filler ${i}`));
			await updateTask(listId, id, { status: "completed" });
		}
		const upstream = (await listTasksWithArchive(listId)).archived.find((t) => t.id === upstreamId)!;
		expect(upstream).toBeTruthy();
		// Deleting the archived upstream must clear the downstream ref.
		await deleteTask(listId, upstream.id);
		const downstream = await getTask(listId, downstreamId);
		expect(downstream?.blockedBy).toEqual([]);
		expect((await listTasksWithArchive(listId)).archived.some((t) => t.id === upstream.id)).toBe(false);
	});

	it("stamps completedAt and clears it on reopen", async () => {
		const listId = getTaskListId("sess-ts");
		const id = await createTask(listId, baseTask("Timed"));
		const done = await updateTask(listId, id, { status: "completed" });
		expect(done?.completedAt).toBeTruthy();
		const reopened = await updateTask(listId, id, { status: "in_progress" });
		expect(reopened?.completedAt).toBeUndefined();
	});

	it("resetTaskList clears the archive", async () => {
		const listId = getTaskListId("sess-reset-arch");
		for (let i = 1; i <= VISIBLE_COMPLETED_LIMIT + 1; i++) {
			const id = await createTask(listId, baseTask(`T${i}`));
			await updateTask(listId, id, { status: "completed" });
		}
		await resetTaskList(listId);
		expect((await listTasksWithArchive(listId)).live).toHaveLength(0);
		expect((await listTasksWithArchive(listId)).archived).toHaveLength(0);
	});
});

describe("task-list disk GC", () => {
	it("removes lists untouched past the retention window and honors exclusions", async () => {
		const { mkdir } = await import("node:fs/promises");
		const oldDir = join(dir, "old-list");
		const freshDir = join(dir, "fresh-list");
		await mkdir(oldDir, { recursive: true });
		await mkdir(freshDir, { recursive: true });
		await writeFile(join(oldDir, "1.json"), JSON.stringify(baseTask("Old")), "utf-8");
		await writeFile(join(freshDir, "1.json"), JSON.stringify(baseTask("Fresh")), "utf-8");
		// Backdate the old list's dir + files 40 days.
		const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
		await utimes(join(oldDir, "1.json"), oldTime, oldTime);
		await utimes(oldDir, oldTime, oldTime);

		const result = await gcStaleTaskLists(30, { exclude: ["fresh-list"] });
		expect(result.dirs).toContain("old-list");
		expect(
			await stat(oldDir).then(
				() => false,
				() => true,
			),
		).toBe(true);
		expect(
			await stat(freshDir).then(
				() => true,
				() => false,
			),
		).toBe(true);
	});

	it("retentionDays 0 disables GC", async () => {
		const result = await gcStaleTaskLists(0);
		expect(result.removed).toBe(0);
	});
});
