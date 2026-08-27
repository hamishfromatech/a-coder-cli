# Session Architecture Roadmap

Where desktop session switching is today, where it is going, and the phased plan to get there. Written after porting the immediate switching fixes (warm transcript cache, stale-switch guard, mid-stream tab switching, per-session drafts) and studying how hermes-agent's desktop (`~/Downloads/Code/A-Coder/hermes-agent/apps/desktop`) handles the same problem.

**Status:** Phase 1 (runtime registry + detaching turns) is implemented in the engine (`packages/coding-agent/src/core/agent-session-runtime.ts`) with the `get_sessions_status` / `abort_session` RPC commands and the `sessions_update` event; the desktop badges background running/finished states on session tabs (`src/stores/runtime-status-store.ts`) and shows a notification orb in the sidebar rail when a background session needs input (amber) or finished while away (green). Phase 2 is implemented on top of it: idle keep-alive (settled detached runtimes stay live ~30min, bounded at 4, `setDetachedIdleTimeoutMs` override), session-scoped UI-request routing (`extension_ui_request` tagged with `sessionFile`; the desktop queues requests per session and only shows them for the active session), session-scoped commands (`prompt`/`steer`/`follow_up`/`abort` accept `sessionPath`), and `switch_session` responses carrying `reattached` + a runtime snapshot for in-flight turn adoption. Not yet implemented: split view / tiles, and Phase 3 multi-project.

| Shipped (this round) | File |
|---|---|
| Warm per-session transcript cache (24-session LRU, instant paint on switch-back) | `src/lib/session-cache.ts` |
| Stale-switch guard (per-`session_start` generation; late fetches bail before painting) | `src/App.tsx` |
| Tab switching allowed mid-stream (engine aborts + persists the turn) | `src/components/SessionTabs.tsx` |
| Per-session composer drafts | `src/stores/draft-store.ts`, `src/components/Composer.tsx` |
| Current-session marker + streaming spinner in the session picker | `src/components/SessionPicker.tsx` |
| Searchable `/apps` gallery | `packages/coding-agent/src/modes/interactive/components/composio-apps-selector.ts` |

## The engine constraint

The desktop spawns **one** engine process (`packages/coding-agent` rpc-mode), and that process holds exactly **one** live `AgentSessionRuntime` — one agent loop, one open model stream, one queue. `switch_session` calls `teardownCurrent()` (disposing the runtime, aborting any in-flight turn) and builds a fresh one. Consequences:

- Switching mid-stream kills the turn (currently persisted as an aborted message).
- Only the active session can stream; there is no background state to badge.
- The desktop-side fixes above are workarounds for this constraint; they do not remove it.

## What hermes-agent does (reference points)

From `apps/desktop/src/app/session/` and `store/`:

- **`SessionStateCache`** (`session-state-cache.ts`): weighted LRU (24 sessions / 32MB) of full client-side transcripts. Warm sessions paint at 0ms; unreferenced, settled entries are evicted by bytes+count.
- **Durable transcript-tail cache** (`store/transcript-tail-cache`): paints the last page at ~0ms even on a cold resume; the authoritative transcript replaces it on arrival.
- **Request-id guards everywhere** (`isCurrentResume()` in `use-session-actions`): a fast A→B→C switch is never painted over by A's late response.
- **Multi-runtime backends**: a pool of live gateway processes per profile; `session.activate` rebinds a session's event transport to the active socket and returns a snapshot (running state, in-flight/queued tail, pending approvals) so the UI can adopt a turn mid-stream (`adoptedRunningTurn`).
- **Busy ≠ loading**: history load never locks the composer; per-session working/attention/stalled/unread states; switch away mid-run and return to the finished turn.
- **Draft + queued-prompt migration** across stored-session-id rotation (auto-compaction).

Their bug list is instructive: #85731, #88880, #89206 are all stale-response / cross-wired-runtime races from the pooled model. Multi-runtime needs those guards designed in from day one, not patched in later.

## Phase 1 — runtime registry + detaching turns

**Goal:** switch away mid-run without killing the turn; background completion is visible and recoverable. Ships independently.

The one architectural decision made up front: `AgentSessionRuntimeHost` stops treating its runtime as "the session" and holds a registry with an active pointer:

```
runtimes: Map<sessionPath, AgentSessionRuntime>   // bounded registry
activePath: sessionPath | null                    // who gets events + uiRequests
```

