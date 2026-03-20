/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AgentDefinition,
  AgentDiscoveryOptions,
  AgentSourceType,
  AGENT_SOURCE,
} from './types.js';
import { discoverAgents, loadAgentFromFile } from './discovery.js';
import { BUILTIN_AGENTS, BuiltinAgentType } from '../tools/subagent-types.js';

/**
 * Registry for managing agent definitions
 */
export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();
  private initialized = false;

  /**
   * Initialize the registry by discovering all available agents
   */
  async initialize(options?: AgentDiscoveryOptions): Promise<void> {
    if (this.initialized) return;

    // Load built-in agents
    for (const [type, config] of Object.entries(BUILTIN_AGENTS)) {
      const definition: AgentDefinition = {
        id: `builtin:${type}`,
        name: config.name,
        description: config.description,
        model: config.model,
        color: config.color,
        allowedTools: config.allowedTools,
        disallowedTools: config.disallowedTools,
        systemPrompt: config.systemPrompt,
        source: AGENT_SOURCE.BUILTIN,
      };
      this.agents.set(definition.id, definition);
    }

    // Discover custom agents
    const discoveredAgents = await discoverAgents(options);
    for (const agent of discoveredAgents) {
      this.agents.set(agent.id, agent);
    }

    this.initialized = true;
  }

  /**
   * Get an agent by ID or name
   */
  async getAgent(idOrName: string): Promise<AgentDefinition | null> {
    await this.initialize();

    // Try exact ID match
    if (this.agents.has(idOrName)) {
      return this.agents.get(idOrName) ?? null;
    }

    // Try built-in prefix
    const builtinId = `builtin:${idOrName}`;
    if (this.agents.has(builtinId)) {
      return this.agents.get(builtinId) ?? null;
    }

    // Try user prefix
    const userId = `user:${idOrName}`;
    if (this.agents.has(userId)) {
      return this.agents.get(userId) ?? null;
    }

    // Try project prefix
    const projectId = `project:${idOrName}`;
    if (this.agents.has(projectId)) {
      return this.agents.get(projectId) ?? null;
    }

    // Try by name match
    for (const agent of this.agents.values()) {
      if (agent.name.toLowerCase() === idOrName.toLowerCase()) {
        return agent;
      }
    }

    return null;
  }

  /**
   * Get all available agents
   */
  async getAllAgents(): Promise<AgentDefinition[]> {
    await this.initialize();
    return Array.from(this.agents.values());
  }

  /**
   * Get all built-in agents
   */
  getBuiltinAgents(): AgentDefinition[] {
    const agents: AgentDefinition[] = [];
    for (const [type, config] of Object.entries(BUILTIN_AGENTS)) {
      agents.push({
        id: `builtin:${type}`,
        name: config.name,
        description: config.description,
        model: config.model,
        color: config.color,
        allowedTools: config.allowedTools,
        disallowedTools: config.disallowedTools,
        systemPrompt: config.systemPrompt,
        source: AGENT_SOURCE.BUILTIN,
      });
    }
    return agents;
  }

  /**
   * Get all custom agents (non-builtin)
   */
  async getCustomAgents(): Promise<AgentDefinition[]> {
    await this.initialize();
    return Array.from(this.agents.values()).filter(
      (agent) => agent.source !== AGENT_SOURCE.BUILTIN,
    );
  }

  /**
   * Check if an agent exists
   */
  async hasAgent(idOrName: string): Promise<boolean> {
    const agent = await this.getAgent(idOrName);
    return agent !== null;
  }

  /**
   * Reload agents from disk
   */
  async reload(options?: AgentDiscoveryOptions): Promise<void> {
    this.initialized = false;
    this.agents.clear();
    await this.initialize(options);
  }

  /**
   * Register a custom agent definition
   */
  registerAgent(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(id: string): boolean {
    return this.agents.delete(id);
  }
}

// Singleton instance
let defaultRegistry: AgentRegistry | null = null;

/**
 * Get the default agent registry instance
 */
export function getAgentRegistry(): AgentRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new AgentRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default registry (useful for testing)
 */
export function resetAgentRegistry(): void {
  defaultRegistry = null;
}