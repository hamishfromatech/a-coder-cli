/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { AuthType } from '@a-coder/core';
import {
  validateAuthMethod,
  setOpenAIApiKey,
  setOpenAIBaseUrl,
  setOpenAIModel,
} from '../../config/auth.js';
import { OpenAIKeyPrompt } from './OpenAIKeyPrompt.js';

interface AuthDialogProps {
  onSelect: (authMethod: AuthType | undefined, scope: SettingScope) => void;
  settings: LoadedSettings;
  initialErrorMessage?: string | null;
  isManualTrigger?: boolean;
}

function parseDefaultAuthType(
  defaultAuthType: string | undefined,
): AuthType | null {
  if (
    defaultAuthType &&
    Object.values(AuthType).includes(defaultAuthType as AuthType)
  ) {
    return defaultAuthType as AuthType;
  }
  return null;
}

export function AuthDialog({
  onSelect,
  settings,
  initialErrorMessage,
  isManualTrigger,
}: AuthDialogProps): React.JSX.Element {
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialErrorMessage || null,
  );
  const [showOpenAIKeyPrompt, setShowOpenAIKeyPrompt] = useState(false);
  const items = [{ label: 'OpenAI (Compatible)', value: AuthType.USE_OPENAI }];

  const initialAuthIndex = Math.max(
    0,
    items.findIndex((item) => {
      if (settings.merged.selectedAuthType) {
        return item.value === settings.merged.selectedAuthType;
      }

      const defaultAuthType = parseDefaultAuthType(
        process.env.GEMINI_DEFAULT_AUTH_TYPE,
      );
      if (defaultAuthType) {
        return item.value === defaultAuthType;
      }

      if (process.env.GEMINI_API_KEY) {
        return item.value === AuthType.USE_GEMINI;
      }

      return item.value === AuthType.LOGIN_WITH_GOOGLE;
    }),
  );

  const handleAuthSelect = (authMethod: AuthType) => {
    const error = validateAuthMethod(authMethod);
    if (error || (authMethod === AuthType.USE_OPENAI && isManualTrigger)) {
      if (authMethod === AuthType.USE_OPENAI) {
        setShowOpenAIKeyPrompt(true);
        setErrorMessage(null);
      } else {
        setErrorMessage(error);
      }
    } else {
      setErrorMessage(null);
      onSelect(authMethod, SettingScope.User);
    }
  };

  const handleOpenAIKeySubmit = (
    apiKey: string,
    baseUrl: string,
    model: string,
  ) => {
    // Auto-correct OpenRouter URL if common mistake is made
    if (baseUrl && baseUrl.includes('openrouter.ai') && !baseUrl.includes('/api/v1')) {
      if (baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.replace('/v1', '/api/v1');
      } else if (!baseUrl.includes('/api')) {
        baseUrl = baseUrl.endsWith('/') ? baseUrl + 'api/v1' : baseUrl + '/api/v1';
      }
    }

    // Set environment variables for immediate use
    setOpenAIApiKey(apiKey);
    if (baseUrl) {
      setOpenAIBaseUrl(baseUrl);
    }
    if (model) {
      setOpenAIModel(model);
    }
    
    // Persist to settings file
    const currentACoderConfig = settings.forScope(SettingScope.User).settings.aCoder || {};
    settings.setValue(SettingScope.User, 'aCoder', {
      ...currentACoderConfig,
      apiKey,
      baseUrl: baseUrl || currentACoderConfig.baseUrl,
      model: model || currentACoderConfig.model,
    });

    setShowOpenAIKeyPrompt(false);
    onSelect(AuthType.USE_OPENAI, SettingScope.User);
  };

  const handleOpenAIKeyCancel = () => {
    setShowOpenAIKeyPrompt(false);
    setErrorMessage('OpenAI API key is required to use OpenAI authentication.');
  };

  useInput((_input, key) => {
    // 当显示 OpenAIKeyPrompt 时，不处理输入事件
    if (showOpenAIKeyPrompt) {
      return;
    }

    if (key.escape) {
      // Prevent exit if there is an error message.
      // This means they user is not authenticated yet.
      if (errorMessage) {
        return;
      }
      if (settings.merged.selectedAuthType === undefined) {
        // Prevent exiting if no auth method is set
        setErrorMessage(
          'You must select an auth method to proceed. Press Ctrl+C twice to exit.',
        );
        return;
      }
      onSelect(undefined, SettingScope.User);
    }
  });

  if (showOpenAIKeyPrompt) {
    return (
      <OpenAIKeyPrompt
        onSubmit={handleOpenAIKeySubmit}
        onCancel={handleOpenAIKeyCancel}
        initialApiKey={settings.merged.aCoder?.apiKey || process.env.OPENAI_API_KEY}
        initialBaseUrl={settings.merged.aCoder?.baseUrl || process.env.OPENAI_BASE_URL}
        initialModel={settings.merged.aCoder?.model || process.env.OPENAI_MODEL}
      />
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold color={Colors.AccentBlue}>Get started</Text>
      <Box marginTop={1}>
        <Text wrap="wrap">How would you like to authenticate for this project?</Text>
      </Box>
      <Box marginTop={1}>
        <RadioButtonSelect
          items={items}
          initialIndex={initialAuthIndex}
          onSelect={handleAuthSelect}
          isFocused={true}
        />
      </Box>
      {errorMessage && (
        <Box marginTop={1}>
          <Text color={Colors.AccentRed} wrap="wrap">{errorMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={Colors.AccentPurple}>(Use Enter to Set Auth)</Text>
      </Box>
      <Box marginTop={1}>
        <Text wrap="wrap">Terms of Services and Privacy Notice for A-Coder CLI</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.AccentBlue} wrap="wrap">
          {'https://github.com/QwenLM/Qwen3-Coder/blob/main/README.md'}
        </Text>
      </Box>
    </Box>
  );
}
