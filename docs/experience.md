# Claude Code CLI UI Architecture

A comprehensive guide to the React-based terminal UI framework that powers Claude Code.

---

## Overview

This is a **React-based terminal UI framework** (a custom fork of Ink) that renders interactive, full-screen terminal applications with mouse support, ANSI escape sequences, and Yoga flexbox layout.

---

## 1. Overall Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Application Layer (src/main.tsx, src/screens/REPL.tsx)         │
│ - Main app entry, REPL screen, message rendering, tool dialogs  │
├─────────────────────────────────────────────────────────────────┤
│ Component Layer (src/components/, src/ink/components/)          │
│ - Box, Text, TextInput, ScrollBox, Messages, PermissionRequest  │
├─────────────────────────────────────────────────────────────────┤
│ Ink Rendering Engine (src/ink/)                                 │
│ - React reconciler, DOM implementation, Yoga layout, diff engine│
├─────────────────────────────────────────────────────────────────┤
│ Terminal Output Layer (src/ink/termio/)                         │
│ - ANSI escape sequences (CSI, OSC, DCS), cell buffers, style池  │
├─────────────────────────────────────────────────────────────────┤
│ Terminal Input Layer (src/ink/parse-keypress.ts)                │
│ - Raw mode stdin, escape sequence tokenization, mouse events    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Rendering System ("Ink")

### Custom React Reconciler (`src/ink/reconciler.ts`)

Uses `react-reconciler` to create a terminal renderer:

