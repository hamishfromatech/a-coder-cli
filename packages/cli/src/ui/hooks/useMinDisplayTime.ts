/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Returns `true` while `showing` is true, and keeps returning `true`
 * for `minMs` after `showing` transitions to `false`. This prevents
 * flickering when a tool call completes very quickly — the collapsed
 * hint stays visible for at least `minMs` milliseconds.
 *
 * @param showing - Whether the content is currently visible
 * @param minMs - Minimum display time in milliseconds (default 700)
 * @returns Whether the content should still be displayed
 */
export function useMinDisplayTime(
  showing: boolean,
  minMs: number = 700,
): boolean {
  const [visible, setVisible] = useState(showing);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasShowingRef = useRef(showing);

  useEffect(() => {
    if (showing) {
      // Content is showing — cancel any pending hide timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setVisible(true);
      wasShowingRef.current = true;
    } else if (wasShowingRef.current) {
      // Content just transitioned from showing to hidden
      // Keep visible for minMs more
      wasShowingRef.current = false;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setVisible(false);
      }, minMs);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [showing, minMs]);

  return visible;
}