Initial lifecycle policy: one focused runtime; on switch, an in-flight turn keeps its loop alive **detached** (keeps streaming, appends to its own session file — already safe, one file per session) and dies when the turn ends.

Deliverables:

1. **Registry in `AgentSessionRuntimeHost`** — `switchSession` becomes "detach + focus" (stop forwarding events, do not dispose if a turn is running) instead of "dispose + recreate".
2. **`sessions_status` RPC** — per-session `{ running, queued, lastActivity }` so the desktop can badge non-active tabs.
3. **Session-tagged `agent_end`/`message_end` events** for background turns, so the desktop can show "finished while you were away".
4. **Desktop**: working dots on background tabs; "done" badge on return; switch-back stays the existing `get_messages` refetch (no activate protocol yet).
5. **Steer/abort semantics for detached turns**: queued steering still applies; abort from the desktop targets the right session.

Non-goals for this phase: `session.activate` snapshot protocol, multiple simultaneously-live runtimes, extension-hook changes beyond what tagging requires.

## Phase 2 — multiple live runtimes

With the registry in place, this is lifecycle + plumbing rather than a rewrite:

1. **Lifecycle policy**: detached runtimes survive their turn; eviction policy (idle timeout, max-N live runtimes, memory guard).
2. **`session.activate(path, { omitMessages })`**: rebinds event forwarding to the target runtime and returns a snapshot (running state, in-flight/queued tail, pending approvals) so the UI adopts mid-stream turns.
3. **Session-scoped routing**: permission requests, `uiRequests`, steering/follow-up queues addressed by session path, not "current". Background-session approvals queue as badges, hermes-style.
4. **Extension event scoping**: `session_start`/`session_shutdown`/`before_switch` fire for background attach/detach too; extension dialogs route by session.
5. **Desktop**: project-grouped sidebar with live sessions across projects; optional split view / tiles; runtimeId↔session mapping validated against recycled ids.

## Phase 3 (optional, later) — multiple projects in one engine

Today each runtime inherits the engine's cwd; a project switch spawns a new engine process. True multi-project either:

- **One engine per project**, pooled desktop-side (hermes's model — simplest, most isolated), or
- **Per-session cwd in the engine** (one engine hosts sessions across projects).

Phases 1–2 do not block either path; this decision can wait until Phase 2 lands.

## Decisions and risks

| Decision / risk | Notes |
|---|---|
| Registry shape decided in Phase 1, even with only one streaming runtime | This is what makes Phase 2 an evolution, not a rewrite. Do not special-case "the background turn" as a hack. |
| UI-request and permission routing is the hard part of Phase 2 | Background-session approvals/dialogs need a destination (badge + queue + restore on activate). Most edge cases live here. |
| Error/retry UX for unwatched sessions | A background turn's retry loop needs a design (badge only? toast on final failure?). |
| Memory ceiling | Each live runtime holds its conversation + open streams. Default caps (e.g. 3–4 live runtimes) with eviction; transcripts survive in session files regardless. |
| MCP/extension runner sharing | Shared runners save spawn cost but extensions with UI state need per-session scoping. Evaluate in Phase 2 design. |
| Shared-services audit | Audited (Phase 2): services are cached per cwd, so two live runtimes on one cwd share `settingsManager`/`modelRegistry`/`authStorage`. Per-session live state (model in `agent.state`, `_permissionMode`, steering queues) is session-owned; shared writes (`setDefaultModelAndProvider`, `setPermissionMode`, steering/follow-up modes) are "defaults for future sessions" — global-preference semantics identical to the CLI today. No leaks into live background sessions. |
| TUI parity | The CLI TUI consumes the same runtime semantics. Phase 1 must keep single-active behavior for the TUI; later phases can surface background sessions there too (e.g. status-line badge). |

## Related reading

- `desktop-app/DESIGN.md` — visual/interaction contract
- hermes reference: `apps/desktop/src/app/session/`, `src/store/gateway-switch.ts`, `src/app/session/hooks/use-session-actions/`
- Engine entry points for this work: `packages/coding-agent/src/core/agent-session-runtime.ts` (`switchSession`, `teardownCurrent`), `packages/coding-agent/src/modes/rpc/rpc-mode.ts`, `packages/coding-agent/src/modes/rpc/rpc-types.ts`