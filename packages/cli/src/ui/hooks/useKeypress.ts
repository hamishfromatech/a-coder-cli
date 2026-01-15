/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';
import readline from 'readline';
import { PassThrough } from 'stream';

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  paste: boolean;
  sequence: string;
}

type KeypressHandler = (key: Key) => void;

// Singleton state
let isPasteActive = false;
let isPasteJustFinished = false;
let pasteTimer: NodeJS.Timeout | null = null;
const handlers = new Set<KeypressHandler>();
let isInitialized = false;

export function isPasting(): boolean {
  return isPasteActive || isPasteJustFinished;
}

export function resetKeypressSingleton() {
  isPasteActive = false;
  isPasteJustFinished = false;
  if (pasteTimer) {
    clearTimeout(pasteTimer);
    pasteTimer = null;
  }
  handlers.clear();
  isInitialized = false;
}

/**
 * A hook that listens for keypress events from stdin.
 * Uses a singleton listener to avoid overhead and hangs.
 */
export function useKeypress(
  onKeypress: (key: Key) => void,
  { isActive }: { isActive: boolean },
) {
  const { stdin, setRawMode } = useStdin();
  const onKeypressRef = useRef(onKeypress);

  useEffect(() => {
    onKeypressRef.current = onKeypress;
  }, [onKeypress]);

  useEffect(() => {
    if (!isActive || !stdin.isTTY) {
      return;
    }

    setRawMode(true);

    const handler: KeypressHandler = (key) => {
      onKeypressRef.current(key);
    };

    handlers.add(handler);

    if (!isInitialized) {
      isInitialized = true;
      
      const keypressStream = new PassThrough();
      readline.emitKeypressEvents(keypressStream);

      keypressStream.on('keypress', (_, key) => {
        const keyWithPaste = { 
          ...key, 
          paste: isPasting(),
          sequence: key.sequence || ''
        };
        for (const h of handlers) {
          h(keyWithPaste);
        }
      });

      stdin.on('data', (data: Buffer | string) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        
        // Heuristic: Large chunks are pastes
        if (buffer.length > 10 && !isPasteActive) {
          isPasteJustFinished = true;
          if (pasteTimer) clearTimeout(pasteTimer);
          pasteTimer = setTimeout(() => {
            isPasteJustFinished = false;
            pasteTimer = null;
          }, 200);
        }

        // Bracketed paste detection
        if (buffer.includes('\x1B[200~')) {
          isPasteActive = true;
        }
        if (buffer.includes('\x1B[201~')) {
          isPasteActive = false;
          isPasteJustFinished = true;
          if (pasteTimer) clearTimeout(pasteTimer);
          pasteTimer = setTimeout(() => {
            isPasteJustFinished = false;
            pasteTimer = null;
          }, 200);
        }

        // Forward to keypress parser
        keypressStream.write(buffer);
      });
    }

    return () => {
      handlers.delete(handler);
    };
  }, [isActive, stdin, setRawMode]);
}
