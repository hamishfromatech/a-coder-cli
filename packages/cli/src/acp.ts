/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { runStreamTurn, type AcpTurnContext } from './nonInteractiveCli.js';
import { getCliVersion } from './utils/version.js';
import { AuthType, GeminiChat } from '@a-coder/core';

const PROTOCOL_VERSION = 1;
const CLIENT_NAME = 'a-coder-desktop';

interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function newSessionId(): string {
  return `ses_${randomUUID()}`;
}

function writeLine(line: string): void {
  if (!line.endsWith('\n')) line += '\n';
  process.stdout.write(line);
}

function sendResponse(id: number | string, result: unknown): void {
  writeLine(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function sendError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): void {
  writeLine(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, data: data ?? null },
    }),
  );
}

function sendNotification(method: string, params: unknown): void {
  writeLine(JSON.stringify({ jsonrpc: '2.0', method, params }));
}

interface AcpSession {
  id: string;
  cwd: string;
  ctx: AcpTurnContext;
  /** Aborts the currently running turn (set during a session/cancel). */
  abort: AbortController;
  busy: boolean;
  /** Persistent history of plain text prompts (for `--resume`-style restore). */
  promptCount: number;
  createdAt: string;
  updatedAt: string;
  /** Last user prompt preview (truncated to 240 chars). */
  preview: string;
}

/**
 * Run a-coder-cli in Agent Client Protocol (ACP) server mode.
 *
 * Speaks JSON-RPC 2.0 over stdio. Each session is a long-lived chat
 * conversation. The desktop app (or any other ACP client) connects,
 * performs `initialize`, opens one or more sessions, and then drives
 * them with `session/prompt` calls. Streaming output is delivered as
 * `session/update` notifications that mirror the Claude-Code
 * `stream-json` shape, so any client that knows one will understand the
 * other.
 */
