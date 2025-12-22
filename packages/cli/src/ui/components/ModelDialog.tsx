/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';

interface ModelDialogProps {
  /** Callback function when a model is selected */
  onSelect: (modelName: string | undefined, scope: SettingScope) => void;
  /** Current active model */
  currentModel: string;
  /** List of available models */
  availableModels: string[];
  /** The settings object */
  settings: LoadedSettings;
  availableTerminalHeight?: number;
}

export function ModelDialog({
  onSelect,
  currentModel,
  availableModels,
  settings,
  availableTerminalHeight,
}: ModelDialogProps): React.JSX.Element {
  const [selectedScope, setSelectedScope] = useState<SettingScope>(
    SettingScope.User,
  );

  const modelItems = availableModels.map((model) => ({
    label: model,
    value: model,
  }));

  const initialModelIndex = Math.max(
    0,
    modelItems.findIndex((item) => item.value === currentModel),
  );

  const scopeItems = [
    { label: 'User Settings', value: SettingScope.User },
    { label: 'Workspace Settings', value: SettingScope.Workspace },
  ];

  const handleModelSelect = useCallback(
    (modelName: string) => {
      onSelect(modelName, selectedScope);
    },
    [onSelect, selectedScope],
  );

  const handleScopeSelect = useCallback((scope: SettingScope) => {
    setSelectedScope(scope);
    setFocusedSection('model');
  }, []);

  const [focusedSection, setFocusedSection] = useState<'model' | 'scope'>(
    'model',
  );

  useInput((input, key) => {
    if (key.tab) {
      setFocusedSection((prev) => (prev === 'model' ? 'scope' : 'model'));
    }
    if (key.escape) {
      onSelect(undefined, selectedScope);
    }
  });

  const DIALOG_PADDING = 2;
  const selectModelHeight = Math.min(8, modelItems.length) + 2;
  const SCOPE_SELECTION_HEIGHT = 4;
  const TAB_TO_SELECT_HEIGHT = 2;
  
  const effectiveTerminalHeight = availableTerminalHeight ?? 20;
  const showScopeSelection = effectiveTerminalHeight > (selectModelHeight + SCOPE_SELECTION_HEIGHT + TAB_TO_SELECT_HEIGHT + DIALOG_PADDING);

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Box flexDirection="column">
        <Text bold color={Colors.AccentBlue}>
          {focusedSection === 'model' ? '> ' : '  '}Select AI Model
        </Text>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={modelItems}
            initialIndex={initialModelIndex}
            onSelect={handleModelSelect}
            isFocused={focusedSection === 'model'}
            maxItemsToShow={8}
            showScrollArrows={true}
          />
        </Box>

        {showScopeSelection && (
          <Box marginTop={1} flexDirection="column">
            <Text bold color={Colors.AccentBlue}>
              {focusedSection === 'scope' ? '> ' : '  '}Save Preference To
            </Text>
            <Box marginTop={1}>
              <RadioButtonSelect
                items={scopeItems}
                initialIndex={selectedScope === SettingScope.User ? 0 : 1}
                onSelect={handleScopeSelect}
                isFocused={focusedSection === 'scope'}
              />
            </Box>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          (Use Enter to select, Tab to change focus, Esc to cancel)
        </Text>
      </Box>
    </Box>
  );
}
