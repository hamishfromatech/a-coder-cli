/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Box,
  DOMElement,
  measureElement,
  Static,
  Text,
  useApp,
  useStdin,
  useStdout,
} from 'ink';
import { StreamingState, type HistoryItem, MessageType, type FocusMode } from './types.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { useGeminiStream } from './hooks/useGeminiStream.js';
import { useLoadingIndicator } from './hooks/useLoadingIndicator.js';
import { useThemeCommand } from './hooks/useThemeCommand.js';
import { useAuthCommand } from './hooks/useAuthCommand.js';
import { useEditorSettings } from './hooks/useEditorSettings.js';
import { useSkillsCommand } from './hooks/useSkillsCommand.js';
import { useSlashCommandProcessor } from './hooks/slashCommandProcessor.js';
import { useAutoAcceptIndicator } from './hooks/useAutoAcceptIndicator.js';
import { useConsoleMessages } from './hooks/useConsoleMessages.js';
import { useWebBridge } from './hooks/useWebBridge.js';
import { Header } from './components/Header.js';
import { LoadingIndicator } from './components/LoadingIndicator.js';
import { ShellOutputViewer } from './components/ShellOutputViewer.js';
import { InputPrompt } from './components/InputPrompt.js';
import { Footer } from './components/Footer.js';
import { useBackgroundShells } from './hooks/useBackgroundShells.js';
import { ThemeDialog } from './components/ThemeDialog.js';
import { AuthDialog } from './components/AuthDialog.js';
import { AuthInProgress } from './components/AuthInProgress.js';
import { EditorSettingsDialog } from './components/EditorSettingsDialog.js';
import { SkillsDialog } from './components/SkillsDialog.js';
import { ModelDialog } from './components/ModelDialog.js';
import { Colors } from './colors.js';
import { Help } from './components/Help.js';
import { loadHierarchicalGeminiMemory } from '../config/config.js';
import { LoadedSettings } from '../config/settings.js';
import { Tips } from './components/Tips.js';
import { ConsolePatcher } from './utils/ConsolePatcher.js';
import { registerCleanup } from '../utils/cleanup.js';
import { DetailedMessagesDisplay } from './components/DetailedMessagesDisplay.js';
import { HistoryItemDisplay } from './components/HistoryItemDisplay.js';
import { ToDoList } from './components/ToDoList.js';
import { QueryQueueList } from './components/QueryQueueList.js';
import { useHistory } from './hooks/useHistoryManager.js';
import process from 'node:process';
import {
  getErrorMessage,
  type Config,
  getAllGeminiMdFilenames,
  ApprovalMode,
  isEditorAvailable,
  EditorType,
  FlashFallbackEvent,
  logFlashFallback,
} from '@a-coder/core';
import { validateAuthMethod } from '../config/auth.js';
import { useLogger } from './hooks/useLogger.js';
import { useModelCommand } from './hooks/useModelCommand.js';
import { StreamingContext } from './contexts/StreamingContext.js';
import {
  SessionStatsProvider,
  useSessionStats,
} from './contexts/SessionContext.js';
import { useGitBranchName } from './hooks/useGitBranchName.js';
import { useTextBuffer } from './components/shared/text-buffer.js';
import * as fs from 'fs';
import { StaticHistoryArea } from './components/StaticHistoryArea.js';
import { StatusBar } from './components/StatusBar.js';
import {
  isProQuotaExceededError,
  isGenericQuotaExceededError,
  UserTierId,
} from '@a-coder/core';
import { checkForUpdates } from './utils/updateCheck.js';
import ansiEscapes from 'ansi-escapes';
import { OverflowProvider } from './contexts/OverflowContext.js';
import { DialogProvider } from './contexts/DialogContext.js';
import { UIStateProvider } from './contexts/UIStateContext.js';
import { ShowMoreLines } from './components/ShowMoreLines.js';
import { PrivacyNotice } from './privacy/PrivacyNotice.js';
import { useUIState } from './contexts/UIStateContext.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { LAYOUT } from './constants.js';

interface AppProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  version: string;
}

export const AppWrapper = (props: AppProps) => (
  <SessionStatsProvider>
    <DialogProvider>
      <UIStateProvider>
        <App {...props} />
      </UIStateProvider>
    </DialogProvider>
  </SessionStatsProvider>
);

