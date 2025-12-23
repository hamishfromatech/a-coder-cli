/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { type HistoryItem, MessageType } from '../types.js';
import { Config } from '@a-coder/core';
import { setOpenAIModel } from '../../config/auth.js';

interface UseModelCommandReturn {
  isModelDialogOpen: boolean;
  openModelDialog: () => void;
  handleModelSelect: (
    modelName: string | undefined,
    scope: SettingScope,
  ) => Promise<void>;
  availableModels: string[];
}

export const useModelCommand = (
  config: Config | null,
  loadedSettings: LoadedSettings,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseModelCommandReturn => {
  const [isModelDialogOpen, setIsModelDialogOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const openModelDialog = useCallback(async () => {
    const geminiClient = config?.getGeminiClient();
    if (!geminiClient) {
      addItem(
        {
          type: MessageType.ERROR,
          text: 'AI client not initialized.',
        },
        Date.now(),
      );
      return;
    }

    try {
      addItem(
        {
          type: MessageType.INFO,
          text: 'Fetching available models...',
        },
        Date.now(),
      );
      const models = await geminiClient.listModels();
      if (models.length === 0) {
        addItem(
          {
            type: MessageType.INFO,
            text: 'No models found or provider does not support listing models.',
          },
          Date.now(),
        );
        return;
      }
      setAvailableModels(models);
      setIsModelDialogOpen(true);
    } catch (error) {
      addItem(
        {
          type: MessageType.ERROR,
          text: `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`,
        },
        Date.now(),
      );
    }
  }, [config, addItem]);

  const handleModelSelect = useCallback(
    async (modelName: string | undefined, scope: SettingScope) => {
      if (!modelName) {
        setIsModelDialogOpen(false);
        return;
      }

      try {
        // Update runtime config
        config?.setModel(modelName);
        setOpenAIModel(modelName);

        // Update OpenAI client if possible
        const geminiClient = config?.getGeminiClient();
        if (geminiClient) {
          const contentGenerator = geminiClient.getContentGenerator();
          if (contentGenerator && typeof (contentGenerator as any).updateModel === 'function') {
            (contentGenerator as any).updateModel(modelName);
          }
        }

        // Persist to settings
        const currentACoderConfig = loadedSettings.forScope(scope).settings.aCoder || {};
        loadedSettings.setValue(scope, 'aCoder', {
          ...currentACoderConfig,
          model: modelName,
        });

        addItem(
          {
            type: MessageType.INFO,
            text: `Model set to: ${modelName} (saved to ${scope} settings)`,
          },
          Date.now(),
        );
      } catch (error) {
        addItem(
          {
            type: MessageType.ERROR,
            text: `Error updating model: ${error instanceof Error ? error.message : String(error)}`,
          },
          Date.now(),
        );
      } finally {
        setIsModelDialogOpen(false);
      }
    },
    [config, loadedSettings, addItem],
  );

  return {
    isModelDialogOpen,
    openModelDialog,
    handleModelSelect,
    availableModels,
  };
};
