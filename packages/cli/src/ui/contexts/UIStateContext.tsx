/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

interface UIState {
  showHelp: boolean;
  showErrorDetails: boolean;
  showThinking: boolean;
  showToolDescriptions: boolean;
  constrainHeight: boolean;
  corgiMode: boolean;
}

interface UIStateContextValue extends UIState {
  setShowHelp: (value: boolean) => void;
  toggleErrorDetails: () => void;
  toggleThinking: () => void;
  setShowToolDescriptions: (value: boolean) => void;
  setConstrainHeight: (value: boolean) => void;
  toggleCorgiMode: () => void;
}

const UIStateContext = createContext<UIStateContextValue | null>(null);

export function UIStateProvider({ children }: { children: React.ReactNode }) {
  const [showHelp, setShowHelp] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showToolDescriptions, setShowToolDescriptions] = useState(false);
  const [constrainHeight, setConstrainHeight] = useState(true);
  const [corgiMode, setCorgiMode] = useState(false);

  const toggleErrorDetails = useCallback(() => setShowErrorDetails((v) => !v), []);
  const toggleThinking = useCallback(() => setShowThinking((v) => !v), []);
  const toggleCorgiMode = useCallback(() => setCorgiMode((v) => !v), []);

  const value = useMemo<UIStateContextValue>(
    () => ({
      showHelp,
      showErrorDetails,
      showThinking,
      showToolDescriptions,
      constrainHeight,
      corgiMode,
      setShowHelp,
      toggleErrorDetails,
      toggleThinking,
      setShowToolDescriptions,
      setConstrainHeight,
      toggleCorgiMode,
    }),
    [showHelp, showErrorDetails, showThinking, showToolDescriptions, constrainHeight, corgiMode, toggleErrorDetails, toggleThinking, toggleCorgiMode],
  );

  return <UIStateContext.Provider value={value}>{children}</UIStateContext.Provider>;
}

export function useUIState(): UIStateContextValue {
  const ctx = useContext(UIStateContext);
  if (!ctx) {
    throw new Error('useUIState must be used within a UIStateProvider');
  }
  return ctx;
}
