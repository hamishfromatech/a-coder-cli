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

interface HandlerEntry {
  handler: KeypressHandler;
  priority: number;
}

// Singleton state — ordered list by priority (highest first)
const handlers: HandlerEntry[] = [];
let isInitialized = false;
let isPasteActive = false;
let propagationStopped = false;

/** Insert a handler into the list, maintaining descending priority order. */
function insertHandler(handler: KeypressHandler, priority: number): void {
  const entry: HandlerEntry = { handler, priority };
  let i = 0;
  while (i < handlers.length && handlers[i].priority >= priority) {
    i++;
  }
  handlers.splice(i, 0, entry);
}

/** Remove a handler from the list by reference. */
function removeHandler(handler: KeypressHandler): void {
  const idx = handlers.findIndex((e) => e.handler === handler);
  if (idx !== -1) handlers.splice(idx, 1);
}

/** Call inside a handler to prevent subsequent handlers from receiving the event. */
export function stopPropagation(): void {
  propagationStopped = true;
}

/** Check if the most recent key event was consumed by a higher-priority handler. */
export function isPropagationStopped(): boolean {
  return propagationStopped;
}

export function isPasting(): boolean {
  return isPasteActive;
}

export function resetKeypressSingleton() {
  isPasteActive = false;
  handlers.length = 0;
  isInitialized = false;
  propagationStopped = false;
  inkListenerSetup = false;
  inkInputListener = null;
}

// Internal function to emit a key to all handlers in priority order (highest first).
// Handlers can call stopPropagation() to prevent subsequent handlers from receiving the event.
function emitKey(key: Key): void {
  propagationStopped = false;
  for (const entry of handlers) {
    if (propagationStopped) break;
    try {
      entry.handler(key);
    } catch (err) {
      console.error('[useKeypress] Handler error:', err);
    }
  }
}

// Map CSI/SS3 escape sequences to human-readable key names.
// Covers the same mappings as Ink's parseKeypress (enquirer keypress.js).
const CSI_KEY_NAMES: Record<string, string> = {
  // xterm ESC [ letter
  '[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left',
  '[E': 'clear', '[F': 'end', '[H': 'home',
  // xterm/gnome ESC O letter
  'OA': 'up', 'OB': 'down', 'OC': 'right', 'OD': 'left',
  'OE': 'clear', 'OF': 'end', 'OH': 'home',
  // xterm/rxvt ESC [ number ~
  '[1~': 'home', '[2~': 'insert', '[3~': 'delete', '[4~': 'end',
  '[5~': 'pageup', '[6~': 'pagedown',
  // putty
  '[[5~': 'pageup', '[[6~': 'pagedown',
  // rxvt
  '[7~': 'home', '[8~': 'end',
  // function keys
  'OP': 'f1', 'OQ': 'f2', 'OR': 'f3', 'OS': 'f4',
  '[11~': 'f1', '[12~': 'f2', '[13~': 'f3', '[14~': 'f4',
  '[[A': 'f1', '[[B': 'f2', '[[C': 'f3', '[[D': 'f4', '[[E': 'f5',
  '[15~': 'f5', '[17~': 'f6', '[18~': 'f7', '[19~': 'f8',
  '[20~': 'f9', '[21~': 'f10', '[23~': 'f11', '[24~': 'f12',
  // rxvt shifted keys
  '[a': 'up', '[b': 'down', '[c': 'right', '[d': 'left',
  Oa: 'up', Ob: 'down', Oc: 'right', Od: 'left',
  // misc
  '[Z': 'tab',
};

// Regex for function key sequences (ESC [ N ; M ~ or ESC [ O letter)
const FN_KEY_RE = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;

/**
 * Parse a single key event string (already split by Ink's input parser)
 * into a Key object with proper name, ctrl, meta, shift flags.
 */
