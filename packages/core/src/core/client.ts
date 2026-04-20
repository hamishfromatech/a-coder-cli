/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EmbedContentParameters,
  GenerateContentConfig,
  Part,
  SchemaUnion,
  PartListUnion,
  Content,
  Tool,
  GenerateContentResponse,
} from '@google/genai';
import { getFolderStructure } from '../utils/getFolderStructure.js';
import {
  Turn,
  ServerGeminiStreamEvent,
  GeminiEventType,
  ChatCompressionInfo,
} from './turn.js';
import { Config } from '../config/config.js';
import { getCoreSystemPrompt, getCompressionPrompt } from './prompts.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { checkNextSpeaker } from '../utils/nextSpeakerChecker.js';
import { reportError } from '../utils/errorReporting.js';
import { retryWithBackoff } from '../utils/retry.js';
import { getErrorMessage } from '../utils/errors.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { tokenLimit } from './tokenLimits.js';
import { computeOutputTokenBudget } from './tokenBudget.js';
import {
  AuthType,
  ContentGenerator,
  ContentGeneratorConfig,
  createContentGenerator,
} from './contentGenerator.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { LoopDetectionService } from '../services/loopDetectionService.js';
import {
  ContextMonitor,
  ContextEvent,
  type ContextMonitorConfig,
} from './contextMonitor.js';
import { GeminiChat } from './geminiChat.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { PromptCacheTracker } from '../utils/promptCacheTracker.js';
import { startupProfiler } from '../utils/startupProfiler.js';

/**
 * Returns the index of the content after the fraction of the total characters in the history.
 *
 * Exported for testing purposes.
 */
export function findIndexAfterFraction(
  history: Content[],
  fraction: number,
): number {
  if (fraction <= 0 || fraction >= 1) {
    throw new Error('Fraction must be between 0 and 1');
  }

  const contentLengths = history.map(
    (content) => JSON.stringify(content).length,
  );

  const totalCharacters = contentLengths.reduce(
    (sum, length) => sum + length,
    0,
  );
  const targetCharacters = totalCharacters * fraction;

  let charactersSoFar = 0;
  for (let i = 0; i < contentLengths.length; i++) {
    charactersSoFar += contentLengths[i];
    if (charactersSoFar >= targetCharacters) {
      return i;
    }
  }
  return contentLengths.length;
}

export class GeminiClient {
  private chat?: GeminiChat;
  private contentGenerator?: ContentGenerator;
  private embeddingModel: string;
  private generateContentConfig: GenerateContentConfig = {
    temperature: 0,
    topP: 1,
  };
  private sessionTurnCount = 0;
  private readonly MAX_TURNS = 100;
  /**
   * Threshold for compression token count as a fraction of the model's token limit.
   * If the chat history exceeds this threshold, it will be compressed.
   */
  private readonly COMPRESSION_TOKEN_THRESHOLD = 0.7;
  /**
   * The fraction of the latest chat history to keep. A value of 0.3
   * means that only the last 30% of the chat history will be kept after compression.
   */
  private readonly COMPRESSION_PRESERVE_THRESHOLD = 0.3;

  private readonly loopDetector: LoopDetectionService;
  private readonly contextMonitor: ContextMonitor;
  private readonly compressionCircuitBreaker: CircuitBreaker;
  private readonly promptCacheTracker: PromptCacheTracker;
  private lastPromptId?: string;

