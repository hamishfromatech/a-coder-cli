import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_TEAMS_DIR } from "../src/config.ts";
import {
	drainUnreadMessages,
	formatMailboxAttachment,
	markMessagesAsRead,
	readMailbox,
	writeToMailbox,
} from "../src/core/teams/mailbox.ts";
import { clearActiveTeam, getActiveTeam } from "../src/core/teams/team-context.ts";
import {
	addTeamMember,
	cleanupTeamDirectory,
	formatAgentId,
	readTeamFile,
	removeTeamMember,
	sanitizeName,
	setMemberActive,
	TEAM_LEAD_NAME,
	type TeamFile,
	writeTeamFile,
} from "../src/core/teams/team-file.ts";
import { createSendMessageTool, createTeamCreateTool, createTeamDeleteTool } from "../src/core/tools/teams.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "a-coder-teams-"));
	process.env[ENV_TEAMS_DIR] = dir;
	clearActiveTeam();
});

afterEach(async () => {
	delete process.env[ENV_TEAMS_DIR];
	clearActiveTeam();
	await rm(dir, { recursive: true, force: true });
});

describe("team-file", () => {
	it("sanitizes names and formats agent ids", () => {
		expect(sanitizeName("My Team!")).toBe("my-team-");
		expect(sanitizeName("refactor-auth")).toBe("refactor-auth");
		expect(formatAgentId("backend", "refactor-auth")).toBe("backend@refactor-auth");
	});

	it("reads and writes a team file with members", async () => {
		const file: TeamFile = {
			name: "refactor-auth",
			createdAt: 1,
			leadAgentId: `${TEAM_LEAD_NAME}@refactor-auth`,
			members: [{ agentId: `${TEAM_LEAD_NAME}@refactor-auth`, name: TEAM_LEAD_NAME, joinedAt: 1, isActive: true }],
		};
		await writeTeamFile("refactor-auth", file);
		expect((await readTeamFile("refactor-auth"))?.name).toBe("refactor-auth");
		expect(await readTeamFile("nope")).toBeNull();
	});

	it("addTeamMember is idempotent on name and setMemberActive flips the flag", async () => {
		await writeTeamFile("t", {
			name: "t",
			createdAt: 1,
			leadAgentId: `${TEAM_LEAD_NAME}@t`,
			members: [{ agentId: `${TEAM_LEAD_NAME}@t`, name: TEAM_LEAD_NAME, joinedAt: 1, isActive: true }],
		});
		await addTeamMember("t", { agentId: "backend@t", name: "backend", joinedAt: 2, isActive: true });
		await addTeamMember("t", { agentId: "backend@t", name: "backend", joinedAt: 3, isActive: true });
		const file = await readTeamFile("t");
		expect(file?.members.filter((m) => m.name === "backend")).toHaveLength(1);
		expect(file?.members.find((m) => m.name === "backend")?.joinedAt).toBe(3);

		await setMemberActive("t", "backend", false);
		expect((await readTeamFile("t"))?.members.find((m) => m.name === "backend")?.isActive).toBe(false);
	});

	it("removeTeamMember and cleanupTeamDirectory mutate/open the dir", async () => {
		await writeTeamFile("t", {
			name: "t",
			createdAt: 1,
			leadAgentId: `${TEAM_LEAD_NAME}@t`,
			members: [
				{ agentId: `${TEAM_LEAD_NAME}@t`, name: TEAM_LEAD_NAME, joinedAt: 1, isActive: true },
				{ agentId: "backend@t", name: "backend", joinedAt: 1, isActive: false },
			],
		});
		await removeTeamMember("t", "backend");
		expect((await readTeamFile("t"))?.members).toHaveLength(1);
		await cleanupTeamDirectory("t");
		expect(await readTeamFile("t")).toBeNull();
	});
});

