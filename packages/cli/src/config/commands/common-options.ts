/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Argv } from 'yargs';
import { DEFAULT_GEMINI_MODEL } from '@a-coder/core';
import process from 'node:process';

/**
 * Apply common CLI options shared across all modes.
 */
export function addCommonOptions(yargs: Argv): Argv {
  return yargs
    .option('model', {
      alias: 'm',
      type: 'string',
      description: 'Model',
      default:
        process.env.A_CODER_MODEL ||
        process.env.OPENAI_MODEL ||
        DEFAULT_GEMINI_MODEL,
    })
    .option('prompt', {
      alias: 'p',
      type: 'string',
      description: 'Prompt. Appended to input on stdin (if any).',
    })
    .option('prompt-interactive', {
      alias: 'i',
      type: 'string',
      description:
        'Execute the provided prompt and continue in interactive mode',
    })
    .option('sandbox', {
      alias: 's',
      type: 'boolean',
      description: 'Run in sandbox?',
    })
    .option('sandbox-image', {
      type: 'string',
      description: 'Sandbox image URI.',
    })
    .option('debug', {
      alias: 'd',
      type: 'boolean',
      description: 'Run in debug mode?',
      default: false,
    })
    .option('all-files', {
      alias: ['a'],
      type: 'boolean',
      description: 'Include ALL files in context?',
      default: false,
    })
    .option('all_files', {
      type: 'boolean',
      description: 'Include ALL files in context?',
      default: false,
    })
    .deprecateOption(
      'all_files',
      'Use --all-files instead. We will be removing --all_files in the coming weeks.',
    )
    .option('show-memory-usage', {
      type: 'boolean',
      description: 'Show memory usage in status bar',
      default: false,
    })
    .option('show_memory_usage', {
      type: 'boolean',
      description: 'Show memory usage in status bar',
      default: false,
    })
    .deprecateOption(
      'show_memory_usage',
      'Use --show-memory-usage instead. We will be removing --show_memory_usage in the coming weeks.',
    )
    .option('yolo', {
      alias: 'y',
      type: 'boolean',
      description:
        'Automatically accept all actions (aka YOLO mode).',
      default: false,
    })
    .option('subagent', {
      type: 'boolean',
      description:
        'Enable subagent system. Use --no-subagent to disable.',
      default: true,
    })
    .option('checkpointing', {
      alias: 'c',
      type: 'boolean',
      description: 'Enables checkpointing of file edits',
      default: false,
    })
    .option('telemetry', {
      type: 'boolean',
      description:
        'Enable telemetry. Other --telemetry-* flags set specific values but do not enable telemetry on their own.',
    })
    .option('telemetry-target', {
      type: 'string',
      choices: ['local', 'gcp'],
      description:
        'Set the telemetry target (local or gcp). Overrides settings files.',
    })
    .option('telemetry-otlp-endpoint', {
      type: 'string',
      description:
        'Set the OTLP endpoint for telemetry. Overrides environment variables and settings files.',
    })
    .option('telemetry-log-prompts', {
      type: 'boolean',
      description:
        'Enable or disable logging of user prompts for telemetry.',
    })
    .option('hide-thinking', {
      type: 'boolean',
      description: 'Hide the thinking/reasoning process from the output',
      default: false,
    })
    .option('upgrade', {
      alias: 'u',
      type: 'boolean',
      description: 'Upgrade the CLI to the latest version from GitHub',
    })
    .option('print', {
      type: 'boolean',
      description:
        'Output results in structured JSON format (useful for CI/CD)',
      default: false,
    })
    .option('resume', {
      alias: 'r',
      type: 'boolean',
      description: 'Resume the last session',
      default: false,
    })
    .option('session-id', {
      type: 'string',
      description: 'Specific session ID to resume',
    })
    .option('heartbeat', {
      type: 'boolean',
      description:
        'Run in heartbeat mode (scheduled autonomous project building)',
      default: false,
    })
    .option('heartbeat-interval', {
      type: 'number',
      description:
        'Heartbeat interval in minutes (overrides Interval: in heartbeat.md, default: 10)',
    })
    .option('allowed-mcp-server-names', {
      type: 'array',
      string: true,
      description: 'Allowed MCP server names',
    })
    .option('extensions', {
      alias: 'e',
      type: 'array',
      string: true,
      description:
        'A list of extensions to use. If not provided, all extensions are used.',
    })
    .option('list-extensions', {
      alias: 'l',
      type: 'boolean',
      description: 'List all available extensions and exit.',
    })
    .option('ide-mode', {
      type: 'boolean',
      description: 'Run in IDE mode?',
    })
    .option('openai-logging', {
      type: 'boolean',
      description:
        'Enable logging of OpenAI API calls for debugging and analysis',
    })
    .option('openai-api-key', {
      type: 'string',
      description: 'OpenAI API key to use for authentication',
    })
    .option('openai-base-url', {
      type: 'string',
      description: 'OpenAI base URL (for custom endpoints)',
    });
}
