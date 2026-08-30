# easy-agent parity backlog

Comparison of the 35 easy-agent build stages (`/Users/hamishfromatech/Downloads/Code/A-Coder/easy-agent`, `step/step1.js`–`step35.js`) against a-coder-cli. What is already ahead is at the bottom; this file tracks what is NOT yet on par, with effort estimates (S ≤ 1 day, M ≤ 1 week, L > 1 week).

## Open items

| # | Area | Gap | Cost |
|---|------|-----|------|
| 1 | Sandbox (easy-agent step18) | No macOS seatbelt/sandbox-exec module at all (profile build from permission rules, `sandbox-exec -p` wrap, per-subcommand exclusions, `<sandbox_violations>` stderr annotation, `dangerouslyDisableSandbox` gate). Port `easy-agent/src/sandbox/` into `core/` and hook `bash-executor.ts`. | M |
| 2 | Web tools (step31) | No WebFetch/WebSearch tools. easy-agent: fetch → HTML→markdown → secondary model pass with `prompt` arg; SSRF re-validation per redirect hop, domain allowlists; search rides Anthropic server-side `web_search` with a Bing fallback. | M/L |
| 3 | Plan mode enrichment (step13) | Current: single `plan_mode` toggle + approval gating. easy-agent: persisted plan file (`~/.easy-agent/plans/<slug>.md`), read-only tool allowlist enforcement, `allowedPrompts` → session allow rules on exit. Decide which parts are wanted. | M |
| 4 | Skills follow-ups (step17) | `allowed-tools` frontmatter → temporary permission allow-rules during the skill turn; conditional `paths` frontmatter (gitignore-pattern activation on files touched by Read/Write/Edit/Glob, sticky). | M |
| 5 | File history across restarts (step26) | `/rewind` state is in-memory per session; easy-agent persists snapshot chains in the session transcript so rewind survives `--resume`. | M |
| 6 | Thinking controls (step34) | No explicit thinking-token budget or `/effort` control (only cyclable levels); no `redacted_thinking` block display; no ultrathink-style keyword escalation. | M/S |
| 7 | Agent Teams polish (step21) | Mailboxes drained only at teammate spawn (easy-agent injects mail into a running teammate's next turn); team files/mailboxes unlocked (proper-lockfile design tolerates multi-writer). | S/M |
| 8 | PowerShell tool (step31) | Windows PowerShell tool (platform-gated), pi is bash-only. | S/M |
| 9 | Streamed-output replay guard (step27) | A mid-stream failure restarts the whole turn; surface/deduplicate already-visible output (easy-agent refuses to replay). | S/L |
| 10 | Prompt templates (step23) | `model` and `allowed-tools` frontmatter on prompt templates; raw-args appended when the template has no placeholder. | S |
| 11 | Workspace containment (step3) | Opt-in per-call path containment guard (reject paths outside cwd) in path-utils. | S |
| 12 | Bundled agent examples (step19) | No example `.md` agent definitions shipped under the project agents dir. | S |
| 13 | Retry-After plumbing (step27) | Retry-after headers parsed at provider level but not honored by the full-turn auto-retry / jitter path. | S |
| 14 | Grep fallback (step5) | grep(1) fallback branch when `rg` is absent (pi auto-installs instead). | S |
| 15 | 529 overload split (step27) | Foreground/background 529 retry policy split; MiniMax `input_tokens` in `message_delta` quirk. | S |

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
- Output styles (stage 23): built-in + user/project `output-styles/*.md` with `/output-style`, persisted selection — on par (pi predates this audit; easy-agent adds only per-arg `$1` substitution patterns on prompt templates, tracked under #13).

## Landed for reference

- README-table pass 3 (post stage-35 audit): loop-level output-cap recovery ladder (truncated tool-less turn at the model's maxTokens → bounded "resume mid-thought" continuation, limit 3), persistent-memory auto-injection (`<persistent_memory>` section from global+workspace MEMORY.md, settings-gated, per-scope cap), sub-agent `permissionMode` frontmatter enforcement (plan→read-only, auto→policy+classifier; tools/model/maxTurns were already enforced at spawn), `/output-style` argument completion. Verified already present: output styles (`/output-style` with built-in/user/project scopes), slash-command argument-completion framework, sub-agent tools/model/maxTurns propagation.
- v0.80.54: MCP stub removed for ≤50-tool servers; gateway stub (only >50-tool servers) hardened with schema echo; `edit` `replaceAll`; retry jitter+cap; loop `maxToolTurns`.
- Current: settings hooks, `skill` tool, MCP resource tools, arg-scoped permission rules + auto-mode classifier, `--mode stream-json`.
- TUI round (step24/step20/step21 comparison): running-tasks viewer now shows per-turn token usage lines, tool-result preview lines (`⎿ ok (1.2k chars): …`), hidden-event/line indicators, and a 1s elapsed ticker. Verified already on par or better: hljs syntax highlighting wired into markdown + read, stable-prefix streaming markdown cache, word-level diff, transcript overlay with search, grouped read/grep cards, live bash output tails, bar elapsed ticks. Remaining TUI-adjacent idea (not planned): teammate picker auto-exit on new prompt — N/A in pi (viewer replaces the editor).