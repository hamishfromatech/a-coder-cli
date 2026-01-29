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
        const str = buffer.toString('utf8');

        // Heuristic: Large chunks are pastes (used as fallback)
        if (buffer.length > 10 && !isPasteActive) {
          isPasteJustFinished = true;
          if (pasteTimer) clearTimeout(pasteTimer);
          pasteTimer = setTimeout(() => {
            isPasteJustFinished = false;
            pasteTimer = null;
          }, 200);
        }

        // Bracketed paste detection - process BEFORE forwarding to keypress stream
        // We need to set isPasteActive BEFORE the content is parsed into keypress events
        if (str.includes('\x1B[200~')) {
          isPasteActive = true;
        }

        // Strip bracketed paste markers from the buffer before forwarding
        // This prevents the escape sequences from interfering with key parsing
        let contentToProcess = str;
        if (contentToProcess.includes('\x1B[200~')) {
          contentToProcess = contentToProcess.replace(/\x1B\[200~/g, '');
        }
        if (contentToProcess.includes('\x1B[201~')) {
          contentToProcess = contentToProcess.replace(/\x1B\[201~/g, '');
          isPasteActive = false;
          isPasteJustFinished = true;
          if (pasteTimer) clearTimeout(pasteTimer);
          pasteTimer = setTimeout(() => {
            isPasteJustFinished = false;
            pasteTimer = null;
          }, 200);
        }

        // Forward to keypress parser (without bracketed paste markers)
        keypressStream.write(Buffer.from(contentToProcess, 'utf8'));
      });
    }

    return () => {
      handlers.delete(handler);
    };
  }, [isActive, stdin, setRawMode]);
}
