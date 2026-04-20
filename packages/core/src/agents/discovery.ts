/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import matter from 'gray-matter';
import {
  AgentDefinition,
  AgentFrontmatter,
  AgentSourceType,
  AgentDiscoveryOptions,
  AGENT_FILE_NAME,
  AGENT_SOURCE,
} from './types.js';
import { MCPServerConfig } from '../config/config.js';

/**
 * Agent discovery locations by priority (highest to lowest)
 */
const AGENT_LOCATIONS: Array<{
  getSource: (cwd: string) => { source: AgentSourceType; basePath: string };
}> = [
  {
    // Project-level agents (.claude/agents/) - Claude Code compatible
    getSource: (cwd: string) => ({
      source: AGENT_SOURCE.PROJECT,
      basePath: path.join(cwd, '.claude', 'agents'),
    }),
  },
  {
    // Project-level agents (.a-coder-cli/agents/) - a-coder-cli native
    getSource: (cwd: string) => ({
      source: AGENT_SOURCE.PROJECT,
      basePath: path.join(cwd, '.a-coder-cli', 'agents'),
    }),
  },
  {
    // User-level agents (~/.claude/agents/) - Claude Code compatible
    getSource: () => ({
      source: AGENT_SOURCE.USER,
      basePath: path.join(os.homedir(), '.claude', 'agents'),
    }),
  },
  {
    // User-level agents (~/.a-coder-cli/agents/) - a-coder-cli native
    getSource: () => ({
      source: AGENT_SOURCE.USER,
      basePath: path.join(os.homedir(), '.a-coder-cli', 'agents'),
    }),
  },
];

/**
 * Parse agent frontmatter from markdown content
 */
export function parseAgentFrontmatter(
  content: string,
  fileName?: string,
): { frontmatter: AgentFrontmatter; content: string } {
  const parsed = matter(content);

  const frontmatter: AgentFrontmatter = {
    name: parsed.data.name as string,
    description: parsed.data.description as string,
    model: parsed.data.model as string | undefined,
    color: parsed.data.color as string | undefined,
    tools: parsed.data.tools as string[] | undefined,
    disallowedTools: parsed.data.disallowedTools as string[] | undefined,
    metadata: parsed.data.metadata as Record<string, unknown> | undefined,
    mcpServers: parsed.data.mcpServers
      ? parseMcpServers(parsed.data.mcpServers as Record<string, unknown>)
      : undefined,
    memoryFile: parsed.data.memoryFile as string | undefined,
    blockNestedSubagents: parsed.data.blockNestedSubagents as boolean | undefined,
  };

  // Validate required fields
  if (!frontmatter.name) {
    // Use filename as fallback name
    frontmatter.name = fileName || 'Unnamed Agent';
  }

  if (!frontmatter.description) {
    // Use first paragraph as fallback description
    const firstParagraph = parsed.content.split('\n\n')[0];
    frontmatter.description = firstParagraph?.substring(0, 200) || 'Custom agent';
  }

  // Default model to 'inherit'
  if (!frontmatter.model) {
    frontmatter.model = 'inherit';
  }

  return {
    frontmatter,
    content: parsed.content,
  };
}

/**
 * Parse inline MCP server configurations from frontmatter.
 * Converts plain objects into MCPServerConfig instances.
 */
function parseMcpServers(
  raw: Record<string, unknown>,
): Record<string, MCPServerConfig> {
  const servers: Record<string, MCPServerConfig> = {};
  for (const [name, config] of Object.entries(raw)) {
    const c = config as Record<string, unknown>;
    servers[name] = new MCPServerConfig(
      c.command as string | undefined,
      c.args as string[] | undefined,
      c.env as Record<string, string> | undefined,
      c.cwd as string | undefined,
      c.url as string | undefined,
      c.httpUrl as string | undefined,
      c.headers as Record<string, string> | undefined,
      c.tcp as string | undefined,
      c.timeout as number | undefined,
      c.trust as boolean | undefined,
      c.description as string | undefined,
      c.includeTools as string[] | undefined,
      c.excludeTools as string[] | undefined,
    );
  }
  return servers;
}

/**
 * Discover agents from file system
 */
export async function discoverAgents(
  options: AgentDiscoveryOptions = {},
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];
  const seenIds = new Set<string>();

  const cwd = options.cwd ?? process.cwd();

  for (const location of AGENT_LOCATIONS) {
    const { source, basePath } = location.getSource(cwd);

    // Skip if not including this source
    if (source === AGENT_SOURCE.USER && options.includeUser === false) continue;
    if (source === AGENT_SOURCE.PROJECT && options.includeProject === false) continue;

    // Check if directory exists
    if (!fs.existsSync(basePath)) continue;

    // Discover agents in directory
    const discoveredAgents = await discoverAgentsInDirectory(basePath, source);
    for (const agent of discoveredAgents) {
      if (!seenIds.has(agent.id)) {
        seenIds.add(agent.id);
        agents.push(agent);
      }
    }
  }

  // Discover plugin agents
  const pluginAgents = await discoverPluginAgents({ currentPath: cwd });
  for (const agent of pluginAgents) {
    if (!seenIds.has(agent.id)) {
      seenIds.add(agent.id);
      agents.push(agent);
    }
  }

  return agents;
}

