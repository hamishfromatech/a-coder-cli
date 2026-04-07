# Input System Architecture

This document describes how keyboard input and paste events are handled in the CLI.

## Overview

The input system uses Ink's `useStdin` hook to capture terminal input and a custom `useKeypress` hook to process and dispatch key events to UI components.

## Key Components

### `useKeypress` Hook

Located at `packages/cli/src/ui/hooks/useKeypress.ts`

The `useKeypress` hook is a singleton-based system that ensures only one stdin listener is active regardless of how many components use the hook.

**Key features:**
- Singleton listener pattern - only one stdin handler regardless of component count
- Bracketed paste mode detection - detects paste start (`\x1b[200~`) and end (`\x1b[201~`) markers
- Single-event paste emission - pastes are emitted as one key event with full content

**Key interface:**
```typescript
export interface Key {
  name: string;      // e.g., 'return', 'escape', 'a'
  ctrl: boolean;     // Ctrl modifier
  meta: boolean;     // Meta/Alt modifier
  shift: boolean;    // Shift modifier
  paste: boolean;    // True if this is a paste event
  sequence: string;  // Raw character sequence
}
```

### Bracketed Paste Mode

When you paste text in a terminal that supports bracketed paste mode:
1. The terminal sends `\x1b[200~` before the paste content
2. The terminal sends `\x1b[201~` after the paste content
3. The content between markers is the actual pasted text

The `useKeypress` hook:
1. Detects these markers in the input stream
2. Strips the markers from the content
3. Emits the ENTIRE paste content as a single key event with `paste: true`
4. Resets paste mode when the end marker is received

This approach prevents the UI freeze that occurs when paste content is processed character-by-character (which would trigger a React re-render for each character).

### Text Buffer Integration

The `TextBuffer` component (`packages/cli/src/ui/components/shared/text-buffer.ts`) handles paste events specially:

```typescript
// In handleInput():
else if (key.paste && key.sequence) {
  // Paste content - insert the entire sequence at once
  insert(key.sequence);
}
```

This ensures pastes are inserted in a single operation rather than character-by-character.

## Singleton Pattern

The `useKeypress` hook uses a module-level singleton to manage stdin:

```typescript
const handlers = new Set<KeypressHandler>();
let isInitialized = false;
let isPasteActive = false;

function setupStdinListener(stdin, setRawMode) {
  if (isInitialized || !stdin.isTTY) {
    return;
  }
  isInitialized = true;
  setRawMode(true);
  stdin.on('data', (data) => {
    // Process and emit to all handlers
  });
}
```

Only the first `useKeypress` component to mount sets up the listener. Subsequent components add their handlers to the shared set.

## Debugging

To debug input issues, set the `DEBUG_KEYS` environment variable:

```bash
DEBUG_KEYS=true a-coder-cli
```

This will log all key events to stderr with their properties.

## Common Issues

### Multi-line paste freezes keyboard

**Cause:** Pasted content was being emitted as multiple key events, causing rapid React re-renders.

**Fix:** The hook now emits pastes as a single key event with the full content.

### Keys repeat or type multiple times

**Cause:** Multiple stdin listeners being registered (deprecated issue - now uses singleton pattern).

**Fix:** The singleton pattern ensures only one listener processes stdin data.

## Files

- `packages/cli/src/ui/hooks/useKeypress.ts` - Main keypress handling hook
- `packages/cli/src/ui/components/shared/text-buffer.ts` - Text buffer with paste handling
- `packages/cli/src/ui/components/InputPrompt.tsx` - Input component using the hooks