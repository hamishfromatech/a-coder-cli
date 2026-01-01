/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink';
import { AppWrapper } from './ui/App.js';
import { loadCliConfig, parseArguments, CliArgs } from './config/config.js';
import { readStdin } from './utils/readStdin.js';
import { basename, join } from 'node:path';
import v8 from 'node:v8';
import os from 'node:os';
import fs from 'node:fs';
import { request } from 'gaxios';
import { spawn } from 'node:child_process';
import { start_sandbox } from './utils/sandbox.js';
import {
  LoadedSettings,
  loadSettings,
  USER_SETTINGS_PATH,
} from './config/settings.js';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { loadExtensions, Extension } from './config/extension.js';
import { cleanupCheckpoints, registerCleanup } from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';
import {
  ApprovalMode,
  Config,
  EditTool,
  ShellTool,
  WriteFileTool,
  sessionId,
  logUserPrompt,
  AuthType,
  getOauthClient,
} from '@a-coder/core';
import { validateAuthMethod } from './config/auth.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';

function getNodeMemoryArgs(config: Config): string[] {
  const totalMemoryMB = os.totalmem() / (1024 * 1024);
  const heapStats = v8.getHeapStatistics();
  const currentMaxOldSpaceSizeMb = Math.floor(
    heapStats.heap_size_limit / 1024 / 1024,
  );

  // Set target to 50% of total memory
  const targetMaxOldSpaceSizeInMB = Math.floor(totalMemoryMB * 0.5);
  if (config.getDebugMode()) {
    console.debug(
      `Current heap size ${currentMaxOldSpaceSizeMb.toFixed(2)} MB`,
    );
  }

  if (process.env.GEMINI_CLI_NO_RELAUNCH) {
    return [];
  }

  if (targetMaxOldSpaceSizeInMB > currentMaxOldSpaceSizeMb) {
    if (config.getDebugMode()) {
      console.debug(
        `Need to relaunch with more memory: ${targetMaxOldSpaceSizeInMB.toFixed(2)} MB`,
      );
    }
    return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
  }

  return [];
}

async function relaunchWithAdditionalArgs(additionalArgs: string[]) {
  const nodeArgs = [...additionalArgs, ...process.argv.slice(1)];
  const newEnv = { ...process.env, GEMINI_CLI_NO_RELAUNCH: 'true' };

  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: newEnv,
  });

  await new Promise((resolve) => child.on('close', resolve));
  process.exit(0);
}

