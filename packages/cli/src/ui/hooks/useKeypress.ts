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

/**
 * A hook that listens for keypress events from stdin, providing a
 * key object that mirrors the one from Node's `readline` module,
 * adding a 'paste' flag for characters input as part of a bracketed
 * paste (when enabled).
 *
 * Pastes are currently sent as a single key event where the full paste
 * is in the sequence field.
 *
 * @param onKeypress - The callback function to execute on each keypress.
 * @param options - Options to control the hook's behavior.
 * @param options.isActive - Whether the hook should be actively listening for input.
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

    const keypressStream = new PassThrough();
    // Prior to node 20, node's built-in readline does not support bracketed
    // paste mode. We hack by detecting it with our own handler.
    // We force this to true to ensure consistent paste handling across all node versions.
    let usePassthrough = true;
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0], 10);

    let isPaste = false;
    let pasteBuffer = Buffer.alloc(0);

    const handleKeypress = (_: unknown, key: Key) => {
      // Handle special keys
      if (key.name === 'return' && key.sequence === '\x1B\r') {
        key.meta = true;
      }
      onKeypressRef.current({ ...key, paste: false });
    };

    const handleRawKeypress = (data: Buffer) => {
      const PASTE_MODE_PREFIX = Buffer.from('\x1B[200~');
      const PASTE_MODE_SUFFIX = Buffer.from('\x1B[201~');

      let pos = 0;
      while (pos < data.length) {
        const prefixPos = data.indexOf(PASTE_MODE_PREFIX, pos);
        const suffixPos = data.indexOf(PASTE_MODE_SUFFIX, pos);

        // Determine which marker comes first, if any.
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
          if (isPaste) {
            pasteBuffer = Buffer.concat([pasteBuffer, remainingData]);
          } else {
            keypressStream.write(remainingData);
          }
          return;
        }

        const nextData = data.slice(pos, nextMarkerPos);
        if (nextData.length > 0) {
          if (isPaste) {
            pasteBuffer = Buffer.concat([pasteBuffer, nextData]);
          } else {
            keypressStream.write(nextData);
          }
        }

        if (isPrefixNext) {
          isPaste = true;
        } else if (isSuffixNext) {
          isPaste = false;
          onKeypressRef.current({
            name: '',
            ctrl: false,
            meta: false,
            shift: false,
            paste: true,
            sequence: pasteBuffer.toString(),
          });
          pasteBuffer = Buffer.alloc(0);
        }
        pos = nextMarkerPos + PASTE_MODE_PREFIX.length; // Both markers have the same length
      }
    };

    let rl: readline.Interface;
    if (usePassthrough) {
      rl = readline.createInterface({ input: keypressStream });
      readline.emitKeypressEvents(keypressStream, rl);
      keypressStream.on('keypress', handleKeypress);
      stdin.on('data', handleRawKeypress);
    } else {
      rl = readline.createInterface({ input: stdin });
      readline.emitKeypressEvents(stdin, rl);
      stdin.on('keypress', handleKeypress);
    }

    return () => {
      if (usePassthrough) {
        keypressStream.removeListener('keypress', handleKeypress);
        stdin.removeListener('data', handleRawKeypress);
      } else {
        stdin.removeListener('keypress', handleKeypress);
      }
      rl.close();
      setRawMode(false);

      // If we are in the middle of a paste, send what we have.
      if (isPaste) {
        onKeypressRef.current({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBuffer.toString(),
        });
        pasteBuffer = Buffer.alloc(0);
      }
    };
  }, [isActive, stdin, setRawMode]);
}
