# easy-agent parity backlog

Comparison of the 35 easy-agent build stages (`/Users/hamishfromatech/Downloads/Code/A-Coder/easy-agent`, `step/step1.js`–`step35.js`) against a-coder-cli. What is already ahead is at the bottom; this file tracks what is NOT yet on par, with effort estimates (S ≤ 1 day, M ≤ 1 week, L > 1 week).

## Open items

| # | Area | Gap | Cost |
|---|------|-----|------|
| 1 | Sandbox (easy-agent step18) | No macOS seatbelt/sandbox-exec module at all (profile build from permission rules, `sandbox-exec -p` wrap, per-subcommand exclusions, `<sandbox_violations>` stderr annotation, `dangerouslyDisableSandbox` gate). Port `easy-agent/src/sandbox/` into `core/` and hook `bash-executor.ts`. | M |
| 2 | Web tools (step31) | No WebFetch/WebSearch tools. easy-agent: fetch → HTML→markdown → secondary model pass with `prompt` arg; SSRF re-validation per redirect hop, domain allowlists; search rides Anthropic server-side `web_search` with a Bing fallback. | M/L |
| 3 | Max-tokens recovery (steps 4/27) | No `stop_reason=length` recovery ladder: silent escalation to a larger output cap, then a bounded "resume mid-thought" continuation prompt (easy-agent `agenticLoop.ts` `MAX_OUTPUT_TOKENS_RECOVERY_PROMPT`, limit 3). Context overflow is handled via compaction; pure output cutoffs are not. | M |
| 4 | Plan mode enrichment (step13) | Current: single `plan_mode` toggle + approval gating. easy-agent: persisted plan file (`~/.easy-agent/plans/<slug>.md`), read-only tool allowlist enforcement, `allowedPrompts` → session allow rules on exit. Decide which parts are wanted. | M |
| 5 | Memory auto-injection (steps 6/10) | `tools/memory.ts` writes/reads MEMORY.md scopes but the content is never injected into the system prompt (no guidance/index/keyword retrieval like easy-agent's 7-part memory context section). | M |
| 6 | Sub-agent config propagation (step19) | `core/agents/loadAgents.ts` reads `tools`/`permissionMode`/`maxTurns`/`isolation` frontmatter, but the spawn path (subagents/manager.ts RPC process, and in-process path) does not enforce tool allowlists/permissionMode/maxTurns from frontmatter. | M |
| 7 | Skills follow-ups (step17) | `allowed-tools` frontmatter → temporary permission allow-rules during the skill turn; conditional `paths` frontmatter (gitignore-pattern activation on files touched by Read/Write/Edit/Glob, sticky). | M |
| 8 | File history across restarts (step26) | `/rewind` state is in-memory per session; easy-agent persists snapshot chains in the session transcript so rewind survives `--resume`. | M |
| 9 | Thinking controls (step34) | No explicit thinking-token budget or `/effort` control (only cyclable levels); no `redacted_thinking` block display; no ultrathink-style keyword escalation. | M/S |
| 10 | Agent Teams polish (step21) | Mailboxes drained only at teammate spawn (easy-agent injects mail into a running teammate's next turn); team files/mailboxes unlocked (proper-lockfile design tolerates multi-writer). | S/M |
| 11 | PowerShell tool (step31) | Windows PowerShell tool (platform-gated), pi is bash-only. | S/M |
| 12 | Streamed-output replay guard (step27) | A mid-stream failure restarts the whole turn; surface/deduplicate already-visible output (easy-agent refuses to replay). | S/L |
| 13 | Prompt templates (step23) | `model` and `allowed-tools` frontmatter on prompt templates; raw-args appended when the template has no placeholder. | S |
| 14 | Workspace containment (step3) | Opt-in per-call path containment guard (reject paths outside cwd) in path-utils. | S |
| 15 | Completion (step33) | Nested subcommand argument suggestions for slash command grammar (e.g. `/plugin marketplace add`). | S |
| 16 | Bundled agent examples (step19) | No example `.md` agent definitions shipped under the project agents dir. | S |
| 17 | Retry-After plumbing (step27) | Retry-after headers parsed at provider level but not honored by the full-turn auto-retry / jitter path. | S |
| 18 | Grep fallback (step5) | grep(1) fallback branch when `rg` is absent (pi auto-installs instead). | S |
| 19 | 529 overload split (step27) | Foreground/background 529 retry policy split; MiniMax `input_tokens` in `message_delta` quirk. | S |

## Done (a-coder-cli already ahead or on par)

- LLM comms (native adapters, ~70 providers, OAuth, prompt caching, JSON repair + partial-json streaming arg parsing) — ahead.
- TUI core (custom zero-dep framework, differential rendering, Kitty keyboard + images, editor undo/kill-ring/fuzzy autocomplete, word-level diff, rich footer) — ahead.
- Tool interface (streaming partial results, details channel, executionMode, pluggable operations, mutation queue) — ahead.
- Agentic loop interactivity (steering + follow-up queues, mid-conversation model/thinking swap, tool-call override hooks).
- Sessions (transcript-as-tree, branching, labels, typed entries) — easy-agent is linear-only.
- Compaction (cut-point safety, incremental summaries, split-turn, file-op extraction, overflow queueing); lacks only micro-compaction + circuit breaker (see #3).
- Task graph V2 (identical store, richer tool layer), TodoWrite (branch-safe snapshots).
- MCP transport lifecycle (timeouts, SSE/env/stderr-tail hardening, resources tools, stub removal for small servers) — see `src/core/mcp/`.
- Background subagents (true process detachment, persisted sessions, worktree rebuild) — ahead.
- Providers (35+ with catalogs/auth) — easy-agent has 4 protocols.
- Multimodal (clipboard MIME negotiation, WSL path, inline terminal images) — ahead.
- Config system (locking, scope guards) — ahead in scale; easy-agent adds runtime schema validation (optional polish).

## Landed for reference

- v0.80.54: MCP stub removed for ≤50-tool servers; gateway stub (only >50-tool servers) hardened with schema echo; `edit` `replaceAll`; retry jitter+cap; loop `maxToolTurns`.
- Current: settings hooks, `skill` tool, MCP resource tools, arg-scoped permission rules + auto-mode classifier, `--mode stream-json`.