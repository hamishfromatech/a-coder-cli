/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { TextBuffer } from '../components/shared/text-buffer.js';

interface UseReverseSearchReturn {
  reverseSearchActive: boolean;
  reverseSearchQuery: string;
  reverseSearchMatchIndex: number;
  reverseSearchMatches: string[];
  enterReverseSearch: () => void;
  exitReverseSearch: () => void;
  cycleNextMatch: () => void;
  appendSearchChar: (char: string) => void;
  removeSearchChar: () => void;
  acceptMatch: () => void;
}

export function useReverseSearch(
  userMessages: readonly string[],
  buffer: TextBuffer,
): UseReverseSearchReturn {
  const [reverseSearchActive, setReverseSearchActive] = useState(false);
  const [reverseSearchQuery, setReverseSearchQuery] = useState('');
  const [reverseSearchMatchIndex, setReverseSearchMatchIndex] = useState(0);
  const reverseSearchMatchesRef = useRef<string[]>([]);

  const reverseSearchMatches = useMemo(() => {
    if (!reverseSearchQuery) return userMessages.filter((m) => m.trim()).slice(0, 20);
    const q = reverseSearchQuery.toLowerCase();
    const seen = new Set<string>();
    const matches: string[] = [];
    for (let i = userMessages.length - 1; i >= 0 && matches.length < 20; i--) {
      const msg = userMessages[i];
      if (msg.toLowerCase().includes(q) && !seen.has(msg)) {
        seen.add(msg);
        matches.push(msg);
      }
    }
    return matches;
  }, [reverseSearchQuery, userMessages]);

  const enterReverseSearch = useCallback(() => {
    setReverseSearchActive(true);
    setReverseSearchQuery('');
    setReverseSearchMatchIndex(0);
  }, []);

  const exitReverseSearch = useCallback(() => {
    setReverseSearchActive(false);
    setReverseSearchQuery('');
    setReverseSearchMatchIndex(0);
    reverseSearchMatchesRef.current = [];
  }, []);

  const cycleNextMatch = useCallback(() => {
    const matches = reverseSearchMatchesRef.current;
    if (matches.length > 0) {
      setReverseSearchMatchIndex((prev) => {
        const next = (prev + 1) % matches.length;
        buffer.setText(matches[next]);
        return next;
      });
    }
  }, [buffer]);

  const appendSearchChar = useCallback((char: string) => {
    setReverseSearchQuery((prev) => prev + char);
    setReverseSearchMatchIndex(0);
  }, []);

  const removeSearchChar = useCallback(() => {
    setReverseSearchQuery((prev) => {
      if (prev.length > 0) {
        return prev.slice(0, -1);
      }
      return prev;
    });
    setReverseSearchMatchIndex(0);
  }, []);

  const acceptMatch = useCallback(() => {
    const matches = reverseSearchMatchesRef.current;
    setReverseSearchMatchIndex((idx) => {
      if (matches.length > 0 && matches[idx]) {
        buffer.setText(matches[idx]);
      }
      return idx;
    });
    exitReverseSearch();
  }, [buffer, exitReverseSearch]);

  // Keep ref in sync with computed matches
  useEffect(() => {
    reverseSearchMatchesRef.current = reverseSearchMatches;
    if (reverseSearchMatchIndex >= reverseSearchMatches.length) {
      setReverseSearchMatchIndex(Math.max(0, reverseSearchMatches.length - 1));
    }
  }, [reverseSearchMatches, reverseSearchMatchIndex]);

  // Update buffer text when match index changes
  useEffect(() => {
    if (reverseSearchActive && reverseSearchMatches.length > 0) {
      buffer.setText(reverseSearchMatches[reverseSearchMatchIndex]);
    } else if (reverseSearchActive && reverseSearchMatches.length === 0) {
      buffer.setText('');
    }
  }, [reverseSearchActive, reverseSearchMatchIndex, reverseSearchMatches, buffer]);

  return {
    reverseSearchActive,
    reverseSearchQuery,
    reverseSearchMatchIndex,
    reverseSearchMatches,
    enterReverseSearch,
    exitReverseSearch,
    cycleNextMatch,
    appendSearchChar,
    removeSearchChar,
    acceptMatch,
  };
}