/**
 * Discover agents in a specific directory
 */
async function discoverAgentsInDirectory(
  directory: string,
  source: AgentSourceType,
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];

  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const agentDir = path.join(directory, entry.name);
      const agentFile = path.join(agentDir, AGENT_FILE_NAME);

      if (!fs.existsSync(agentFile)) continue;

      try {
        const agent = await loadAgentFromFile(agentFile, source);
        if (agent) {
          agents.push(agent);
        }
      } catch (error) {
        // Log error but continue discovering other agents
        console.error(`Error loading agent from ${agentFile}:`, error);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
    console.error(`Error reading directory ${directory}:`, error);
  }

  return agents;
}

/**
 * Load an agent definition from a file
 */
export async function loadAgentFromFile(
  filePath: string,
  source: AgentSourceType,
): Promise<AgentDefinition | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const { frontmatter, content: systemPrompt } = parseAgentFrontmatter(
      content,
      fileName,
    );

    const agentDir = path.dirname(filePath);
    const agentName = path.basename(agentDir);

    // Generate unique ID based on source and name
    const id = `${source}:${agentName}`;

    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      model: frontmatter.model || 'inherit',
      color: frontmatter.color,
      allowedTools: frontmatter.tools || [],
      disallowedTools: frontmatter.disallowedTools || [],
      systemPrompt: systemPrompt.trim() || undefined,
      source,
      filePath,
      mcpServers: frontmatter.mcpServers,
      memoryFile: frontmatter.memoryFile,
      blockNestedSubagents: frontmatter.blockNestedSubagents,
    };
  } catch (error) {
    console.error(`Error loading agent from ${filePath}:`, error);
    return null;
  }
}

/**
 * Get the path to a specific agent directory
 * Checks both .claude/agents and .a-coder-cli/agents directories
 */
export function getAgentPath(
  agentName: string,
  source: AgentSourceType,
  cwd?: string,
): string {
  const baseCwd = cwd ?? process.cwd();

  // Define possible locations based on source
  const possiblePaths =
    source === AGENT_SOURCE.USER
      ? [
          path.join(os.homedir(), '.claude', 'agents', agentName),
          path.join(os.homedir(), '.a-coder-cli', 'agents', agentName),
        ]
      : [
          path.join(baseCwd, '.claude', 'agents', agentName),
          path.join(baseCwd, '.a-coder-cli', 'agents', agentName),
        ];

  // Return the first path that exists, or the default (.claude) path
  for (const agentPath of possiblePaths) {
    if (fs.existsSync(agentPath)) {
      return agentPath;
    }
  }

  // Default to .claude/agents for new agents
  return source === AGENT_SOURCE.USER
    ? path.join(os.homedir(), '.claude', 'agents', agentName)
    : path.join(baseCwd, '.claude', 'agents', agentName);
}

/**
 * Check if a directory contains a valid agent
 */
export function isValidAgentDirectory(dirPath: string): boolean {
  const agentFile = path.join(dirPath, AGENT_FILE_NAME);
  return fs.existsSync(agentFile);
}

/**
 * Discover agents from installed plugins
 *
 * @param pluginDiscoveryOptions - Options for plugin discovery
 * @returns Array of plugin agent definitions
 */
export async function discoverPluginAgents(
  pluginDiscoveryOptions?: { currentPath?: string },
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];

  try {
    const { PluginDiscovery } = await import('../plugins/discovery.js');
    const pluginDiscovery = new PluginDiscovery();
    const plugins = await pluginDiscovery.discoverAll(pluginDiscoveryOptions);

    for (const plugin of plugins) {
      if (plugin.state !== 'enabled') {
        continue;
      }

      // Check if plugin has agents component
      if (plugin.manifest.components?.agents === false) {
        continue;
      }

      const pluginAgents = await discoverAgentsFromPlugin(plugin);
      agents.push(...pluginAgents);
    }
  } catch (error) {
    // Plugin discovery may not be available in all contexts
    console.warn('Warning: Could not discover plugin agents:', error);
  }

  return agents;
}

/**
 * Discover agents from a specific plugin
 *
 * @param plugin - The installed plugin to discover agents from
 * @returns Array of agent definitions from the plugin
 */
export async function discoverAgentsFromPlugin(plugin: {
  name: string;
  pluginDir: string;
}): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];
  const agentsDir = path.join(plugin.pluginDir, 'agents');

  if (!fs.existsSync(agentsDir)) {
    return agents;
  }

  try {
    const entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const agentDir = path.join(agentsDir, entry.name);
      const agentFile = path.join(agentDir, AGENT_FILE_NAME);

      if (!fs.existsSync(agentFile)) continue;

      try {
        const agent = await loadAgentFromFile(agentFile, AGENT_SOURCE.PLUGIN);
        if (agent) {
          // Namespace the agent with plugin name
          agent.id = `plugin:${plugin.name}:${agent.name}`;
          agents.push(agent);
        }
      } catch (error) {
        console.error(`Error loading plugin agent from ${agentFile}:`, error);
      }
    }
  } catch (error) {
    console.error(`Error reading plugin agents directory ${agentsDir}:`, error);
  }

  return agents;
}