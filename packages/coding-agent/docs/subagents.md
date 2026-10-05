# Sub-Agents

Sub-agents are named agent profiles that the main agent can spawn to work on a focused subtask in its own context window, with its own tool set, and return a concise report. a-coder-cli ships two built-ins, and you define your own as plain Markdown files — no packaging needed.

> The agent can create sub-agents for you: ask for "a subagent that reviews PRs" and it scaffolds the file in the right place. (a-coder-cli can help build agents. Ask it for what you want.)

## Built-ins

| agentType | Behavior |
|-----------|----------|
| `general-purpose` | Inherits the parent's full tool pool (minus the sub-agent tool itself). The default when no `subagent_type` is passed. |
| `Explore` | Read-only code exploration: search, read, and trace usages without changing anything. Even if the model ignores its prompt, `write`, `edit`, and `memory` are structurally stripped from its tool pool. |

## Defining a custom sub-agent

A sub-agent definition is a Markdown file: YAML frontmatter plus a system-prompt body.

| Scope | Directory |
|-------|-----------|
| User (shared across projects) | `~/.a-coder/cli/agent/agents/*.md` |
| Project (checked in, shared with your team) | `.a-coder-cli/agents/*.md` |

On a name collision, project definitions win over user definitions, and both win over a built-in with the same `agentType` — so you can override `Explore` project-wide by shipping your own `Explore.md`.

Only `.md` files are loaded. Files with malformed frontmatter or missing fields are skipped with a startup warning. Changes are picked up on the next a-coder-cli start (or when the resource loader reloads).

```markdown
---
name: pr-reviewer
description: Reviews a pull request diff for correctness, tests, and style. Use when the user asks to review a PR or a diff.
disallowedTools: "write,edit"
permissionMode: "plan"
maxTurns: 20
---

You are a code-review agent. Your job is to review the diff the dispatcher
gave you and return a review.

Focus on: correctness, missing tests, error handling, and API misuse.
Do not modify files. Report findings as a numbered list with file paths.
```

### Frontmatter reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Sub-agent identifier — the `subagent_type` value passed to `spawn_subagent`. |
| `description` | Yes | whenToUse text shown to the dispatching agent; it decides when to delegate based on this. |
| `tools` | No | Explicit tool allow-list (CSV string or YAML list). When omitted, the agent inherits the parent's full tool pool minus the `spawn_subagent` tool itself. |
| `disallowedTools` | No | Tool names to strip from the inherited pool (`disallowed_tools:` also accepted) — how read-only agents guarantee they cannot write. |
| `model` | No | Model override for this agent; falls back to the parent's model. Also overridden per-spawn by `spawn_subagent(model: ...)`. |
| `maxTurns` | No | Positive integer bound on the agent's loop. (`max_turns:` also accepted.) |
| `permissionMode` | No | `default` (parent's mode), `plan` (read-only, enforced), or `auto` (policy rules apply). |
| `isolation` | No | `worktree` runs the agent inside a fresh `git worktree` so its edits never touch the main working copy (kept only if it has changes); requires a git repository. `none` is the default. |

The body below the frontmatter is the agent's system prompt — write the mission, operating instructions, and the report format the dispatcher should expect.

## The spawn tool

The agent spawns sub-agents with `spawn_subagent`:

```text
spawn_subagent(id="pr-review", task="Review the diff in ...", subagent_type="pr-reviewer")
```

- `id` — unique task slug (kebab-case)
- `task` — the self-contained task prompt (sub-agents do not see the main conversation)
- `subagent_type` — the agent to use (built-ins or your definitions)
- `system_prompt`, `model`, `provider` — per-spawn overrides
- `detached: true` — run in the background; returns immediately with an id
- `isolation: "worktree"` — filesystem isolation for the run
- `timeout_ms` — runtime bound (default 10 minutes)

Background runs come with companion tools: `get_subagent_status`, `wait_subagent`, and `kill_subagent`; progress logs live under the session directory and a live viewer is available via `/subagents` and the running-tasks panel. Sub-agents can join Agent Teams as named teammates (`name` + `team_name`) and become reachable over `send_message`.

When the definition includes permission modes, they are enforced structurally: `plan` strips mutating tools; `auto` applies the configured policy rules — not just prompt instructions.

## Examples

Runnable definition examples live in [`examples/agents/`](../examples/agents/): a read-only PR reviewer, a test-loop runner, and an overridable Explore variant. Copy one into `.a-coder-cli/agents/` and edit.