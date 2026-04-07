/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';

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
const handlers = new Set<KeypressHandler>();
let isInitialized = false;
let isPasteActive = false;

export function isPasting(): boolean {
  return isPasteActive;
}

export function resetKeypressSingleton() {
  isPasteActive = false;
  handlers.clear();
  isInitialized = false;
}

// Internal function to emit a key to all handlers
function emitKey(key: Key): void {
  for (const h of handlers) {
    try {
      h(key);
    } catch (err) {
      console.error('[useKeypress] Handler error:', err);
    }
  }
}

// Internal function to process text input
function processInput(text: string): void {
  // Check for bracketed paste markers
  const hasPasteStart = text.includes('\x1b[200~');
  const hasPasteEnd = text.includes('\x1b[201~');

  if (hasPasteStart) {
    isPasteActive = true;
  }

  // Extract the actual content (remove paste markers)
  let content = text;
  if (hasPasteStart) {
    content = content.replace(/\x1b\[200~/g, '');
  }
  if (hasPasteEnd) {
    content = content.replace(/\x1b\[201~/g, '');
  }

  // If we're in paste mode (bracketed paste was started), emit as single paste event
  if (isPasteActive) {
    // Emit the ENTIRE paste content as ONE key event
    // This lets the text buffer insert it all at once, which is much more efficient
    emitKey({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: content,
    });
  } else {
    // Normal typing - single character or Enter key
    if (content === '\n' || content === '\r') {
      emitKey({
        name: 'return',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: content,
      });
    } else {
      // Single character
      emitKey({
        name: content,
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: content,
      });
    }
  }

  // Reset paste mode if we saw the end marker
  if (hasPasteEnd) {
    isPasteActive = false;
  }
}

// Track if we've set up the listener on Ink's event emitter
let inkListenerSetup = false;

/**
 * A hook that listens for keypress events.
 * Uses Ink's internal event emitter when available to coexist with useInput.
 * Falls back to direct stdin handling when Ink's event system is not available.
 */
export function useKeypress(
  onKeypress: (key: Key) => void,
  { isActive }: { isActive: boolean },
) {
  const { stdin, setRawMode, internal_eventEmitter } = useStdin();
  const onKeypressRef = useRef(onKeypress);

  useEffect(() => {
    onKeypressRef.current = onKeypress;
  }, [onKeypress]);

  useEffect(() => {
    if (!isActive || !stdin.isTTY) {
      return;
    }

    // Prefer Ink's event emitter when available - this coexists with useInput
    if (internal_eventEmitter) {
      // Set raw mode via Ink's management
      setRawMode(true);

      // Set up listener on Ink's event emitter if not already done
      if (!inkListenerSetup) {
        internal_eventEmitter.on('input', (data: Buffer | string) => {
          const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
          processInput(str);
        });
        inkListenerSetup = true;
      }

      const handler: KeypressHandler = (key) => {
        onKeypressRef.current(key);
      };

      handlers.add(handler);

      return () => {
        handlers.delete(handler);
        // Note: We don't call setRawMode(false) here because other components
        // may still need raw mode. Ink manages this via reference counting.
      };
    }

    // Fallback: direct stdin handling (for non-Ink contexts)
    if (isInitialized) {
      const handler: KeypressHandler = (key) => {
        onKeypressRef.current(key);
      };
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }

    isInitialized = true;

    try {
      setRawMode(true);
    } catch (err) {
      console.error('[useKeypress] setRawMode error:', err);
    }

    stdin.on('data', (data: Buffer | string) => {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      processInput(str);
    });

    const handler: KeypressHandler = (key) => {
      onKeypressRef.current(key);
    };

    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  }, [isActive, stdin, setRawMode, internal_eventEmitter]);
}