/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';

interface AboutBoxProps {
  cliVersion: string;
  osVersion: string;
  sandboxEnv: string;
  modelVersion: string;
  selectedAuthType: string;
  gcpProject: string;
}

export const AboutBox: React.FC<AboutBoxProps> = ({
  cliVersion,
  osVersion,
  sandboxEnv,
  modelVersion,
  selectedAuthType,
  gcpProject,
}) => (
  <Box
    borderStyle="round"
    borderColor={Semantic.Muted}
    flexDirection="column"
    padding={1}
    marginY={1}
    width="100%"
  >
    <Box marginBottom={1}>
      <Text bold color={Semantic.Primary}>
        about a-coder cli
      </Text>
    </Box>
    <Box flexDirection="row">
      <Box width={15}>
        <Text color={Semantic.Info}>cli version</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap">{cliVersion}</Text>
      </Box>
    </Box>
    {GIT_COMMIT_INFO && !['N/A'].includes(GIT_COMMIT_INFO) && (
      <Box flexDirection="row">
        <Box width={15}>
          <Text color={Semantic.Info}>git commit</Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="wrap">{GIT_COMMIT_INFO}</Text>
        </Box>
      </Box>
    )}
    <Box flexDirection="row">
      <Box width={15}>
        <Text color={Semantic.Info}>model</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap">{modelVersion}</Text>
      </Box>
    </Box>
    <Box flexDirection="row">
      <Box width={15}>
        <Text color={Semantic.Info}>sandbox</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap">{sandboxEnv}</Text>
      </Box>
    </Box>
    <Box flexDirection="row">
      <Box width={15}>
        <Text color={Semantic.Info}>os</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap">{osVersion}</Text>
      </Box>
    </Box>
    <Box flexDirection="row">
      <Box width={15}>
        <Text color={Semantic.Info}>auth method</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap">
          {selectedAuthType.startsWith('oauth') ? 'OAuth' : selectedAuthType}
        </Text>
      </Box>
    </Box>
    {gcpProject && (
      <Box flexDirection="row">
        <Box width={15}>
          <Text color={Semantic.Info}>gcp project</Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="wrap">{gcpProject}</Text>
        </Box>
      </Box>
    )}
  </Box>
);
