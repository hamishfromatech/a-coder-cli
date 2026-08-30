export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";

import { createAskUserQuestionTool, createAskUserQuestionToolDefinition } from "./ask-user-question.ts";
import {
	createTaskCreateTool,
	createTaskCreateToolDefinition,
	createTaskGetTool,
	createTaskGetToolDefinition,
	createTaskListTool,
	createTaskListToolDefinition,
	createTaskUpdateTool,
	createTaskUpdateToolDefinition,
} from "./tasks.ts";
import {
	createSendMessageTool,
	createSendMessageToolDefinition,
	createTeamCreateTool,
	createTeamCreateToolDefinition,
	createTeamDeleteTool,
	createTeamDeleteToolDefinition,
} from "./teams.ts";
import { createTodoTool, createTodoToolDefinition } from "./todo.ts";

export {
	createMemoryTool,
	createMemoryToolDefinition,
	type MemoryToolInput,
} from "./memory.ts";
export {
	createPlanModeTool,
	createPlanModeToolDefinition,
	type PlanModeToolCallbacks,
	type PlanModeToolDetails,
	type PlanModeToolInput,
} from "./plan-mode.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createMemoryTool, createMemoryToolDefinition } from "./memory.ts";
import { createPlanModeTool, createPlanModeToolDefinition, type PlanModeToolCallbacks } from "./plan-mode.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import { createSkillTool, createSkillToolDefinition, type SkillToolOptions } from "./skill.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName =
	| "skill"
	| "read"
	| "bash"
	| "edit"
	| "write"
	| "grep"
	| "find"
	| "ls"
	| "todo"
	| "ask_user_question"
	| "task_create"
	| "task_get"
	| "task_list"
	| "task_update"
	| "memory"
	| "plan_mode"
	| "team_create"
	| "team_delete"
	| "send_message";
