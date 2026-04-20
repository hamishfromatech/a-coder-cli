/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

type DialogName =
  | 'theme'
  | 'auth'
  | 'model'
  | 'editor'
  | 'skills'
  | 'privacy';

interface DialogState {
  openDialogs: Set<DialogName>;
  isAuthenticating: boolean;
}

interface DialogContextValue extends DialogState {
  openDialog: (name: DialogName) => void;
  closeDialog: (name: DialogName) => void;
  closeAllDialogs: () => void;
  isDialogOpen: (name: DialogName) => boolean;
  isAnyDialogOpen: boolean;
  setAuthenticating: (value: boolean) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [openDialogs, setOpenDialogs] = useState<Set<DialogName>>(new Set());
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const openDialog = useCallback((name: DialogName) => {
    setOpenDialogs((prev) => new Set(prev).add(name));
  }, []);

  const closeDialog = useCallback((name: DialogName) => {
    setOpenDialogs((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const closeAllDialogs = useCallback(() => {
    setOpenDialogs(new Set());
    setIsAuthenticating(false);
  }, []);

  const isDialogOpen = useCallback(
    (name: DialogName) => openDialogs.has(name),
    [openDialogs],
  );

  const isAnyDialogOpen = useMemo(
    () => openDialogs.size > 0 || isAuthenticating,
    [openDialogs.size, isAuthenticating],
  );

  const value = useMemo<DialogContextValue>(
    () => ({
      openDialogs,
      isAuthenticating,
      openDialog,
      closeDialog,
      closeAllDialogs,
      isDialogOpen,
      isAnyDialogOpen,
      setAuthenticating: setIsAuthenticating,
    }),
    [openDialogs, isAuthenticating, openDialog, closeDialog, closeAllDialogs, isDialogOpen, isAnyDialogOpen],
  );

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function useDialogContext(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialogContext must be used within a DialogProvider');
  }
  return ctx;
}