async function handleUpgrade() {
  console.log('Checking for updates...');
  const repo = 'hamishfromatech/a-coder-cli';
  try {
    const response = await request<any>({
      url: `https://api.github.com/repos/${repo}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'a-coder-cli',
      },
    });

    if (response.status !== 200 || !response.data.tag_name) {
      console.error('Failed to fetch latest release info.');
      return;
    }

    const latestVersion = response.data.tag_name;
    const currentVersion = `v${(await import('./utils/version.js')).getCliVersion()}`;

    if (latestVersion === currentVersion) {
      console.log(`You are already on the latest version (${currentVersion}).`);
      return;
    }

    console.log(`Upgrading from ${currentVersion} to ${latestVersion}...`);

    const asset = response.data.assets.find((a: any) => a.name === 'a-coder.js');
    if (!asset) {
      console.error('Latest release does not contain a-coder.js asset.');
      return;
    }

    const downloadUrl = asset.browser_download_url;
    const downloadResponse = await request<Buffer>({
      url: downloadUrl,
      method: 'GET',
      responseType: 'arraybuffer',
    });

    if (downloadResponse.status !== 200) {
      console.error('Failed to download update.');
      return;
    }

    const targetPath = join(__dirname, 'a-coder.js');
    fs.writeFileSync(targetPath, Buffer.from(downloadResponse.data));

    console.log(`Successfully upgraded to ${latestVersion}!`);
  } catch (error) {
    console.error('Error during upgrade:', error);
  }
}

export async function main() {
  console.log('[TRACE] Entering main()');
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);

  console.log('[TRACE] Settings loaded');
  await cleanupCheckpoints();
  if (settings.errors.length > 0) {
    // ...
    process.exit(1);
  }

  const argv = await parseArguments();
  console.log('[TRACE] Arguments parsed');

  if (argv.upgrade) {
    await handleUpgrade();
    process.exit(0);
  }

  const extensions = loadExtensions(workspaceRoot);
  const config = await loadCliConfig(
    settings.merged,
    extensions,
    sessionId,
    argv,
  );

  console.log('[TRACE] Config loaded');
  if (argv.promptInteractive && !process.stdin.isTTY) {
    // ...
    process.exit(1);
  }

  if (config.getListExtensions()) {
    // ...
    process.exit(0);
  }

  // Set a default auth type if one isn't set.
  if (!settings.merged.selectedAuthType) {
    // ...
  }

  setMaxSizedBoxDebugging(config.getDebugMode());

  console.log('[TRACE] Initializing config...');
  await config.initialize();
  console.log('[TRACE] Config initialized');

  if (settings.merged.theme) {
    // ...
  }

  // hop into sandbox if we are outside and sandboxing is enabled
  if (!process.env.SANDBOX) {
    console.log('[TRACE] Checking for sandbox...');
    const memoryArgs = settings.merged.autoConfigureMaxOldSpaceSize
      ? getNodeMemoryArgs(config)
      : [];
    const sandboxConfig = config.getSandbox();
    if (sandboxConfig) {
      console.log('[TRACE] Entering sandbox...');
      if (settings.merged.selectedAuthType) {
        // ...
      }
      await start_sandbox(sandboxConfig, memoryArgs);
      console.log('[TRACE] Sandbox started (or failed)');
      process.exit(0);
    } else {
      // Not in a sandbox and not entering one, so relaunch with additional
      // arguments to control memory usage if needed.
      if (memoryArgs.length > 0) {
        console.log('[TRACE] Relaunching with memory args...');
        await relaunchWithAdditionalArgs(memoryArgs);
        process.exit(0);
      }
    }
  }

  if (
    settings.merged.selectedAuthType === AuthType.LOGIN_WITH_GOOGLE &&
    config.getNoBrowser()
  ) {
    console.log('[TRACE] Refreshing OAuth...');
    // Do oauth before app renders to make copying the link possible.
    await getOauthClient(settings.merged.selectedAuthType, config);
  }

  let input = config.getQuestion();
  console.log('[TRACE] Input question:', input);
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(workspaceRoot)),
  ];

  const shouldBeInteractive =
    !!argv.promptInteractive ||
    (process.stdin.isTTY && (input?.length === 0 || input?.startsWith('/')));

  console.log('[TRACE] shouldBeInteractive:', shouldBeInteractive);

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (shouldBeInteractive) {
    console.log('[TRACE] Starting interactive mode...');
    const version = await getCliVersion();
    setWindowTitle(basename(workspaceRoot), settings);
    const instance = render(
      <React.StrictMode>
        <AppWrapper
          config={config}
          settings={settings}
          startupWarnings={startupWarnings}
          version={version}
        />
      </React.StrictMode>,
      { exitOnCtrlC: false },
    );

    registerCleanup(() => instance.unmount());
    return;
  }
  // If not a TTY, read from stdin
  // This is for cases where the user pipes input directly into the command
  if (!process.stdin.isTTY && !input) {
    console.log('[TRACE] Reading from stdin...');
    input += await readStdin();
  }
  if (!input) {
    console.error('No input provided via stdin.');
    process.exit(1);
  }

  const prompt_id = Math.random().toString(16).slice(2);
  console.log('[TRACE] Starting non-interactive mode...');
  logUserPrompt(config, {
    'event.name': 'user_prompt',
    'event.timestamp': new Date().toISOString(),
    prompt: input,
    prompt_id,
    auth_type: config.getContentGeneratorConfig()?.authType,
    prompt_length: input.length,
  });

  // Non-interactive mode handled by runNonInteractive
  const nonInteractiveConfig = await loadNonInteractiveConfig(
    config,
    extensions,
    settings,
    argv,
  );

  console.log('[TRACE] Calling runNonInteractive...');
  await runNonInteractive(nonInteractiveConfig, input, prompt_id);
  console.log('[TRACE] runNonInteractive finished');
  process.exit(0);
}

function setWindowTitle(title: string, settings: LoadedSettings) {
  if (!settings.merged.hideWindowTitle) {
    const windowTitle = (process.env.CLI_TITLE || `Qwen - ${title}`).replace(
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1F\x7F]/g,
      '',
    );
    process.stdout.write(`\x1b]2;${windowTitle}\x07`);

    process.on('exit', () => {
      process.stdout.write(`\x1b]2;\x07`);
    });
  }
}

// --- Global Unhandled Rejection Handler ---
process.on('unhandledRejection', (reason, _promise) => {
  // Log other unexpected unhandled rejections as critical errors
  console.error('=========================================');
  console.error('CRITICAL: Unhandled Promise Rejection!');
  console.error('=========================================');
  console.error('Reason:', reason);
  console.error('Stack trace may follow:');
  if (!(reason instanceof Error)) {
    console.error(reason);
  }
  // Exit for genuinely unhandled errors
  process.exit(1);
});

async function loadNonInteractiveConfig(
  config: Config,
  extensions: Extension[],
  settings: LoadedSettings,
  argv: CliArgs,
) {
  let finalConfig = config;
  if (config.getApprovalMode() !== ApprovalMode.YOLO) {
    // Everything is not allowed, ensure that only read-only tools are configured.
    const existingExcludeTools = settings.merged.excludeTools || [];
    const interactiveTools = [
      ShellTool.Name,
      EditTool.Name,
      WriteFileTool.Name,
    ];

    const newExcludeTools = [
      ...new Set([...existingExcludeTools, ...interactiveTools]),
    ];

    const nonInteractiveSettings = {
      ...settings.merged,
      excludeTools: newExcludeTools,
    };
    finalConfig = await loadCliConfig(
      nonInteractiveSettings,
      extensions,
      config.getSessionId(),
      argv,
    );
    await finalConfig.initialize();
  }

  return await validateNonInterActiveAuth(
    settings.merged.selectedAuthType,
    finalConfig,
  );
}

async function validateNonInterActiveAuth(
  selectedAuthType: AuthType | undefined,
  nonInteractiveConfig: Config,
) {
  // making a special case for the cli. many headless environments might not have a settings.json set
  // so if GEMINI_API_KEY or OPENAI_API_KEY is set, we'll use that. However since the oauth things are interactive anyway, we'll
  // still expect that exists
  if (!selectedAuthType && !process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) {
    console.error(
      `Please set an Auth method in your ${USER_SETTINGS_PATH} OR specify OPENAI_API_KEY/GEMINI_API_KEY env variable file before running`,
    );
    process.exit(1);
  }

  // Auto-detect auth type: prefer OpenAI if configured, otherwise use Gemini
  if (!selectedAuthType) {
    if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) {
      selectedAuthType = AuthType.USE_OPENAI;
    } else {
      selectedAuthType = AuthType.USE_GEMINI;
    }
  }
  const err = validateAuthMethod(selectedAuthType);
  if (err != null) {
    console.error(err);
    process.exit(1);
  }

  await nonInteractiveConfig.refreshAuth(selectedAuthType);
  return nonInteractiveConfig;
}
