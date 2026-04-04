# CLI Architecture Refinement Plan

Based on `experience.md`, this document outlines the refined architecture for the A-Coder CLI terminal UI framework.

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Application Layer (src/gemini.tsx, src/ui/App.tsx)             │
│ - Main app entry, REPL screen, message rendering, tool dialogs  │
├─────────────────────────────────────────────────────────────────┤
│ Component Layer (src/ui/components/)                            │
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

## Phase 1: Core Infrastructure (Week 1-2)

### 1.1 Custom React Reconciler (`src/ink/reconciler.ts`)

Create a custom react-reconciler host config:

```typescript
// src/ink/reconciler.ts
import Reconciler from 'react-reconciler';
import { DOMElement, TextNode } from './dom.js';
import { YogaNode } from './yoga.js';

const hostConfig = {
  createInstance(type: string, props: any): DOMElement {
    const node = new DOMElement(type);
    node.yogaNode = YogaNode.create();
    applyProps(node, props);
    return node;
  },

  createTextInstance(text: string): TextNode {
    return new TextNode(text);
  },

  commitUpdate(node: DOMElement, oldProps: any, newProps: any): void {
    applyPropsDiff(node, oldProps, newProps);
  },

  resetAfterCommit(rootNode: DOMElement): void {
    // Trigger layout calculation + render
    onComputeLayout(rootNode);
  },

  // ... full reconciler interface
};

export const InkReconciler = Reconciler(hostConfig);
```

**Why:** Full control over reconciliation, better performance tuning, custom event handling.

### 1.2 Virtual DOM Implementation (`src/ink/dom.ts`)

```typescript
// src/ink/dom.ts
export class DOMElement {
  nodeName: string;
  childNodes: (DOMElement | TextNode)[] = [];
  yogaNode: YogaNode | null = null;
  style: Record<string, any> = {};
  attributes: Record<string, any> = {};
  eventHandlers: Map<string, Function[]> = new Map();

  // DOM-like methods
  appendChild(child: DOMElement | TextNode): void;
  removeChild(child: DOMElement | TextNode): void;
  insertBefore(newChild: DOMElement | TextNode, refChild: DOMElement | TextNode): void;
}

export class TextNode {
  nodeValue: string;
  textStyles: TextStyle = {};
}
```

**Why:** Enables Yoga layout integration, event system, and style inheritance.

### 1.3 StylePool for Performance (`src/ink/style-pool.ts`)

```typescript
// src/ink/style-pool.ts
export class StylePool {
  private styleMap: Map<string, number> = new Map();
  private idToStyle: AnsiCode[][] = [];

  intern(styles: AnsiCode[]): number {
    const key = styles.join(',');
    if (this.styleMap.has(key)) {
      return this.styleMap.get(key)!;
    }
    const id = this.idToStyle.length;
    this.styleMap.set(key, id);
    this.idToStyle.push(styles);
    return id;
  }

  transition(fromId: number, toId: number): string {
    // Return cached transition ANSI string
  }
}
```

**Why:** Avoids per-frame style allocations, enables fast style transitions.

## Phase 2: Terminal Output (Week 2-3)

### 2.1 Cell-Based Rendering (`src/ink/screen.ts`)

```typescript
// src/ink/screen.ts
type Cell = {
  char: string;           // Grapheme cluster
  width: number;          // 1 (narrow) or 2 (wide)
  styleId: number;        // Packed style reference
  hyperlink?: string;     // OSC 8 URL
};

export class Screen {
  private cells: Cell[][];
  private stylePool: StylePool;

  setCell(x: number, y: number, char: string, styleId: number): void;
  getCell(x: number, y: number): Cell | undefined;
}
```

**Why:** Enables incremental updates, wide character support (CJK, emoji), hyperlink embedding.

### 2.2 ANSI Escape Sequence Handler (`src/ink/termio/ansi.ts`)

