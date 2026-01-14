/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { type HistoryItem, MessageType } from '../types.js';
import { getAvailableSkills } from '@a-coder/core';

interface UseSkillsCommandReturn {
  isSkillsDialogOpen: boolean;
  openSkillsDialog: () => void;
  handleSkillSelect: (skillName: string | undefined) => void;
  availableSkills: string[];
}

export const useSkillsCommand = (
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
  submitQuery: (query: string) => void,
): UseSkillsCommandReturn => {
  const [isSkillsDialogOpen, setIsSkillsDialogOpen] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);

  const openSkillsDialog = useCallback(() => {
    try {
      const skills = getAvailableSkills();
      setAvailableSkills(skills);
      setIsSkillsDialogOpen(true);
    } catch (error) {
      addItem(
        {
          type: MessageType.ERROR,
          text: `Failed to fetch skills: ${error instanceof Error ? error.message : String(error)}`,
        },
        Date.now(),
      );
    }
  }, [addItem]);

  const handleSkillSelect = useCallback(
    (skillName: string | undefined) => {
      setIsSkillsDialogOpen(false);
      if (skillName) {
        // We want the LLM to be aware that a skill is being loaded and to "learn" it.
        // By sending this message, the LLM is encouraged to use the skills tool
        // to load the instructions and then proceed.
        submitQuery(
          `I want to use the "${skillName}" skill. Please load it and proceed with the task.`,
        );
      }
    },
    [submitQuery],
  );

  return {
    isSkillsDialogOpen,
    openSkillsDialog,
    handleSkillSelect,
    availableSkills,
  };
};
