/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from '@google/genai';
import { BaseTool, ToolResult, ToolCallConfirmationDetails } from './tools.js';
import {
  SubagentConfig,
  SubagentResult,
  DEFAULT_SUBAGENT_CONFIG,
  BUILTIN_AGENTS,
  BuiltinAgentType,
  DESTRUCTIVE_TOOLS,
  IsolationMode,
} from './subagent-types.js';
import { AgentDefinition } from '../agents/types.js';
import { getSubagentManager } from '../services/subagentManager.js';
import { getAgentRegistry } from '../agents/registry.js';
import { randomUUID } from 'crypto';

/**
 * Parameters for the SubagentTool
 */
export interface SubagentToolParams {
  /** The task description for the subagent to accomplish */
  task: string;

  /** Agent type to use (built-in: 'general-purpose', 'Explore', 'Plan', or custom agent name) */
  subagent_type?: BuiltinAgentType | string;

  /** Short description (3-5 words) for the subagent */
  description?: string;

  /** Working directory for the subagent (defaults to project root) */
  workingDir?: string;

  /** Relevant context to provide to the subagent */
  context?: string;

  /** Specific files to include in context */
  contextFiles?: string[];

  /** Subset of tool names to allow */
  allowedTools?: string[];

  /** Tools to explicitly block for this subagent */
  disallowedTools?: string[];

  /** Maximum execution time in milliseconds */
  timeout?: number;

  /** Model to use for the subagent */
  model?: string;

  /** Whether to allow destructive tools (edit, write_file, shell) */
  allowDestructive?: boolean;

  /** Run the subagent in the background (returns task ID immediately) */
  run_in_background?: boolean;

  /** Isolation mode: 'worktree' creates a git worktree for isolated file operations */
  isolation?: IsolationMode;
}

/**
 * Tool for spawning subagents to handle specialized tasks
 */
export class SubagentTool extends BaseTool<SubagentToolParams, ToolResult> {
  private sessionId: string;