describe("mailbox", () => {
	it("writes, drains, and formats messages", async () => {
		await writeToMailbox("backend", { from: "team-lead", text: "hello", timestamp: "t" }, "t");
		await writeToMailbox("backend", { from: "team-lead", text: "again", timestamp: "t2" }, "t");
		const unread = await drainUnreadMessages("backend", "t");
		expect(unread.map((m) => m.text)).toEqual(["hello", "again"]);
		expect(await drainUnreadMessages("backend", "t")).toEqual([]);

		const block = formatMailboxAttachment([{ from: "team-lead", text: "hi", timestamp: "t3", read: false }]);
		expect(block).toContain("<teammate-message");
		expect(block).toContain("hi");
	});

	it("markMessagesAsRead flips read flags", async () => {
		await writeToMailbox("backend", { from: "team-lead", text: "x", timestamp: "t" }, "t");
		const before = await readMailbox("backend", "t");
		expect(before[0]?.read).toBe(false);
		await markMessagesAsRead("backend", "t");
		expect((await readMailbox("backend", "t"))[0]?.read).toBe(true);
	});

	it("serializes concurrent writers without dropping messages", async () => {
		// Regression guard for the keyed mailbox mutex: interleaved
		// read-modify-write cycles must not lose messages (e.g. a SendMessage
		// landing while a running teammate drains its inbox).
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				writeToMailbox("busy", { from: `sender-${i}`, text: `m${i}`, timestamp: "t" }, "t"),
			),
		);
		const inbox = await readMailbox("busy", "t");
		expect(inbox).toHaveLength(20);
		const unread = await drainUnreadMessages("busy", "t");
		expect(unread).toHaveLength(20);
		expect(await drainUnreadMessages("busy", "t")).toEqual([]);
	});
});

describe("team tools", () => {
	it("TeamCreate then double-create errors", async () => {
		const create = createTeamCreateTool();
		await create.execute("call", { team_name: "refactor-auth" });
		expect(getActiveTeam()?.teamName).toBe("refactor-auth");
		await expect(create.execute("call", { team_name: "other" })).rejects.toThrow(/already leading/);
	});

	it("SendMessage delivers to a named teammate; broadcast hits the rest", async () => {
		const create = createTeamCreateTool();
		const send = createSendMessageTool();
		await create.execute("call", { team_name: "t" });
		await addTeamMember("t", { agentId: "backend@t", name: "backend", joinedAt: 2, isActive: true });
		await addTeamMember("t", { agentId: "reviewer@t", name: "reviewer", joinedAt: 2, isActive: true });

		await send.execute("call", { to: "backend", message: "go build the API" });
		expect((await drainUnreadMessages("backend", "t")).map((m) => m.from)).toEqual([TEAM_LEAD_NAME]);

		await send.execute("call", { to: "*", message: "all hands" });
		const backend = await drainUnreadMessages("backend", "t");
		const reviewer = await drainUnreadMessages("reviewer", "t");
		expect(backend.map((m) => m.text)).toEqual(["all hands"]);
		expect(reviewer.map((m) => m.text)).toEqual(["all hands"]);
	});

	it("SendMessage errors on unknown recipient and self-send", async () => {
		const create = createTeamCreateTool();
		await create.execute("call", { team_name: "t" });
		const send = createSendMessageTool();
		await expect(send.execute("call", { to: "ghost", message: "hi" })).rejects.toThrow(/No teammate named/);
		await expect(send.execute("call", { to: TEAM_LEAD_NAME, message: "hi" })).rejects.toThrow(/yourself/);
	});

	it("a teammate's SendMessage carries the teammate as sender", async () => {
		const create = createTeamCreateTool();
		await create.execute("call", { team_name: "t" });
		await addTeamMember("t", { agentId: "backend@t", name: "backend", joinedAt: 2, isActive: true });

		const teammateSend = createSendMessageTool("backend");
		await teammateSend.execute("call", { to: TEAM_LEAD_NAME, message: "done" });
		expect((await drainUnreadMessages(TEAM_LEAD_NAME, "t")).map((m) => m.from)).toEqual(["backend"]);
	});

	it("TeamDelete refuses while a teammate is active, then succeeds", async () => {
		const create = createTeamCreateTool();
		const del = createTeamDeleteTool();
		await create.execute("call", { team_name: "t" });
		await addTeamMember("t", { agentId: "backend@t", name: "backend", joinedAt: 2, isActive: true });

		await expect(del.execute("call", {})).rejects.toThrow(/still active/);

		await setMemberActive("t", "backend", false);
		await del.execute("call", {});
		expect(getActiveTeam()).toBeNull();
		expect(await readTeamFile("t")).toBeNull();
	});
});
