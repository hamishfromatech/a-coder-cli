/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Static, Text } from 'ink';
import type { HistoryItem } from '../types.js';
import { HistoryItemDisplay } from './HistoryItemDisplay.js';
import { Header } from './Header.js';
import { Tips } from './Tips.js';
import { UpdateNotification } from './UpdateNotification.js';
import { Config } from '@a-coder/core';
import { LoadedSettings } from '../../config/settings.js';

interface StaticHistoryAreaProps {
  history: HistoryItem[];
  archivedCount: number;
  staticKey: number;
  settings: LoadedSettings;
  config: Config;
  version: string;
  nightly: boolean;
  mainAreaWidth: number;
  staticAreaMaxItemHeight: number;
  updateMessage: string | null;
}

export const StaticHistoryArea: React.FC<StaticHistoryAreaProps> = ({
  history,
  archivedCount,
  staticKey,
  settings,
  config,
  version,
  nightly,
  mainAreaWidth,
  staticAreaMaxItemHeight,
  updateMessage,
}) => (
  <>
    {updateMessage && <UpdateNotification message={updateMessage} />}
    <Static
      key={staticKey}
      items={[
        <Box flexDirection="column" key="header">
          {!settings.merged.hideBanner && (
            <Header
              terminalWidth={mainAreaWidth}
              version={version}
              nightly={nightly}
            />
          )}
          {!settings.merged.hideTips && <Tips config={config} />}
        </Box>,
        ...(archivedCount > 0
          ? [
              <Box key="archived-notice" paddingX={1}>
                <Text dimColor>
                  {`[${archivedCount} earlier message${archivedCount > 1 ? 's' : ''} archived]`}
                </Text>
              </Box>,
            ]
          : []),
        ...history.slice(archivedCount).map((h) => (
          <HistoryItemDisplay
            terminalWidth={mainAreaWidth}
            availableTerminalHeight={staticAreaMaxItemHeight}
            key={h.id}
            item={h}
            isPending={false}
            config={config}
          />
        )),
      ]}
    >
      {(item) => item}
    </Static>
  </>
);
