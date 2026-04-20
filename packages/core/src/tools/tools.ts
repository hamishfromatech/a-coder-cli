/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionDeclaration, PartListUnion, Schema } from '@google/genai';

/**
 * Interface representing the base Tool functionality
 */
export interface Tool<
  TParams = unknown,
  TResult extends ToolResult = ToolResult,
> {
  /**
   * The internal name of the tool (used for API calls)
   */
  name: string;

  /**
   * The user-friendly display name of the tool
   */
  displayName: string;

  /**
   * Description of what the tool does
   */
  description: string;

  /**
   * Function declaration schema from @google/genai
   */
  schema: FunctionDeclaration;

  /**
   * Whether the tool's output should be rendered as markdown
   */
  isOutputMarkdown: boolean;

  /**
   * Whether the tool supports live (streaming) output
   */
  canUpdateOutput: boolean;

  /**
   * Whether this tool only reads data and doesn't mutate state.
   * Read-only tools can be executed concurrently for better performance.
   * Defaults to false.
   */
  isReadOnly?: boolean;

  /**
   * Determines if this tool invocation with the given parameters is safe
   * to run concurrently with other tool invocations.
   * This is a finer-grained version of isReadOnly that considers parameters.
   * For example, a shell command that reads (e.g., `ls`) is concurrency-safe,
   * while one that writes (e.g., `rm`) is not.
   * Defaults to the value of isReadOnly if not overridden.
   */
  isConcurrencySafe?(params: TParams): boolean;

  /**
   * Returns a background color for the tool name pill in the UI.
   * The pill renders the tool displayName with this color as background
   * for visual categorization (e.g., cyan for read, green for write,
   * yellow for shell/exec).
   * Return undefined for no background (plain text).
   */
  userFacingNameBackgroundColor?(params: TParams): string | undefined;

  /**
   * Returns a present-participle verb phrase for the tool's in-progress
   * spinner (e.g., "Reading...", "Writing...", "Running...").
   * Used by the UI to show per-tool-use activity.
   */
  getVerbPhrase?(params: TParams): string;

  /**
   * Validates the parameters for the tool
   * Should be called from both `shouldConfirmExecute` and `execute`
   * `shouldConfirmExecute` should return false immediately if invalid
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  validateToolParams(params: TParams): string | null;

  /**
   * Gets a pre-execution description of the tool operation
   * @param params Parameters for the tool execution
   * @returns A markdown string describing what the tool will do
   * Optional for backward compatibility
   */
  getDescription(params: TParams): string;

  /**
   * Determines if the tool should prompt for confirmation before execution
   * @param params Parameters for the tool execution
   * @returns Whether execute should be confirmed.
   */
  shouldConfirmExecute(
    params: TParams,
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false>;

  /**
   * Executes the tool with the given parameters
   * @param params Parameters for the tool execution
   * @returns Result of the tool execution
   */
  execute(
    params: TParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult>;
}

/**
 * Base implementation for tools with common functionality
 */
export abstract class BaseTool<
  TParams = unknown,
  TResult extends ToolResult = ToolResult,
> implements Tool<TParams, TResult>
{
  /**
   * Creates a new instance of BaseTool
   * @param name Internal name of the tool (used for API calls)
   * @param displayName User-friendly display name of the tool
   * @param description Description of what the tool does
   * @param isOutputMarkdown Whether the tool's output should be rendered as markdown
   * @param canUpdateOutput Whether the tool supports live (streaming) output
   * @param parameterSchema JSON Schema defining the parameters
   */
  constructor(
    readonly name: string,
    readonly displayName: string,
    readonly description: string,
    readonly parameterSchema: Schema,
    readonly isOutputMarkdown: boolean = true,
    readonly canUpdateOutput: boolean = false,
    readonly isReadOnly: boolean = false,
  ) {}

  /**
   * Function declaration schema computed from name, description, and parameterSchema
   */
  get schema(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameterSchema,
    };
  }

  /**
   * Validates the parameters for the tool
   * This is a placeholder implementation and should be overridden
   * Should be called from both `shouldConfirmExecute` and `execute`
   * `shouldConfirmExecute` should return false immediately if invalid
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validateToolParams(params: TParams): string | null {
    // Implementation would typically use a JSON Schema validator
    // This is a placeholder that should be implemented by derived classes
    return null;
  }

  /**
   * Gets a pre-execution description of the tool operation
   * Default implementation that should be overridden by derived classes
   * @param params Parameters for the tool execution
   * @returns A markdown string describing what the tool will do
   */
  getDescription(params: TParams): string {
    return JSON.stringify(params);
  }

  /**
   * Determines if the tool should prompt for confirmation before execution
   * @param params Parameters for the tool execution
   * @returns Whether or not execute should be confirmed by the user.
   */
  shouldConfirmExecute(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    params: TParams,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return Promise.resolve(false);
  }

  /**
   * Returns a background color for the tool name pill.
   * Default: undefined (no background). Override in subclasses.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userFacingNameBackgroundColor(params: TParams): string | undefined {
    return undefined;
  }

  /**
   * Returns a verb phrase for the in-progress spinner.
   * Default: "Working...". Override in subclasses for specific verbs.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getVerbPhrase(params: TParams): string {
    return 'Working...';
  }

  /**
   * Determines if this tool invocation is safe to run concurrently.
   * Defaults to the value of isReadOnly. Override for parameter-dependent
   * concurrency decisions (e.g., shell commands that are read-only vs mutating).
   */
  isConcurrencySafe(params: TParams): boolean {
    return this.isReadOnly ?? false;
  }

  /**
   * Abstract method to execute the tool with the given parameters
   * Must be implemented by derived classes
   * @param params Parameters for the tool execution
   * @param signal AbortSignal for tool cancellation
   * @returns Result of the tool execution
   */
  abstract execute(
    params: TParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult>;
}

export interface ToolResult {
  /**
   * A short, one-line summary of the tool's action and result.
   * e.g., "Read 5 files", "Wrote 256 bytes to foo.txt"
   */
  summary?: string;
  /**
   * Content meant to be included in LLM history.
   * This should represent the factual outcome of the tool execution.
   */
  llmContent: PartListUnion;

  /**
   * Markdown string for user display.
   * This provides a user-friendly summary or visualization of the result.
   * NOTE: This might also be considered UI-specific and could potentially be
   * removed or modified in a further refactor if the server becomes purely API-driven.
   * For now, we keep it as the core logic in ReadFileTool currently produces it.
   */
  returnDisplay: ToolResultDisplay;
}

export type ToolResultDisplay = string | FileDiff;

export interface FileDiff {
  fileDiff: string;
  fileName: string;
}

export interface ToolEditConfirmationDetails {
  type: 'edit';
  title: string;
  onConfirm: (
    outcome: ToolConfirmationOutcome,
    payload?: ToolConfirmationPayload,
  ) => Promise<void>;
  fileName: string;
  fileDiff: string;
  isModifying?: boolean;
}

export interface ToolConfirmationPayload {
  // used to override `modifiedProposedContent` for modifiable tools in the
  // inline modify flow
  newContent: string;
}

export interface ToolExecuteConfirmationDetails {
  type: 'exec';
  title: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  command: string;
  rootCommand: string;
}

export interface ToolMcpConfirmationDetails {
  type: 'mcp';
  title: string;
  serverName: string;
  toolName: string;
  toolDisplayName: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
}

export interface ToolInfoConfirmationDetails {
  type: 'info';
  title: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  prompt: string;
  urls?: string[];
}

/**
 * Confirmation details for tools that need user approval via 'ask' decision
 */
export interface ToolAskConfirmationDetails {
  type: 'ask';
  title: string;
  /** Explanation for why user confirmation is needed */
  message: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
}

export type ToolCallConfirmationDetails =
  | ToolEditConfirmationDetails
  | ToolExecuteConfirmationDetails
  | ToolMcpConfirmationDetails
  | ToolInfoConfirmationDetails
  | ToolAskConfirmationDetails;

export enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  Cancel = 'cancel',
}
