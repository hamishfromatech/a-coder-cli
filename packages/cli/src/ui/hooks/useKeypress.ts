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

let isPasteActive = false;
const handlers = new Set<KeypressHandler>();
let isInitialized = false;
let currentStdin: NodeJS.ReadStream | null = null;
let currentRawKeypressHandler: ((data: Buffer) => void) | null = null;

export function isPasting(): boolean {
  return isPasteActive;
}

export function resetKeypressSingleton() {
  if (isInitialized && currentStdin && currentRawKeypressHandler) {
    currentStdin.removeListener('data', currentRawKeypressHandler);
  }
  isPasteActive = false;
  handlers.clear();
  isInitialized = false;
  currentStdin = null;
  currentRawKeypressHandler = null;
}

/**
 * A hook that listens for keypress events from stdin, providing a
 * key object that mirrors the one from Node's `readline` module,
 * adding a 'paste' flag for characters input as part of a bracketed
 * paste (when enabled).
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
      const rl = readline.createInterface({ input: keypressStream });
      readline.emitKeypressEvents(keypressStream, rl);

      const handleKeypress = (_: unknown, key: Key) => {
        if (key.name === 'return' && key.sequence === '\x1B\r') {
          key.meta = true;
        }
        const keyWithPaste = { ...key, paste: false };
        for (const h of handlers) {
          h(keyWithPaste);
        }
      };

      let pasteBuffer = Buffer.alloc(0);

      const handleRawKeypress = (data: Buffer) => {
        const PASTE_MODE_PREFIX = Buffer.from('\x1B[200~');
        const PASTE_MODE_SUFFIX = Buffer.from('\x1B[201~');

        let pos = 0;
        while (pos < data.length) {
          const prefixPos = data.indexOf(PASTE_MODE_PREFIX, pos);
          const suffixPos = data.indexOf(PASTE_MODE_SUFFIX, pos);

          const isPrefixNext =
            prefixPos !== -1 && (suffixPos === -1 || prefixPos < suffixPos);
          const isSuffixNext =
            suffixPos !== -1 && (prefixPos === -1 || suffixPos < prefixPos);

          let nextMarkerPos = -1;
          if (isPrefixNext) {
            nextMarkerPos = prefixPos;
          } else if (isSuffixNext) {
            nextMarkerPos = suffixPos;
          }

          if (nextMarkerPos === -1) {
            const remainingData = data.slice(pos);
            if (isPasteActive) {
              pasteBuffer = Buffer.concat([pasteBuffer, remainingData]);
            } else {
              keypressStream.write(remainingData);
            }
            return;
          }

          const nextData = data.slice(pos, nextMarkerPos);
          if (nextData.length > 0) {
            if (isPasteActive) {
              pasteBuffer = Buffer.concat([pasteBuffer, nextData]);
            } else {
              keypressStream.write(nextData);
            }
          }

          if (isPrefixNext) {
            isPasteActive = true;
          } else if (isSuffixNext) {
            isPasteActive = false;
            const pasteKey: Key = {
              name: '',
              ctrl: false,
              meta: false,
              shift: false,
              paste: true,
              sequence: pasteBuffer.toString(),
            };
            for (const h of handlers) {
              h(pasteKey);
            }
            pasteBuffer = Buffer.alloc(0);
          }
          pos = nextMarkerPos + PASTE_MODE_PREFIX.length;
        }
      };

      keypressStream.on('keypress', handleKeypress);
      currentRawKeypressHandler = handleRawKeypress;
      currentStdin = stdin;
      stdin.on('data', handleRawKeypress);
    }

    return () => {
      handlers.delete(handler);
      // We don't easily uninitialize the singleton because other hooks might still be using it.
      // But we can reset raw mode if no more handlers are active.
      if (handlers.size === 0) {
        setRawMode(false);
      }
    };
  }, [isActive, stdin, setRawMode]);
}

