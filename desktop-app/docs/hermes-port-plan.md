# Hermes desktop → A-Coder desktop port plan

Survey of the sibling `hermes-agent` repo (`apps/desktop`, on-disk state 2026-10-17)
for features, UI primitives, and interaction law worth porting into our Tauri
desktop app. Commit hashes are `hermes-agent` refs; re-read any with
`git show <hash>` in that repo.

## How to survey next time

```bash
cd ../hermes-agent
git log --since="2026-10-01" --format="%h %s" -- apps/desktop          # firehose
git log --since="2026-09-25" --grep="feat" -- apps/desktop            # features only
git show <hash> --stat                                                 # file list
cat apps/desktop/DESIGN.md                                             # design contract
```

The upstream is fast (≈1000 desktop commits/month); their main branch is the
feature source of truth — ignore their `feat/unified-gateway-runtime` merge
noise, filter with `--grep="feat"` + `--grep="ux|polish|anim"`.

## Ranked port list

| # | Feature | Their commits | Effort | Notes |
|---|---|---|---|---|
| 1 | **voice-turn model routing** | `6cc1efd8f9` (auxiliary.voice_chat, #83894) | engine + desktop | Voice turns bind to a dedicated fast model per-turn, unbind before background work; oversized turns stay on the main model (never compacts); separate usage attribution. Ours: engine-side per-prompt model override (`prompt.voiceTurn` flag + aux model setting) + desktop model-settings row. Highest value for our voice-call mode. |
| 2 | **HUD mode** (shipped in v0.80.142) | `src/store/hud.ts`, `electron/hud-ipc.ts`, `spawnHudWindow` (main.ts:13428–13586), `src/app/hud/hud-shell.tsx` | desktop (Tauri) | Transparent frameless always-on-top floating chat — the real composer + scrolling reply over other apps. See spec below. Extras (snap shortcut, session latch, click-through idle) deferred. |
| 3 | **Butterbar** | store `a10faf9e5a`, bar `3f62bc5342`, consumers `1176255381` | desktop, small | Anywhere-registerable notice strip above the statusbar: priority sort, rotating carousel w/ dots + hover-pause (3s dwell), tone/color variants via one CSS var, `persistKey` = remembered dismissal. Immediate use: update-available, MCP down, auth expiry. |
| 4 | **Guided first-run onboarding** | Oct 13 series (`2a1713c2d1`, `cd59efaed2`, `232f5c486b`, `8a55f7803c`, …) | desktop, large | Chat-driven setup beats: theme/layout/connector/plugin cards render in the conversation, the composer answers the waiting card, receipts collapse into a resolved row, "Skip setup" + "Run onboarding again". Theirs is gateway-event driven; ours must be a desktop-orchestrated run-store (no engine dependency). |
| 5 | **Approval CardStack** | DESIGN.md "Queued cards" (`src/components/ui/card-stack.tsx`) | desktop, medium | Inline approvals + toasts as a gesture stack: front card + 96% silhouette 7px above, 220ms promotion, 180ms clearance; **gestures never grant** (buttons grant); one persistent transcript-level host; prepared approvals can't remount the stack; reduced-motion settles instantly. |
| 6 | **Live partial transcription** | `00adf69d92` (stt.streaming) | deferred | Only meaningful with realtime STT endpoints (OpenAI Realtime/xAI WS/ElevenLabs). Local OpenAI-compatible whisper servers don't stream; our endpointing already covers the feel. Revisit if a user runs a streaming STT. |
| 7 | **Statusbar cwd switcher** | `63ed3caa4b` | engine + desktop | Change the focused session's working directory from the statusbar (their gateway `use-cwd-actions`). Needs a tiny engine `set_cwd` RPC. |
| 8 | **Theme typography knobs** | `7951ddd729` | desktop, small | Per-theme `baseSize`/`lineHeight`/`letterSpacing` baked into theme context; VS Code imports carry none. |
| 9 | Composer dim-on-idle | `08165d5893` | desktop, tiny | Dimmed composer returns after 5s without scrolling (`thread-scroll` store). |
| 10 | About ▸ update channel | `9287719a65`, `573f514a19` | infra | Stable-vs-nightly for source installs; blocked on our channel story (releases only today). |

Update-dialog release notes (`891a5dfb0d`: real notes + PR titles in the update
dialog) folds into item 10.

## Design-system parity (their DESIGN.md vs our inventory)

Quick wins — one coherent "design parity" pass:

- **Themed `Tip` tooltip system** — we have none; ~10 raw `title=` attrs remain
  (StatusBar, Cron, RightSidebar, SessionList). Their contract: 200ms open delay
  (no bubble trail while sweeping), 300ms warm-trail instant re-open, placement
  intents (`control` above / `toolbar` below / `row` right), `TipKeybindLabel`
  reads live bindings (never hardcode combos), `OverflowTip` = own slower delay,
  native `title=` banned by test.
- **`ConfirmDialog` + `confirm()` store** — one confirmation primitive: focus on
  Confirm at open (Enter confirms, Esc cancels), pending→done→close beat, inline
  error, one `secondaryAction` slot. Also invocable outside JSX via a store
  (`confirm()`), rendered by a single `ConfirmHost`.
- **Elevation + z-index ladder tokens** — floating surfaces share one
  `shadow-nous` + theme hairline; z-order is a named ladder
  (`--z-modal-backdrop/modal/popover/over-modal/switcher/boot-chain`), never
  ad-hoc `z-50`/`z-[80]` (we already have both).
- **`SearchField`** (borderless, underline-on-focus, hidden on empty lists),
  **`LogView`** (hairline-bordered tight mono), **`AnimatedInt`** (spring
  counter writing to the DOM directly), **`edgeMask`/`FadeScroll`** (masked
  scroll edges; dragged squares unmask themselves), **`FanMenu`** (hub fans
  sibling toggles out on hover — composer voice controls).

Interaction laws to adopt while touching surfaces:

- Single-cancel: Esc closes the topmost dismissable only, never both a dialog
  and the control underneath; keyboard ownership follows focus.
- Sticky user messages clip covered scrolling content (only the bubble owns
  fill); nested scrollers hand vertical scroll back at edges
  (`overscroll-behavior-y: auto`).
- Composer status stack: groups start collapsed except todos, top-edge ridge
  hides/reveals, choice persists per conversation, hidden-but-mounted.
- Direct manipulation paints first; persistence reconciles and rolls back
  visibly on failure. No automatic navigation/focus-steal from background
  events.
- Motion: quick functional ~100ms transitions; motion follows state, never
  delays it; no `transition-all` on hot interactions.

## App-shell level

- **Minimize to tray** — off-by-default, per-install; minimize hides while work
  continues; tray Show restores; Quit keeps the active-work confirmation.
  Tauri: `tray-icon` feature + Rust menu.
- **UI Scale + Chat Text Size** — window zoom is separate from a
  conversation-only text multiplier (their default 110%) that leaves
  sidebar/settings/panes untouched; sizes derive inside transcript/editor from
  root tokens.
- **Terminal pane + file tree** — persistent working panes (their Elite profile
  opens them). Highest cost: engine PTY-over-RPC; own session.
- Statusbar cwd switcher (item 7 above).

## Not porting (gateway/platform-coupled)

Canonical group chats/rooms + hermes-bots, plugin catalog + verified tier +
plugin sockets/profiles, free-tier/connectors/Nous-Tool-Gateway surfaces,
release lanes, telemetry rows, i18n (we're English-only), their
assistant-ui/react base (our chat stack is custom and staying), multi-window
profile peers + window glass (Electron translucency specifics).

## HUD mode — Tauri spec (item 2)

Theirs: a transparent frameless always-on-top window showing the REAL composer
with the reply scrolling above it; a full renderer with its own gateway (same
`ChatView` in a `hud` variant — no lookalike drift); app window steps aside on
reveal; click-through where the band isn't (`setIgnoreMouseEvents` + forward);
macOS vibrancy frost diffed through a latch; renderer-drag via a cursor-grab
session (X11/Wayland dialects handled); non-resizable window + programmatic
resize by edge handles; geometry persisted with display-aware defaults;
`?win=hud` query flag; profile/session latched at spawn.

Ours (single engine, one event channel):

- Events: Rust `app_handle.emit("rpc://event", …)` reaches **every** webview —
  a HUD window receives the full event stream without Rust changes. Commands:
  any window can invoke.
- Event stream has **no sessionPath on message events** (single active-session
  stream) → v1 HUD **mirrors the active session** (their session-latch needs an
  engine-side session-tagging change first).
- Window: `WebviewWindow("hud", { url: "index.html?win=hud", transparent,
  decorations: false, alwaysOnTop, shadow: false, skipTaskbar: false,
  minWidth 380, minHeight 160 })` — created JS-side, no Rust changes. Hidden
  main window would starve its WKWebView — the app window stays visible.
- Renderer: `isHudWindow()` query check in `main.tsx` → render `HudShell`
  instead of `App`. `HudShell` = transcript + real `Composer` + drag grip +
  close/expand rows; the slim layout is the HUD variant, not a fork.
- Event pipeline: extract the message/session-processing switch from App.tsx
  into `src/lib/agent-event-pipeline.ts` (pure store mutations) so both
  windows consume the same reducer — the architectural gate for every
  multi-window feature after this.
- Drag: renderer grip calls `window.startDragging()` (native). Resize: grip
  handles call `setSize` (Tauri allows programmatic sizing).
- Click-through: `setIgnoreCursorEvents(ignore)` when nothing interactive is
  under the cursor (measure + hysteresis as theirs does; `forward` analog =
  re-arm on mousemove).
- Frost: `windowEffects: { vibrancy: "hud" }` on macOS while the band shows;
  skip on Windows (transparent-window + DWM backdrop conflict is the same).
- Extras later: snap shortcuts, modifier-held drag, session latch (after
  engine tagging), composer draft stash sync.

Engine-side gaps worth filing: per-session event tagging (enables the session
latch), `set_cwd` RPC, prompt/turn model route override, PTY terminal RPC.