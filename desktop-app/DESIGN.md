# Desktop Design System

Conventions for the Tauri desktop app (`desktop-app`). Read this before adding a component, panel, or style. The rule of thumb: **one source per concern, tokens over literals, flat over boxed.** If you reach for a raw color, a one-off shadow, a bespoke button, or a hardcoded `px-*` on a control — stop, there's already a primitive for it.

This file owns the visual and interaction contract. Read [`AGENTS.md`](../../AGENTS.md) for architecture, state, and testing rules.

This doc contains two kinds of content, maintained differently:

- **Principles** (flatness, intent, feedback, motion) are durable. They hold as components come and go.
- **Named contracts** (tokens, component variants, primitive names) are the design system's current API. They are maintained *with* the code: if you change a primitive, token, or variant, update its entry here **in the same change** — a stale name in this file is a bug, exactly like a stale type.

When a rule and the code disagree, fix whichever is wrong rather than forking a one-off at the call site.

## Principles

1. **Flat, not boxed.** No card-in-card, no divider borders inside a panel. Group with whitespace and a single hairline, never nested rounded boxes.
2. **Borderless elevation for floating panels.** Overlays float on layered soft shadow + a `--pi-border` hairline, not thick framed boxes. In-panel structure may use token hairlines sparingly.
3. **One primitive per concern.** One `Button`, one set of control variants, one `Modal`, one `Badge`. Migrate onto them; don't fork.
4. **Tokens, not literals.** Reference CSS vars (`--pi-*`, `--font-*`), never raw hex / ad-hoc rgba in components.
5. **Style lives in the primitive.** Variants and sizes own padding, radius, color, chrome. Call sites pass a `variant`/`size`, not `className` overrides that re-specify those.
6. **Intent before automation.** Surface useful actions and previews, but do not open panes, move focus, or navigate because a tool happened to produce something.
7. **Immediate feedback.** Direct manipulation updates the view first. Network or disk persistence reconciles afterward and rolls back visibly on failure.

## Information Architecture

- **Chat is the home surface.** The transcript and composer stay primary; tools, previews, files, and settings complement the conversation.
- **Sidebar is workspace context.** Projects, tasks, and todos live in the left sidebar. The sidebar can be pinned (always visible) or hover-rail (collapsed until mouse nears).
- **Right sidebar is tool context.** File tree, subagent panels, and tool-specific views appear on the right. Resizable drawer.
- **Pages are overlays.** Settings, model picker, session picker, and onboarding render as modal overlays, not navigation routes.
- **One action, one home.** A command may have keyboard, palette, and visible affordances, but they invoke the same action and state. Do not fork behavior per entry point.

Navigation must preserve context. A background session finishing, a tool result arriving, or a project refresh may update badges and cached data; it must not replace the foreground transcript or steal focus.

## Surfaces & Elevation

Floating panels (Modal, model-picker, session-picker, onboarding, notifications) use:

```
background: var(--pi-surface-overlay)
border-radius: 14px
box-shadow:
  0 1px 1px rgba(0, 0, 0, 0.04),
  0 4px 12px rgba(0, 0, 0, 0.16),
  0 16px 48px rgba(0, 0, 0, 0.28)
border: 1px solid var(--pi-border)
```

The `.pi-card-overlay` utility class provides this. Don't add per-overlay `shadow-[…]` or `border-*` one-offs; if elevation needs to change, change the token or the utility class.

## Stroke & Color Tokens

| Token | Use |
| --- | --- |
| `--pi-bg` | Deepest chrome — chat background |
| `--pi-surface` | Sidebar / panels |
| `--pi-surface-raised` | Cards, editor, in-panel surfaces |
| `--pi-surface-overlay` | Modals / popovers |
| `--pi-border` | Hairline for all bordered surfaces |
| `--pi-border-strong` | Emphasized hairline (focus, active) |
| `--pi-text` | Primary text |
| `--pi-text-secondary` | Secondary / supporting text |
| `--pi-text-muted` | Muted / tertiary text |
| `--pi-text-faint` | Faint / quaternary text |
| `--pi-accent` | Brand/accent color (Nous blue) |
| `--pi-accent-hover` | Accent on hover |
| `--pi-accent-soft` | Accent fill at 14% opacity |
| `--pi-accent-ring` | Focus ring accent |
| `--pi-success` | Success / positive status |
| `--pi-warning` | Warning / caution status |
| `--pi-error` | Error / destructive status |

