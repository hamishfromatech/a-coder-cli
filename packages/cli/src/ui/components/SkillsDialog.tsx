/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { RadioButtonSelect, RadioSelectItem } from './shared/RadioButtonSelect.js';
import { Colors } from '../colors.js';

/** Props for the SkillsDialog component. */
export interface SkillsDialogProps {
  /** Callback function when a skill is selected. Receives the skill name. */
  onSelect: (skillName: string | undefined) => void;
  /** List of available skills. */
  availableSkills: string[];
}

/**
 * A dialog component that allows the user to select a skill from a list.
 */
export const SkillsDialog = ({
  onSelect,
  availableSkills,
}: SkillsDialogProps): React.JSX.Element => {
  const handleSkillSelect = useCallback(
    (skillName: string) => {
      onSelect(skillName);
    },
    [onSelect],
  );

  const skillItems: Array<RadioSelectItem<string>> = useMemo(
    () =>
      availableSkills.map((skill) => ({
        label: skill,
        value: skill,
      })),
    [availableSkills],
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={Colors.AccentBlue} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={Colors.AccentBlue}>
          Select Skill to Load
        </Text>
      </Box>

      {availableSkills.length > 0 ? (
        <Box flexDirection="column">
          <RadioButtonSelect
            items={skillItems}
            onSelect={handleSkillSelect}
            isFocused={true}
          />
          <Box marginTop={1}>
            <Text color={Colors.Gray}>
              (Use Enter to select, Esc to cancel)
            </Text>
          </Box>
        </Box>
      ) : (
        <Box>
          <Text color={Colors.AccentYellow}>No skills available.</Text>
        </Box>
      )}
    </Box>
  );
};