export async function runAcpServer(argv: {
  cwd: string;
  harness: string;
  model?: string;
  autoAccept?: boolean;
  permissionMode?: 'default' | 'autoEdit' | 'plan' | 'yolo';
  sessionId?: string;
}): Promise<never> {
  const version = await getCliVersion();
  const sessions = new Map<string, AcpSession>();
  const autoAccept = !!argv.autoAccept || argv.permissionMode === 'yolo' || argv.permissionMode === 'autoEdit';
  const permissionMode = argv.permissionMode || 'default';

  let initDone = false;
  const initAgentInfo = {
    name: argv.harness || 'a-coder-cli',
    title: 'A-Coder CLI',
    version,
  };

  // Build a minimal CliArgs object that loadCliConfig will accept. We don't
  // need the full set of options here - the desktop app passes its own
  // model/env/argv through env vars.
  const baseArgv = {
    model: argv.model,
    sandbox: undefined,
    sandboxImage: undefined,
    debug: undefined,
    prompt: undefined,
    promptInteractive: undefined,
    allFiles: undefined,
    all_files: undefined,
    showMemoryUsage: undefined,
    show_memory_usage: undefined,
    yolo: permissionMode === 'yolo',
    permissionMode,
    continue: undefined,
    maxTurns: undefined,
    autoAccept,
    subagent: undefined,
    telemetry: undefined,
    checkpointing: undefined,
    telemetryTarget: undefined,
    telemetryOtlpEndpoint: undefined,
    telemetryLogPrompts: undefined,
    allowedMcpServerNames: undefined,
    extensions: undefined,
    listExtensions: undefined,
    ideMode: undefined,
    openaiLogging: undefined,
    hideThinking: undefined,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    outputFormat: undefined,
    upgrade: undefined,
    print: undefined,
    acp: true,
    resume: undefined,
    sessionId: undefined,
    heartbeat: undefined,
    heartbeatInterval: undefined,
  } as const;

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
    crlfDelay: Infinity,
  });

  rl.on('line', (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      sendError(null, -32700, `Parse error: ${(err as Error).message}`);
      return;
    }
    void handleMessage(msg);
  });

  rl.on('close', () => {
    process.exit(0);
  });

  async function handleMessage(msg: JsonRpcRequest): Promise<void> {
    const id = msg.id ?? null;
    const isRequest = msg.id !== undefined && msg.id !== null;

    if (!initDone && msg.method !== 'initialize') {
      if (isRequest) {
        sendError(id, -32002, 'Server not initialized; call initialize first');
      }
      return;
    }

    switch (msg.method) {
      case 'initialize':
        if (!isRequest) return;
        initDone = true;
        sendResponse(id as number | string, {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: false,
            promptCapabilities: {
              image: false,
              audio: false,
              embeddedContext: true,
            },
            mcpCapabilities: { http: false, sse: false },
          },
          agentInfo: {
            ...initAgentInfo,
            metadata: { permissionMode, autoAccept },
          },
          authMethods: [
            {
              id: 'env',
              name: 'Environment variables',
              description:
                'Use A_CODER_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY and OPENAI_BASE_URL from the environment.',
            },
            {
              id: 'api_key',
              name: 'Inline API key',
              description:
                'Provide API key and (optional) base URL inline via the first session/new params. Saved to ~/.a-coder/.env for subsequent runs.',
            },
            {
              id: 'oauth',
              name: 'OAuth (Gemini / Claude)',
              description:
                'Run `a-coder-cli auth` in another terminal to set up OAuth credentials, then restart the ACP client.',
            },
          ],
        });
        return;

      case 'session/new': {
        if (!isRequest) return;
        const params = (msg.params ?? {}) as { cwd?: string; mcpServers?: unknown[] };
        try {
          const session = await createSession(params.cwd || argv.cwd);
          sendResponse(id as number | string, { sessionId: session.id });
        } catch (err) {
          sendError(id, -32000, (err as Error).message);
        }
        return;
      }      case 'session/prompt': {
        if (!isRequest) return;
        const params = (msg.params ?? {}) as {
          sessionId?: string;
          prompt?: Array<{
            type: string;
            text?: string;
            resource?: { uri?: string; text?: string };
          }>;
        };
        const session = params.sessionId ? sessions.get(params.sessionId) : null;
        if (!session) {
          sendError(id, -32004, `Unknown sessionId: ${params.sessionId ?? '(none)'}`);
          return;
        }
        if (session.busy) {
          sendError(id, -32005, 'Session is already processing a prompt');
          return;
        }
        const text = extractPromptText(params.prompt);
        session.busy = true;
        try {
          const result = await runStreamTurn(session.ctx, text);
          session.promptCount += 1;
          session.preview = text.slice(0, 240);
          session.updatedAt = new Date().toISOString();
          sendResponse(id as number | string, {
            stopReason: result.stopReason,
            turns: result.turns,
          });
        } catch (err) {
          sendError(id, -32000, (err as Error).message);
        } finally {
          session.busy = false;
        }
        return;
      }

      case 'session/cancel': {
        const params = (msg.params ?? {}) as { sessionId?: string };
        const session = params.sessionId ? sessions.get(params.sessionId) : null;
        if (session) {
          session.abort.abort();
          // Reset controller so subsequent prompts can run.
          session.abort = new AbortController();
          session.ctx.abortController = session.abort;
        }
        if (isRequest) sendResponse(id as number | string, {});
        return;
      }

      case 'session/list': {
        if (!isRequest) return;
        sendResponse(id as number | string, {
          sessions: [...sessions.values()].map((s) => ({
            sessionId: s.id,
            cwd: s.cwd,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            promptCount: s.promptCount,
            busy: s.busy,
          })),
        });
        return;
      }

      case 'fs/read_text_file': {
        if (!isRequest) return;
        const params = (msg.params ?? {}) as { path?: string };
        try {
          const buf = await fs.readFile(params.path ?? '', 'utf8');
          sendResponse(id as number | string, { content: buf });
        } catch (err) {
          sendError(id, -32000, (err as Error).message);
        }
        return;
      }

      case 'fs/write_text_file': {
        if (!isRequest) return;
        const params = (msg.params ?? {}) as { path?: string; content?: string };
        try {
          const filePath = params.path ?? '';
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, params.content ?? '', 'utf8');
          sendResponse(id as number | string, {});
        } catch (err) {
          sendError(id, -32000, (err as Error).message);
        }
        return;
      }

      case 'session/request_permission': {
        // Auto-allow for now; a future UI can prompt the user.
        const params = (msg.params ?? {}) as {
          options?: Array<{ optionId: string; kind: string }>;
        };
        if (!autoAccept) {
          // Bubble the request up to the client via notification so an
          // interactive host can show a prompt. We still respond with
          // a "rejected_by_timeout" outcome that the model can recover
          // from; richer UIs will replace this once the client supports
          // permission bridges.
          sendNotification('session/permission_requested', params);
        }
        if (isRequest) {
          if (autoAccept) {
            const allowOpt =
              params.options?.find((o) => o.kind?.includes('allow')) ??
              params.options?.[0];
            sendResponse(id as number | string, {
              outcome: {
                outcome: 'selected',
                optionId: allowOpt?.optionId ?? 'allow',
              },
            });
          } else {
            sendResponse(id as number | string, {
              outcome: { outcome: 'cancelled' },
            });
          }
        }
        return;
      }

      default:
        if (isRequest) {
          sendError(id, -32601, `Method not found: ${msg.method}`);
        } else {
          process.stderr.write(`[acp] ignoring notification: ${msg.method}\n`);
        }
    }
  }

  async function createSession(cwd: string): Promise<AcpSession> {
    // Load a fresh Config each session so cwd & settings reflect the new session.
    const { loadCliConfig } = await import('./config/config.js');
    const { loadSettings } = await import('./config/settings.js');
    const { loadExtensions } = await import('./config/extension.js');
    const { validateAuthMethod } = await import('./config/auth.js');

    const effectiveCwd = cwd && existsSync(cwd) ? cwd : process.cwd();
    if (cwd && cwd !== effectiveCwd) {
      sendNotification('fs/working_dir_fallback', { requested: cwd, using: effectiveCwd });
    }
    process.chdir(effectiveCwd);

    const settings = loadSettings(effectiveCwd);
    const extensions = loadExtensions(effectiveCwd);
    const sessionId = newSessionId();
    const config = await loadCliConfig(
      settings.merged,
      extensions,
      sessionId,
      {
        ...baseArgv,
        cwd: effectiveCwd,
        sessionId,
        acp: true,
      } as unknown as Parameters<typeof loadCliConfig>[3],
    );
    await config.initialize();

    // Pick auth method
    const selectedAuthType =
      settings.merged.selectedAuthType ||
      (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL
        ? AuthType.USE_OPENAI
        : AuthType.USE_GEMINI);
    const err = validateAuthMethod(selectedAuthType);
    if (err) {
      throw new Error(err);
    }
    await config.refreshAuth(selectedAuthType);

    const geminiClient = config.getGeminiClient();
    const toolRegistry = await config.getToolRegistry();
    const chat: GeminiChat = await geminiClient.getChat();
    const abort = new AbortController();

    const session: AcpSession = {
      id: sessionId,
      cwd: effectiveCwd,
      abort,
      busy: false,
      promptCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      preview: '',
      ctx: {
        config,
        chat,
        toolRegistry,
        abortController: abort,
        sessionId,
        model: config.getModel?.() ?? baseArgv.model ?? '',
      },
    };
    sessions.set(sessionId, session);
    return session;
  }

  // Block forever - readline drives the loop.
  return new Promise<never>(() => {});
}

function extractPromptText(blocks?: Array<{ type: string; text?: string }>): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks
    .map((b) => {
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
      if (b.type === 'resource' && typeof (b as { text?: string }).text === 'string') {
        return `\n\n<resource>\n${(b as { text?: string }).text}\n</resource>`;
      }
      if (b.type === 'resource_link') {
        return `\n\n<resource_link uri="${(b as { uri?: string }).uri ?? ''}">`;
      }
      return '';
    })
    .join('')
    .trim();
}

void CLIENT_NAME;
void PROTOCOL_VERSION;
