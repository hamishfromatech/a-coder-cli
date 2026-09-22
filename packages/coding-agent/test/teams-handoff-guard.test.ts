import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_TEAMS_DIR } from "../src/config.ts";
import { HandoffGuard } from "../src/core/teams/handoff-guard.ts";
import { clearActiveTeam, getActiveTeam } from "../src/core/teams/team-context.ts";
import { addTeamMember, TEAM_LEAD_NAME } from "../src/core/teams/team-file.ts";
import { createSendMessageTool, createTeamCreateTool } from "../src/core/tools/teams.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "a-coder-handoff-"));
	process.env[ENV_TEAMS_DIR] = dir;
	clearActiveTeam();
});

afterEach(async () => {
	delete process.env[ENV_TEAMS_DIR];
	clearActiveTeam();
	await rm(dir, { recursive: true, force: true });
});

describe("HandoffGuard", () => {
	it("stays quiet until the window fills with few unique pairs", () => {
		const guard = new HandoffGuard();
		// 7 alternating messages: window not yet full.
		for (let i = 0; i < 7; i++) {
			expect(guard.record("lead", "backend")).toBeUndefined();
		}
		// 8th fills the window: 1 unique pair out of the last 8.
		const advisory = guard.record("backend", "lead");
		expect(advisory).toContain("Repetitive handoff detected");
		expect(advisory).toContain("lead->backend");
	});

	it("fires once when entering the repetitive state, not on every message", () => {
		const guard = new HandoffGuard();
		for (let i = 0; i < 7; i++) guard.record("lead", "backend");
		expect(guard.record("backend", "lead")).toBeDefined();
		expect(guard.record("lead", "backend")).toBeUndefined();
		expect(guard.record("backend", "lead")).toBeUndefined();
	});

	it("clears the state when a third distinct pair joins", () => {
		const guard = new HandoffGuard();
		for (let i = 0; i < 7; i++) guard.record("lead", "backend");
		expect(guard.record("backend", "lead")).toBeDefined();

		// Rotate so the window now contains 3 distinct pairs.
		for (const [from, to] of [
			["lead", "backend"],
			["backend", "reviewer"],
			["reviewer", "lead"],
			["lead", "reviewer"],
		] as const) {
			guard.record(from, to);
		}
		for (let i = 0; i < 5; i++) {
			expect(guard.record("lead", "backend")).toBeUndefined();
		}
		// Window full again but the state was cleared by healthy traffic; the next
		// degenerate window re-arms the advisory.
		let refired: string | undefined;
		for (let i = 0; i < 8; i++) {
			refired = guard.record("lead", "backend") ?? refired;
		}
		expect(refired).toContain("Repetitive handoff detected");
	});

	it("reset() clears history and state", () => {
		const guard = new HandoffGuard();
		for (let i = 0; i < 8; i++) guard.record("lead", "backend");
		guard.reset();
		expect(guard.snapshot()).toEqual([]);
		for (let i = 0; i < 7; i++) guard.record("lead", "backend");
		// Window not yet full after reset: quiet.
		expect(guard.record("backend", "lead")).toContain("Repetitive handoff detected");
	});
});

describe("send_message handoff advisory", () => {
	it("appends the advisory once the lead/teammate exchange turns into ping-pong", async () => {
		const create = createTeamCreateTool();
		await create.execute("call", { team_name: "t" });
		await addTeamMember("t", { agentId: "backend@t", name: "backend", joinedAt: 2, isActive: true });

		let advisory: string | undefined;
		for (let i = 0; i < 8; i++) {
			const from = i % 2 === 0 ? TEAM_LEAD_NAME : "backend";
			const sender = createSendMessageTool(from === TEAM_LEAD_NAME ? undefined : "backend");
			const result = await sender.execute("call", {
				to: from === TEAM_LEAD_NAME ? "backend" : TEAM_LEAD_NAME,
				message: `ping ${i}`,
			});
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			if (text.includes("Repetitive handoff detected")) advisory = text;
		}

		expect(advisory).toContain("Repetitive handoff detected");
		expect(advisory).toContain("lead->backend");
		expect(getActiveTeam()?.handoffGuard.snapshot().length).toBe(8);
	});
});
