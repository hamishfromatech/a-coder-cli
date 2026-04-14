/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
} from './tools.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { GEMINI_DIR } from '../utils/paths.js';

/**
 * Parameters for the InitializeHeartbeat tool
 */
export interface InitializeHeartbeatToolParams {
  /**
   * A brief description of the project goals and scope
   */
  project_description: string;
}

/**
 * Tool to initialize the heartbeat system by creating plan.md and heartbeat.md files
 * in the .a-coder-cli directory.
 */
export class InitializeHeartbeatTool extends BaseTool<InitializeHeartbeatToolParams, ToolResult> {
  static readonly Name: string = 'initialize_heartbeat';

  constructor(private readonly config: Config) {
    super(
      InitializeHeartbeatTool.Name,
      'InitializeHeartbeat',
      `Initializes the heartbeat system by creating plan.md and heartbeat.md files in the .a-coder-cli directory.
      Call this tool once at the start of a project to set up automated task tracking.
      After creating the files, you should suggest initial tasks to add to heartbeat.md.`,
      {
        properties: {
          project_description: {
            description: 'A brief description of the project goals and scope',
            type: Type.STRING,
          },
        },
        required: ['project_description'],
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(params: InitializeHeartbeatToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }
    if (!params.project_description || params.project_description.trim().length === 0) {
      return 'project_description cannot be empty';
    }
    return null;
  }

  async execute(
    params: InitializeHeartbeatToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
      };
    }

    const geminiDir = path.join(this.config.getTargetDir(), GEMINI_DIR);

    // Ensure .a-coder-cli directory exists
    if (!fs.existsSync(geminiDir)) {
      fs.mkdirSync(geminiDir, { recursive: true });
    }

    const planPath = path.join(geminiDir, 'plan.md');
    const heartbeatPath = path.join(geminiDir, 'heartbeat.md');

    // Create plan.md
    const planContent = this.createPlanContent(params.project_description);
    fs.writeFileSync(planPath, planContent, 'utf8');

    // Create heartbeat.md
    const heartbeatContent = this.createHeartbeatContent();
    fs.writeFileSync(heartbeatPath, heartbeatContent, 'utf8');

    return {
      llmContent: `Successfully initialized heartbeat system. Created:\n- ${planPath}\n- ${heartbeatPath}`,
      returnDisplay: `Initialized heartbeat system with plan.md and heartbeat.md in ${geminiDir}`,
    };
  }

  private createPlanContent(projectDescription: string): string {
    const timestamp = new Date().toISOString();
    return `# Project Plan

## Overview
${projectDescription}

## Architecture
<!-- Describe the key architectural decisions and project structure -->

## Current Phase
<!-- Describe the current phase of work -->

## Milestones
- [ ] Milestone 1: <description>
- [ ] Milestone 2: <description>

## Progress Summary
Last updated: ${timestamp}
`;
  }

  private createHeartbeatContent(): string {
    const timestamp = new Date().toISOString();
    return `# Heartbeat Tasks

## Project Status
<!-- The CLI will update this section as it works -->

## Task List
<!-- Managed by the CLI during heartbeat cycles -->

## Status
Last Run: ${timestamp}
Next Run: <!-- Will be set by heartbeat scheduler -->
Status: idle
Current Task: null
Interval: 10
`;
  }
}
