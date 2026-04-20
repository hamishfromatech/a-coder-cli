/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { StreamingState, type FocusMode, type BackgroundShell } from '../types.js';
import { useKeypress, isPasting, type Key } from './useKeypress.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import type { SlashCommand, CommandContext } from '../commands/types.js';
import type { Config } from '@a-coder/core';

const CTRL_EXIT_PROMPT_DURATION_MS = 3000;

export interface UseKeyboardShortcutsOptions {
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
  showToolDescriptions: boolean;
  setShowToolDescriptions: (show: boolean) => void;
  constrainHeight: boolean;
  setConstrainHeight: (show: boolean) => void;
  streamingState: StreamingState;
  cancelCurrentTask: () => void;
  buffer: TextBuffer;
  config: Config;
  handleSlashCommand: (command: string) => void;
  toggleThinking: () => void;
  toggleErrorDetails: () => void;
  slashCommands: SlashCommand[];
  commandContext: CommandContext;
  inkExit: () => void;
  ctrlCPressedOnceRef: React.MutableRefObject<boolean>;
  setCtrlCPressedOnce: (pressed: boolean) => void;
  ctrlCTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  ctrlDPressedOnceRef: React.MutableRefObject<boolean>;
  setCtrlDPressedOnce: (pressed: boolean) => void;
  ctrlDTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  focusMode: FocusMode;
  setFocusMode: (mode: FocusMode) => void;
  selectedShellId: string | null;
  setSelectedShellId: React.Dispatch<React.SetStateAction<string | null>>;
  backgroundShells: BackgroundShell[];
  killShell: (shellId: string) => void;
  isThemeDialogOpen: boolean;
  isAuthDialogOpen: boolean;
  isAuthenticating: boolean;
  isModelDialogOpen: boolean;
  isEditorDialogOpen: boolean;
  isSkillsDialogOpen: boolean;
  showPrivacyNotice: boolean;
}

export const useKeyboardShortcuts = (options: UseKeyboardShortcutsOptions) => {
  const {
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
  } = options;

  const handleExit = useCallback(
    (
      pressedOnceRef: React.MutableRefObject<boolean>,
      setPressedOnceState: (value: boolean) => void,
      timerRef: React.MutableRefObject<NodeJS.Timeout | null>,
    ) => {
      if (isPasting()) {
        return;
      }

      if (pressedOnceRef.current) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        const quitCommand = slashCommands.find(
          (cmd) => cmd.name === 'quit' || cmd.altName === 'exit',
        );
        if (quitCommand && quitCommand.action) {
          quitCommand.action(commandContext, '');
        } else {
          inkExit();
        }
      } else {
        pressedOnceRef.current = true;
        setPressedOnceState(true);
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          pressedOnceRef.current = false;
          setPressedOnceState(false);
          timerRef.current = null;
        }, CTRL_EXIT_PROMPT_DURATION_MS);
      }
    },
    [slashCommands, commandContext, inkExit],
  );

  useKeypress((key: Key) => {
    if (process.env['DEBUG_KEYS'] === 'true') {
      console.error(`[App] key received: name="${key.name}" ctrl=${key.ctrl} paste=${key.paste} sequence=${JSON.stringify(key.sequence)}`);
    }

    if (key.paste) {
      return;
    }

    if (showHelp) {
      if (key.name === 'escape' || key.sequence === 'q') {
        setShowHelp(false);
      }
      return;
    }
    if (
      isThemeDialogOpen ||
      isAuthenticating ||
      isAuthDialogOpen ||
      isModelDialogOpen ||
      isEditorDialogOpen ||
      isSkillsDialogOpen ||
      showPrivacyNotice
    ) {
      return;
    }

    let enteringConstrainHeightMode = false;
    if (!constrainHeight) {
      enteringConstrainHeightMode = true;
      setConstrainHeight(true);
    }

    if (key.ctrl && key.name === 'o') {
      toggleThinking();
    } else if (key.ctrl && key.name === 'e') {
      toggleErrorDetails();
    } else if (key.ctrl && key.name === 't') {
      const newValue = !showToolDescriptions;
      setShowToolDescriptions(newValue);

      const mcpServers = config.getMcpServers();
      if (Object.keys(mcpServers || {}).length > 0) {
        handleSlashCommand(newValue ? '/mcp desc' : '/mcp nodesc');
      }
    } else if (key.ctrl && key.name === 'c') {
      if (process.env['DEBUG_KEYS'] === 'true') {
        console.error('[App] Ctrl+C detected');
      }
      const isBusy =
        streamingState === StreamingState.Responding ||
        streamingState === StreamingState.WaitingForConfirmation;
      if (isBusy) {
        cancelCurrentTask();
        ctrlCPressedOnceRef.current = false;
        setCtrlCPressedOnce(false);
        if (ctrlCTimerRef.current) {
          clearTimeout(ctrlCTimerRef.current);
          ctrlCTimerRef.current = null;
        }
      } else {
        handleExit(ctrlCPressedOnceRef, setCtrlCPressedOnce, ctrlCTimerRef);
      }
    } else if (key.ctrl && key.name === 'd') {
      if (buffer.text.length > 0) {
        return;
      }
      handleExit(ctrlDPressedOnceRef, setCtrlDPressedOnce, ctrlDTimerRef);
    } else if (key.ctrl && key.name === 's' && !enteringConstrainHeightMode) {
      setConstrainHeight(false);
    }

    // Background shell navigation
    if (focusMode === 'input') {
      if (key.name === 'down' && backgroundShells.length > 0) {
        setFocusMode('shell-list');
        return;
      }
    } else if (focusMode === 'shell-list') {
      if (key.name === 'escape') {
        setFocusMode('input');
        return;
      }
      if (key.name === 'up') {
        setSelectedShellId((prev) => {
          const currentIndex = prev
            ? backgroundShells.findIndex((s) => s.id === prev)
            : 0;
          const newIndex = currentIndex > 0 ? currentIndex - 1 : backgroundShells.length - 1;
          return backgroundShells[newIndex]?.id || null;
        });
        return;
      }
      if (key.name === 'down') {
        setSelectedShellId((prev) => {
          const currentIndex = prev
            ? backgroundShells.findIndex((s) => s.id === prev)
            : 0;
          const newIndex = (currentIndex + 1) % backgroundShells.length;
          return backgroundShells[newIndex]?.id || null;
        });
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        const shellId = selectedShellId || backgroundShells[0]?.id;
        if (shellId) {
          setFocusMode('shell-view');
        }
        return;
      }
    } else if (focusMode === 'shell-view') {
      if (key.name === 'x') {
        if (selectedShellId) {
          killShell(selectedShellId);
        }
        return;
      }
      if (key.name === 'escape' || key.name === 'backspace' || key.name === 'return' || key.name === 'enter') {
        setFocusMode('input');
        setSelectedShellId(null);
        return;
      }
    }
  }, { isActive: true });
};
