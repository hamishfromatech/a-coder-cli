/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, SlashCommandActionReturn, type CommandContext, CommandCategory } from './types.js';
import { MessageType } from '../types.js';
import { getAgentRegistry, AGENT_SOURCE, AgentSourceType } from '@a-coder/core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get the agents directory path for a given scope
 */
function getAgentsDir(scope: AgentSourceType): string {
  switch (scope) {
    case AGENT_SOURCE.USER:
      return path.join(os.homedir(), '.claude', 'agents');
    case AGENT_SOURCE.PROJECT:
      return path.join(process.cwd(), '.claude', 'agents');
    default:
      return path.join(os.homedir(), '.claude', 'agents');
  }
}

/**
 * Create a new agent with default template
 */
async function createAgentTemplate(
  agentName: string,
  scope: AgentSourceType,
): Promise<{ success: boolean; path: string; error?: string }> {
  const agentsDir = getAgentsDir(scope);
  const agentDir = path.join(agentsDir, agentName);
  const agentFile = path.join(agentDir, 'AGENT.md');

  // Check if agent already exists
  if (fs.existsSync(agentDir)) {
    return {
      success: false,
      path: agentDir,
      error: `Agent '${agentName}' already exists at ${agentDir}`,
    };
  }

  // Create agent template
  const template = `---
name: ${agentName}
description: Use this agent when... Examples: <example>...</example>
model: inherit
color: blue
tools: ["Read", "Grep", "Glob"]  # Optional: restrict tools available to this agent
---

You are an agent that [does X].

**Your Core Responsibilities:**
1. [Responsibility 1]
2. [Responsibility 2]
3. [Responsibility 3]

**Process:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Output Format:**
Provide a structured response:
1. Summary (2-3 sentences)
2. Key findings or results
3. Any recommendations or next steps

Include file names and line numbers for all findings.
`;

  try {
    // Create directory
    fs.mkdirSync(agentDir, { recursive: true });
    // Write template file
    fs.writeFileSync(agentFile, template);

    return {
      success: true,
      path: agentDir,
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Agent management command
 */
export const agentCommand: SlashCommand = {
  name: 'agent',
  description: 'Manage custom agents',
  category: 'agent' as CommandCategory,
  keywords: ['agents', 'custom', 'create', 'subagent', 'bot'],
  argumentHint: '<subcommand> [args]',
  examples: ['/agent list', '/agent create my-agent', '/agent view Explore'],
  subCommands: [
    {
      name: 'list',
      description: 'List all available agents (built-in and custom)',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        try {
          const registry = getAgentRegistry();
          await registry.initialize();

          const allAgents = await registry.getAllAgents();

          // Group by source
          const builtinAgents = allAgents.filter((a) => a.source === AGENT_SOURCE.BUILTIN);
          const userAgents = allAgents.filter((a) => a.source === AGENT_SOURCE.USER);
          const projectAgents = allAgents.filter((a) => a.source === AGENT_SOURCE.PROJECT);
          const pluginAgents = allAgents.filter((a) => a.source === AGENT_SOURCE.PLUGIN);

          let output = 'Available Agents\n\n';

          // Built-in agents
          if (builtinAgents.length > 0) {
            output += 'Built-in Agents:\n';
            builtinAgents.forEach((agent) => {
              output += `  • ${agent.name} (${agent.id})\n`;
              output += `    ${agent.description}\n`;
              if (agent.model && agent.model !== 'inherit') {
                output += `    Model: ${agent.model}\n`;
              }
            });
            output += '\n';
          }

          // User agents
          if (userAgents.length > 0) {
            output += 'User Agents (~/.claude/agents/):\n';
            userAgents.forEach((agent) => {
              output += `  • ${agent.name} (${agent.id})\n`;
              output += `    ${agent.description}\n`;
              if (agent.model && agent.model !== 'inherit') {
                output += `    Model: ${agent.model}\n`;
              }
            });
            output += '\n';
          }

          // Project agents
          if (projectAgents.length > 0) {
            output += 'Project Agents (.claude/agents/):\n';
            projectAgents.forEach((agent) => {
              output += `  • ${agent.name} (${agent.id})\n`;
              output += `    ${agent.description}\n`;
              if (agent.model && agent.model !== 'inherit') {
                output += `    Model: ${agent.model}\n`;
              }
            });
            output += '\n';
          }

          // Plugin agents
          if (pluginAgents.length > 0) {
            output += 'Plugin Agents:\n';
            pluginAgents.forEach((agent) => {
              output += `  • ${agent.name} (${agent.id})\n`;
              output += `    ${agent.description}\n`;
              if (agent.model && agent.model !== 'inherit') {
                output += `    Model: ${agent.model}\n`;
              }
            });
            output += '\n';
          }

          if (allAgents.length === 0) {
            output += 'No agents found.\n\n';
            output += 'Create a custom agent with: /agent create <agent-name>\n';
            output += 'Agents are stored in ~/.claude/agents/ or .claude/agents/\n';
          }

          return {
            type: 'message',
            messageType: 'info',
            content: output.trim(),
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to list agents: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'create',
      description: 'Create a new custom agent with a template',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const parts = args.trim().split(/\s+/);

        if (parts.length === 0 || !parts[0]) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Usage: /agent create <agent-name> [--user|--project]

Creates a new custom agent with a template AGENT.md file.

Arguments:
  agent-name    Name for the new agent (e.g., "code-reviewer")
  --user        Create in user directory (~/.claude/agents/)
  --project     Create in project directory (.claude/agents/)

Examples:
  /agent create code-reviewer
  /agent create code-reviewer --project
  /agent create my-custom-agent --user`,
          };
        }

        const agentName = parts[0];
        const isProject = parts.includes('--project');
        const isUser = parts.includes('--user') || !isProject; // Default to user if --project not specified

        // Validate agent name
        if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Agent name must only contain letters, numbers, hyphens, and underscores.',
          };
        }

        const scope = isProject ? AGENT_SOURCE.PROJECT : AGENT_SOURCE.USER;

        try {
          const result = await createAgentTemplate(agentName, scope);

          if (result.success) {
            return {
              type: 'message',
              messageType: 'info',
              content: `Created agent '${agentName}' at ${result.path}

Edit the AGENT.md file to customize your agent:
- name: Display name for the agent
- description: When to use this agent (include examples)
- model: 'haiku', 'sonnet', 'opus', or 'inherit' (default)
- color: UI color ('blue', 'green', 'purple', 'cyan', etc.)
- tools: Array of allowed tools (e.g., ["Read", "Grep", "Glob"])

After editing, reload agents with: /agent reload`,
            };
          } else {
            return {
              type: 'message',
              messageType: 'error',
              content: result.error || 'Failed to create agent',
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to create agent: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'view',
      description: 'View details of a specific agent',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const agentName = args.trim();

        if (!agentName) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /agent view <agent-name>',
          };
        }

        try {
          const registry = getAgentRegistry();
          await registry.initialize();

          const agent = await registry.getAgent(agentName);

          if (!agent) {
            return {
              type: 'message',
              messageType: 'error',
              content: `Agent '${agentName}' not found. Use /agent list to see available agents.`,
            };
          }

          let output = `Agent: ${agent.name}\n\n`;
          output += `ID: ${agent.id}\n`;
          output += `Source: ${agent.source}\n`;
          output += `Description: ${agent.description}\n`;
          output += `Model: ${agent.model}\n`;

          if (agent.color) {
            output += `Color: ${agent.color}\n`;
          }

          if (agent.allowedTools.length > 0) {
            output += `\nAllowed Tools:\n  ${agent.allowedTools.join(', ')}\n`;
          }

          if (agent.disallowedTools.length > 0) {
            output += `\nDisallowed Tools:\n  ${agent.disallowedTools.join(', ')}\n`;
          }

          if (agent.systemPrompt) {
            output += `\nSystem Prompt:\n---\n${agent.systemPrompt}\n---\n`;
          }

          if (agent.filePath) {
            output += `\nFile: ${agent.filePath}\n`;
          }

          return {
            type: 'message',
            messageType: 'info',
            content: output,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to view agent: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'open',
      description: 'Open the agents directory in file explorer',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const parts = args.trim().split(/\s+/);
        const isProject = parts.includes('--project');

        const agentsDir = isProject
          ? path.join(process.cwd(), '.claude', 'agents')
          : path.join(os.homedir(), '.claude', 'agents');

        // Create directory if it doesn't exist
        if (!fs.existsSync(agentsDir)) {
          fs.mkdirSync(agentsDir, { recursive: true });
        }

        const { default: open } = await import('open');
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: `Opening agents directory: ${agentsDir}`,
          },
          Date.now(),
        );

        open(agentsDir);

        return {
          type: 'message',
          messageType: 'info',
          content: `Agents directory: ${agentsDir}`,
        };
      },
    },
    {
      name: 'reload',
      description: 'Reload agents from disk',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        try {
          const registry = getAgentRegistry();
          await registry.reload();

          const allAgents = await registry.getAllAgents();

          return {
            type: 'message',
            messageType: 'info',
            content: `Reloaded ${allAgents.length} agent(s). Use /agent list to see all agents.`,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to reload agents: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'help',
      description: 'Show help for creating custom agents',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const helpText = `Custom Agents
===============

Agents are autonomous subprocesses that handle specialized tasks. You can create custom agents to automate repetitive workflows.

Creating a Custom Agent
-----------------------

1. Run: /agent create <agent-name>

   This creates a template in ~/.claude/agents/<agent-name>/AGENT.md

2. Edit the AGENT.md file:

---
name: my-agent
description: Use this agent when... Examples:
  <example>
  Context: User wants to do X
  user: "I need to X"
  assistant: "I'll use my-agent to help with X."
  </example>
model: inherit  # 'haiku', 'sonnet', 'opus', or 'inherit'
color: blue     # 'blue', 'green', 'purple', 'cyan', etc.
tools: ["Read", "Grep", "Glob"]  # Optional tool restrictions
---

Your system prompt here...

Agent File Structure
--------------------

  ~/.claude/agents/
  └── my-agent/
      ├── AGENT.md      # Agent definition (required)
      └── supporting.md # Optional supporting files

Agent Properties
-----------------

• name: Display name for the agent
• description: When to use this agent (include usage examples)
• model: AI model to use:
  - 'inherit': Same as parent session (recommended)
  - 'haiku': Fast, cheap
  - 'sonnet': Balanced
  - 'opus': Most capable
• color: UI color for the agent
• tools: Array of allowed tools (omit for all tools)
  - Use ["*"] for all tools
  - Use ["Read", "Grep", "Glob"] for read-only
  - Use ["Read", "Write", "Edit", "Bash"] for write access

Built-in Agents
----------------

• general-purpose: Complex multi-step operations
• Explore: Fast codebase exploration (read-only)
• Plan: Implementation planning (read-only)

Examples
---------

Create a code review agent:
  /agent create code-reviewer

View agent details:
  /agent view code-reviewer

List all agents:
  /agent list

Open agent directory:
  /agent open`;

        return {
          type: 'message',
          messageType: 'info',
          content: helpText,
        };
      },
    },
  ],
};