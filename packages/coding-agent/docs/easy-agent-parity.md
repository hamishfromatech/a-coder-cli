# easy-agent parity backlog

Comparison of the 35 easy-agent build stages (`/Users/hamishfromatech/Downloads/Code/A-Coder/easy-agent`, `step/step1.js`–`step35.js`) against a-coder-cli. What is already ahead is at the bottom; this file tracks what is NOT yet on par, with effort estimates (S ≤ 1 day, M ≤ 1 week, L > 1 week).

## Open items

| # | Area | Gap | Cost |
|---|------|-----|------|
| 1 | Sandbox (easy-agent step18) | No macOS seatbelt/sandbox-exec module at all (profile build from permission rules, `sandbox-exec -p` wrap, per-subcommand exclusions, `<sandbox_violations>` stderr annotation, `dangerouslyDisableSandbox` gate). Port `easy-agent/src/sandbox/` into `core/` and hook `bash-executor.ts`. | M |
| 2 | Web tools (step31) | No WebFetch/WebSearch tools. easy-agent: fetch → HTML→markdown → secondary model pass with `prompt` arg; SSRF re-validation per redirect hop, domain allowlists; search rides Anthropic server-side `web_search` with a Bing fallback. | M/L |
| 3 | PowerShell tool (step31) | Windows PowerShell tool (platform-gated), pi is bash-only. | S/M |
| 4 | Prompt templates (step23) | `model` and `allowed-tools` frontmatter on prompt templates; raw-args appended when the template has no placeholder. | S |
| 5 | Workspace containment (step3) | Opt-in per-call path containment guard (reject paths outside cwd) in path-utils. | S |
| 6 | Bundled agent examples (step19) | No example `.md` agent definitions shipped under the project agents dir. | S |

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

- README-table pass 5: skills follow-ups (`allowed-tools` frontmatter grants session allow rules at model or user invocation; `paths` frontmatter makes skills conditional — hidden from the listing until a read/write/edit/find call touches a matching path, sticky activation), teams polish (running named teammates wake for mail sent mid-run and drain it between turns; mailbox + team-file read-modify-write serialized through a keyed in-process mutex = easy-agent's proper-lockfile multi-writer tolerance without the lock), stream-replay guard (full-turn auto-retry refuses turns whose failed attempt already streamed text/thinking/tool calls), Retry-After plumbing (`AssistantMessage.retryAfterMs` extracted from Retry-After/-Ms headers across all providers, honored by the full-turn auto-retry over the backoff schedule, capped by new `retry.maxDelayMs` setting, default 60s), grep(1) fallback (search runs via `grep -RInE` when ripgrep cannot be provisioned instead of erroring, with a gitignore notice), 529 policy (consecutive-overload retry cap of 3 in the foreground auto-retry; pi's background sub-agents already fail fast in the nested loop = the background split; MiniMax input_tokens-in-message_delta was already handled by the anthropic adapter).
- README-table pass 4: plan-mode enrichment (persisted session plan file, write-to-plan-file allowed while planning, read-only bash auto-approval with a strict write-intent guard, `plan_mode` exit accepts `plan` + `allowedPrompts` which become arg-scoped session allow rules that bypass the classifier), file-history persistence (snapshots mirrored into the transcript as `file_history_snapshot` entries so `/rewind` survives `--resume` and follows branch navigation; the backup copies were already on disk), thinking controls (`/think <level>` slash command with completion; session-layer keyword escalation: ultrathink > megathink/think harder > think hard, raise-only; redacted thinking already displayed). Deliberately NOT ported: removing non-allowlisted tools in plan mode (pi prompts instead of denying — safer interactively), thinking budget_tokens/effort provider betas (pi's provider-agnostic thinking levels cover the same ground), plain-"think" keyword trigger (false-positive surface too large).
- README-table pass 3 (post stage-35 audit): loop-level output-cap recovery ladder (truncated tool-less turn at the model's maxTokens → bounded "resume mid-thought" continuation, limit 3), persistent-memory auto-injection (`<persistent_memory>` section from global+workspace MEMORY.md, settings-gated, per-scope cap), sub-agent `permissionMode` frontmatter enforcement (plan→read-only, auto→policy+classifier; tools/model/maxTurns were already enforced at spawn), `/output-style` argument completion. Verified already present: output styles (`/output-style` with built-in/user/project scopes), slash-command argument-completion framework, sub-agent tools/model/maxTurns propagation.
- v0.80.54: MCP stub removed for ≤50-tool servers; gateway stub (only >50-tool servers) hardened with schema echo; `edit` `replaceAll`; retry jitter+cap; loop `maxToolTurns`.
- Current: settings hooks, `skill` tool, MCP resource tools, arg-scoped permission rules + auto-mode classifier, `--mode stream-json`.
- TUI round (step24/step20/step21 comparison): running-tasks viewer now shows per-turn token usage lines, tool-result preview lines (`⎿ ok (1.2k chars): …`), hidden-event/line indicators, and a 1s elapsed ticker. Verified already on par or better: hljs syntax highlighting wired into markdown + read, stable-prefix streaming markdown cache, word-level diff, transcript overlay with search, grouped read/grep cards, live bash output tails, bar elapsed ticks. Remaining TUI-adjacent idea (not planned): teammate picker auto-exit on new prompt — N/A in pi (viewer replaces the editor).