function parseKeyToKey(text: string): Key {
  const s = text;
  const key: Key = {
    name: '',
    ctrl: false,
    meta: false,
    shift: false,
    paste: false,
    sequence: s,
  };

  if (s === '\r' || s === '\x1b\r') {
    key.name = 'return';
    key.meta = s.length === 2;
  } else if (s === '\n') {
    key.name = 'enter';
  } else if (s === '\t') {
    key.name = 'tab';
  } else if (s === '\b' || s === '\x1b\b') {
    key.name = 'backspace';
    key.meta = s.charAt(0) === '\x1b';
  } else if (s === '\x7f' || s === '\x1b\x7f') {
    key.name = 'delete';
    key.meta = s.charAt(0) === '\x1b';
  } else if (s === '\x1b' || s === '\x1b\x1b') {
    key.name = 'escape';
    key.meta = s.length === 2;
  } else if (s === ' ' || s === '\x1b ') {
    key.name = 'space';
    key.meta = s.length === 2;
  } else if (s.length === 1 && s.charCodeAt(0) <= 0x1a) {
    // Ctrl+letter (codepoints 1-26)
    key.name = String.fromCharCode(s.charCodeAt(0) + 0x60); // 'a' = 0x61
    key.ctrl = true;
  } else if (s.length === 1 && s >= '0' && s <= '9') {
    key.name = 'number';
  } else if (s.length === 1 && s >= 'a' && s <= 'z') {
    key.name = s;
  } else if (s.length === 1 && s >= 'A' && s <= 'Z') {
    key.name = s.toLowerCase();
    key.shift = true;
  } else if (s.startsWith('\x1b') && s.length >= 1) {
    // ESC + letter (meta+character)
    const metaRe = /^(?:\x1b)([a-zA-Z0-9])$/;
    const metaMatch = metaRe.exec(s);
    if (metaMatch) {
      key.meta = true;
      key.shift = /^[A-Z]$/.test(metaMatch[1]);
    } else {
      // CSI / SS3 sequence — try the key name map
      const fnMatch = FN_KEY_RE.exec(s);
      if (fnMatch) {
        const code = [fnMatch[1], fnMatch[2], fnMatch[4], fnMatch[6]]
          .filter(Boolean)
          .join('');
        const modifier = Number(fnMatch[3] || fnMatch[5] || 1) - 1;
        key.ctrl = !!(modifier & 4);
        key.meta = !!(modifier & 10);
        key.shift = !!(modifier & 1);
        key.name = CSI_KEY_NAMES[code] || '';
      } else {
        key.name = CSI_KEY_NAMES[s.slice(1)] || '';
        key.meta = true;
      }
    }
  }

  return key;
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
    emitKey({
      name: '',
      ctrl: false,
      meta: false,
      shift: false,
      paste: true,
      sequence: content,
    });
  } else if (content.length === 0) {
    // Paste marker only, no content to process
  } else {
    const parsed = parseKeyToKey(content);
    emitKey(parsed);
  }

  // Reset paste mode if we saw the end marker
  if (hasPasteEnd) {
    isPasteActive = false;
  }
}

// Track if we've set up the listener on Ink's event emitter
let inkListenerSetup = false;
// Keep a reference to the bound listener so we can remove it on cleanup
let inkInputListener: ((data: Buffer | string) => void) | null = null;

/**
 * A hook that listens for keypress events.
 * Uses Ink's internal event emitter when available to coexist with useInput.
 * Falls back to direct stdin handling when Ink's event system is not available.
 *
 * Priority: higher numbers fire first. Default is 0. Input-level handlers
 * should use priority 100 so they fire before App-level handlers (priority 0).
 * Handlers can call stopPropagation() to prevent lower-priority handlers from
 * receiving the event.
 */
export function useKeypress(
  onKeypress: (key: Key) => void,
  { isActive, priority = 0 }: { isActive: boolean; priority?: number },
) {
  const { stdin, setRawMode, internal_eventEmitter } = useStdin();
  const onKeypressRef = useRef(onKeypress);
  const priorityRef = useRef(priority);

  useEffect(() => {
    onKeypressRef.current = onKeypress;
  }, [onKeypress]);

  useEffect(() => {
    priorityRef.current = priority;
  }, [priority]);

  useEffect(() => {
    if (!isActive || !stdin.isTTY) {
      return;
    }

    // Prefer Ink's event emitter when available - this coexists with useInput
    if (internal_eventEmitter) {
      // Set raw mode via Ink's management — only when setting up for the first time
      // to avoid incrementing Ink's internal ref count on every handler mount
      if (!inkListenerSetup) {
        setRawMode(true);
        inkInputListener = (data: Buffer | string) => {
          const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
          processInput(str);
        };
        internal_eventEmitter.on('input', inkInputListener);
        inkListenerSetup = true;
      }

      const handler: KeypressHandler = (key) => {
        onKeypressRef.current(key);
      };

      insertHandler(handler, priorityRef.current);

      return () => {
        removeHandler(handler);
        // If no handlers remain, clean up the listener and balance Ink's raw mode ref count
        if (handlers.length === 0 && inkInputListener) {
          internal_eventEmitter.off('input', inkInputListener);
          inkInputListener = null;
          inkListenerSetup = false;
          setRawMode(false);
        }
      };
    }

    // Fallback: direct stdin handling (for non-Ink contexts)
    if (isInitialized) {
      const handler: KeypressHandler = (key) => {
        onKeypressRef.current(key);
      };
      insertHandler(handler, priorityRef.current);
      return () => {
        removeHandler(handler);
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
    insertHandler(handler, priorityRef.current);

    return () => {
      removeHandler(handler);
    };
  }, [isActive, stdin, setRawMode, internal_eventEmitter]);
}