```typescript
// src/ink/termio/ansi.ts
export const CSI = {
  HIDE_CURSOR: '\x1b[?25l',
  SHOW_CURSOR: '\x1b[?25h',
  ALT_SCREEN_ENTER: '\x1b[?1049h',
  ALT_SCREEN_LEAVE: '\x1b[?1049l',
  SGR_MOUSE_ENABLE: '\x1b[?1006h',
  SCROLL_REGION: (top: number, bottom: number) => `\x1b[${top};${bottom}r`,
};

export const SGR = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',
  FOREGROUND: (code: number) => `\x1b[${30 + code}m`,
};

export const OSC = {
  HYPERLINK: (url: string, id?: string) => `\x1b]8;${id || ''};${url}\x1b\\`,
  CLIPBOARD: (data: string) => `\x1b]52;c;${data}\x1b\\`,
};
```

**Why:** Direct control over terminal capabilities, optimized escape sequences.

### 2.3 Diff Engine (`src/ink/log-update.ts`)

```typescript
// src/ink/log-update.ts
export function render(prev: Frame, next: Frame, altScreen: boolean): Diff {
  // 1. Check for resize → full reset
  // 2. Apply DECSTBM scroll hints
  // 3. diffEach() finds changed cells
  // 4. moveCursorTo() positions cursor
  // 5. writeCellWithStyleStr() outputs char
}

// Optimizations:
// - Virtual screen tracking (cursor position between frames)
// - Incremental updates (only changed cells written)
// - DECSTBM scroll optimization (hardware scroll for scrollboxes)
// - DEC 2026 synchronized output (BSU/ESU wrapper prevents flicker)
// - Wide char compensation (CHA cursor fix for emoji on old wcwidth)
```

**Why:** Minimal terminal writes, flicker-free rendering, smooth scrolling.

## Phase 3: Terminal Input (Week 3-4)

### 3.1 Enhanced Input Parser (`src/ink/parse-keypress.ts`)

```typescript
// src/ink/parse-keypress.ts
export function createTokenizer(): Tokenizer {
  // Supports:
  // - Kitty keyboard protocol (CSI u): ESC[13;2u = Shift+Enter
  // - xterm modifyOtherKeys: ESC[27;2;13~ for ctrl+shift+letter
  // - Bracketed paste mode: ESC[200~...ESC[201~ distinguishes typed vs pasted
  // - SGR mouse tracking: ESC[<64;10;20M = wheel-up at col 10, row 20
  // - Wheel events: button codes 64/65
}
```

**Why:** Full keyboard support, mouse tracking, paste detection.

### 3.2 Event System (`src/ink/events/dispatcher.ts`)

```typescript
// src/ink/events/dispatcher.ts
export class EventDispatcher {
  // Event types: keydown, click, focus, blur, paste, resize, scroll
  // Priority scheduling:
  //   - Discrete: keyboard, click, focus (sync)
  //   - Continuous: scroll, resize, mousemove (batched)
  // - stopImmediatePropagation() support
  // - Capture/bubble phases like react-dom
}
```

**Why:** DOM-like event handling, proper event propagation.

### 3.3 Focus Management (`src/ink/focus.ts`)

```typescript
// src/ink/focus.ts
export class FocusManager {
  private activeElement: DOMElement | null = null;
  private focusStack: DOMElement[] = [];

  focus(element: DOMElement): void;
  blur(): void;
  focusNext(): void;  // Tab
  focusPrevious(): void;  // Shift+Tab

  private collectTabbable(root: DOMElement): DOMElement[];
}
```

**Why:** Tab navigation, auto-focus, focus trapping for dialogs.

## Phase 4: Advanced Features (Week 4-5)

### 4.1 Terminal Capability Detection (`src/ink/terminal.ts`)

```typescript
// src/ink/terminal.ts
export async function detectTerminal(): Promise<TerminalCapabilities> {
  // XTVERSION Probe: Send CSI > 0 q → receive DCS > | name ST
  // Detects: xterm.js, ghostty, kitty, iTerm2, WezTerm

  // Feature Detection:
  // - Synchronized output: DEC 2026 (iTerm2, WezTerm, Ghostty, kitty)
  // - Extended keys: Kitty keyboard + modifyOtherKeys
  // - Mouse tracking: SGR mode (1006) vs X10 (legacy)
  // - OSC 9;4 progress: iTerm2 3.6.6+, Ghostty 1.2.0+
}
```

**Why:** Graceful degradation, optimal rendering per terminal.

### 4.2 Scrolling Architecture (`src/ink/components/ScrollBox.tsx`)

