/**
 * Agent Teams built-in tools: TeamCreate, TeamDelete, SendMessage.
 *
 * Ports easy-agent stage 21's team toolchain into pi-mono. The three tools are
 * always-on built-ins: when no team is active they error with guidance, so they
 * are inert until TeamCreate is called. `createSendMessageTool` takes an
 * optional `teammateName` so the runner can build identity-captured instances
 * for teammates (sender = the teammate) vs. the lead (sender = "team-lead").
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { writeToMailbox } from "../teams/mailbox.ts";
import { clearActiveTeam, getActiveTeam, setActiveTeam } from "../teams/team-context.ts";
import {
	cleanupTeamDirectory,
	formatAgentId,
	getTeamFilePath,
	readTeamFile,
	sanitizeName,
	TEAM_LEAD_NAME,
	type TeamFile,
	writeTeamFile,
} from "../teams/team-file.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

interface TeamToolDetails {
	teamName?: string;
	message?: string;
	recipients?: string[];
}

const TEAM_CREATE_SCHEMA = Type.Object(
	{
		team_name: Type.String({
			minLength: 1,
			description:
				'Short human-readable team name (e.g. "refactor-auth"). Sanitized to lowercase alphanumeric + hyphen for the on-disk directory.',
		}),
		description: Type.Optional(
			Type.String({ description: "Optional 1-2 sentence summary of what the team is for." }),
		),
	},
	{ additionalProperties: false },
);

export type TeamCreateInput = Static<typeof TEAM_CREATE_SCHEMA>;

const TEAM_DELETE_SCHEMA = Type.Object({}, { additionalProperties: false });

const SEND_MESSAGE_SCHEMA = Type.Object(
	{
		to: Type.String({
			minLength: 1,
			description:
				'Recipient teammate name (the `name` you passed to Agent({ name, ... })), "team-lead" for the lead, or "*" to broadcast to every active teammate other than yourself.',
		}),
		message: Type.String({
			minLength: 1,
			description: "Plain text body. Treated as user-side context by the recipient.",
		}),
		summary: Type.Optional(
			Type.String({ description: "Optional 5-10 word preview shown alongside the full message." }),
		),
	},
	{ additionalProperties: false },
);

export type SendMessageInput = Static<typeof SEND_MESSAGE_SCHEMA>;

function textResult(text: string, details?: TeamToolDetails) {
	return { content: [{ type: "text" as const, text }], details };
}

function requireActiveTeam(): NonNullable<ReturnType<typeof getActiveTeam>> {
	const active = getActiveTeam();
	if (!active) {
		throw new Error("No team is active. Call team_create first.");
	}
	return active;
}

/** Build the lead's TeamCreate tool. */
export function createTeamCreateToolDefinition(): ToolDefinition<
	typeof TEAM_CREATE_SCHEMA,
	TeamToolDetails | undefined
> {
	return {
		name: "team_create",
		label: "Team Create",
		description:
			"Spin up a new Agent Teams session; the current agent becomes the team lead. After this you can spawn named teammates via Agent({ name, team_name, ... }) and message them with send_message. Only ONE team can be active at a time — call team_delete first to start over. Use this when the task splits naturally into long-running parallel roles; for a single short subtask prefer plain Agent(...) without a team.",
		promptSnippet: "Start or manage an Agent Teams session",
		parameters: TEAM_CREATE_SCHEMA,
		async execute(_toolCallId, input: TeamCreateInput) {
			const teamName = input.team_name.trim();
			if (!teamName) {
				throw new Error("'team_name' is required and must be a non-empty string.");
			}

			const active = getActiveTeam();
			if (active) {
				throw new Error(
					`This session is already leading team "${active.teamName}". Call team_delete first to disband it.`,
				);
			}

			const sanitized = sanitizeName(teamName);
			if (!sanitized) {
				throw new Error("'team_name' sanitizes to an empty string. Use letters / digits / hyphens.");
			}

			const existing = await readTeamFile(teamName);
			if (existing) {
				throw new Error(
					`Team "${teamName}" already exists on disk (${getTeamFilePath(teamName)}). Pick a different name, or delete the previous one first.`,
				);
			}

			const leadAgentId = formatAgentId(TEAM_LEAD_NAME, teamName);
			const createdAt = Date.now();
			const file: TeamFile = {
				name: teamName,
				...(input.description ? { description: input.description.trim() } : {}),
				createdAt,
				leadAgentId,
				members: [
					{
						agentId: leadAgentId,
						name: TEAM_LEAD_NAME,
						agentType: "team-lead",
						joinedAt: createdAt,
						isActive: true,
					},
				],
			};
			const teamFilePath = getTeamFilePath(teamName);
			await writeTeamFile(teamName, file);
			setActiveTeam({ teamName, leadAgentId, teamFilePath, createdAt });

			const lines = [
				`Team "${teamName}" created. You are the lead (${leadAgentId}).`,
				`team_file: ${teamFilePath}`,
				"",
				'Spawn a named teammate with: Agent({ subagent_type: "<type>", name: "<short-name>", team_name: "' +
					teamName +
					'", prompt: "..." }).',
				'Message a teammate with: send_message({ to: "<short-name>", message: "..." }) — or to: "*" to broadcast.',
				"When the mission is done, call team_delete().",
			];
			return textResult(lines.join("\n"), { teamName });
		},
	};
}

