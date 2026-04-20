/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import process from 'node:process';
import {
  Config,
  loadServerHierarchicalMemory,
  setGeminiMdFilename as setServerGeminiMdFilename,
  getCurrentGeminiMdFilename,
  ApprovalMode,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  FileDiscoveryService,
  TelemetryTarget,
  MCPServerConfig,
} from '@a-coder/core';
import { Settings } from './settings.js';

import { Extension, filterActiveExtensions } from './extension.js';
import { getCliVersion } from '../utils/version.js';
import { loadSandboxConfig } from './sandboxConfig.js';
import { addCommonOptions } from './commands/common-options.js';

// Simple console logger for now - replace with actual logger if available
const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

export interface CliArgs {
  model: string | undefined;
  sandbox: boolean | string | undefined;
  sandboxImage: string | undefined;
  debug: boolean | undefined;
  prompt: string | undefined;
  promptInteractive: string | undefined;
  allFiles: boolean | undefined;
  all_files: boolean | undefined;
  showMemoryUsage: boolean | undefined;
  show_memory_usage: boolean | undefined;
  yolo: boolean | undefined;
  subagent: boolean | undefined;
  telemetry: boolean | undefined;
  checkpointing: boolean | undefined;
  telemetryTarget: string | undefined;
  telemetryOtlpEndpoint: string | undefined;
  telemetryLogPrompts: boolean | undefined;
  allowedMcpServerNames: string[] | undefined;
  extensions: string[] | undefined;
  listExtensions: boolean | undefined;
  ideMode: boolean | undefined;
  openaiLogging: boolean | undefined;
  hideThinking: boolean | undefined;
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  upgrade: boolean | undefined;
  print: boolean | undefined;
  // Dash integration options
  resume: boolean | undefined;
  sessionId: string | undefined;
  // Heartbeat mode
  heartbeat: boolean | undefined;
  heartbeatInterval: number | undefined;
}

export async function parseArguments(): Promise<CliArgs> {
  const yargsInstance = yargs(hideBin(process.argv))
    .scriptName('a-coder')
    .usage(
      '$0 [options]',
      'A-Coder CLI - Launch an interactive CLI, use -p/--prompt for non-interactive mode',
    );

  addCommonOptions(yargsInstance);

  yargsInstance
    .version(await getCliVersion())
    .alias('v', 'version')
    .help()
    .alias('h', 'help')
    .group(['model', 'prompt', 'prompt-interactive'], 'Input Options:')
    .group(['sandbox', 'sandbox-image', 'debug', 'all-files'], 'Execution Options:')
    .group(['yolo', 'subagent', 'checkpointing', 'heartbeat'], 'Behavior Options:')
    .group(['telemetry', 'telemetry-target', 'telemetry-otlp-endpoint', 'telemetry-log-prompts'], 'Telemetry Options:')
    .group(['extensions', 'list-extensions', 'ide-mode', 'openai-logging', 'openai-api-key', 'openai-base-url'], 'Advanced Options:')
    .group(['upgrade', 'print', 'resume', 'session-id', 'hide-thinking'], 'Other Options:')
    .epilog('For more information, visit the documentation or use --help for detailed usage.')
    .strict()
    .check((argv) => {
      if (argv.prompt && argv.promptInteractive) {
        throw new Error(
          'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
        );
      }
      return true;
    });

  yargsInstance.wrap(yargsInstance.terminalWidth());
  return yargsInstance.argv as unknown as Promise<CliArgs>;
}

// This function is now a thin wrapper around the server's implementation.
// It's kept in the CLI for now as App.tsx directly calls it for memory refresh.
// TODO: Consider if App.tsx should get memory via a server call or if Config should refresh itself.
export async function loadHierarchicalGeminiMemory(
  currentWorkingDirectory: string,
  debugMode: boolean,
  fileService: FileDiscoveryService,
  extensionContextFilePaths: string[] = [],
): Promise<{ memoryContent: string; fileCount: number }> {
  if (debugMode) {
    logger.debug(
      `CLI: Delegating hierarchical memory load to server for CWD: ${currentWorkingDirectory}`,
    );
  }
  // Directly call the server function.
  // The server function will use its own homedir() for the global path.
  return loadServerHierarchicalMemory(
    currentWorkingDirectory,
    debugMode,
    fileService,
    extensionContextFilePaths,
  );
}