```typescript
// ScrollBox DOM node:
//   - scrollTop: Current scroll position
//   - pendingScrollDelta: Accumulated wheel input
//   - scrollClampMin/Max: Virtual scroll bounds
//   - scrollAnchor: Element-to-scroll-to (deferred position read)
//   - stickyScroll: Auto-pin-to-bottom flag

// Render flow:
//   1. Yoga computes full content height
//   2. renderNodeToOutput culls children outside viewport
//   3. Content translated by -scrollTop
//   4. Clipped to box bounds
```

**Why:** Smooth scrolling, virtual scrolling for large lists.

### 4.3 OSC 8 Hyperlinks (`src/ink/components/Link.tsx`)

```typescript
// src/ink/components/Link.tsx
export function Link({ href, children }: LinkProps) {
  return (
    <ink-text hyperlink={href}>
      {children}
    </ink-text>
  );
}

// Renders as: OSC 8 ; ; URL ST text OSC 8 ; ; ST
```

**Why:** Clickable URLs in terminal output.

## Phase 5: Component Migration (Week 5-6)

### 5.1 Core Primitives (`src/ink/components/`)

| Component | Description |
|-----------|-------------|
| `<Box>` | Flexbox container (`display: flex`) |
| `<Text>` | Styled text with color, bold, italic, underline |
| `<ScrollBox>` | Virtualized scrolling with imperative API |
| `<AlternateScreen>` | Alt-screen buffer wrapper (fullscreen mode) |
| `<Link>` | OSC 8 hyperlink wrapper |
| `<Button>` | Clickable interactive element |
| `<TextInput>` | Prompt input with cursor, history, mask |

### 5.2 Application Components (`src/ui/components/`)

Migrate existing components to use new primitives:
- **Messages**: Conversation message rendering
- **PermissionRequest**: Tool permission dialogs
- **Spinner**: Loading indicators with animation frames
- **VirtualMessageList**: Windowed message list
- **TaskListV2**: Task management UI
- **CostThresholdDialog**: Budget warning dialogs

## Performance Optimizations

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

## File Structure

```
packages/cli/src/
├── ink/
│   ├── reconciler.ts          # Custom react-reconciler
│   ├── dom.ts                 # Virtual DOM implementation
│   ├── yoga.ts                # Yoga WASM integration
│   ├── screen.ts              # Cell-based screen buffer
│   ├── style-pool.ts          # Interned styles
│   ├── log-update.ts          # Diff engine
│   ├── parse-keypress.ts      # Input tokenizer
│   ├── terminal.ts            # Capability detection
│   ├── focus.ts               # Focus management
│   ├── events/
│   │   └── dispatcher.ts      # Event system
│   ├── termio/
│   │   ├── ansi.ts            # ANSI escape sequences
│   │   ├── sgr.ts             # Style codes
│   │   └── osc.ts             # Operating system commands
│   └── components/
│       ├── Box.tsx
│       ├── Text.tsx
│       ├── ScrollBox.tsx
│       ├── Link.tsx
│       ├── Button.tsx
│       ├── TextInput.tsx
│       └── AlternateScreen.tsx
├── ui/
│   ├── App.tsx
│   ├── components/
│   ├── hooks/
│   └── utils/
└── gemini.tsx
```

## Migration Strategy

1. **Build in isolation**: Create `src/ink/` alongside existing Ink usage
2. **Incremental adoption**: Start with `<Box>` and `<Text>` components
3. **Feature flag**: Use `INK_VERSION=v2` env var to toggle
4. **Test coverage**: Each component needs unit tests
5. **Performance benchmarks**: Measure before/after for key operations

## Success Metrics

- **Render latency**: < 16ms (60fps) for typical updates
- **Input latency**: < 50ms from keypress to screen update
- **Memory usage**: < 100MB for typical session
- **ANSI output**: 50% reduction in bytes sent to terminal
- **Scroll performance**: Smooth 60fps for 1000+ item lists

## References

- `experience.md` - Full architecture documentation
- `react-reconciler` - https://github.com/facebook/react/tree/main/packages/react-reconciler
- `Yoga` - https://github.com/facebook/yoga
- `Kitty Keyboard Protocol` - https://sw.kovidgoyal.net/kitty/keyboard-protocol/
- `DEC 2026` - https://vt100.net/docs/vt510-rm/DECSCUSR.html