export function createTeamCreateTool(): AgentTool<typeof TEAM_CREATE_SCHEMA> {
	return wrapToolDefinition(createTeamCreateToolDefinition());
}

/** Build the lead's TeamDelete tool. */
export function createTeamDeleteToolDefinition(): ToolDefinition<
	typeof TEAM_DELETE_SCHEMA,
	TeamToolDetails | undefined
> {
	return {
		name: "team_delete",
		label: "Team Delete",
		description:
			"Disband the currently active Agent Teams session: removes the on-disk team file and every teammate's inbox. Refuses while any teammate is still active — finish or interrupt their work first. Returns the session to single-agent mode.",
		promptSnippet: "Disband the active Agent Teams session",
		parameters: TEAM_DELETE_SCHEMA,
		async execute() {
			const active = requireActiveTeam();

			const file = await readTeamFile(active.teamName);
			if (!file) {
				clearActiveTeam();
				return textResult(
					`Team "${active.teamName}" was already missing on disk. Cleared the in-process team context.`,
				);
			}

			const activeTeammates = file.members.filter((m) => m.name !== TEAM_LEAD_NAME && m.isActive);
			if (activeTeammates.length > 0) {
				const names = activeTeammates.map((m) => m.name).join(", ");
				throw new Error(
					`Cannot delete team "${active.teamName}" — ${activeTeammates.length} teammate(s) still active: ${names}. Wait for them to finish, or message them to wrap up.`,
				);
			}

			// Dirty worktrees are intentionally preserved — surface a pointer so
			// the user can review them. (Clean ones were removed by the runner's
			// finalizer at teammate completion.)
			const preserved = file.members.filter((m) => m.worktreePath).map((m) => m.worktreePath);

			await cleanupTeamDirectory(active.teamName);
			clearActiveTeam();

			const lines = [
				`Team "${active.teamName}" disbanded. Removed team file and inboxes.`,
				preserved.length > 0
					? `Preserved worktrees to review manually:\n${preserved.map((p) => `  - ${p}`).join("\n")}`
					: "",
			];
			return textResult(lines.filter(Boolean).join("\n"));
		},
	};
}

export function createTeamDeleteTool(): AgentTool<typeof TEAM_DELETE_SCHEMA> {
	return wrapToolDefinition(createTeamDeleteToolDefinition());
}

/**
 * Build a SendMessage tool. `teammateName` is the sender's `name` when the
 * tool is exercised inside a teammate; omit it for the lead (sender becomes
 * "team-lead").
 */
export function createSendMessageToolDefinition(
	teammateName?: string,
): ToolDefinition<typeof SEND_MESSAGE_SCHEMA, TeamToolDetails | undefined> {
	return {
		name: "send_message",
		label: "Send Message",
		description:
			'Send a plain-text message to another teammate\'s inbox in the active Agent Teams session. The recipient sees it as a <teammate-message> context block at the start of their next turn. Use to: "*" to broadcast to every other active teammate. Errors if no team is active — call team_create first.',
		promptSnippet: "Message a teammate in the active Agent Teams session",
		parameters: SEND_MESSAGE_SCHEMA,
		async execute(_toolCallId, input: SendMessageInput) {
			const to = input.to.trim();
			const message = input.message.trim();
			if (!to) {
				throw new Error("'to' is required (teammate name or '*').");
			}
			if (!message) {
				throw new Error("'message' is required and must be non-empty.");
			}

			const active = requireActiveTeam();
			const teamFile = await readTeamFile(active.teamName);
			if (!teamFile) {
				throw new Error(`Team "${active.teamName}" is registered in-process but the team file is missing.`);
			}

			const senderName = teammateName ?? TEAM_LEAD_NAME;
			const timestamp = new Date().toISOString();

			const deliver = (recipientName: string) =>
				writeToMailbox(
					recipientName,
					{
						from: senderName,
						text: message,
						timestamp,
						...(input.summary ? { summary: input.summary.trim() } : {}),
					},
					active.teamName,
				);

			if (to === "*") {
				const recipients = teamFile.members.filter((m) => m.isActive && m.name !== senderName);
				if (recipients.length === 0) {
					return textResult("No active teammates to broadcast to (you're the only active member).");
				}
				for (const r of recipients) {
					await deliver(r.name);
				}
				return textResult(
					`Broadcast message to ${recipients.length} teammate(s): ${recipients.map((r) => r.name).join(", ")}.`,
					{ recipients: recipients.map((r) => r.name) },
				);
			}

			const recipient = teamFile.members.find((m) => m.name === to);
			if (!recipient) {
				const known = teamFile.members.map((m) => m.name).join(", ");
				throw new Error(`No teammate named "${to}" in team "${active.teamName}". Known members: ${known}.`);
			}
			if (to === senderName) {
				throw new Error(`Cannot message yourself ("${to}").`);
			}

			await deliver(recipient.name);

			const offlineHint = recipient.isActive
				? ""
				: ` (note: "${to}" is not currently active — the message sits in their inbox until they are respawned.)`;
			return textResult(`Message delivered to "${to}"'s inbox in team "${active.teamName}".${offlineHint}`, {
				message,
				recipients: [recipient.name],
			});
		},
	};
}

export function createSendMessageTool(teammateName?: string): AgentTool<typeof SEND_MESSAGE_SCHEMA> {
	return wrapToolDefinition(createSendMessageToolDefinition(teammateName));
}