- Maps React elements (`<ink-box>`, `<ink-text>`) to custom DOM-like nodes
- Implements full reconciler interface: `createInstance`, `appendChild`, `commitUpdate`, `commitMount`
- Integrates **Yoga WASM** (Facebook's flexbox engine) for layout calculations

Key reconciler methods:
```typescript
createInstance(type, props, root, hostContext) → DOMElement
createTextInstance(text, root, hostContext) → TextNode  
commitUpdate(node, oldProps, newProps) → applies prop diffs
resetAfterCommit(rootNode) → triggers layout + render
```

### Virtual DOM (`src/ink/dom.ts`)

Custom DOM-like node structure:
- `DOMElement`: nodeName, childNodes, yogaNode, style, attributes, event handlers
- `TextNode`: nodeValue, textStyles
- Each node has a `yogaNode` for flexbox layout
- Style system mirrors CSS: `setStyle(node, styles)`

### Render Pipeline (`src/ink/ink.tsx`, `src/ink/renderer.ts`)

1. React commits changes → `resetAfterCommit` calls `onComputeLayout`
2. Yoga calculates layout with terminal width constraint
3. `renderNodeToOutput` walks tree, writing to `Output` buffer
4. `LogUpdate.render()` diffs new screen against previous frame
5. `writeDiffToTerminal` sends minimal ANSI escape sequences

---

## 3. Key Libraries

| Library | Purpose |
|---------|---------|
| **React 19** | Component model, hooks, reconciliation |
| **react-reconciler** | Custom renderer host config |
| **Yoga (WASM)** | Flexbox layout engine |
| **chalk** | Terminal color/styling |
| **@alcalzone/ansi-tokenize** | ANSI escape sequence parsing |
| **figures** | Unicode box-drawing characters |
| **lodash-es/throttle** | Render throttling (~60fps) |

---

## 4. User Input Handling

### Raw Mode Input (`src/ink/parse-keypress.ts`)

Terminal enters raw mode via `setRawMode(true)`:
- Input tokenized by `createTokenizer` for escape sequence boundaries
- Supports:
  - **Kitty keyboard protocol** (CSI u): `ESC[13;2u` = Shift+Enter
  - **xterm modifyOtherKeys**: `ESC[27;2;13~` for ctrl+shift+letter
  - **Bracketed paste mode**: `ESC[200~...ESC[201~` distinguishes typed vs pasted
  - **SGR mouse tracking**: `ESC[<64;10;20M` = wheel-up at col 10, row 20
  - **Wheel events**: button codes 64/65

### Event System (`src/ink/events/dispatcher.ts`)

DOM-like capture/bubble phases:
- Event types: `keydown`, `click`, `focus`, `blur`, `paste`, `resize`, `scroll`
- Priority scheduling:
  - **Discrete**: keyboard, click, focus (sync)
  - **Continuous**: scroll, resize, mousemove (batched)
- `stopImmediatePropagation()` support

### Focus Management (`src/ink/focus.ts`)

`FocusManager` class:
- Tracks `activeElement` and focus stack
- Tab/Shift+Tab navigation via `collectTabbable` tree walk
- `tabIndex` gates focusability
- Auto-focus via `autoFocus` prop in `commitMount`

### useInput Hook (`src/ink/hooks/use-input.ts`)

```typescript
useInput((input, key) => {
  if (key.leftArrow) { /* handle left */ }
  if (input === 'q') { /* handle q */ }
})
```

---

## 5. Output Formatting & Display

### ANSI Escape Sequences (`src/ink/termio/`)

- **CSI (Control Sequence Introducer)**: `ESC[` - cursor movement, colors, scroll
- **DEC private modes**: Alt screen (`1049`), mouse tracking (`1003`, `1006`)
- **SGR (Select Graphic Rendition)**: colors, bold, underline, inverse
- **OSC (Operating System Command)**: hyperlinks (`OSC 8`), clipboard

### Diff Engine (`src/ink/log-update.ts`)

Key optimizations:
- **Virtual screen tracking**: maintains cursor position between frames
- **Incremental updates**: only changed cells written
- **DECSTBM scroll optimization**: hardware scroll for scrollboxes
- **DEC 2026 synchronized output**: BSU/ESU wrapper prevents flicker
- **Wide char compensation**: CHA cursor fix for emoji on old wcwidth

```typescript
render(prev: Frame, next: Frame, altScreen: boolean): Diff {
  // 1. Check for resize → full reset
  // 2. Apply DECSTBM scroll hints
  // 3. diffEach() finds changed cells
  // 4. moveCursorTo() positions cursor
  // 5. writeCellWithStyleStr() outputs char
}
```

### Cell-Based Rendering (`src/ink/screen.ts`)

```typescript
type Cell = {
  char: string           // Grapheme cluster
  width: number          // 1 (narrow) or 2 (wide)
  styleId: number        // Packed style reference
  hyperlink?: string     // OSC 8 URL
}
```

### StylePool (interned styles)

```typescript
class StylePool {
  intern(styles: AnsiCode[]): number  // Returns packed ID
  transition(fromId, toId): string    // Cached transition string
  get(id): AnsiCode[]                 // Recover styles from ID
}
```

Style IDs encode visibility on spaces (bit 0) for fast skipping.

---

## 6. Key Components

### Core Primitives (`src/ink/components/`)

| Component | Description |
|-----------|-------------|
| `<Box>` | Flexbox container (`display: flex`) |
| `<Text>` | Styled text with color, bold, italic, underline |
| `<ScrollBox>` | Virtualized scrolling with imperative API |
| `<AlternateScreen>` | Alt-screen buffer wrapper (fullscreen mode) |
| `<Link>` | OSC 8 hyperlink wrapper |
| `<Button>` | Clickable interactive element |
| `<TextInput>` | Prompt input with cursor, history, mask |

### Application Components (`src/components/`)

- **Messages**: Conversation message rendering
- **PermissionRequest**: Tool permission dialogs
- **Spinner**: Loading indicators with animation frames
- **VirtualMessageList**: Windowed message list
- **TaskListV2**: Task management UI
- **CostThresholdDialog**: Budget warning dialogs

---

## 7. Layout System

Yoga node created per `<Box>` (not for `<Text>` or `<Link>`):

```typescript
// Box props → Yoga styles
const yogaNode = Yoga.Node.create()
yogaNode.setFlexDirection(FlexDirection.Row)
yogaNode.setFlexGrow(props.flexGrow ?? 0)
yogaNode.setFlexShrink(props.flexShrink ?? 0)
```

Text measurement via `measureText()` with grapheme-aware width.

---

## 8. Scrolling Architecture (`src/ink/components/ScrollBox.tsx`)

```
ScrollBox DOM node:
  - scrollTop: Current scroll position
  - pendingScrollDelta: Accumulated wheel input
  - scrollClampMin/Max: Virtual scroll bounds
  - scrollAnchor: Element-to-scroll-to (deferred position read)
  - stickyScroll: Auto-pin-to-bottom flag

Render flow:
  1. Yoga computes full content height
  2. renderNodeToOutput culls children outside viewport
  3. Content translated by -scrollTop
  4. Clipped to box bounds
```

---

## 9. Terminal Capability Detection

### XTVERSION Probe (`src/ink/terminal.ts`)

Sends `CSI > 0 q` → receives `DCS > | name ST`:
- Detects: xterm.js, ghostty, kitty, iTerm2, WezTerm
- Survives SSH (goes through pty, not env vars)

### Feature Detection

- **Synchronized output**: DEC 2026 (iTerm2, WezTerm, Ghostty, kitty)
- **Extended keys**: Kitty keyboard + modifyOtherKeys
- **Mouse tracking**: SGR mode (1006) vs X10 (legacy)
- **OSC 9;4 progress**: iTerm2 3.6.6+, Ghostty 1.2.0+

---

## 10. Performance Optimizations

| Optimization | Description |
|--------------|-------------|
| **StylePool** | Interns style arrays → packed int |
| **CharCache** | Caches grapheme+style per line |
| **Throttled render** | ~60fps via lodash throttle |
| **Dirty tracking** | `markDirty` walks ancestors |
| **Blit escaping** | Cached rects for absolute overlays |
| **DECSTBM scroll** | Hardware scroll for scrollbox |
| **Virtual scrolling** | `useVirtualScroll` mounts visible children |
| **React Compiler** | Automatic memoization |

---

## 11. Entry Points

| File | Description |
|------|-------------|
| `src/main.tsx` | Main application, CLI parsing, initialization |
| `src/screens/REPL.tsx` | Main REPL screen, message rendering, input handling |
| `src/ink/ink.tsx` | Ink class - render loop, terminal setup, event wiring |
| `src/ink/reconciler.ts` | React reconciler host config |
| `src/ink/dom.ts` | Virtual DOM implementation |
| `src/ink/log-update.ts` | Screen diff engine |
| `src/ink/parse-keypress.ts` | Terminal input parser |

---

## 12. Replication Checklist

To replicate this CLI UI experience:

1. **Set up react-reconciler** with custom host config for terminal
2. **Integrate Yoga WASM** for flexbox layout calculations
3. **Implement double-buffered screen** with cell-based diff
4. **Support ANSI escape sequences**: cursor (CSI), colors (SGR), hyperlinks (OSC 8)
5. **Enable raw mode** for input with escape sequence tokenization
6. **Implement capture/bubble event dispatch** like react-dom
7. **Add alt-screen support** (DEC 1049) for fullscreen mode
8. **Support mouse tracking** (SGR mode 1006) for scroll/click
9. **Cache styles and graphemes** to avoid per-frame allocations
10. **Throttle renders** to ~60fps with leading+trailing edges
11. **Handle wide characters** (CJK, emoji) with compensation for old wcwidth
12. **Implement focus management** with Tab/Shift+Tab navigation
13. **Add text selection** with anchor/focus model for alt-screen

---

## 13. Example Component Structure

```tsx
// REPL.tsx - Main screen
function REPL() {
  return (
    <Box flexDirection="column" height="100%">
      <Messages messages={messages} />
      <ScrollBox ref={scrollRef}>
        {/* Scrollable content */}
      </ScrollBox>
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
      />
    </Box>
  )
}

// Messages.tsx - Message list
function Messages({ messages }) {
  return (
    <Box flexDirection="column">
      {messages.map(msg => (
        <Message key={msg.id} message={msg} />
      ))}
    </Box>
  )
}

// Message.tsx - Single message
function Message({ message }) {
  return (
    <Box padding={1} marginBottom={1}>
      <Text bold>{message.role}: </Text>
      <Text>{message.content}</Text>
    </Box>
  )
}
```

---

## 14. Terminal Output Example

ANSI escape sequence flow for rendering a frame:

```
1. CSI ? 1049 h        → Enter alt screen
2. CSI ? 1006 h        → Enable SGR mouse mode
3. CSI ? 2026 h        → Begin synchronized update (DEC 2026)
4. CSI H               → Cursor home
5. CSI 31 m            → Set red foreground
6. Hello World         → Output text
7. CSI 0 m             → Reset styles
8. CSI ? 2026 l        → End synchronized update
9. CSI ? 1049 l        → Exit alt screen (on exit)
```

---

## 15. Key Design Principles

1. **React-first**: Everything is a component; state drives rendering
2. **Incremental updates**: Only changed cells are written to terminal
3. **Hardware acceleration**: Use terminal capabilities (DECSTBM, DEC 2026) when available
4. **Graceful degradation**: Fall back to simpler rendering on older terminals
5. **Performance**: Style interning, grapheme caching, throttled renders
6. **Cross-terminal**: Detect capabilities dynamically, not via TERM sniffing

---

This architecture provides a **React-native development experience for terminal applications** with full mouse support, smooth scrolling, hardware-accelerated rendering, and cross-terminal compatibility.
