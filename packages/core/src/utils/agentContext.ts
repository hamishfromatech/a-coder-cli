/**
 * Agent Context Isolation via AsyncLocalStorage
 *
 * Provides per-agent context isolation for in-process subagent execution.
 * Each subagent runs within its own AsyncLocalStorage context, preventing
 * state collisions between concurrent agents in the same process.
 *
 * Modeled after Claude Code's agentContext.ts pattern.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Context identifying a specific agent execution.
 */
export interface SubagentContext {
  /** Unique identifier for this agent instance */
  agentId: string;

  /** Type of agent (general-purpose, Explore, Plan, or custom) */
  agentType: 'subagent';

  /** Human-readable name of the agent */
  subagentName?: string;

  /** Whether this is a built-in agent */
  isBuiltIn?: boolean;

  /** Parent session ID for telemetry and logging */
  parentSessionId?: string;

  /** Whether this agent should avoid showing permission prompts */
  shouldAvoidPermissionPrompts?: boolean;

  /** Tools explicitly allowed for this agent */
  allowedTools?: string[];

  /** Tools explicitly blocked for this agent */
  disallowedTools?: string[];

  /** Permission mode override for this agent */
  permissionMode?: string;

  /** Whether this agent is running in the background */
  isBackground?: boolean;
}

/**
 * AsyncLocalStorage instance for agent context.
 * Each in-process agent gets its own store, isolated from others.
 */
const agentAsyncLocalStorage = new AsyncLocalStorage<SubagentContext>();

/**
 * Get the current agent context (if running inside an agent).
 * Returns undefined if not inside an agent execution context.
 */
export function getAgentContext(): SubagentContext | undefined {
  return agentAsyncLocalStorage.getStore();
}

/**
 * Check if the current execution is inside a subagent context.
 */
export function isSubagentContext(): boolean {
  return getAgentContext() !== undefined;
}

/**
 * Run a function within an isolated agent context.
 * All async operations within `fn` will see the provided context
 * via `getAgentContext()`.
 *
 * @param context The agent context to establish
 * @param fn The function to run within the agent context
 * @returns The return value of fn
 */
export function runWithAgentContext<T>(
  context: SubagentContext,
  fn: () => T,
): T {
  return agentAsyncLocalStorage.run(context, fn);
}

/**
 * Update a value in the current agent context.
 * This mutates the store in-place (AsyncLocalStorage stores are mutable objects).
 * Returns true if the update was applied, false if no agent context is active.
 */
export function updateAgentContext(
  updater: (ctx: SubagentContext) => Partial<SubagentContext>,
): boolean {
  const ctx = agentAsyncLocalStorage.getStore();
  if (!ctx) {
    return false;
  }
  Object.assign(ctx, updater(ctx));
  return true;
}

/**
 * Create a default subagent context for a given agent type.
 */
export function createSubagentContext(
  agentId: string,
  options: {
    agentName?: string;
    isBuiltIn?: boolean;
    parentSessionId?: string;
    isBackground?: boolean;
    shouldAvoidPermissionPrompts?: boolean;
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
  } = {},
): SubagentContext {
  return {
    agentId,
    agentType: 'subagent',
    subagentName: options.agentName,
    isBuiltIn: options.isBuiltIn,
    parentSessionId: options.parentSessionId,
    isBackground: options.isBackground ?? false,
    shouldAvoidPermissionPrompts: options.shouldAvoidPermissionPrompts ?? options.isBackground ?? false,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    permissionMode: options.permissionMode,
  };
}