Never hardcode `border-gray-*`, `bg-white`, `text-black`, etc. The only sanctioned literal is the grain overlay in `index.css`.

## Z-Index Ladder

Use Tailwind's `z-*` utilities with these semantic levels:

| Level | Z-Index | Use |
| --- | --- | --- |
| Base | 0 | Normal content |
| Sticky | 10 | Sticky headers, toolbars |
| Sidebar | 20 | Left/right sidebars |
| Overlay | 30 | Modal backdrop, drawer |
| Modal | 40 | Modal content, popover |
| Toast | 50 | Toast notifications |
| Top | 60 | Find bar, command palette |
| Tooltip | 70 | Tooltips, dropdown menus |
| Crash | 9999 | Error boundary overlay |

Use the semantic classes where possible (`z-overlay`, `z-modal`, etc.) rather than numeric `z-[30]`.

## Typography

| Token | Use |
| --- | --- |
| `--font-sans` | UI text — native system stack |
| `--font-mono` | Code, numerals — JetBrains Mono |
| `--conversation-text-font-size` | Body text in chat (0.8125rem) |
| `--conversation-tool-font-size` | Tool captions (0.6875rem) |

Use `font-mono` for code blocks, inline code, and numerical stats (tabular figures). The `.pi-tabular` utility sets `font-variant-numeric: tabular-nums`.

## Buttons — one component

`src/components/ui/Button.tsx` is the single source. Pick a `variant` + `size`; do **not** pass `h-*`, `px-*`, `py-*`, or icon-size overrides.

**Variants:** `default` (primary), `secondary` (soft fill — the default non-primary look), `destructive` (danger action), `outline` (transparent + ring, no fill), `ghost` (invisible until hover), `link` (inline link styling).

**Sizes:** `default`, `sm`, `lg`, `icon` (square, for icon-only buttons).

## Modals — one component

`src/components/ui/Modal.tsx` provides the backdrop + panel. Use it for all overlays; don't create bespoke dialog implementations.

Props:
- `open: boolean` — controlled visibility
- `onCloseChange: (open: boolean) => void` — close handler
- `title?: React.ReactNode` — header title
- `description?: React.ReactNode` — header subtitle
- `children: React.ReactNode` — modal content

The modal automatically applies `.pi-card-overlay` styling. Focus is trapped and Escape closes.

## Icons

Lucide icons are used throughout. Import from `lucide-react`:

```tsx
import { Search, Settings, ChevronRight } from 'lucide-react'
```

Icon size should match the containing button's `size`:
- `icon` button → `className="size-4"` (16px)
- `default` button → `className="size-5"` (20px)
- `lg` button → `className="size-6"` (24px)

## Animation & Motion

- **Respect reduced motion.** All animations must include a `prefers-reduced-motion` fallback (see `index.css`).
- **Fast feedback.** Hover/focus transitions: 120-150ms. Activation (press): 75ms.
- **Entrance animations.** Modals/overlays: 150-200ms ease-out. Avoid long entrances that delay interaction.
- **Streaming indicators.** Use the `.pi-dot` pulse animation for loading states.

## Dark Mode

The app defaults to dark mode. Light mode is activated by adding the `.light` class to `<html>` or `<body>`. All tokens have both dark and light variants defined in `index.css`. Never write color logic that branches on theme — the tokens handle it.

## Checklist

Before shipping a new component or panel:

- [ ] Uses only CSS tokens (`--pi-*`), never raw colors
- [ ] Uses existing primitives (Button, Modal, Badge) — or extends them, not forks
- [ ] Has no card-in-card (flat surfaces, single hairline)
- [ ] Uses `variant`/`size` props, not `className` overrides for core styles
- [ ] Respects `prefers-reduced-motion`
- [ ] Dark and light modes both work (test by toggling `.light`)
- [ ] No z-index conflicts (use the ladder above)