const App = ({ config, settings, startupWarnings = [], version }: AppProps) => {
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const { stdout } = useStdout();
  const { exit: inkExit } = useApp();
  const nightly = version.includes('nightly');

  useEffect(() => {
    checkForUpdates().then(setUpdateMessage);
  }, []);

  const { history, addItem, clearItems, loadHistory } = useHistory();
  const {
    consoleMessages,
    handleNewMessage,
    clearConsoleMessages: clearConsoleMessagesState,
  } = useConsoleMessages();

  useEffect(() => {
    const consolePatcher = new ConsolePatcher({
      onNewMessage: handleNewMessage,
      debugMode: config.getDebugMode(),
    });
    consolePatcher.patch();
    registerCleanup(consolePatcher.cleanup);
  }, [handleNewMessage, config]);

  const { stats: sessionStats } = useSessionStats();
  const [staticNeedsRefresh, setStaticNeedsRefresh] = useState(false);
  const [staticKey, setStaticKey] = useState(0);
  const refreshStatic = useCallback(() => {
    stdout.write(ansiEscapes.clearTerminal);
    setStaticKey((prev) => prev + 1);
  }, [setStaticKey, stdout]);

  // Sliding window for message history: keep the last MAX_VISIBLE_HISTORY items
  // in the Static component to prevent excessive re-rendering in long sessions
  const MAX_VISIBLE_HISTORY = LAYOUT.maxVisibleHistory;
  const [archivedCount, setArchivedCount] = useState(0);
  useEffect(() => {
    if (history.length > MAX_VISIBLE_HISTORY) {
      setArchivedCount(history.length - MAX_VISIBLE_HISTORY);
    } else {
      setArchivedCount(0);
    }
  }, [history.length]);

  const [geminiMdFileCount, setGeminiMdFileCount] = useState<number>(0);
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [footerHeight, setFooterHeight] = useState<number>(0);
  const [currentModel, setCurrentModel] = useState(config.getModel());
  const [shellModeActive, setShellModeActive] = useState(false);
  const {
    showErrorDetails,
    toggleErrorDetails,
    showThinking: showThinkingFromContext,
    toggleThinking,
    showToolDescriptions,
    setShowToolDescriptions,
    constrainHeight,
    setConstrainHeight,
    corgiMode,
    toggleCorgiMode,
  } = useUIState();

  const [ctrlCPressedOnce, setCtrlCPressedOnce] = useState(false);
  const ctrlCPressedOnceRef = useRef(false);
  const [quittingMessages, setQuittingMessages] = useState<
    HistoryItem[] | null
  >(null);
  const ctrlCTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [ctrlDPressedOnce, setCtrlDPressedOnce] = useState(false);
  const ctrlDPressedOnceRef = useRef(false);
  const ctrlDTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState<boolean>(false);
  const [modelSwitchedFromQuotaError, setModelSwitchedFromQuotaError] =
    useState<boolean>(false);
  const [userTier, setUserTier] = useState<UserTierId | undefined>(undefined);
  const [contextUsage, setContextUsage] = useState<{
    tokens: number;
    limit: number;
    percentage: number;
  } | null>(null);

  // Background shell state
  const {
    backgroundShells,
    spawnBackgroundShell,
    killShell,
  } = useBackgroundShells();
  const [focusMode, setFocusMode] = useState<FocusMode>('input');
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null);

  const openPrivacyNotice = useCallback(() => {
    setShowPrivacyNotice(true);
  }, []);
  const initialPromptSubmitted = useRef(false);

  const errorCount = useMemo(
    () => consoleMessages.filter((msg) => msg.type === 'error').length,
    [consoleMessages],
  );

  const {
    isThemeDialogOpen,
    openThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  } = useThemeCommand(settings, setThemeError, addItem);

  const {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating,
    cancelAuthentication,
    isManualTrigger,
  } = useAuthCommand(settings, setAuthError, config, inkExit);

  const { isModelDialogOpen, openModelDialog, handleModelSelect, availableModels } =
    useModelCommand(config, settings, addItem);

  useEffect(() => {
    if (settings.merged.selectedAuthType) {
      const error = validateAuthMethod(settings.merged.selectedAuthType);
      if (error) {
        setAuthError(error);
        openAuthDialog();
      }
    } else if (
      !process.env.OPENAI_API_KEY &&
      !process.env.OPENAI_BASE_URL &&
      !process.env.GEMINI_API_KEY
    ) {
      // No auth configured and no env vars — open auth dialog to guide setup
      openAuthDialog();
    }
  }, [settings.merged.selectedAuthType, openAuthDialog, setAuthError]);

  // Sync user tier from config when authentication changes
  useEffect(() => {
    const syncUserTier = async () => {
      try {
        const configUserTier = await config.getUserTier();
        if (configUserTier !== userTier) {
          setUserTier(configUserTier);
        }
      } catch (error) {
        // Silently fail - this is not critical functionality
        // Only log in debug mode to avoid cluttering the console
        if (config.getDebugMode()) {
          console.debug('Failed to sync user tier:', error);
        }
      }
    };

    // Only sync when not currently authenticating
    if (!isAuthenticating) {
      syncUserTier();
    }
  }, [config, userTier, isAuthenticating]);

  const {
    isEditorDialogOpen,
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
  } = useEditorSettings(settings, setEditorError, addItem);

  const {
    isSkillsDialogOpen,
    openSkillsDialog,
    handleSkillSelect,
    availableSkills,
  } = useSkillsCommand(addItem, (query) => submitQuery(query), config);

  const performMemoryRefresh = useCallback(async () => {
    addItem(
      {
        type: MessageType.INFO,
        text: 'Refreshing hierarchical memory (A-CODER.md or other context files)...',
      },
      Date.now(),
    );
    try {
      const { memoryContent, fileCount } = await loadHierarchicalGeminiMemory(
        process.cwd(),
        config.getDebugMode(),
        config.getFileService(),
        config.getExtensionContextFilePaths(),
      );
      config.setUserMemory(memoryContent);
      config.setGeminiMdFileCount(fileCount);
      setGeminiMdFileCount(fileCount);

      addItem(
        {
          type: MessageType.INFO,
          text: `Memory refreshed successfully. ${memoryContent.length > 0 ? `Loaded ${memoryContent.length} characters from ${fileCount} file(s).` : 'No memory content found.'}`,
        },
        Date.now(),
      );
      if (config.getDebugMode()) {
        console.log(
          `[DEBUG] Refreshed memory content in config: ${memoryContent.substring(0, 200)}...`,
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      addItem(
        {
          type: MessageType.ERROR,
          text: `Error refreshing memory: ${errorMessage}`,
        },
        Date.now(),
      );
      console.error('Error refreshing memory:', error);
    }
  }, [config, addItem]);

  // Watch for model changes (e.g., from Flash fallback)
  useEffect(() => {
    // Subscribe to model changes from config
    const unsubscribe = config.onModelChange((newModel) => {
      setCurrentModel(newModel);
    });

    // Initial check (in case it changed before subscription)
    const configModel = config.getModel();
    if (configModel !== currentModel) {
      setCurrentModel(configModel);
    }

    return () => {
      unsubscribe();
    };
  }, [config, currentModel]);

  // Set up Flash fallback handler
  useEffect(() => {
    const flashFallbackHandler = async (
      currentModel: string,
      fallbackModel: string,
      error?: unknown,
    ): Promise<boolean> => {
      let message: string;

      // Use actual user tier if available, otherwise default to FREE tier behavior (safe default)
      const isPaidTier =
        userTier === UserTierId.LEGACY || userTier === UserTierId.STANDARD;

      // Check if this is a Pro quota exceeded error
      if (error && isProQuotaExceededError(error)) {
        if (isPaidTier) {
          message = `You have reached your daily ${currentModel} quota limit.
Automatically switching from ${currentModel} to ${fallbackModel} for the remainder of this session.
To continue accessing the ${currentModel} model today, consider using /auth to switch to a paid API key from AI Studio at https://aistudio.google.com/apikey`;
        } else {
          message = `You have reached your daily ${currentModel} quota limit.
Automatically switching from ${currentModel} to ${fallbackModel} for the remainder of this session.
To increase your limits, upgrade to a Gemini Code Assist Standard or Enterprise plan with higher limits at https://goo.gle/set-up-gemini-code-assist
Or you can utilize a Gemini API Key. See: https://goo.gle/a-coder-cli-docs-auth#gemini-api-key
You can switch authentication methods by typing /auth`;
        }
      } else if (error && isGenericQuotaExceededError(error)) {
        if (isPaidTier) {
          message = `You have reached your daily quota limit.
Automatically switching from ${currentModel} to ${fallbackModel} for the remainder of this session.
To continue accessing the ${currentModel} model today, consider using /auth to switch to a paid API key from AI Studio at https://aistudio.google.com/apikey`;
        } else {
          message = `You have reached your daily quota limit.
Automatically switching from ${currentModel} to ${fallbackModel} for the remainder of this session.
To increase your limits, upgrade to a Gemini Code Assist Standard or Enterprise plan with higher limits at https://goo.gle/set-up-gemini-code-assist
Or you can utilize a Gemini API Key. See: https://goo.gle/a-coder-cli-docs-auth#gemini-api-key
You can switch authentication methods by typing /auth`;
        }
      } else {
        if (isPaidTier) {
          // Default fallback message for other cases (like consecutive 429s)
          message = `Automatically switching from ${currentModel} to ${fallbackModel} for faster responses for the remainder of this session.
Possible reasons: multiple consecutive capacity errors or daily ${currentModel} quota limit
To continue with ${currentModel} today, consider using /auth to switch to a paid API key from AI Studio at https://aistudio.google.com/apikey`;
        } else {
          // Default fallback message for other cases (like consecutive 429s)
          message = `Automatically switching from ${currentModel} to ${fallbackModel} for faster responses for the remainder of this session.
Possible reasons: multiple consecutive capacity errors or daily ${currentModel} quota limit
To increase your limits, upgrade to a Gemini Code Assist Standard or Enterprise plan with higher limits at https://goo.gle/set-up-gemini-code-assist
Or utilize a Gemini API Key. See: https://goo.gle/a-coder-cli-docs-auth#gemini-api-key
You can switch authentication methods by typing /auth`;
        }
      }

      // Add message to UI history
      addItem(
        {
          type: MessageType.INFO,
          text: message,
        },
        Date.now(),
      );

      // Set the flag to prevent tool continuation
      setModelSwitchedFromQuotaError(true);
      // Set global quota error flag to prevent Flash model calls
      config.setQuotaErrorOccurred(true);
      // Switch model for future use but return false to stop current retry
      config.setModel(fallbackModel);
      logFlashFallback(
        config,
        new FlashFallbackEvent(config.getContentGeneratorConfig().authType!),
      );
      return false; // Don't continue with current prompt
    };

    config.setFlashFallbackHandler(flashFallbackHandler);
  }, [config, addItem, userTier]);

  const {
    handleSlashCommand,
    slashCommands,
    pendingHistoryItems: pendingSlashCommandHistoryItems,
    commandContext,
  } = useSlashCommandProcessor(
    config,
    settings,
    history,
    addItem,
    clearItems,
    loadHistory,
    refreshStatic,
    setShowHelp,
    setDebugMessage,
    openThemeDialog,
    openAuthDialog,
    openModelDialog,
    openEditorDialog,
    openSkillsDialog,
    toggleCorgiMode,
    showToolDescriptions,
    setQuittingMessages,
    openPrivacyNotice,
    inkExit,
  );
  const pendingHistoryItems = [...pendingSlashCommandHistoryItems];

  const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();
  const isInitialMount = useRef(true);
  const { stdin, setRawMode } = useStdin();
  const isValidPath = useCallback((filePath: string): boolean => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch (_e) {
      return false;
    }
  }, []);

  const inputWidth = Math.max(LAYOUT.minInputWidth, terminalWidth - 8);
  const suggestionsWidth = Math.max(LAYOUT.minInputWidth, terminalWidth - 10);

  const buffer = useTextBuffer({
    initialText: '',
    viewport: { height: 10, width: inputWidth },
    stdin,
    setRawMode,
    isValidPath,
    shellModeActive,
  });

  useEffect(() => {
    if (config) {
      setGeminiMdFileCount(config.getGeminiMdFileCount());
    }
  }, [config]);

  const getPreferredEditor = useCallback(() => {
    const editorType = settings.merged.preferredEditor;
    const isValidEditor = isEditorAvailable(editorType);
    if (!isValidEditor) {
      openEditorDialog();
      return;
    }
    return editorType as EditorType;
  }, [settings, openEditorDialog]);

  const onAuthError = useCallback(() => {
    setAuthError('reauth required');
    openAuthDialog();
  }, [openAuthDialog, setAuthError]);

  const {
    streamingState,
    submitQuery,
    cancelCurrentTask,
    initError,
    pendingHistoryItems: pendingGeminiHistoryItems,
    thought,
    todos,
    queryQueue,
  } = useGeminiStream(
    config.getGeminiClient(),
    history,
    addItem,
    setShowHelp,
    config,
    setDebugMessage,
    handleSlashCommand,
    shellModeActive,
    getPreferredEditor,
    onAuthError,
    performMemoryRefresh,
    modelSwitchedFromQuotaError,
    setModelSwitchedFromQuotaError,
    (tokens: number, limit: number) => {
      setContextUsage({
        tokens,
        limit,
        percentage: tokens / limit,
      });
    },
  );
  pendingHistoryItems.push(...pendingGeminiHistoryItems);
  const { elapsedTime, currentLoadingPhrase } =
    useLoadingIndicator(streamingState);
  const showAutoAcceptIndicator = useAutoAcceptIndicator({ config });

  // Integrate with web interface
  useWebBridge({
    submitQuery: (query: string) => {
      submitQuery(query);
    },
    addItem,
    history,
    streamingState,
  });

  useKeyboardShortcuts({
    showHelp,
    setShowHelp,
    showToolDescriptions,
    setShowToolDescriptions,
    constrainHeight,
    setConstrainHeight,
    streamingState,
    cancelCurrentTask,
    buffer,
    config,
    handleSlashCommand,
    toggleThinking,
    toggleErrorDetails,
    slashCommands,
    commandContext,
    inkExit,
    ctrlCPressedOnceRef,
    setCtrlCPressedOnce,
    ctrlCTimerRef,
    ctrlDPressedOnceRef,
    setCtrlDPressedOnce,
    ctrlDTimerRef,
    focusMode,
    setFocusMode,
    selectedShellId,
    setSelectedShellId,
    backgroundShells,
    killShell,
    isThemeDialogOpen,
    isAuthDialogOpen,
    isAuthenticating,
    isModelDialogOpen,
    isEditorDialogOpen,
    isSkillsDialogOpen,
    showPrivacyNotice,
  });

  const handleFinalSubmit = useCallback(
    (submittedValue: string) => {
      try {
        const trimmedValue = submittedValue.trim();
        // Show help when user sends "?" by itself
        if (trimmedValue === '?') {
          setShowHelp((prev) => !prev);
          return;
        }
        if (trimmedValue.length > 0) {
          // Preserve pastedInfo if present by passing the original string.
          // Note: submittedValue may have a pastedInfo property attached by InputPrompt.
          submitQuery(submittedValue);
        }
      } catch (err) {
        console.error('[App] Error in handleFinalSubmit:', err);
      }
    },
    [submitQuery],
  );

  const logger = useLogger();
  const [userMessages, setUserMessages] = useState<string[]>([]);
  const pastMessagesRef = useRef<string[]>([]);

  // Fetch past messages from logger only once on mount
  useEffect(() => {
    const fetchPastMessages = async () => {
      const pastMessagesRaw = (await logger?.getPreviousUserMessages()) || [];
      pastMessagesRef.current = pastMessagesRaw;
    };
    fetchPastMessages();
  }, [logger]);

  // Derive user messages from current session + cached past messages
  useEffect(() => {
    const currentSessionUserMessages = history
      .filter(
        (item): item is HistoryItem & { type: 'user'; text: string } =>
          item.type === 'user' &&
          typeof item.text === 'string' &&
          item.text.trim() !== '',
      )
      .map((item) => item.text)
      .reverse(); // Newest first, to match pastMessagesRaw sorting

    // Combine, with current session messages being more recent
    const combinedMessages = [
      ...currentSessionUserMessages,
      ...pastMessagesRef.current,
    ];

    // Deduplicate consecutive identical messages from the combined list (still newest first)
    const deduplicatedMessages: string[] = [];
    if (combinedMessages.length > 0) {
      deduplicatedMessages.push(combinedMessages[0]); // Add the newest one unconditionally
      for (let i = 1; i < combinedMessages.length; i++) {
        if (combinedMessages[i] !== combinedMessages[i - 1]) {
          deduplicatedMessages.push(combinedMessages[i]);
        }
      }
    }
    // Reverse to oldest first for useInputHistory
    setUserMessages(deduplicatedMessages.reverse());
  }, [history]);

  const isInputActive = !initError && !showHelp;
  const isInputFocused =
    !showHelp &&
    (streamingState === StreamingState.Idle ||
      streamingState === StreamingState.Responding);

  const handleClearScreen = useCallback(() => {
    clearItems();
    clearConsoleMessagesState();
    console.clear();
    refreshStatic();
  }, [clearItems, clearConsoleMessagesState, refreshStatic]);

  const mainControlsRef = useRef<DOMElement>(null);
  const pendingHistoryItemRef = useRef<DOMElement>(null);

  useEffect(() => {
    if (mainControlsRef.current) {
      const fullFooterMeasurement = measureElement(mainControlsRef.current);
      setFooterHeight(fullFooterMeasurement.height);
    }
  }, [terminalHeight, consoleMessages, showErrorDetails]);

  const staticExtraHeight = /* margins and padding */ 3;
  const availableTerminalHeight = useMemo(
    () => Math.max(1, terminalHeight - footerHeight - staticExtraHeight),
    [terminalHeight, footerHeight],
  );

  useEffect(() => {
    // skip refreshing Static during first mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // debounce so it doesn't fire up too often during resize
    const handler = setTimeout(() => {
      // debounce so it doesn't fire up too often during resize
      setStaticNeedsRefresh(false);
      refreshStatic();
    }, LAYOUT.resizeDebounceMs);

    return () => {
      clearTimeout(handler);
    };
  }, [terminalWidth, terminalHeight, refreshStatic]);

  useEffect(() => {
    if (streamingState === StreamingState.Idle && staticNeedsRefresh) {
      setStaticNeedsRefresh(false);
      refreshStatic();
    }
  }, [streamingState, refreshStatic, staticNeedsRefresh]);

  const filteredConsoleMessages = useMemo(() => {
    if (config.getDebugMode()) {
      return consoleMessages;
    }
    return consoleMessages.filter((msg) => msg.type !== 'debug');
  }, [consoleMessages, config]);

  const branchName = useGitBranchName(config.getTargetDir());

  const contextFileNames = useMemo(() => {
    const fromSettings = settings.merged.contextFileName;
    if (fromSettings) {
      return Array.isArray(fromSettings) ? fromSettings : [fromSettings];
    }
    return getAllGeminiMdFilenames();
  }, [settings.merged.contextFileName]);

  const initialPrompt = useMemo(() => config.getQuestion(), [config]);
  const geminiClient = config.getGeminiClient();

  useEffect(() => {
    if (
      initialPrompt &&
      !initialPromptSubmitted.current &&
      !isAuthenticating &&
      !isAuthDialogOpen &&
      !isThemeDialogOpen &&
      !isEditorDialogOpen &&
      !showPrivacyNotice &&
      geminiClient?.isInitialized?.()
    ) {
      submitQuery(initialPrompt);
      initialPromptSubmitted.current = true;
    }
  }, [
    initialPrompt,
    submitQuery,
    isAuthenticating,
    isAuthDialogOpen,
    isThemeDialogOpen,
    isEditorDialogOpen,
    showPrivacyNotice,
    geminiClient,
  ]);

  if (quittingMessages) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {quittingMessages.map((item) => (
          <HistoryItemDisplay
            key={item.id}
            availableTerminalHeight={
              constrainHeight ? availableTerminalHeight : undefined
            }
            terminalWidth={terminalWidth}
            item={item}
            isPending={false}
            config={config}
          />
        ))}
      </Box>
    );
  }
  const mainAreaWidth = Math.max(LAYOUT.minInputWidth, terminalWidth - LAYOUT.contentPaddingX * 2);
  const debugConsoleMaxHeight = Math.floor(Math.max(terminalHeight * 0.2, 5));
  // Arbitrary threshold to ensure that items in the static area are large
  // enough but not too large to make the terminal hard to use.
  const staticAreaMaxItemHeight = Math.max(terminalHeight * 4, 100);
  return (
    <StreamingContext.Provider value={streamingState}>
      <Box flexDirection="column" marginBottom={1} width={terminalWidth} paddingX={2}>
        <StaticHistoryArea
          history={history}
          archivedCount={archivedCount}
          staticKey={staticKey}
          settings={settings}
          config={config}
          version={version}
          nightly={nightly}
          mainAreaWidth={mainAreaWidth}
          staticAreaMaxItemHeight={staticAreaMaxItemHeight}
          updateMessage={updateMessage}
        />
        <OverflowProvider>
          <Box ref={pendingHistoryItemRef} flexDirection="column">
            {pendingHistoryItems.map((item) => {
              // Generate stable key based on item type and content
              const key = item.type === 'tool_group'
                ? `tool-group-${(item as { tools?: { callId: string }[] }).tools?.map(t => t.callId).join('-') || 'empty'}`
                : `pending-${item.type}-${item.type === 'gemini' || item.type === 'gemini_content' ? (item as { text?: string }).text?.length || 0 : 0}`;

              return (
                <HistoryItemDisplay
                  key={key}
                  availableTerminalHeight={
                    constrainHeight ? availableTerminalHeight : undefined
                  }
                  terminalWidth={mainAreaWidth}
                  item={{ ...item, id: 0 }}
                  isPending={true}
                  config={config}
                  isFocused={!isEditorDialogOpen}
                />
              );
            })}
            <ShowMoreLines constrainHeight={constrainHeight} />
          </Box>
        </OverflowProvider>

        {showHelp && <Help commands={slashCommands} />}

        <Box flexDirection="column" ref={mainControlsRef}>
          {startupWarnings.length > 0 && (
            <Box
              borderStyle="round"
              borderColor={Colors.AccentYellow}
              paddingX={1}
              marginY={1}
              flexDirection="column"
            >
              {startupWarnings.map((warning, index) => (
                <Text key={index} color={Colors.AccentYellow}>
                  {warning}
                </Text>
              ))}
            </Box>
          )}

          {isThemeDialogOpen ? (
            <Box flexDirection="column">
              {themeError && (
                <Box marginBottom={1}>
                  <Text color={Colors.AccentRed}>{themeError}</Text>
                </Box>
              )}
              <ThemeDialog
                onSelect={handleThemeSelect}
                onHighlight={handleThemeHighlight}
                settings={settings}
                availableTerminalHeight={
                  constrainHeight
                    ? terminalHeight - staticExtraHeight
                    : undefined
                }
                terminalWidth={mainAreaWidth}
              />
            </Box>
          ) : isAuthenticating ? (
            <>
              <AuthInProgress
                onTimeout={() => {
                  setAuthError('Authentication timed out. Please try again.');
                  cancelAuthentication();
                  openAuthDialog();
                }}
              />
              {showErrorDetails && (
                <OverflowProvider>
                  <Box flexDirection="column">
                    <DetailedMessagesDisplay
                      messages={filteredConsoleMessages}
                      maxHeight={
                        constrainHeight ? debugConsoleMaxHeight : undefined
                      }
                      width={inputWidth}
                    />
                    <ShowMoreLines constrainHeight={constrainHeight} />
                  </Box>
                </OverflowProvider>
              )}
            </>
          ) : isAuthDialogOpen ? (
            <Box flexDirection="column">
              <AuthDialog
                onSelect={handleAuthSelect}
                settings={settings}
                initialErrorMessage={authError}
                isManualTrigger={isManualTrigger}
              />
            </Box>
          ) : isModelDialogOpen ? (
            <Box flexDirection="column">
              <ModelDialog
                onSelect={handleModelSelect}
                currentModel={currentModel}
                availableModels={availableModels}
                settings={settings}
                availableTerminalHeight={availableTerminalHeight}
              />
            </Box>
          ) : isEditorDialogOpen ? (
            <Box flexDirection="column">
              {editorError && (
                <Box marginBottom={1}>
                  <Text color={Colors.AccentRed}>{editorError}</Text>
                </Box>
              )}
              <EditorSettingsDialog
                onSelect={handleEditorSelect}
                settings={settings}
                onExit={exitEditorDialog}
              />
            </Box>
          ) : isSkillsDialogOpen ? (
            <Box flexDirection="column">
              <SkillsDialog
                onSelect={handleSkillSelect}
                availableSkills={availableSkills}
              />
            </Box>
          ) : showPrivacyNotice ? (
            <PrivacyNotice
              onExit={() => setShowPrivacyNotice(false)}
              config={config}
            />
          ) : (
            <>
              {/* Container for status area to prevent overlap */}
              <Box flexDirection="column" marginBottom={1}>
                <ToDoList todos={todos} />
                <QueryQueueList queue={queryQueue} />
                <LoadingIndicator
                  thought={
                    streamingState === StreamingState.WaitingForConfirmation ||
                    config.getAccessibility()?.disableLoadingPhrases
                      ? undefined
                      : thought
                  }
                  showThinking={showThinkingFromContext}
                  currentLoadingPhrase={
                    config.getAccessibility()?.disableLoadingPhrases
                      ? undefined
                      : currentLoadingPhrase
                  }
                  elapsedTime={elapsedTime}
                />
              </Box>
              <StatusBar
                ctrlCPressedOnce={ctrlCPressedOnce}
                ctrlDPressedOnce={ctrlDPressedOnce}
                geminiMdFileCount={geminiMdFileCount}
                contextFileNames={contextFileNames}
                config={config}
                showToolDescriptions={showToolDescriptions}
                showAutoAcceptIndicator={showAutoAcceptIndicator}
                shellModeActive={shellModeActive}
                backgroundShells={backgroundShells}
                focusMode={focusMode}
                onSelectShell={(id) => {
                  setSelectedShellId(id);
                  setFocusMode('shell-view');
                }}
              />

              {showErrorDetails && (
                <OverflowProvider>
                  <Box flexDirection="column">
                    <DetailedMessagesDisplay
                      messages={filteredConsoleMessages}
                      maxHeight={
                        constrainHeight ? debugConsoleMaxHeight : undefined
                      }
                      width={inputWidth}
                    />
                    <ShowMoreLines constrainHeight={constrainHeight} />
                  </Box>
                </OverflowProvider>
              )}

              <InputPrompt
                buffer={buffer}
                inputWidth={inputWidth}
                suggestionsWidth={suggestionsWidth}
                onSubmit={handleFinalSubmit}
                userMessages={userMessages}
                onClearScreen={handleClearScreen}
                config={config}
                slashCommands={slashCommands}
                commandContext={commandContext}
                shellModeActive={shellModeActive}
                setShellModeActive={setShellModeActive}
                waitingForConfirmation={streamingState === StreamingState.WaitingForConfirmation}
                disabled={!isInputActive}
                focus={focusMode === 'input' && isInputFocused}
                spawnBackgroundShell={spawnBackgroundShell}
                focusMode={focusMode}
                onFocusShellList={() => setFocusMode('shell-list')}
              />

              {focusMode === 'shell-view' && selectedShellId && (
                <ShellOutputViewer
                  shell={backgroundShells.find((s) => s.id === selectedShellId)!}
                  shellIndex={backgroundShells.findIndex((s) => s.id === selectedShellId)}
                  onKill={() => killShell(selectedShellId)}
                  onBack={() => {
                    setFocusMode('input');
                    setSelectedShellId(null);
                  }}
                  terminalWidth={mainAreaWidth}
                />
              )}
            </>
          )}

          {initError && streamingState !== StreamingState.Responding && (
            <Box
              borderStyle="round"
              borderColor={Colors.AccentRed}
              paddingX={1}
              marginBottom={1}
            >
              {history.find(
                (item) =>
                  item.type === 'error' && item.text?.includes(initError),
              )?.text ? (
                <Text color={Colors.AccentRed}>
                  {
                    history.find(
                      (item) =>
                        item.type === 'error' && item.text?.includes(initError),
                    )?.text
                  }
                </Text>
              ) : (
                <>
                  <Text color={Colors.AccentRed}>
                    Initialization Error: {initError}
                  </Text>
                  <Text color={Colors.AccentRed}>
                    {' '}
                    Please check API key and configuration.
                  </Text>
                </>
              )}
            </Box>
          )}
          <Footer
            model={currentModel}
            targetDir={config.getTargetDir()}
            debugMode={config.getDebugMode()}
            branchName={branchName}
            debugMessage={debugMessage}
            corgiMode={corgiMode}
            errorCount={errorCount}
            showErrorDetails={showErrorDetails}
            showMemoryUsage={
              config.getDebugMode() || config.getShowMemoryUsage()
            }
            promptTokenCount={sessionStats.lastPromptTokenCount}
            contextUsage={contextUsage}
            nightly={nightly}
            terminalWidth={terminalWidth}
            approvalMode={showAutoAcceptIndicator}
          />
        </Box>
      </Box>
    </StreamingContext.Provider>
  );
};