export const allToolNames: Set<ToolName> = new Set([
	"skill",
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"todo",
	"ask_user_question",
	"task_create",
	"task_get",
	"task_list",
	"task_update",
	"memory",
	"plan_mode",
	"team_create",
	"team_delete",
	"send_message",
]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	planMode?: { callbacks: PlanModeToolCallbacks };
	memory?: { sessionDir: string; sessionId: string };
	skill?: SkillToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	switch (toolName) {
		case "skill":
			return createSkillToolDefinition(options?.skill ?? { getSkills: () => [] });
		case "read":
			return createReadToolDefinition(cwd, options?.read);
		case "bash":
			return createBashToolDefinition(cwd, options?.bash);
		case "edit":
			return createEditToolDefinition(cwd, options?.edit);
		case "write":
			return createWriteToolDefinition(cwd, options?.write);
		case "grep":
			return createGrepToolDefinition(cwd, options?.grep);
		case "find":
			return createFindToolDefinition(cwd, options?.find);
		case "ls":
			return createLsToolDefinition(cwd, options?.ls);
		case "memory":
			return createMemoryToolDefinition();
		case "plan_mode":
			return createPlanModeToolDefinition(
				options?.planMode?.callbacks ?? { getPlanMode: () => false, setPlanMode: () => {} },
			);
		case "todo":
			return createTodoToolDefinition();
		case "ask_user_question":
			return createAskUserQuestionToolDefinition();
		case "task_create":
			return createTaskCreateToolDefinition();
		case "task_get":
			return createTaskGetToolDefinition();
		case "task_list":
			return createTaskListToolDefinition();
		case "task_update":
			return createTaskUpdateToolDefinition();
		case "team_create":
			return createTeamCreateToolDefinition();
		case "team_delete":
			return createTeamDeleteToolDefinition();
		case "send_message":
			return createSendMessageToolDefinition();
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	switch (toolName) {
		case "read":
			return createReadTool(cwd, options?.read);
		case "bash":
			return createBashTool(cwd, options?.bash);
		case "edit":
			return createEditTool(cwd, options?.edit);
		case "write":
			return createWriteTool(cwd, options?.write);
		case "grep":
			return createGrepTool(cwd, options?.grep);
		case "find":
			return createFindTool(cwd, options?.find);
		case "ls":
			return createLsTool(cwd, options?.ls);
		case "memory":
			return createMemoryTool(options?.memory);
		case "plan_mode":
			return createPlanModeTool(options?.planMode?.callbacks ?? { getPlanMode: () => false, setPlanMode: () => {} });
		case "todo":
			return createTodoTool();
		case "ask_user_question":
			return createAskUserQuestionTool();
		case "task_create":
			return createTaskCreateTool();
		case "task_get":
			return createTaskGetTool();
		case "task_list":
			return createTaskListTool();
		case "task_update":
			return createTaskUpdateTool();
		case "team_create":
			return createTeamCreateTool();
		case "team_delete":
			return createTeamDeleteTool();
		case "send_message":
			return createSendMessageTool();
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd, options?.edit),
		createWriteToolDefinition(cwd, options?.write),
		createPlanModeToolDefinition(options?.planMode?.callbacks ?? { getPlanMode: () => false, setPlanMode: () => {} }),
		createTodoToolDefinition(),
		createAskUserQuestionToolDefinition(),
		createTaskCreateToolDefinition(),
		createTaskGetToolDefinition(),
		createTaskListToolDefinition(),
		createTaskUpdateToolDefinition(),
		createMemoryToolDefinition(),
		createTeamCreateToolDefinition(),
		createTeamDeleteToolDefinition(),
		createSendMessageToolDefinition(),
	];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
		createMemoryToolDefinition(),
	];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		skill: createSkillToolDefinition(options?.skill ?? { getSkills: () => [] }),
		read: createReadToolDefinition(cwd, options?.read),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd, options?.edit),
		write: createWriteToolDefinition(cwd, options?.write),
		grep: createGrepToolDefinition(cwd, options?.grep),
		find: createFindToolDefinition(cwd, options?.find),
		ls: createLsToolDefinition(cwd, options?.ls),
		plan_mode: createPlanModeToolDefinition(
			options?.planMode?.callbacks ?? { getPlanMode: () => false, setPlanMode: () => {} },
		),
		todo: createTodoToolDefinition(),
		ask_user_question: createAskUserQuestionToolDefinition(),
		task_create: createTaskCreateToolDefinition(),
		task_get: createTaskGetToolDefinition(),
		task_list: createTaskListToolDefinition(),
		task_update: createTaskUpdateToolDefinition(),
		memory: createMemoryToolDefinition(),
		team_create: createTeamCreateToolDefinition(),
		team_delete: createTeamDeleteToolDefinition(),
		send_message: createSendMessageToolDefinition(),
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
		createPlanModeTool(options?.planMode?.callbacks ?? { getPlanMode: () => false, setPlanMode: () => {} }),
		createTodoTool(),
		createAskUserQuestionTool(),
		createTaskCreateTool(),
		createTaskGetTool(),
		createTaskListTool(),
		createTaskUpdateTool(),
		createMemoryTool(options?.memory),
		createTeamCreateTool(),
		createTeamDeleteTool(),
		createSendMessageTool(),
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
		createMemoryTool(options?.memory),
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd, options?.edit),
		write: createWriteTool(cwd, options?.write),
		grep: createGrepTool(cwd, options?.grep),
		find: createFindTool(cwd, options?.find),
		ls: createLsTool(cwd, options?.ls),
		plan_mode: createPlanModeTool(
			options?.planMode?.callbacks ?? { getPlanMode: () => false, setPlanMode: () => {} },
		),
		todo: createTodoTool(),
		ask_user_question: createAskUserQuestionTool(),
		task_create: createTaskCreateTool(),
		task_get: createTaskGetTool(),
		task_list: createTaskListTool(),
		task_update: createTaskUpdateTool(),
		memory: createMemoryTool(options?.memory),
		skill: createSkillTool(options?.skill ?? { getSkills: () => [] }),
		team_create: createTeamCreateTool(),
		team_delete: createTeamDeleteTool(),
		send_message: createSendMessageTool(),
	};
}

export {
	clearToolRendererOverrides,
	getToolRendererOverride,
	registerToolRendererOverride,
	subscribeToolRendererOverrides,
	type ToolRendererOverride,
	unregisterToolRendererOverride,
} from "./tool-renderer-registry.ts";