  constructor(sessionId: string) {
    super(
      'subagent',
      'Agent',
      `Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- Explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- statusline-setup: Use this agent to configure the user's Claude Code status line setting. (Tools: Read, Edit)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)

When NOT to use the Agent tool:
- If you want to read a specific file path, use the Read tool or the Glob tool instead of the Agent tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead of the Agent tool, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Agent tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above


Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. You should show the user a concise summary of the result.
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed — e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.
- To continue a previously spawned agent, use SendMessage with the agent's ID or name as the \`to\` field. The agent resumes with its full context preserved. Each Agent invocation starts fresh — provide a complete task description.
- Provide clear, detailed prompts so the agent can work autonomously and return exactly the information you need.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Agent tool use content blocks. For example, if you need to launch both a build-validator agent and a test-runner agent in parallel, send a single message with both tool calls.

Example usage:
\`\`\`
<example_agent_descriptions>
"test-runner": use this agent after you are done writing code to run tests
"greeting-responder": use this agent to respond to user greetings with a friendly joke
</example_agent_descriptions>

user: "Please write a function that checks if a number is prime"
assistant: I'm going to use the Write tool to write the following code:
\`\`\`function isPrime(n) {
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false
  }
  return true
}
\`\`\`
commentary: Since a significant piece of code was written and the task was completed, now use the test-runner agent to run the tests
assistant: Uses the Agent tool to launch the test-runner agent
<example>`,
      {
        type: Type.OBJECT,
        properties: {
          task: {
            type: Type.STRING,
            description:
              'A short (3-5 word) description of what the agent will do',
          },
          subagent_type: {
            type: Type.STRING,
            description:
              'The type of specialized agent to use. If omitted, the general-purpose agent is used. Available types: "general-purpose" (default), "Explore" (fast codebase search), "Plan" (implementation planning), or a custom agent name.',
          },
          description: {
            type: Type.STRING,
            description:
              'A short (3-5 word) description summarizing what the agent will do',
          },
          prompt: {
            type: Type.STRING,
            description:
              'The task for the agent to perform. Be specific and include relevant details. Good: "How to set up authentication with JWT in Express.js". Bad: "auth" or "hooks".',
          },
          workingDir: {
            type: Type.STRING,
            description:
              'Working directory for the subagent. Defaults to the current project root.',
          },
          context: {
            type: Type.STRING,
            description:
              'Additional context to provide to the subagent. Include relevant background information, constraints, or requirements.',
          },
          contextFiles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'List of file paths to include in the subagent context. Use glob patterns or specific paths.',
          },
          allowedTools: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'List of tool names the subagent can use. Defaults to read-only tools: read_file, glob, grep, list_directory, web_fetch, web_search.',
          },
          disallowedTools: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'List of tool names to explicitly block for this subagent. Use to restrict destructive operations.',
          },
          timeout: {
            type: Type.NUMBER,
            description:
              'Maximum execution time in milliseconds. Default: 300000 (5 minutes). Maximum: 600000 (10 minutes).',
          },
          model: {
            type: Type.STRING,
            description:
              'Specific model to use for the subagent. Defaults to the same model as the main agent. Options: "haiku" (fast, cheap), "sonnet" (balanced), "opus" (most capable), "inherit" (same as parent).',
          },
          allowDestructive: {
            type: Type.BOOLEAN,
            description:
              'Allow the subagent to use destructive tools (edit, write_file, shell). Default: false. Use with caution.',
          },
          run_in_background: {
            type: Type.BOOLEAN,
            description:
              'Set to true to run this agent in the background. Use for genuinely independent work that can proceed in parallel. You will be notified when it completes.',
          },
          isolation: {
            type: Type.STRING,
            description:
              'Isolation mode. Use "worktree" to create a temporary git worktree for isolated file operations. Automatically cleaned up when done.',
          },
        },
        required: ['prompt'],
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );

    this.sessionId = sessionId;
  }

  /**
   * Validate the parameters
   */
  override validateToolParams(params: SubagentToolParams): string | null {
    if (!params.task || params.task.trim().length === 0) {
      return 'Task description is required';
    }

    if (params.timeout) {
      if (params.timeout < 1000) {
        return 'Timeout must be at least 1000ms (1 second)';
      }
      if (params.timeout > 600000) {
        return 'Timeout cannot exceed 600000ms (10 minutes)';
      }
    }

    if (params.allowedTools && params.allowedTools.length === 0) {
      return 'If specified, allowedTools must contain at least one tool';
    }

    if (params.isolation && params.isolation !== 'worktree') {
      return 'Isolation must be "worktree" or undefined';
    }

    // Validate agent type
    if (params.subagent_type) {
      const builtinTypes = Object.keys(BUILTIN_AGENTS) as BuiltinAgentType[];
      if (!builtinTypes.includes(params.subagent_type as BuiltinAgentType)) {
        // Could be a custom agent - we'll check the registry later
        // For now, just validate it's a non-empty string
        if (typeof params.subagent_type !== 'string' || params.subagent_type.trim().length === 0) {
          return 'subagent_type must be a non-empty string';
        }
      }
    }

    return null;
  }

  /**
   * Get a description of what this tool will do
   */
  override getDescription(params: SubagentToolParams): string {
    const agentType = params.subagent_type || 'general-purpose';
    const agentConfig = BUILTIN_AGENTS[agentType as BuiltinAgentType];
    const agentName = agentConfig?.name || agentType;

    let desc = `Spawning ${agentName} agent`;

    if (params.description) {
      desc += ` to ${params.description}`;
    } else {
      desc += `: ${params.task.substring(0, 100)}${params.task.length > 100 ? '...' : ''}`;
    }

    if (params.isolation === 'worktree') {
      desc += '\n📁 Using isolated worktree';
    }

    if (params.run_in_background) {
      desc += '\n⏳ Running in background';
    }

    if (params.allowDestructive) {
      desc += '\n⚠️ Destructive operations allowed';
    }

    if (params.allowedTools && params.allowedTools.length > 0) {
      desc += `\nTools: ${params.allowedTools.join(', ')}`;
    }

    if (params.disallowedTools && params.disallowedTools.length > 0) {
      desc += `\nBlocked tools: ${params.disallowedTools.join(', ')}`;
    }

    if (params.timeout) {
      desc += `\nTimeout: ${Math.round(params.timeout / 1000)}s`;
    }

    return desc;
  }

  /**
   * Determine if confirmation is needed
   */
  override async shouldConfirmExecute(
    params: SubagentToolParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // Require confirmation for destructive operations or worktree isolation
    if (params.allowDestructive) {
      return {
        type: 'exec',
        title: 'Spawn Agent with Destructive Tools',
        command: `agent --allow-destructive --task "${params.task.substring(0, 50)}..."`,
        rootCommand: 'agent',
        onConfirm: async () => {
          // Confirmation handled by the UI
        },
      };
    }

    if (params.isolation === 'worktree') {
      return {
        type: 'exec',
        title: 'Spawn Agent in Isolated Worktree',
        command: `agent --isolation worktree --task "${params.task.substring(0, 50)}..."`,
        rootCommand: 'agent',
        onConfirm: async () => {
          // Confirmation handled by the UI
        },
      };
    }

    // No confirmation needed for read-only operations
    return false;
  }

  /**
   * Resolve agent type to agent definition
   */
  private async resolveAgentType(
    agentType: string | undefined,
  ): Promise<{ definition: AgentDefinition | null; isBuiltin: boolean }> {
    const type = agentType || 'general-purpose';

    // Check if it's a built-in agent
    if (type in BUILTIN_AGENTS) {
      const config = BUILTIN_AGENTS[type as BuiltinAgentType];
      return {
        definition: {
          id: type,
          name: config.name,
          description: config.description,
          model: config.model,
          color: config.color,
          allowedTools: config.allowedTools,
          disallowedTools: config.disallowedTools,
          systemPrompt: config.systemPrompt,
          source: 'builtin', // AgentSource.BUILTIN
        },
        isBuiltin: true,
      };
    }

    // Check if it's a custom agent
    try {
      const registry = getAgentRegistry();
      const customAgent = await registry.getAgent(type);
      return { definition: customAgent, isBuiltin: false };
    } catch {
      // Agent not found, use general-purpose defaults
      return { definition: null, isBuiltin: false };
    }
  }

  /**
   * Execute the subagent
   */
  override async execute(
    params: SubagentToolParams,
    signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        summary: 'Invalid parameters',
        llmContent: `Error: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
      };
    }

    // Resolve agent type
    const { definition: agentDef } = await this.resolveAgentType(params.subagent_type);

    // Build the subagent config
    const config: SubagentConfig = {
      id: randomUUID(),
      task: params.task,
      agentType: params.subagent_type,
      description: params.description,
      workingDir: params.workingDir,
      context: params.context,
      contextFiles: params.contextFiles,
      timeout: Math.min(
        params.timeout || DEFAULT_SUBAGENT_CONFIG.defaultTimeout,
        600000,
      ),
      model: params.model || agentDef?.model,
      allowDestructive: params.allowDestructive || false,
      runInBackground: params.run_in_background || false,
      isolation: params.isolation,
      parentSessionId: this.sessionId,
      abortSignal: signal,
    };

    // Determine allowed/disallowed tools based on agent type and params
    config.allowedTools = this.resolveAllowedTools(params, agentDef);
    config.disallowedTools = this.resolveDisallowedTools(params, agentDef);

    try {
      const manager = getSubagentManager();

      // Handle background execution
      if (params.run_in_background) {
        const taskId = manager.spawnSubagentBackground(config);
        return {
          summary: `Background agent spawned (ID: ${taskId})`,
          llmContent: `Background agent started with ID: ${taskId}.\n\nThe agent is working on: ${params.task}\n\nYou will be notified when it completes. Use TaskOutput with the task ID to retrieve results.`,
          returnDisplay: `Background task ID: ${taskId}`,
        };
      }

      // Foreground execution
      const result = await manager.spawnSubagent(config);
      return this.formatResult(result, agentDef);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        summary: 'Failed to spawn agent',
        llmContent: `Error spawning agent: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  /**
   * Resolve allowed tools from params and agent definition
   */
  private resolveAllowedTools(
    params: SubagentToolParams,
    agentDef: AgentDefinition | null,
  ): string[] {
    // Priority: params > agent definition > defaults
    if (params.allowedTools && params.allowedTools.length > 0) {
      return params.allowedTools;
    }

    if (agentDef?.allowedTools && agentDef.allowedTools.length > 0) {
      // Check for wildcard
      if (agentDef.allowedTools.includes('*')) {
        return ['*']; // All tools allowed
      }
      return agentDef.allowedTools;
    }

    return DEFAULT_SUBAGENT_CONFIG.allowedTools;
  }

  /**
   * Resolve disallowed tools from params and agent definition
   */
  private resolveDisallowedTools(
    params: SubagentToolParams,
    agentDef: AgentDefinition | null,
  ): string[] {
    const disallowed: string[] = [];

    // Add from agent definition
    if (agentDef?.disallowedTools) {
      disallowed.push(...agentDef.disallowedTools);
    }

    // Add from params
    if (params.disallowedTools) {
      disallowed.push(...params.disallowedTools);
    }

    // If not allowing destructive, add destructive tools to disallowed
    if (!params.allowDestructive) {
      disallowed.push(...DESTRUCTIVE_TOOLS);
    }

    // Add from config defaults
    if (DEFAULT_SUBAGENT_CONFIG.disallowedTools) {
      disallowed.push(...DEFAULT_SUBAGENT_CONFIG.disallowedTools);
    }
    if (DEFAULT_SUBAGENT_CONFIG.blockedTools) {
      disallowed.push(...DEFAULT_SUBAGENT_CONFIG.blockedTools);
    }

    // Remove duplicates
    return [...new Set(disallowed)];
  }

  /**
   * Format the subagent result for display
   */
  private formatResult(result: SubagentResult, agentDef?: AgentDefinition | null): ToolResult {
    const agentName = agentDef?.name || 'Agent';
    let llmContent = `## ${agentName} Result\n\n`;
    llmContent += `**Status:** ${result.success ? '✅ Success' : '❌ Failed'}\n`;
    llmContent += `**Summary:** ${result.summary}\n\n`;

    if (result.details) {
      llmContent += `### Details\n${result.details}\n\n`;
    }

    if (result.filesModified && result.filesModified.length > 0) {
      llmContent += `### Files Modified\n${result.filesModified.map((f) => `- ${f}`).join('\n')}\n\n`;
    }

    if (result.filesRead && result.filesRead.length > 0) {
      llmContent += `### Files Read\n${result.filesRead.map((f) => `- ${f}`).join('\n')}\n\n`;
    }

    if (result.commandsExecuted && result.commandsExecuted.length > 0) {
      llmContent += `### Commands Executed\n${result.commandsExecuted.map((c) => `- \`${c}\``).join('\n')}\n\n`;
    }

    if (result.errors && result.errors.length > 0) {
      llmContent += `### Errors\n${result.errors.map((e) => `- ${e}`).join('\n')}\n\n`;
    }

    if (result.duration) {
      llmContent += `**Duration:** ${Math.round(result.duration / 1000)}s\n`;
    }

    let returnDisplay = result.summary;
    if (result.filesModified && result.filesModified.length > 0) {
      returnDisplay += `\n\nModified: ${result.filesModified.join(', ')}`;
    }
    if (result.errors && result.errors.length > 0) {
      returnDisplay += `\n\nErrors: ${result.errors.join('; ')}`;
    }

    return {
      summary: result.summary,
      llmContent,
      returnDisplay,
    };
  }
}

// Export the tool name for registration
export const SubagentToolName = 'Agent';
export const SubagentToolNameLegacy = 'subagent'; // For backward compatibility