export async function loadCliConfig(
  settings: Settings,
  extensions: Extension[],
  sessionId: string,
  argv: CliArgs,
): Promise<Config> {
  const debugMode =
    argv.debug ||
    [process.env.DEBUG, process.env.DEBUG_MODE].some(
      (v) => v === 'true' || v === '1',
    );

  const ideMode =
    (argv.ideMode ?? settings.ideMode ?? false) &&
    (process.env.TERM_PROGRAM === 'vscode' || process.env.TERM_PROGRAM === 'a-coder') &&
    !process.env.SANDBOX;

  const activeExtensions = filterActiveExtensions(
    extensions,
    argv.extensions || [],
  );

  // Handle OpenAI API key from command line
  if (argv.openaiApiKey) {
    process.env.OPENAI_API_KEY = argv.openaiApiKey;
  }

  // Handle OpenAI base URL from command line
  if (argv.openaiBaseUrl) {
    process.env.OPENAI_BASE_URL = argv.openaiBaseUrl;
  }

  // Set the context filename in the server's memoryTool module BEFORE loading memory
  // TODO(b/343434939): This is a bit of a hack. The contextFileName should ideally be passed
  // directly to the Config constructor in core, and have core handle setGeminiMdFilename.
  // However, loadHierarchicalGeminiMemory is called *before* createServerConfig.
  if (settings.contextFileName) {
    setServerGeminiMdFilename(settings.contextFileName);
  } else {
    // Reset to default if not provided in settings.
    setServerGeminiMdFilename(getCurrentGeminiMdFilename());
  }

  const extensionContextFilePaths = activeExtensions.flatMap(
    (e) => e.contextFiles,
  );

  const fileService = new FileDiscoveryService(process.cwd());
  // Call the (now wrapper) loadHierarchicalGeminiMemory which calls the server's version
  const { memoryContent, fileCount } = await loadHierarchicalGeminiMemory(
    process.cwd(),
    debugMode,
    fileService,
    extensionContextFilePaths,
  );

  let mcpServers = mergeMcpServers(settings, activeExtensions);
  const excludeTools = mergeExcludeTools(settings, activeExtensions);

  if (argv.allowedMcpServerNames) {
    const allowedNames = new Set(argv.allowedMcpServerNames.filter(Boolean));
    if (allowedNames.size > 0) {
      mcpServers = Object.fromEntries(
        Object.entries(mcpServers).filter(([key]) => allowedNames.has(key)),
      );
    } else {
      mcpServers = {};
    }
  }

  if (ideMode) {
    mcpServers['_ide_server'] = new MCPServerConfig(
      undefined, // command
      undefined, // args
      undefined, // env
      undefined, // cwd
      undefined, // url
      'http://localhost:3000/mcp', // httpUrl
      undefined, // headers
      undefined, // tcp
      undefined, // timeout
      false, // trust
      'IDE connection', // description
      undefined, // includeTools
      undefined, // excludeTools
    );
  }

  const sandboxConfig = await loadSandboxConfig(settings, argv);

  return new Config({
    sessionId,
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: sandboxConfig,
    targetDir: process.cwd(),
    debugMode,
    question: argv.promptInteractive || argv.prompt || '',
    fullContext: argv.allFiles || argv.all_files || false,
    coreTools: settings.coreTools || undefined,
    excludeTools,
    toolDiscoveryCommand: settings.toolDiscoveryCommand,
    toolCallCommand: settings.toolCallCommand,
    mcpServerCommand: settings.mcpServerCommand,
    mcpServers,
    userMemory: memoryContent,
    geminiMdFileCount: fileCount,
    approvalMode: argv.yolo || false ? ApprovalMode.YOLO : ApprovalMode.DEFAULT,
    showMemoryUsage:
      argv.showMemoryUsage ||
      argv.show_memory_usage ||
      settings.showMemoryUsage ||
      false,
    accessibility: settings.accessibility,
    telemetry: {
      enabled: argv.telemetry ?? settings.telemetry?.enabled,
      target: (argv.telemetryTarget ??
        settings.telemetry?.target) as TelemetryTarget,
      otlpEndpoint:
        argv.telemetryOtlpEndpoint ??
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        settings.telemetry?.otlpEndpoint,
      logPrompts: argv.telemetryLogPrompts ?? settings.telemetry?.logPrompts,
    },
    usageStatisticsEnabled: settings.usageStatisticsEnabled ?? true,
    // Git-aware file filtering settings
    fileFiltering: {
      respectGitIgnore: settings.fileFiltering?.respectGitIgnore,
      enableRecursiveFileSearch:
        settings.fileFiltering?.enableRecursiveFileSearch,
    },
    checkpointing: argv.checkpointing || settings.checkpointing?.enabled,
    proxy:
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
    cwd: process.cwd(),
    fileDiscoveryService: fileService,
    bugCommand: settings.bugCommand,
    model: argv.model!,
    extensionContextFilePaths,
    maxSessionTurns: settings.maxSessionTurns ?? -1,
    maxTokens: settings.maxTokens,
    listExtensions: argv.listExtensions || false,
    activeExtensions: activeExtensions.map((e) => ({
      name: e.config.name,
      version: e.config.version,
    })),
    noBrowser: !!process.env.NO_BROWSER,
    ideMode,
    enableOpenAILogging:
      (typeof argv.openaiLogging === 'undefined'
        ? settings.enableOpenAILogging
        : argv.openaiLogging) ?? false,
    hideThinking:
      (typeof argv.hideThinking === 'undefined'
        ? settings.hideThinking
        : argv.hideThinking) ?? false,
    sampling_params: settings.sampling_params,
    // --no-subagent sets argv.subagent to false
    // If subagent is explicitly false, disable it; otherwise use settings (or default: enabled)
    subagent: argv.subagent === false
      ? { enabled: false }
      : settings.subagent,
  });
}

function mergeMcpServers(settings: Settings, extensions: Extension[]) {
  const mcpServers = { ...(settings.mcpServers || {}) };
  for (const extension of extensions) {
    Object.entries(extension.config.mcpServers || {}).forEach(
      ([key, server]) => {
        if (mcpServers[key]) {
          logger.warn(
            `Skipping extension MCP config for server with key "${key}" as it already exists.`,
          );
          return;
        }
        mcpServers[key] = server;
      },
    );
  }
  return mcpServers;
}

function mergeExcludeTools(
  settings: Settings,
  extensions: Extension[],
): string[] {
  const allExcludeTools = new Set(settings.excludeTools || []);
  for (const extension of extensions) {
    for (const tool of extension.config.excludeTools || []) {
      allExcludeTools.add(tool);
    }
  }
  return [...allExcludeTools];
}