  constructor(private config: Config) {
    if (config.getProxy()) {
      setGlobalDispatcher(new ProxyAgent(config.getProxy() as string));
    }

    this.embeddingModel = config.getEmbeddingModel();
    this.loopDetector = new LoopDetectionService(config);

    // Initialize context monitor with config
    const contextConfig = config.getContextManagementConfig();
    this.contextMonitor = new ContextMonitor({
      warningThreshold: contextConfig.warningThreshold,
      criticalThreshold: contextConfig.criticalThreshold,
      autoCompressThreshold: contextConfig.autoCompressThreshold,
      microcompactThreshold: contextConfig.microcompactThreshold,
    });

    // Circuit breaker for compression: max 3 consecutive failures before stopping
    this.compressionCircuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
      name: 'context-compression',
    });

    // Track prompt cache state to detect cache-break events
    this.promptCacheTracker = new PromptCacheTracker();
  }

  async initialize(contentGeneratorConfig: ContentGeneratorConfig) {
    startupProfiler.checkpoint('initialize-start');
    this.contentGenerator = await createContentGenerator(
      contentGeneratorConfig,
      this.config,
      this.config.getSessionId(),
    );
    startupProfiler.checkpoint('content-generator-ready');
    // Warm the API connection in parallel with chat setup.
    // The first API call pays TCP+TLS handshake cost (~100-200ms).
    // Firing this early overlaps that with startChat() work.
    const preconnectPromise = this.preconnect().catch(() => {
      // Preconnect is best-effort; failures are silently ignored.
      // The connection is still warmed even if the request "fails".
    });
    this.chat = await this.startChat();
    startupProfiler.checkpoint('chat-ready');
    // Don't await — preconnect runs concurrently for speed.
    // It will complete in the background.
    void preconnectPromise;
    startupProfiler.checkpoint('initialize-done');
    const report = startupProfiler.getReport();
    if (report) {
      console.debug(report);
    }
  }

  /**
   * Fires a minimal API request to warm the TCP+TLS connection
   * before the first real API call. This overlaps the connection
   * setup (~100-200ms) with other initialization work.
   */
  private async preconnect(): Promise<void> {
    try {
      const generator = this.getContentGenerator();
      await generator.countTokens({
        model: this.config.getModel(),
        contents: [{ role: 'user', parts: [{ text: '' }] }],
      });
    } catch {
      // Preconnect is best-effort — the TCP connection is warmed
      // even if the actual request fails with an API error.
    }
  }

  getContentGenerator(): ContentGenerator {
    if (!this.contentGenerator) {
      throw new Error('Content generator not initialized');
    }
    return this.contentGenerator;
  }

  async listModels(): Promise<string[]> {
    const generator = this.getContentGenerator();
    if (generator.listModels) {
      return generator.listModels();
    }
    return [];
  }

  async addHistory(content: Content) {
    this.getChat().addHistory(content);
  }

  getChat(): GeminiChat {
    if (!this.chat) {
      throw new Error('Chat not initialized');
    }
    return this.chat;
  }

  /**
   * Gets the current chat history token count
   */
  getChatHistoryTokenCount(): number {
    return this.getChat().getHistoryTokenCount();
  }

  isInitialized(): boolean {
    return this.chat !== undefined && this.contentGenerator !== undefined;
  }

  getHistory(): Content[] {
    return this.getChat().getHistory();
  }

  setHistory(history: Content[]) {
    this.getChat().setHistory(history);
  }

  async resetChat(): Promise<void> {
    this.chat = await this.startChat();
  }

  private async getEnvironment(): Promise<Part[]> {
    const cwd = this.config.getWorkingDir();
    const today = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const platform = process.platform;
    const folderStructure = await getFolderStructure(cwd, {
      fileService: this.config.getFileService(),
    });
    const context = `
  This is the A-Coder CLI. We are setting up the context for our chat.
  Today's date is ${today}.
  My operating system is: ${platform}
  I'm currently working in the directory: ${cwd}
  ${folderStructure}
          `.trim();

    const initialParts: Part[] = [{ text: context }];
    const toolRegistry = await this.config.getToolRegistry();

    // Add full file context if the flag is set
    if (this.config.getFullContext()) {
      try {
        const globTool = toolRegistry.getTool('glob');
        const readFileTool = toolRegistry.getTool('read_file');

        if (globTool && readFileTool) {
          // Use glob to discover all files, then read them in parallel
          const globResult = await globTool.execute(
            { pattern: '**/*', path: this.config.getTargetDir() },
            AbortSignal.timeout(30000),
          );

          if (
            globResult.llmContent &&
            typeof globResult.llmContent === 'string' &&
            !globResult.llmContent.startsWith('No files found')
          ) {
            const filePaths = globResult.llmContent
              .split('\n')
              .slice(1) // Skip header line
              .map((line: string) => line.trim())
              .filter(Boolean);

            if (filePaths.length > 0) {
              const readResults = await Promise.all(
                filePaths.map((filePath: string) =>
                  readFileTool
                    .execute(
                      { absolute_path: filePath },
                      AbortSignal.timeout(30000),
                    )
                    .then((result) => {
                      const content = result.llmContent;
                      if (typeof content === 'string') {
                        return `--- ${filePath} ---\n\n${content}\n\n`;
                      }
                      if (Array.isArray(content)) {
                        const text = (content as Array<Record<string, unknown>>)
                          .filter((p) => 'text' in p)
                          .map((p) => (p as { text: string }).text)
                          .join('\n');
                        return `--- ${filePath} ---\n\n${text}\n\n`;
                      }
                      return '';
                    })
                    .catch(() => ''),
                ),
              );

              const content = readResults.filter(Boolean).join('');
              if (content) {
                initialParts.push({
                  text: `\n--- Full File Context ---\n${content}`,
                });
              } else {
                console.warn(
                  'Full context requested, but no files could be read.',
                );
              }
            }
          } else {
            console.warn(
              'Full context requested, but glob found no files.',
            );
          }
        } else {
          console.warn(
            'Full context requested, but glob or read_file tool not found.',
          );
        }
      } catch (error) {
        // Not using reportError here as it's a startup/config phase, not a chat/generation phase error.
        console.error('Error reading full file context:', error);
        initialParts.push({
          text: '\n--- Error reading full file context ---',
        });
      }
    }

    return initialParts;
  }

  private async startChat(extraHistory?: Content[]): Promise<GeminiChat> {
    const envParts = await this.getEnvironment();
    const toolRegistry = await this.config.getToolRegistry();
    const toolDeclarations = toolRegistry.getFunctionDeclarations();
    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];
    const history: Content[] = [
      {
        role: 'user',
        parts: envParts,
      },
      {
        role: 'model',
        parts: [{ text: 'Got it. Thanks for the context!' }],
      },
      ...(extraHistory ?? []),
    ];
    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory);

      // Track prompt cache state for optimization insights
      if (this.config.getDebugMode()) {
        const cacheStatus = this.promptCacheTracker.checkAll(
          systemInstruction,
          toolDeclarations,
          this.config.getModel(),
        );
        if (!cacheStatus.overallHit) {
          if (cacheStatus.breakReason) {
            console.debug(
              `[PromptCache] Cache break: ${cacheStatus.breakReason.systemPromptChanged ? 'system prompt changed' : ''}${cacheStatus.breakReason.toolDeclarationsChanged ? ' tool declarations changed' : ''}${cacheStatus.breakReason.modelChanged ? ` model changed (${cacheStatus.breakReason.previousModel} → ${cacheStatus.breakReason.currentModel})` : ''}`.trim(),
            );
          } else {
            console.debug(
              `[PromptCache] Cache miss - systemPrompt: ${cacheStatus.systemPromptHit}, tools: ${cacheStatus.toolDeclarationsHit}, model: ${cacheStatus.modelHit}`,
            );
          }
        }
      }

      // Always enable thinking config - API will ignore it for unsupported models,
      // and Turn.run() will parse any <thinking> tags from the stream
      const generateContentConfigWithThinking = {
        ...this.generateContentConfig,
        thinkingConfig: {
          includeThoughts: true,
        },
      };
      return new GeminiChat(
        this.config,
        this.getContentGenerator(),
        {
          systemInstruction,
          ...generateContentConfigWithThinking,
          tools,
        },
        history,
      );
    } catch (error) {
      await reportError(
        error,
        'Error initializing Gemini chat session.',
        history,
        'startChat',
      );
      throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
    }
  }

  async *sendMessageStream(
    request: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = this.MAX_TURNS,
    originalModel?: string,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    if (this.lastPromptId !== prompt_id) {
      this.loopDetector.reset();
      this.lastPromptId = prompt_id;
    }
    this.sessionTurnCount++;
    if (
      this.config.getMaxSessionTurns() > 0 &&
      this.sessionTurnCount > this.config.getMaxSessionTurns()
    ) {
      yield { type: GeminiEventType.MaxSessionTurns };
      return new Turn(this.getChat(), prompt_id);
    }
    // Ensure turns never exceeds MAX_TURNS to prevent infinite loops
    const boundedTurns = Math.min(turns, this.MAX_TURNS);
    if (!boundedTurns) {
      return new Turn(this.getChat(), prompt_id);
    }

    // Track the original model from the first call to detect model switching
    const initialModel = originalModel || this.config.getModel();

    // Update the cached history token count before checking context
    await this.getChat().updateHistoryTokenCount();

    // Check context usage and emit warnings/compression trigger
    const contextConfig = this.config.getContextManagementConfig();
    if (contextConfig.enabled) {
      const currentTokens = this.getChatHistoryTokenCount();
      const model = this.config.getModel();
      const modelTokenLimit = tokenLimit(model);
      const contextUsage = this.contextMonitor.checkUsage(currentTokens, modelTokenLimit);

      if (contextUsage) {
        yield {
          type: GeminiEventType.ContextWarning,
          value: contextUsage,
        };

        // Auto-compress if at threshold
        if (contextUsage.event === ContextEvent.AUTO_COMPRESS) {
          const compressed = await this.tryCompressChat(prompt_id, true);
          if (compressed) {
            yield { type: GeminiEventType.ChatCompressed, value: compressed };
            // Update token count after compression
            await this.getChat().updateHistoryTokenCount();
          }
        }

        // Microcompact: incrementally remove old tool results at 50% threshold
        // This is cheaper than full compression and doesn't require an LLM call
        if (contextUsage.event === ContextEvent.MICRO_COMPACT) {
          const microResult = this.microcompact();
          if (microResult && microResult.removedCount > 0) {
            await this.getChat().updateHistoryTokenCount();
            const newTokens = this.getChatHistoryTokenCount();
            yield {
              type: GeminiEventType.ChatCompressed,
              value: { originalTokenCount: currentTokens, newTokenCount: newTokens },
            };
          }
        }
      }
    }

    const compressed = await this.tryCompressChat(prompt_id);

    if (compressed) {
      yield { type: GeminiEventType.ChatCompressed, value: compressed };
    }

    // Compute a dynamic output token budget based on context usage.
    // This helps avoid exceeding the model's total token limit when
    // the conversation history is large.
    let maxOutputTokens: number | undefined;
    const currentTokens = this.getChatHistoryTokenCount();
    const model = this.config.getModel();
    const modelTokenLimit = tokenLimit(model);
    const usagePercentage = modelTokenLimit > 0 ? currentTokens / modelTokenLimit : 0;
    maxOutputTokens = computeOutputTokenBudget(
      modelTokenLimit,
      currentTokens,
      usagePercentage,
    );

    const turn = new Turn(this.getChat(), prompt_id, maxOutputTokens);
    const resultStream = turn.run(request, signal);
    for await (const event of resultStream) {
      const loopResult = this.loopDetector.addAndCheck(event);
      if (loopResult.detected) {
        // Instead of halting, silently inject a user message to break the loop
        // and continue the conversation
        yield { type: GeminiEventType.LoopDetected };
        this.loopDetector.reset();

        const loopMessage =
          loopResult.loopType === 'consecutive_identical_tool_calls'
            ? 'You are in a loop — you have been making the same tool call repeatedly. Stop repeating that call. Move on to a different approach or summarize what you know so far instead of reading the same file again.'
            : 'You are in a loop — you have been repeating the same text. Stop repeating yourself and provide a different response.';

        // Start a new turn with the loop-breaking message and continue
        const continuationStream = this.sendMessageStream(
          [{ text: loopMessage }],
          signal,
          prompt_id,
          boundedTurns - 1,
          initialModel,
        );
        yield* continuationStream;
        return turn;
      }
      yield event;
    }
    if (!turn.pendingToolCalls.length && signal && !signal.aborted) {
      // Check if model was switched during the call (likely due to quota error)
      const currentModel = this.config.getModel();
      if (currentModel !== initialModel) {
        // Model was switched (likely due to quota error fallback)
        // Don't continue with recursive call to prevent unwanted Flash execution
        return turn;
      }

      const nextSpeakerCheck = await checkNextSpeaker(
        this.getChat(),
        this,
        signal,
      );
      if (nextSpeakerCheck?.next_speaker === 'model') {
        const nextRequest = [{ text: 'Please continue.' }];
        // This recursive call's events will be yielded out, but the final
        // turn object will be from the top-level call.
        yield* this.sendMessageStream(
          nextRequest,
          signal,
          prompt_id,
          boundedTurns - 1,
          initialModel,
        );
      }
    }
    return turn;
  }

  async generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model?: string,
    config: GenerateContentConfig = {},
  ): Promise<Record<string, unknown>> {
    // Use current model from config instead of hardcoded Flash model
    const modelToUse =
      model || this.config.getModel() || DEFAULT_GEMINI_FLASH_MODEL;
    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory);
      const requestConfig = {
        abortSignal,
        ...this.generateContentConfig,
        ...config,
      };

      const apiCall = () =>
        this.getContentGenerator().generateContent({
          model: modelToUse,
          config: {
            ...requestConfig,
            systemInstruction,
            responseSchema: schema,
            responseMimeType: 'application/json',
          },
          contents,
        });

      const result = await retryWithBackoff(apiCall, {
        onPersistent429: async (authType?: string, error?: unknown) =>
          await this.handleFlashFallback(authType, error),
        authType: this.config.getContentGeneratorConfig()?.authType,
      });

      const text = getResponseText(result);
      if (!text) {
        const error = new Error(
          'API returned an empty response for generateJson.',
        );
        await reportError(
          error,
          'Error in generateJson: API returned an empty response.',
          {
            originalRequestContents: contents,
            rawApiResult: result,
          },
          'generateJson-empty-response',
        );
        throw error;
      }
      try {
        // 1. First, try to strip thinking tags to avoid confusion during JSON extraction
        const textWithoutThoughts = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        
        // 2. Try to extract JSON from various formats, starting with the cleanest text
        const extractionCandidates = [textWithoutThoughts, text];
        const extractors = [
          // Match ```json ... ``` or ``` ... ``` blocks
          /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
          // Match inline code blocks `{...}`
          /`(\{[\s\S]*?\})`/,
          // Match raw JSON objects or arrays - try to find the largest/outermost one
          /(\{[\s\S]*\}|\[[\s\S]*\])/,
        ];

        for (const candidate of extractionCandidates) {
          if (!candidate) continue;
          
          for (const regex of extractors) {
            const match = candidate.match(regex);
            if (match && match[1]) {
              try {
                return JSON.parse(match[1].trim());
              } catch {
                // Continue to next pattern if parsing fails
                continue;
              }
            }
          }

          // If no patterns matched for this candidate, try parsing the entire candidate
          try {
            return JSON.parse(candidate.trim());
          } catch {
            // Continue to next candidate
          }
        }

        // If we reached here, we couldn't parse anything as JSON
        throw new Error('No valid JSON found in response');
      } catch (parseError) {
        await reportError(
          parseError,
          'Failed to parse JSON response from generateJson.',
          {
            responseTextFailedToParse: text,
            originalRequestContents: contents,
          },
          'generateJson-parse',
        );
        throw new Error(
          `Failed to parse API response as JSON: ${getErrorMessage(parseError)}`,
        );
      }
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }

      // Avoid double reporting for the empty response case handled above
      if (
        error instanceof Error &&
        error.message === 'API returned an empty response for generateJson.'
      ) {
        throw error;
      }

      await reportError(
        error,
        'Error generating JSON content via API.',
        contents,
        'generateJson-api',
      );
      throw new Error(
        `Failed to generate JSON content: ${getErrorMessage(error)}`,
      );
    }
  }

  async generateContent(
    contents: Content[],
    generationConfig: GenerateContentConfig,
    abortSignal: AbortSignal,
    model?: string,
  ): Promise<GenerateContentResponse> {
    const modelToUse = model ?? this.config.getModel();
    const configToUse: GenerateContentConfig = {
      ...this.generateContentConfig,
      ...generationConfig,
    };

    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory);

      const requestConfig = {
        abortSignal,
        ...configToUse,
        systemInstruction,
      };

      const apiCall = () =>
        this.getContentGenerator().generateContent({
          model: modelToUse,
          config: requestConfig,
          contents,
        });

      const result = await retryWithBackoff(apiCall, {
        onPersistent429: async (authType?: string, error?: unknown) =>
          await this.handleFlashFallback(authType, error),
        authType: this.config.getContentGeneratorConfig()?.authType,
      });
      return result;
    } catch (error: unknown) {
      if (abortSignal.aborted) {
        throw error;
      }

      await reportError(
        error,
        `Error generating content via API with model ${modelToUse}.`,
        {
          requestContents: contents,
          requestConfig: configToUse,
        },
        'generateContent-api',
      );
      throw new Error(
        `Failed to generate content with model ${modelToUse}: ${getErrorMessage(error)}`,
      );
    }
  }

  async generateEmbedding(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }
    const embedModelParams: EmbedContentParameters = {
      model: this.embeddingModel,
      contents: texts,
    };

    const embedContentResponse =
      await this.getContentGenerator().embedContent(embedModelParams);
    if (
      !embedContentResponse.embeddings ||
      embedContentResponse.embeddings.length === 0
    ) {
      throw new Error('No embeddings found in API response.');
    }

    if (embedContentResponse.embeddings.length !== texts.length) {
      throw new Error(
        `API returned a mismatched number of embeddings. Expected ${texts.length}, got ${embedContentResponse.embeddings.length}.`,
      );
    }

    return embedContentResponse.embeddings.map((embedding, index) => {
      const values = embedding.values;
      if (!values || values.length === 0) {
        throw new Error(
          `API returned an empty embedding for input text at index ${index}: "${texts[index]}"`,
        );
      }
      return values;
    });
  }

  async tryCompressChat(
    prompt_id: string,
    force: boolean = false,
  ): Promise<ChatCompressionInfo | null> {
    // Check circuit breaker — if compression has failed too many times, skip it
    if (!this.compressionCircuitBreaker.canExecute()) {
      console.warn(
        'Context compression circuit breaker is open — skipping compression. ' +
        'Compression has failed too many times consecutively.',
      );
      return null;
    }

    const curatedHistory = this.getChat().getHistory(true);

    // Regardless of `force`, don't do anything if the history is empty.
    if (curatedHistory.length === 0) {
      return null;
    }

    const model = this.config.getModel();
    const configMaxTokens = this.config.getMaxTokens();
    const effectiveTokenLimit =
      configMaxTokens > 0 ? configMaxTokens : tokenLimit(model);

    const { totalTokens: originalTokenCount } =
      await this.getContentGenerator().countTokens({
        model,
        contents: curatedHistory,
      });
    if (originalTokenCount === undefined) {
      console.warn(`Could not determine token count for model ${model}.`);
      return null;
    }

    // Don't compress if not forced and we are under the limit.
    if (!force && originalTokenCount < this.COMPRESSION_TOKEN_THRESHOLD * effectiveTokenLimit) {
      return null;
    }

    let compressBeforeIndex = findIndexAfterFraction(
      curatedHistory,
      1 - this.COMPRESSION_PRESERVE_THRESHOLD,
    );
    // Find the first user message after the index. This is the start of the next turn.
    while (
      compressBeforeIndex < curatedHistory.length &&
      (curatedHistory[compressBeforeIndex]?.role === 'model' ||
        isFunctionResponse(curatedHistory[compressBeforeIndex]))
    ) {
      compressBeforeIndex++;
    }

    const historyToCompress = curatedHistory.slice(0, compressBeforeIndex);
    const historyToKeep = curatedHistory.slice(compressBeforeIndex);

    // Save a backup of the full history so we can restore on failure.
    // setHistory below mutates the chat, and if sendMessage fails,
    // the retained portion would be lost.
    const fullHistoryBackup = this.getChat().getHistory();

    this.getChat().setHistory(historyToCompress);

    let summary: string;
    try {
      const result = await this.getChat().sendMessage(
        {
          message: {
            text: 'First, reason in your scratchpad. Then, generate the <state_snapshot>.',
          },
          config: {
            systemInstruction: { text: getCompressionPrompt() },
          },
        },
        prompt_id,
      );
      summary = result.text ?? '';
      this.compressionCircuitBreaker.recordSuccess();
    } catch (err) {
      // Restore the full history on compression failure
      this.getChat().setHistory(fullHistoryBackup);
      this.compressionCircuitBreaker.recordFailure();
      throw err;
    }
    this.chat = await this.startChat([
      {
        role: 'user',
        parts: [{ text: summary }],
      },
      {
        role: 'model',
        parts: [{ text: 'Got it. Thanks for the additional context!' }],
      },
      ...historyToKeep,
    ]);

    const { totalTokens: newTokenCount } =
      await this.getContentGenerator().countTokens({
        // model might change after calling `sendMessage`, so we get the newest value from config
        model: this.config.getModel(),
        contents: this.getChat().getHistory(),
      });
    if (newTokenCount === undefined) {
      console.warn('Could not determine compressed history token count.');
      return null;
    }

    return {
      originalTokenCount,
      newTokenCount,
    };
  }

  /**
   * Incrementally removes old tool results from history without an LLM call.
   * This is much cheaper than full compression and preserves the cache prefix.
   * Only triggers when context usage exceeds the microcompact threshold (default: 50%).
   *
   * Modeled after Claude Code's microCompact pattern which removes tool results
   * to free up context without invalidating the cached prompt prefix.
   */
  private microcompact(): { removedCount: number } | null {
    const curatedHistory = this.getChat().getHistory(true);
    if (curatedHistory.length < 4) return null;

    const model = this.config.getModel();
    const modelTokenLimit = tokenLimit(model);
    const currentTokens = this.getChatHistoryTokenCount();

    // Only microcompact when context exceeds 50% of the model's limit
    if (currentTokens < modelTokenLimit * 0.5) return null;

    // Find function-response entries in the first 40% of history
    const cutoffIndex = Math.floor(curatedHistory.length * 0.4);
    let removedCount = 0;
    const newHistory: Content[] = [];

    for (let i = 0; i < curatedHistory.length; i++) {
      const entry = curatedHistory[i];

      // Keep entries that are: user messages, model text responses, or in the recent window
      if (i >= cutoffIndex || !isFunctionResponse(entry)) {
        newHistory.push(entry);
      } else {
        // Replace removed function-response pairs with a brief placeholder
        // to maintain conversation coherence
        if (removedCount === 0) {
          newHistory.push({
            role: 'user',
            parts: [{ text: '[Earlier tool results removed for context management]' }],
          });
        }
        removedCount++;
      }
    }

    if (removedCount === 0) return null;

    this.getChat().setHistory(newHistory);
    return { removedCount };
  }

  /**
   * Handles fallback to Flash model when persistent 429 errors occur for OAuth users.
   * Uses a fallback handler if provided by the config, otherwise returns null.
   */
  private async handleFlashFallback(
    authType?: string,
    error?: unknown,
  ): Promise<string | null> {
    // Only handle fallback for OAuth users
    if (authType !== AuthType.LOGIN_WITH_GOOGLE) {
      return null;
    }

    const currentModel = this.config.getModel();
    const fallbackModel = DEFAULT_GEMINI_FLASH_MODEL;

    // Don't fallback if already using Flash model
    if (currentModel === fallbackModel) {
      return null;
    }

    // Check if config has a fallback handler (set by CLI package)
    const fallbackHandler = this.config.flashFallbackHandler;
    if (typeof fallbackHandler === 'function') {
      try {
        const accepted = await fallbackHandler(
          currentModel,
          fallbackModel,
          error,
        );
        if (accepted !== false && accepted !== null) {
          this.config.setModel(fallbackModel);
          return fallbackModel;
        }
        // Check if the model was switched manually in the handler
        if (this.config.getModel() === fallbackModel) {
          return null; // Model was switched but don't continue with current prompt
        }
      } catch (error) {
        console.warn('Flash fallback handler failed:', error);
      }
    }

    return null;
  }
}
