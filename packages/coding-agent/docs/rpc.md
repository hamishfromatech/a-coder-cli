# RPC Mode

RPC mode enables headless operation of the coding agent via a JSON protocol over stdin/stdout. This is useful for embedding the agent in other applications, IDEs, or custom UIs.

**Note for Node.js/TypeScript users**: If you're building a Node.js application, consider using `AgentSession` directly from `@earendil-works/pi-coding-agent` instead of spawning a subprocess. See [`src/core/agent-session.ts`](../src/core/agent-session.ts) for the API. For a subprocess-based TypeScript client, see [`src/modes/rpc/rpc-client.ts`](../src/modes/rpc/rpc-client.ts).

## Starting RPC Mode

```bash
a-coder-cli --mode rpc [options]
```

Common options:
- `--provider <name>`: Set the LLM provider (anthropic, openai, google, etc.)
- `--model <pattern>`: Model pattern or ID (supports `provider/id` and optional `:<thinking>`)
- `--name <name>` / `-n <name>`: Set the session display name at startup
- `--no-session`: Disable session persistence
- `--session-dir <path>`: Custom session storage directory

## Protocol Overview

- **Handshake**: the first line on stdout is an `engine_info` event: `{ "type": "engine_info", "version": "<engine version>", "contract": <protocol contract number>, "capabilities": [...] }`. Bump detection: clients compare `contract` against the version they speak (see `RPC_CONTRACT`) and fail fast on skew instead of failing cryptically later.
- **Additive features**: a client may send `client_info` to opt into compact deltas and batched frames. Clients that never send it keep the full `message_update` stream described below.
- **Commands**: JSON objects sent to stdin, one per line
- **Responses**: JSON objects with `type: "response"` indicating command success/failure
- **Events**: Agent events streamed to stdout as JSON lines

All commands support an optional `id` field for request/response correlation. If provided, the corresponding response will include the same `id`.

### Framing

RPC mode uses strict JSONL semantics with LF (`\n`) as the only record delimiter.

This matters for clients:
- Split records on `\n` only
- Accept optional `\r\n` input by stripping a trailing `\r`
- Do not use generic line readers that treat Unicode separators as newlines

In particular, Node `readline` is not protocol-compliant for RPC mode because it also splits on `U+2028` and `U+2029`, which are valid inside JSON strings.

## Commands

### Prompting

#### prompt

Send a user prompt to the agent. The command response is emitted after the prompt is accepted, queued, or handled. Events continue streaming asynchronously after acceptance.

```json
{"id": "req-1", "type": "prompt", "message": "Hello, world!"}
```

With images:
```json
{"type": "prompt", "message": "What's in this image?", "images": [{"type": "image", "data": "base64-encoded-data", "mimeType": "image/png"}]}
```

**During streaming**: If the agent is already streaming, you must specify `streamingBehavior` to queue the message:

```json
{"type": "prompt", "message": "New instruction", "streamingBehavior": "steer"}
```

- `"steer"`: Queue the message while the agent is running. It is delivered after the current assistant turn finishes executing its tool calls, before the next LLM call.
- `"followUp"`: Wait until the agent finishes. Message is delivered only when agent stops.

If the agent is streaming and no `streamingBehavior` is specified, the command returns an error.

**Extension commands**: If the message is an extension command (e.g., `/mycommand`), it executes immediately even during streaming. Extension commands manage their own LLM interaction via `pi.sendMessage()`.

**Input expansion**: Skill commands (`/skill:name`) and prompt templates (`/template`) are expanded before sending/queueing.

Response:
```json
{"id": "req-1", "type": "response", "command": "prompt", "success": true}
```

`success: true` means the prompt was accepted, queued, or handled immediately. `success: false` means the prompt was rejected before acceptance. Failures after acceptance are reported through the normal event and message stream, not as a second `response` for the same request id.

The `images` field is optional. Each image uses `ImageContent` format: `{"type": "image", "data": "base64-encoded-data", "mimeType": "image/png"}`.

#### steer

Queue a steering message while the agent is running. It is delivered after the current assistant turn finishes executing its tool calls, before the next LLM call. Skill commands and prompt templates are expanded. Extension commands are not allowed (use `prompt` instead).

```json
{"type": "steer", "message": "Stop and do this instead"}
```

With images:
```json
{"type": "steer", "message": "Look at this instead", "images": [{"type": "image", "data": "base64-encoded-data", "mimeType": "image/png"}]}
```

The `images` field is optional. Each image uses `ImageContent` format (same as `prompt`).

Response:
```json
{"type": "response", "command": "steer", "success": true}
```

See [set_steering_mode](#set_steering_mode) for controlling how steering messages are processed.

#### follow_up

Queue a follow-up message to be processed after the agent finishes. Delivered only when agent has no more tool calls or steering messages. Skill commands and prompt templates are expanded. Extension commands are not allowed (use `prompt` instead).

```json
{"type": "follow_up", "message": "After you're done, also do this"}
```

With images:
```json
{"type": "follow_up", "message": "Also check this image", "images": [{"type": "image", "data": "base64-encoded-data", "mimeType": "image/png"}]}
```

The `images` field is optional. Each image uses `ImageContent` format (same as `prompt`).

Response:
```json
{"type": "response", "command": "follow_up", "success": true}
```

See [set_follow_up_mode](#set_follow_up_mode) for controlling how follow-up messages are processed.

#### abort

Abort the current operation and wait for the session to become idle before responding (includes cancelling an in-progress compaction).

```json
{"type": "abort"}
```

Response:
```json
{"type": "response", "command": "abort", "success": true}
```

#### new_session

Start a fresh session. Can be cancelled by a `session_before_switch` extension event handler.

```json
{"type": "new_session"}
```

With optional parent session tracking:
```json
{"type": "new_session", "parentSession": "/path/to/parent-session.jsonl"}
```

Response:
```json
{"type": "response", "command": "new_session", "success": true, "data": {"cancelled": false}}
```

If an extension cancelled:
```json
{"type": "response", "command": "new_session", "success": true, "data": {"cancelled": true}}
```

### Queue Management

#### clear_queue

Remove every queued steering and follow-up message from the session.

```json
{"type": "clear_queue"}
```

Background (detached) sessions accept an optional `sessionPath` targeting key:
```json
{"type": "clear_queue", "sessionPath": "/path/to/session.jsonl"}
```

Response:
```json
{"type": "response", "command": "clear_queue", "success": true, "data": {"removed": {"steering": 2, "followUp": 1}}}
```

#### queue_remove

Remove one queued message by kind and index:

```json
{"type": "queue_remove", "kind": "steering", "index": 0}
```

Response:
```json
{"type": "response", "command": "queue_remove", "success": true, "data": {"removed": true}}
```

`removed: false` means the index was out of range.

### State

#### client_info

Opt into additive protocol features. Safe to send once after connect; clients that omit it receive contract-1 events.

```json
{"type": "client_info", "contract": 1, "capabilities": ["delta", "batch"]}
```

Response:
```json
{"type": "response", "command": "client_info", "success": true, "data": {"contract": 1, "capabilities": ["delta", "batch"]}}
```

Capabilities:

| Capability | Effect |
|---|---|
| `delta` | Send `message_delta` / `message_snapshot` instead of per-token `message_update`; `tool_execution_*` and duplicate `turn_end` / `entry_appended` frames are suppressed. |
| `batch` | Coalesce session events into `event_batch` frames (~30Hz). Responses and structural events flush immediately. |
| `tool-progress` | Keep `tool_execution_*` events and receive `tool_progress` frames (off by default for contract-2 clients). |

#### get_state

Get current session state.

```json
{"type": "get_state"}
```

Response:
```json
{
  "type": "response",
  "command": "get_state",
  "success": true,
  "data": {
    "model": {...},
    "thinkingLevel": "medium",
    "isStreaming": false,
    "isCompacting": false,
    "steeringMode": "all",
    "followUpMode": "one-at-a-time",
    "sessionFile": "/path/to/session.jsonl",
    "sessionId": "abc123",
    "sessionName": "my-feature-work",
    "activationId": 3,
    "autoCompactionEnabled": true,
    "messageCount": 5,
    "pendingMessageCount": 0
  }
}
```

The `model` field is a full [Model](#model) object or `null`. The `sessionName` field is the display name set via `set_session_name`, or omitted if not set.

#### get_session_snapshot

One activation round trip: current state plus session stats (including `contextUsage`). Prefer this over `get_state` + `get_session_stats` when switching or resuming a session.

```json
{"type": "get_session_snapshot"}
```

Response `data`: `{ state: <get_state data>, stats: <get_session_stats data> }`.

#### get_messages

Get conversation messages. With no options this returns the full context array (contract-1 behavior). With `limit` it returns a page; `before` selects an older page by index.

```json
{"type": "get_messages", "limit": 120}
{"type": "get_messages", "limit": 100, "before": 380}
```

Response:
```json
{
  "type": "response",
  "command": "get_messages",
  "success": true,
  "data": {
    "messages": [...],
    "total": 500,
    "start": 380,
    "end": 500,
    "hasMore": true
  }
}
```

`start` is the index of the first returned message in the live context array; pass it as `before` to load the previous page. A page never starts on a tool result: the engine walks the start back to the assistant/user message that owns the call, so tool results are never rendered without their call. `hasMore` is `start > 0`.

Messages are `AgentMessage` objects (see [Message Types](#message-types)).

### Model

#### set_model

Switch to a specific model.

```json
{"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}
```

Response contains the full [Model](#model) object:
```json
{
  "type": "response",
  "command": "set_model",
  "success": true,
  "data": {...}
}
```

#### cycle_model

Cycle to the next available model. Returns `null` data if only one model available.

```json
{"type": "cycle_model"}
```

Response:
```json
{
  "type": "response",
  "command": "cycle_model",
  "success": true,
  "data": {
    "model": {...},
    "thinkingLevel": "medium",
    "isScoped": false
  }
}
```

The `model` field is a full [Model](#model) object.

#### get_available_models

List all configured models.

```json
{"type": "get_available_models"}
```

Response contains an array of full [Model](#model) objects:
```json
{
  "type": "response",
  "command": "get_available_models",
  "success": true,
  "data": {
    "models": [...]
  }
}
```

### Thinking

#### set_thinking_level

Set the reasoning/thinking level for models that support it.

```json
{"type": "set_thinking_level", "level": "high"}
```

Levels: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`

Note: `"xhigh"` is only supported by OpenAI codex-max models.

Response:
```json
{"type": "response", "command": "set_thinking_level", "success": true}
```

#### cycle_thinking_level

Cycle through available thinking levels. Returns `null` data if model doesn't support thinking.

```json
{"type": "cycle_thinking_level"}
```

Response:
```json
{
  "type": "response",
  "command": "cycle_thinking_level",
  "success": true,
  "data": {"level": "high"}
}
```

### Permission & Plan Mode

#### set_permission_mode

```json
{"type": "set_permission_mode", "mode": "allow"}
```

Modes: `ask`, `allow`, `read-only`, `auto`.

#### get_permission_mode

```json
{"type": "get_permission_mode"}
```

Response `data`: `{"mode": "ask"}`.

#### add_session_allow_rules

Add session-scoped permission allow rules (the desktop approval card's "Always allow"):

```json
{"type": "add_session_allow_rules", "rules": ["Bash(git push:*)"]}
```

#### set_plan_mode / get_plan_mode

```json
{"type": "set_plan_mode", "enabled": true}
{"type": "get_plan_mode"}
```

`get_plan_mode` responds with `data.enabled`.

### Auth & Models

#### reload_auth

Re-read `auth.json` after external credential changes:

```json
{"type": "reload_auth"}
```

#### oauth_login

Start an OAuth login for a provider id (asynchronous):

```json
{"type": "oauth_login", "providerId": "openai"}
```

The response confirms the start (`data.started`); progress arrives as `oauth_login_status` events until the flow resolves.

### MCP

#### mcp_status

Return the process-wide MCP connection snapshot:

```json
{"type": "mcp_status"}
```

```json
{"type": "response", "command": "mcp_status", "success": true, "data": {"servers": [
  {"name": "chrome-devtools", "status": "ok", "toolCount": 24, "source": "global"}
]}}
```

Status is one of `connecting`, `ok`, `error`, or `disabled`; errors carry `error`, and successful servers carry `toolCount`.

#### mcp_reconnect

Reconnect and re-discover one server, or every server when `name` is omitted:

```json
{"type": "mcp_reconnect", "name": "chrome-devtools"}
```

```json
{"type": "response", "command": "mcp_reconnect", "success": true,
 "data": {"ok": true, "deferred": false, "name": "chrome-devtools"}}
```

If a turn is running, the engine sets `deferred: true` and applies the reconnect after the next natural `agent_end`, so a live tool call is never interrupted.

#### refresh_models

Force-refresh dynamic provider model lists (local servers, gateways):

```json
{"type": "refresh_models"}
```

### Queue Modes

#### set_steering_mode

Control how steering messages (from `steer`) are delivered.

```json
{"type": "set_steering_mode", "mode": "one-at-a-time"}
```

Modes:
- `"all"`: Deliver all steering messages after the current assistant turn finishes executing its tool calls
- `"one-at-a-time"`: Deliver one steering message per completed assistant turn (default)

Response:
```json
{"type": "response", "command": "set_steering_mode", "success": true}
```

#### set_follow_up_mode

Control how follow-up messages (from `follow_up`) are delivered.

```json
{"type": "set_follow_up_mode", "mode": "one-at-a-time"}
```

Modes:
- `"all"`: Deliver all follow-up messages when agent finishes
- `"one-at-a-time"`: Deliver one follow-up message per agent completion (default)

Response:
```json
{"type": "response", "command": "set_follow_up_mode", "success": true}
```

### Compaction

#### compact

Manually compact conversation context to reduce token usage.

```json
{"type": "compact"}
```

With custom instructions:
```json
{"type": "compact", "customInstructions": "Focus on code changes"}
```

Response:
```json
{
  "type": "response",
  "command": "compact",
  "success": true,
  "data": {
    "summary": "Summary of conversation...",
    "firstKeptEntryId": "abc123",
    "tokensBefore": 150000,
    "estimatedTokensAfter": 32000,
    "details": {}
  }
}
```

`estimatedTokensAfter` is a heuristic estimate over the rebuilt message context immediately after compaction, not a provider-exact token count.

#### set_auto_compaction

Enable or disable automatic compaction when context is nearly full.

```json
{"type": "set_auto_compaction", "enabled": true}
```

Response:
```json
{"type": "response", "command": "set_auto_compaction", "success": true}
```

#### get_llama_cpp_status

Return live llama-server capabilities from `/props` plus the registered llama.cpp models, their context windows, vision/thinking support, and current sampling defaults.

```json
{"type": "get_llama_cpp_status"}
```

#### get_decision_models

List installed/configured System One models and the resolved smart auto-continue settings. Refreshes local providers first (Ollama decision models are discovered from `/api/tags`).

```json
{"type": "get_decision_models"}
```

#### get_auto_continue_settings / set_auto_continue_settings

```json
{"type": "get_auto_continue_settings"}
{"type": "set_auto_continue_settings", "settings": {"mode": "smart", "maxConsecutive": 2}}
```

`mode` is `off`, `compaction`, or `smart`. See [settings.md](settings.md#smart-auto-continue).

#### set_cron_model

Set the model used for scheduled runs (`provider/model`). `model` omitted or empty clears the override. The engine persists it in global settings; new runs resolve `cron.model` → `subagentModel` → default model, never a job session's pinned model.

```json
{"type": "set_cron_model", "model": "ollama-cloud/beam"}
```

#### set_cron_model

Set the model used for scheduled runs (`provider/model`). `model` omitted or empty clears the override. The engine persists it in global settings; new runs resolve `cron.model` → `subagentModel` → default model, never a job session's pinned model.

```json
{"type": "set_cron_model", "model": "ollama-cloud/beam"}
```

#### set_compaction_auto_continue

Enable or disable automatic continuation after auto-compaction completes. When enabled, the agent queues a follow-up "continue" message after threshold compaction so it resumes without waiting for user input. Overflow recovery always retries regardless of this setting.

```json
{"type": "set_compaction_auto_continue", "enabled": true}
```

Response:
```json
{"type": "response", "command": "set_compaction_auto_continue", "success": true}
```

### Retry

#### set_auto_retry

Enable or disable automatic retry on transient errors (overloaded, rate limit, 5xx).

```json
{"type": "set_auto_retry", "enabled": true}
```

Response:
```json
{"type": "response", "command": "set_auto_retry", "success": true}
```

#### abort_retry

Abort an in-progress retry (cancel the delay and stop retrying).

```json
{"type": "abort_retry"}
```

Response:
```json
{"type": "response", "command": "abort_retry", "success": true}
```

### Bash

#### bash

Execute a shell command and add output to conversation context.

```json
{"type": "bash", "command": "ls -la"}
```

Response:
```json
{
  "type": "response",
  "command": "bash",
  "success": true,
  "data": {
    "output": "total 48\ndrwxr-xr-x ...",
    "exitCode": 0,
    "cancelled": false,
    "truncated": false
  }
}
```

If output was truncated, includes `fullOutputPath`:
```json
{
  "type": "response",
  "command": "bash",
  "success": true,
  "data": {
    "output": "truncated output...",
    "exitCode": 0,
    "cancelled": false,
    "truncated": true,
    "fullOutputPath": "/tmp/pi-bash-abc123.log"
  }
}
```

**How bash results reach the LLM:**

The `bash` command executes immediately and returns a `BashResult`. Internally, a `BashExecutionMessage` is created and stored in the agent's message state. This message does NOT emit an event.

When the next `prompt` command is sent, all messages (including `BashExecutionMessage`) are transformed before being sent to the LLM. The `BashExecutionMessage` is converted to a `UserMessage` with this format:

````
Ran `ls -la`
```
total 48
drwxr-xr-x ...
```
````

This means:
1. Bash output is included in the LLM context on the **next prompt**, not immediately
2. Multiple bash commands can be executed before a prompt; all outputs will be included
3. No event is emitted for the `BashExecutionMessage` itself

#### abort_bash

Abort a running bash command.

```json
{"type": "abort_bash"}
```

Response:
```json
{"type": "response", "command": "abort_bash", "success": true}
```

### Workflows

#### stop_workflow_run

Stop a running workflow (see `docs/sops.md`, "Workflows"): aborts the run's controller and kills its live sub-agents. Completed agents keep their persisted results and can be replayed with `run_workflow`'s `resume` parameter.

```json
{"type": "stop_workflow_run", "runId": "audit-routes-1727000000000"}
```

Response:
```json
{"type": "response", "command": "stop_workflow_run", "success": true, "data": {"stopped": true}}
```

`stopped` is `false` when the run is unknown or already finished.

### Sub-agents

Background sub-agents surface through `subagents_update` snapshots (state below). The desktop task manager and the CLI running-tasks viewer use these two commands to act on a finished or running task.

#### kill_subagent

Stop a running background sub-agent by record id. Returns the updated record.

```json
{"type": "kill_subagent", "subagentId": "general-purpose-1727000000000"}
```

```json
{"type": "response", "command": "kill_subagent", "success": true, "data": {"subagent": {"id": "general-purpose-1727000000000", "status": "killed"}}}
```

#### rerun_subagent

Re-spawn a finished sub-agent with its original prompt, model, isolation, and teammate binding. Returns the new record id. Fails for running tasks and for records with no prompt (pre-rerun records only carry the derived goal).

```json
{"type": "rerun_subagent", "subagentId": "general-purpose-1727000000000"}
```

```json
{"type": "response", "command": "rerun_subagent", "success": true, "data": {"id": "general-purpose-rerun-m1k2j3"}}
```

The new run appears in the next `subagents_update`.

### Session

#### get_session_stats

Get token usage, cost statistics, and current context window usage.

```json
{"type": "get_session_stats"}
```

Response:
```json
{
  "type": "response",
  "command": "get_session_stats",
  "success": true,
  "data": {
    "sessionFile": "/path/to/session.jsonl",
    "sessionId": "abc123",
    "userMessages": 5,
    "assistantMessages": 5,
    "toolCalls": 12,
    "toolResults": 12,
    "totalMessages": 22,
    "tokens": {
      "input": 50000,
      "output": 10000,
      "cacheRead": 40000,
      "cacheWrite": 5000,
      "total": 105000
    },
    "cost": 0.45,
    "contextUsage": {
      "tokens": 60000,
      "contextWindow": 200000,
      "percent": 30
    }
  }
}
```

`tokens` contains assistant usage totals for the current session state. `contextUsage` contains the actual current context-window estimate used for compaction and footer display.

`contextUsage` is omitted when no model or context window is available. `contextUsage.tokens` and `contextUsage.percent` are `null` immediately after compaction until a fresh post-compaction assistant response provides valid usage data.

#### export_html

Export session to an HTML file.

```json
{"type": "export_html"}
```

With custom path:
```json
{"type": "export_html", "outputPath": "/tmp/session.html"}
```

Response:
```json
{
  "type": "response",
  "command": "export_html",
  "success": true,
  "data": {"path": "/tmp/session.html"}
}
```

#### switch_session

Load a different session file. Can be cancelled by a `session_before_switch` extension event handler.

```json
{"type": "switch_session", "sessionPath": "/path/to/session.jsonl"}
```

Response:
```json
{"type": "response", "command": "switch_session", "success": true, "data": {"cancelled": false, "sessionFile": "/path/to/session.jsonl", "sessionId": "abc123", "activationId": 4}}
```

`activationId` identifies this session activation. Events carry the same value; discard frames whose `activationId` differs from the current one.

If an extension cancelled the switch:
```json
{"type": "response", "command": "switch_session", "success": true, "data": {"cancelled": true}}
```

#### fork

Create a new fork from a previous user message on the active branch. Can be cancelled by a `session_before_fork` extension event handler. Returns the text of the message being forked from.

```json
{"type": "fork", "entryId": "abc123"}
```

Response:
```json
{
  "type": "response",
  "command": "fork",
  "success": true,
  "data": {"text": "The original prompt text...", "cancelled": false}
}
```

If an extension cancelled the fork:
```json
{
  "type": "response",
  "command": "fork",
  "success": true,
  "data": {"text": "The original prompt text...", "cancelled": true}
}
```

#### clone

Duplicate the current active branch into a new session at the current position. Can be cancelled by a `session_before_fork` extension event handler.

```json
{"type": "clone"}
```

Response:
```json
{
  "type": "response",
  "command": "clone",
  "success": true,
  "data": {"cancelled": false}
}
```

If an extension cancelled the clone:
```json
{
  "type": "response",
  "command": "clone",
  "success": true,
  "data": {"cancelled": true}
}
```

#### get_fork_messages

Get user messages available for forking.

```json
{"type": "get_fork_messages"}
```

Response:
```json
{
  "type": "response",
  "command": "get_fork_messages",
  "success": true,
  "data": {
    "messages": [
      {"entryId": "abc123", "text": "First prompt..."},
      {"entryId": "def456", "text": "Second prompt..."}
    ]
  }
}
```

#### get_entries

Get all session entries in append order (excluding the session header). The session is an append-only tree of entries with stable ids, so an entry id works as a durable cursor: pass the last entry id you have seen as `since` to get only entries strictly after it, even across client restarts. Unlike `get_messages`, this includes pre-compaction history and abandoned branches.

```json
{"type": "get_entries"}
```

With a cursor:
```json
{"type": "get_entries", "since": "abc123"}
```

Response:
```json
{
  "type": "response",
  "command": "get_entries",
  "success": true,
  "data": {
    "entries": [
      {"type": "message", "id": "def456", "parentId": "abc123", "timestamp": "...", "message": {"role": "user", "...": "..."}}
    ],
    "leafId": "def456"
  }
}
```

`leafId` is the id of the current leaf entry (`null` for an empty session), so a client can tell in one round trip whether the active branch moved. If `since` does not match any entry id, the response is `success: false`.

#### get_tree

Get the session as a tree of entries. Each node is `{entry, children, label?, labelTimestamp?}`. A well-formed session has a single root; orphaned entries (broken parent chain) also appear as roots.

Pass `flat: true` to receive `nodes: [{id, parentId, type, messageRole?, timestamp?, label?, labelTimestamp?}]` plus `version` (entry count) instead of the nested tree. Flat avoids deep recursion on long sessions; the client builds the parent/child map itself.

```json
{"type": "get_tree"}
```

Response:
```json
{
  "type": "response",
  "command": "get_tree",
  "success": true,
  "data": {
    "tree": [
      {
        "entry": {"type": "message", "id": "abc123", "parentId": null, "...": "..."},
        "children": [
          {"entry": {"type": "message", "id": "def456", "parentId": "abc123", "...": "..."}, "children": []}
        ]
      }
    ],
    "leafId": "def456"
  }
}
```

#### get_last_assistant_text

Get the text content of the last assistant message.

```json
{"type": "get_last_assistant_text"}
```

Response:
```json
{
  "type": "response",
  "command": "get_last_assistant_text",
  "success": true,
  "data": {"text": "The assistant's response..."}
}
```

Returns `{"text": null}` if no assistant messages exist.

#### set_session_name

Set a display name for the current session. The name appears in session listings and helps identify sessions.

```json
{"type": "set_session_name", "name": "my-feature-work"}
```

Response:
```json
{
  "type": "response",
  "command": "set_session_name",
  "success": true
}
```

The current session name is available via `get_state` in the `sessionName` field. To set the initial name when starting RPC mode, pass `--name <name>` or `-n <name>` to the `a-coder-cli --mode rpc` process.

#### rename_session

Rename any stored session by path, including one with no live runtime. Unlike `set_session_name`, which resolves only the active session (and detached background runtimes), this opens the session file and appends the same `session_info` entry.

```json
{"type": "rename_session", "sessionPath": "/path/to/session.jsonl", "name": "New name"}
```

Response: `{"type": "response", "command": "rename_session", "success": true}`. Empty names are rejected.

#### delete_session

Delete a stored session. The file is moved into the sessions directory's `.trash/` folder (recoverable — this is not an unlink), so a mistaken delete can be restored by moving the file back. Refused for the active session, for any path with a live runtime, and for paths outside the sessions directory.

```json
{"type": "delete_session", "sessionPath": "/path/to/session.jsonl"}
```

Response: `{"type": "response", "command": "delete_session", "success": true, "data": {"trashPath": "..."}}`.

### Protocol tracing

Pass `--rpc-log <path>` when starting RPC mode to append a JSONL trace of every
inbound command and outbound frame:

```bash
a-coder-cli --mode rpc --rpc-log /tmp/engine-trace.jsonl
```

Each line is `{"ts": "...", "dir": "in" | "out", "payload": {...}}`. The trace
is what client-side event-ordering bugs are diagnosed from: you can see
exactly when `session_start`, `get_messages`, and `message_start` crossed the
wire relative to each other. Tracing failures never affect the engine.

### Session Management

#### list_sessions

List known sessions (all projects), newest first. Pass `limit` to page (capped at 500):

```json
{"type": "list_sessions", "limit": 50}
```

Response `data.sessions` entries carry `path`, `id`, `cwd`, `name`, `parentSessionPath`, `created`, `modified`, `messageCount`, `firstMessage` (ISO date strings), plus optional `model`, `totalTokens`, and `totalCost` summed from the session's assistant turns.

#### get_sessions_status

Status of the runtime's background (detached) sessions:

```json
{"type": "get_sessions_status"}
```

#### subscribe_session / unsubscribe_session

Forward live events from a detached (background) runtime. At most four sessions can be subscribed; the active session does not need a subscription.

```json
{"type": "subscribe_session", "sessionPath": "/path/to/session.jsonl"}
{"type": "unsubscribe_session", "sessionPath": "/path/to/session.jsonl"}
```

`subscribe_session` returns `{subscribed, sessionFile, sessionId, activationId}` (or `active: true` when the path is the active session). While subscribed, every session frame carries that session's `sessionId`/`sessionFile` and a distinct `activationId`; clients must route it by `sessionFile`, not into the active transcript. Subscriptions are dropped automatically when the runtime is reaped or becomes active.

`get_messages` accepts `sessionPath` to read a background runtime's history without switching.

#### abort_session

Abort an agent turn in a background session:

```json
{"type": "abort_session", "sessionPath": "/path/to/session.jsonl"}
```

#### import_jsonl

Import a session from a JSONL file and switch to it (a `session_before_switch` extension handler can cancel):

```json
{"type": "import_jsonl", "inputPath": "/tmp/imported.jsonl"}
```

#### export_jsonl

Export the current session as JSONL:

```json
{"type": "export_jsonl", "outputPath": "/tmp/session.jsonl"}
```

#### rewind

Rewind file edits via the file-history snapshot log (`steps` defaults to 1):

```json
{"type": "rewind", "steps": 1}
```

Errors when file history is disabled or no snapshots exist.

#### clear_conversation

Reset the current session's conversation context (the RPC equivalent of `/clear`):

```json
{"type": "clear_conversation"}
```

#### set_entry_label

Set or clear a `/tree` label on an entry:

```json
{"type": "set_entry_label", "entryId": "abc123", "label": "good approach"}
```

Omitting `label` (or `null`) clears it.

### Commands

#### get_commands

Get available commands (extension commands, prompt templates, and skills). These can be invoked via the `prompt` command by prefixing with `/`.

```json
{"type": "get_commands"}
```

Response:
```json
{
  "type": "response",
  "command": "get_commands",
  "success": true,
  "data": {
    "commands": [
      {"name": "session-name", "description": "Set or clear session name", "source": "extension", "path": "/home/user/.a-coder-cli/agent/extensions/session.ts"},
      {"name": "fix-tests", "description": "Fix failing tests", "source": "prompt", "location": "project", "path": "/home/user/myproject/.a-coder-cli/agent/prompts/fix-tests.md"},
      {"name": "skill:brave-search", "description": "Web search via Brave API", "source": "skill", "location": "user", "path": "/home/user/.a-coder-cli/agent/skills/brave-search/SKILL.md"}
    ]
  }
}
```

Each command has:
- `name`: Command name (invoke with `/name`)
- `description`: Human-readable description (optional for extension commands)
- `source`: What kind of command:
  - `"extension"`: Registered via `pi.registerCommand()` in an extension
  - `"prompt"`: Loaded from a prompt template `.md` file
  - `"skill"`: Loaded from a skill directory (name is prefixed with `skill:`)
- `location`: Where it was loaded from (optional, not present for extensions):
  - `"user"`: User-level (`~/.a-coder/cli/agent/`)
  - `"project"`: Project-level (`./.a-coder-cli/agent/`)
  - `"path"`: Explicit path via CLI or settings
- `path`: Absolute file path to the command source (optional)

**Note**: Built-in TUI commands (`/settings`, `/hotkeys`, etc.) are not included. They are handled only in interactive mode and would not execute if sent via `prompt`.

### Your Office

The office surface (coworkers, huddles, errands — see `docs/office.md`).

#### office_list

```json
{"type": "office_list"}
```

Response `data`: the full office snapshot — `coworkers` (roster records with face + soul + per-project session pointers), `statuses` (per-coworker `working`/`needsInput`), `huddles` (summaries with preview + last activity; DMs are `dm:<coworkerId>`), `errands`, and `pendingPrompts` (supervised approvals/questions awaiting `office_respond`).

#### office_coworker_save / office_coworker_delete

```json
{"type": "office_coworker_save", "coworker": {"name": "Atlas", "title": "Scout", "description": "Watches the repo", "face": {"shape": "hexagon", "color": "#2563eb"}, "autonomy": "supervised", "model": "anthropic/claude-sonnet-4-5"}}
{"type": "office_coworker_delete", "coworkerId": "<id>"}
```

`id` set on the coworker input = update; `keepSoul: true` preserves the stored soul. Creating a coworker seeds its DM huddle.

#### office_huddle_save / office_huddle_delete / office_huddle_get

```json
{"type": "office_huddle_save", "huddle": {"name": "Launch room", "members": ["<coworkerId>", "<coworkerId>"]}}
{"type": "office_huddle_get", "huddleId": "<id>"}
```

`office_huddle_get` returns the full room payload: `{ huddleId, data: { epoch, log, watermarks, holds, running }, working }` (or `null`).

#### office_search

```json
{"type": "office_search", "query": "deploy", "limit": 20}
```

Searches every stored huddle and DM log (not just rooms the client has loaded)
and returns `{huddleId, title, snippet, author?, messageId?, at}[]` sorted
newest first. The desktop falls back to its loaded-room search when an older
engine rejects the command.

#### office_message_delete

```json
{"type": "office_message_delete", "huddleId": "<id>", "messageId": "<id>"}
```

Deletes one user message. Coworker/system messages are rejected. Reply is
`{removed: boolean}`; the engine shifts every watermark and stranded marker so
later turns stay aligned.

#### office_send / office_stop

```json
{"type": "office_send", "huddleId": "<id>", "text": "hello @atlas", "images": [{"name": "shot.png", "kind": "image", "dataUrl": "data:image/png;base64,..."}]}
{"type": "office_stop", "huddleId": "<id>"}
```

`office_send` logs the user message, applies hold directives, and starts a huddle drive in the background — the response returns immediately; watch `office_huddle_delta` events for replies (or `office_huddle` on first contact / after the log cap drops history). `office_stop` bumps the drive epoch and aborts in-flight turns.

#### office_errand_save / office_errand_run / office_errand_delete

Manage errands (unattended tasks given to coworkers):

```json
{"type": "office_errand_save", "errand": { "coworkerId": "atlas", "name": "CI triage", "prompt": "Triage CI failures", "schedule": { "kind": "every", "minutes": 30 }, "continuity": false, "delivery": "huddle", "huddleId": "dm:atlas" }}
{"type": "office_errand_run", "errandId": "e1"}
{"type": "office_errand_delete", "errandId": "e1"}
```

Schedules: `{ "kind": "every", "minutes": N }`, `{ "kind": "daily", "time": "HH:MM" }`, or `{ "kind": "once", "at": <epoch-ms> }`. `delivery` is `"dm"` (coworker's DM huddle) or `"huddle"` (with `huddleId`); `continuity: true` runs in the coworker's canonical session so it keeps history between runs. `save` creates (or updates when `id` is set) and returns the stored errand; `run` dispatches it; activity arrives via `office_activity` events.

#### office_respond

```json
{"type": "office_respond", "requestId": "<id>", "choice": "Allow"}
```

Answers a supervised prompt surfaced in the snapshot (approval or question). `null` denies/cancels.

### Cron

Scheduled tasks for the main agent. Jobs are project-scoped (`cwd`) and persist in `~/.a-coder/cli/agent/cron/jobs.json`; run history lands in `cron/runs.json` (last 20 per job).

#### cron_list

```json
{"type": "cron_list"}
```

Response `data`: `{ jobs }` — every job with schedule, `nextRunAt`, `lastRunAt`, `lastStatus`, `lastError`, and the continuity `sessionFile` for background runs.

#### cron_create / cron_update / cron_delete / cron_run_now

```json
{"type": "cron_create", "job": {"name": "Morning CI triage", "prompt": "Review overnight CI failures", "schedule": {"kind": "daily", "time": "09:00"}, "concurrencyPolicy": "coalesce_if_active", "catchUpPolicy": "run_once", "variables": [{"name": "target", "value": "main"}], "isolated": true}}
{"type": "cron_update", "jobId": "<id>", "patch": {"enabled": false}}
{"type": "cron_delete", "jobId": "<id>"}
{"type": "cron_run_now", "jobId": "<id>", "variables": {"target": "prod"}}
{"type": "cron_revisions", "jobId": "<id>"}
{"type": "cron_restore_revision", "jobId": "<id>", "revisionId": "<revision-id>"}
```

Schedules: `{"kind": "every", "minutes": N}` (min 5), `{"kind": "daily", "time": "HH:MM"}` local, `{"kind": "weekly", "days": [1,3,5], "time": "HH:MM"}` (`0` = Sunday, `1` = Monday), `{"kind": "once", "at": <epoch ms>}`, or event triggers — `{"kind": "event", "trigger": "turn_end"}` (fires after the agent finishes a turn in the job's project; default 30-minute quiet period, set `cooldownMinutes` to override, min 5) and `{"kind": "git_commit"}` jobs use `{"kind": "event", "trigger": "git_commit"}` (fires once per new commit; the `lastGitHead` watermark coalesces). `concurrencyPolicy` is `skip_if_active`, `coalesce_if_active`, or `always_enqueue`; `catchUpPolicy` is `run_once` or `skip_missed`. `variables` are non-secret values substituted into the task as `{{name}}`; `cron_run_now` accepts per-run overrides. `isolated` defaults to `true`: each fire runs in a background subagent with its own context/turn budget and a progress card in the target session; set it to `false` for a normal live-session turn. `cron_run_now` awaits the fire (prompt delivery or the bounded background run). `cron_revisions` returns the capped configuration history, and `cron_restore_revision` applies one snapshot while preserving project/session/run state. Clients can also ask the engine's agent to create a task with the `schedule_task` tool, which accepts natural-language timing.

#### cron_runs

```json
{"type": "cron_runs", "jobId": "<id>"}
```

Response `data`: `{ runs }` — newest-first `CronRun` records (`id`, `jobId`, `jobName`, `trigger` schedule|manual, `delivery` session|background, `execution` session|subagent, `startedAt`, `finishedAt`, `status` running|ok|error|timeout, `error`, `summary`, `sessionFile`, `subagentId`, `outputFile`, `worktreePath`). Omit `jobId` for every job's runs. `sessionFile` is the continue-a-run handle: switch the engine to it to reopen that run's conversation.

## Events (continued)

Events are streamed to stdout as JSON lines during agent operation. Events do NOT include an `id` field (only responses do).

### Event Types

| Event | Description |
|-------|-------------|
| `agent_start` | Agent begins processing |
| `agent_end` | Agent completes (includes all generated messages) |
| `turn_start` | New turn begins |
| `turn_end` | Turn completes (includes assistant message and tool results) |
| `message_start` | Message begins (assistant frames include `messageId`) |
| `message_update` | Streaming update (contract 1; full partial per token) |
| `message_delta` | Contract 2: compact text/thinking delta for one `messageId` |
| `message_snapshot` | Contract 2: full partial message at a block boundary (tool-call end) |
| `event_batch` | Contract 2: coalesced ordered events |
| `message_end` | Message completes (authoritative full message) |
| `tree_delta` | Contract 2: incremental session-tree change (`added`/`updated`/`removed`, `leafId`, `version`) |
| `tool_execution_start` | Tool begins execution |
| `tool_execution_update` | Tool execution progress (streaming output) |
| `tool_execution_end` | Tool completes |
| `queue_update` | Pending steering/follow-up queue changed |
| `compaction_start` | Compaction begins |
| `compaction_end` | Compaction completes |
| `auto_retry_start` | Auto-retry begins (after transient error) |
| `auto_retry_end` | Auto-retry completes (success or final failure) |
| `auto_continue_decision` | Smart auto-continue evaluated: checkpoint, action, probabilities, progress, model, latency |
| `extension_error` | Extension threw an error |
| `sessions_update` | Runtime registry changed (background sessions) |
| `session_stats` | Token/cost/context stats after a turn or compaction (no polling needed) |
| `session_changed` | A stored session was created, renamed/updated, or deleted (`sessionPath`, optional `name`) |
| `office_update` | Your Office roster changed (coworkers, statuses, huddle summaries, errands, pending prompts) |
| `office_huddle` | A huddle's full log (first contact, or a reset after the log cap drops old lines) |
| `office_huddle_delta` | Messages appended to a huddle plus the live drive state; clients that have not loaded the room should ignore it and fetch `office_huddle_get` |
| `cron_update` | Cron jobs changed (created, edited, fired) — full job list snapshot |
| `cron_run` | A cron run started or finished (`event: "started"|"finished"`, `run: CronRun`) — feeds activity inboxes |
| `workflows_update` | Workflow-run snapshots changed (full runs list; the desktop workflows view follows it) |
| `office_activity` | Office activity feed entry (errand/huddle activity for the Activity inbox) |
| `background_processes_update` | Background process list changed (bash background jobs and their states) |
| `oauth_login_status` | OAuth login progress for `oauth_login`: `phase` is `started`, `browser`, `device_code`, `progress`, `success`, or `error` |

### Contract 2: identity, deltas, and batches

When a client sends `client_info` with `delta`/`batch`, session frames gain identity and are reshaped:

```json
{"seq":1842,"type":"message_delta","sessionId":"abc123","sessionFile":"/path/to/session.jsonl","activationId":4,"messageId":"message-7","contentIndex":0,"kind":"text","delta":"Hel"}
```

- `seq` is monotonic for session events. A gap means frames were lost; refetch state/history. Responses remain correlated by `id`.
- `sessionId`, `sessionFile`, and `activationId` let a client drop late frames from a session or activation it already switched away from.
- `messageId` is stable for the lifetime of one assistant message and appears on `message_start`, `message_delta`, `message_snapshot`, and `message_end`.
- `message_delta` covers text/thinking only. Tool-call blocks arrive as a `message_snapshot` at `toolcall_end`; `message_end` remains authoritative.
- `message_snapshot` at most replaces the draft for the same `messageId`; it is the recovery path after a dropped delta.
- With `batch`, frames are delivered as:
  ```json
  {"type":"event_batch","seq":1843,"events":[{"seq":1841,...},{"seq":1842,...}]}
  ```
  Events inside a batch are in order. `agent_start`, `agent_end`, `message_start`, `message_end`, `session_start`, compaction, queue updates, retries, and extension UI requests flush immediately; text/thinking deltas may wait up to ~33ms.

### agent_start

Emitted when the agent begins processing a prompt.

```json
{"type": "agent_start"}
```

### agent_end

Emitted when the agent completes. Contains all messages generated during this run.

```json
{
  "type": "agent_end",
  "messages": [...]
}
```

### turn_start / turn_end

A turn consists of one assistant response plus any resulting tool calls and results.

```json
{"type": "turn_start"}
```

```json
{
  "type": "turn_end",
  "message": {...},
  "toolResults": [...]
}
```

### message_start / message_end

Emitted when a message begins and completes. The `message` field contains an `AgentMessage`.

```json
{"type": "message_start", "message": {...}}
{"type": "message_end", "message": {...}}
```

### message_update (Streaming)

Contract-1 streaming. Contains both the partial message and a streaming delta event. Clients that negotiated `delta` receive `message_delta` / `message_snapshot` instead.

```json
{
  "type": "message_update",
  "message": {...},
  "assistantMessageEvent": {
    "type": "text_delta",
    "contentIndex": 0,
    "delta": "Hello ",
    "partial": {...}
  }
}
```

The `assistantMessageEvent` field contains one of these delta types:

| Type | Description |
|------|-------------|
| `start` | Message generation started |
| `text_start` | Text content block started |
| `text_delta` | Text content chunk |
| `text_end` | Text content block ended |
| `thinking_start` | Thinking block started |
| `thinking_delta` | Thinking content chunk |
| `thinking_end` | Thinking block ended |
| `toolcall_start` | Tool call started |
| `toolcall_delta` | Tool call arguments chunk |
| `toolcall_end` | Tool call ended (includes full `toolCall` object) |
| `done` | Message complete (reason: `"stop"`, `"length"`, `"toolUse"`) |
| `error` | Error occurred (reason: `"aborted"`, `"error"`) |

Example streaming a text response:
```json
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_start","contentIndex":0,"partial":{...}}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hello","partial":{...}}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":" world","partial":{...}}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"Hello world","partial":{...}}}
```

### tool_execution_start / tool_execution_update / tool_execution_end

Emitted when a tool begins, streams progress, and completes execution.

```json
{
  "type": "tool_execution_start",
  "toolCallId": "call_abc123",
  "toolName": "bash",
  "args": {"command": "ls -la"}
}
```

During execution, `tool_execution_update` events stream partial results (e.g., bash output as it arrives):

```json
{
  "type": "tool_execution_update",
  "toolCallId": "call_abc123",
  "toolName": "bash",
  "args": {"command": "ls -la"},
  "partialResult": {
    "content": [{"type": "text", "text": "partial output so far..."}],
    "details": {"truncation": null, "fullOutputPath": null}
  }
}
```

When complete:

```json
{
  "type": "tool_execution_end",
  "toolCallId": "call_abc123",
  "toolName": "bash",
  "result": {
    "content": [{"type": "text", "text": "total 48\n..."}],
    "details": {...}
  },
  "isError": false
}
```

Use `toolCallId` to correlate events. The `partialResult` in `tool_execution_update` contains the accumulated output so far (not just the delta), allowing clients to simply replace their display on each update.

With the `tool-progress` capability, MCP servers that emit `notifications/progress` also produce `tool_progress` frames. The engine throttles them to one per 500 ms and always sends the final update:

```json
{"type": "tool_progress", "toolCallId": "call_1", "toolName": "mcp__meshy__refine",
 "progress": 2, "total": 8, "percent": 25, "message": "refining mesh"}
```

`progress`/`total` are the server's raw values; `percent` is computed when a positive total is available. `message` is optional. Progress is UI-only: it is cleared on `tool_end` and never changes the transcript.

### queue_update

Emitted whenever the pending steering or follow-up queue changes.

```json
{
  "type": "queue_update",
  "steering": ["Focus on error handling"],
  "followUp": ["After that, summarize the result"]
}
```

### compaction_start / compaction_end

Emitted when compaction runs, whether manual or automatic.

```json
{"type": "compaction_start", "reason": "threshold"}
```

The `reason` field is `"manual"`, `"threshold"`, or `"overflow"`.

```json
{
  "type": "compaction_end",
  "reason": "threshold",
  "result": {
    "summary": "Summary of conversation...",
    "firstKeptEntryId": "abc123",
    "tokensBefore": 150000,
    "estimatedTokensAfter": 32000,
    "details": {}
  },
  "aborted": false,
  "willRetry": false
}
```

If `reason` was `"overflow"` and compaction succeeds, `willRetry` is `true` and the agent will automatically retry the prompt.

If compaction was aborted, `result` is `null` and `aborted` is `true`.

If compaction failed (e.g., API quota exceeded), `result` is `null`, `aborted` is `false`, and `errorMessage` contains the error description.

### auto_continue_decision

Emitted when smart auto-continue evaluates a checkpoint. The model is advisory; the event records what it saw.

```json
{
  "type": "auto_continue_decision",
  "checkpoint": "compaction",
  "action": "continue",
  "probabilities": {"done": 0.06, "ask_user": 0.08, "blocked": 0.04, "continue": 0.82},
  "progress": 0.74,
  "confidence": 0.61,
  "model": "nimble-v3",
  "latencyMs": 180,
  "reason": "next=continue p=0.82 progress=0.74"
}
```

`checkpoint` is `length`, `compaction`, or `agent_end`; `action` is `continue`, `ask_user`, or `stop`. `confidence` is distribution concentration, not correctness.

### auto_retry_start / auto_retry_end

Emitted when automatic retry is triggered after a transient error (overloaded, rate limit, 5xx).

```json
{
  "type": "auto_retry_start",
  "attempt": 1,
  "maxAttempts": 3,
  "delayMs": 2000,
  "errorMessage": "529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}"
}
```

```json
{
  "type": "auto_retry_end",
  "success": true,
  "attempt": 2
}
```

On final failure (max retries exceeded):
```json
{
  "type": "auto_retry_end",
  "success": false,
  "attempt": 3,
  "finalError": "529 overloaded_error: Overloaded"
}
```

### extension_error

Emitted when an extension throws an error.

```json
{
  "type": "extension_error",
  "extensionPath": "/path/to/extension.ts",
  "event": "tool_call",
  "error": "Error message..."
}
```

### Store snapshot events

Three events stream full snapshots of process-level stores whenever they change (throttled to ~10 Hz), plus one initial snapshot when a session binds. Clients typically replace their local copy with the posted array.

#### subagents_update

Live snapshot of in-process background sub-agents (spawned by `spawn_subagent` or Agent Teams):

```json
{
  "type": "subagents_update",
  "agents": [ { "id": "scout", "agentType": "Explore", "status": "running", "goal": "Map the auth flow", "toolUseCount": 4, "timeline": [] } ]
}
```

#### background_processes_update

Live snapshot of backgrounded bash processes (bash with `background: true`):

```json
{
  "type": "background_processes_update",
  "processes": [ { "id": "bash-1", "command": "npm run dev", "pid": 1234, "status": "running", "output": "...", "totalLines": 42 } ]
}
```

#### workflows_update

Live snapshot of workflow runs (see `docs/sops.md`, "Workflows"). Summaries are output-free: per-run status, agent count, per-phase rounds/errors, and per-agent status (no prompts or results).

```json
{
  "type": "workflows_update",
  "runs": [
    {
      "id": "audit-routes-1727000000000",
      "workflowName": "audit-routes",
      "status": "running",
      "startedAt": 1727000000000,
      "updatedAt": 1727000005000000,
      "agentCount": 7,
      "steps": {
        "discover": { "stepId": "discover", "rounds": 1 },
        "audit": { "stepId": "audit", "rounds": 1 }
      }
    }
  ]
}
```

Stop a run with the `stop_workflow_run` command.

## Extension UI Protocol

Extensions can request user interaction via `ctx.ui.select()`, `ctx.ui.confirm()`, etc. In RPC mode, these are translated into a request/response sub-protocol on top of the base command/event flow.

There are two categories of extension UI methods:

- **Dialog methods** (`select`, `confirm`, `input`, `editor`): emit an `extension_ui_request` on stdout and block until the client sends back an `extension_ui_response` on stdin with the matching `id`.
- **Fire-and-forget methods** (`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`): emit an `extension_ui_request` on stdout but do not expect a response. The client can display the information or ignore it.

If a dialog method includes a `timeout` field, the agent-side will auto-resolve with a default value when the timeout expires. The client does not need to track timeouts.

Some `ExtensionUIContext` methods are not supported or degraded in RPC mode because they require direct TUI access:
- `custom()` returns `undefined`
- `setWorkingMessage()`, `setWorkingIndicator()`, `setFooter()`, `setHeader()`, `setEditorComponent()`, `setToolsExpanded()` are no-ops
- `getEditorText()` returns `""`
- `getToolsExpanded()` returns `false`
- `pasteToEditor()` delegates to `setEditorText()` (no paste/collapse handling)
- `getAllThemes()` returns `[]`
- `getTheme()` returns `undefined`
- `setTheme()` returns `{ success: false, error: "..." }`

Note: `ctx.mode` is `"rpc"` and `ctx.hasUI` is `true` in RPC mode because the dialog and fire-and-forget methods are functional via the extension UI sub-protocol. Use `ctx.mode === "tui"` to guard TUI-specific features like `custom()` that require a real terminal.

### Extension UI Requests (stdout)

All requests have `type: "extension_ui_request"`, a unique `id`, and a `method` field.

#### select

Prompt the user to choose from a list. Dialog methods with a `timeout` field include the timeout in milliseconds; the agent auto-resolves with `undefined` if the client doesn't respond in time.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-1",
  "method": "select",
  "title": "Allow dangerous command?",
  "options": ["Allow", "Block"],
  "timeout": 10000
}
```

Expected response: `extension_ui_response` with `value` (the selected option string) or `cancelled: true`.

#### confirm

Prompt the user for yes/no confirmation.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-2",
  "method": "confirm",
  "title": "Clear session?",
  "message": "All messages will be lost.",
  "timeout": 5000
}
```

Expected response: `extension_ui_response` with `confirmed: true/false` or `cancelled: true`.

#### input

Prompt the user for free-form text.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-3",
  "method": "input",
  "title": "Enter a value",
  "placeholder": "type something..."
}
```

Expected response: `extension_ui_response` with `value` (the entered text) or `cancelled: true`.

#### editor

Open a multi-line text editor with optional prefilled content.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-4",
  "method": "editor",
  "title": "Edit some text",
  "prefill": "Line 1\nLine 2\nLine 3"
}
```

Expected response: `extension_ui_response` with `value` (the edited text) or `cancelled: true`.

#### notify

Display a notification. Fire-and-forget, no response expected.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-5",
  "method": "notify",
  "message": "Command blocked by user",
  "notifyType": "warning"
}
```

The `notifyType` field is `"info"`, `"warning"`, or `"error"`. Defaults to `"info"` if omitted.

#### setStatus

Set or clear a status entry in the footer/status bar. Fire-and-forget.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-6",
  "method": "setStatus",
  "statusKey": "my-ext",
  "statusText": "Turn 3 running..."
}
```

Send `statusText: undefined` (or omit it) to clear the status entry for that key.

#### setWidget

Set or clear a widget (block of text lines) displayed above or below the editor. Fire-and-forget.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-7",
  "method": "setWidget",
  "widgetKey": "my-ext",
  "widgetLines": ["--- My Widget ---", "Line 1", "Line 2"],
  "widgetPlacement": "aboveEditor"
}
```

Send `widgetLines: undefined` (or omit it) to clear the widget. The `widgetPlacement` field is `"aboveEditor"` (default) or `"belowEditor"`. Only string arrays are supported in RPC mode; component factories are ignored.

#### setTitle

Set the terminal window/tab title. Fire-and-forget.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-8",
  "method": "setTitle",
  "title": "pi - my project"
}
```

#### set_editor_text

Set the text in the input editor. Fire-and-forget.

```json
{
  "type": "extension_ui_request",
  "id": "uuid-9",
  "method": "set_editor_text",
  "text": "prefilled text for the user"
}
```

### Extension UI Responses (stdin)

Responses are sent for dialog methods only (`select`, `confirm`, `input`, `editor`). The `id` must match the request.

#### Value response (select, input, editor)

```json
{"type": "extension_ui_response", "id": "uuid-1", "value": "Allow"}
```

#### Confirmation response (confirm)

```json
{"type": "extension_ui_response", "id": "uuid-2", "confirmed": true}
```

#### Cancellation response (any dialog)

Dismiss any dialog method. The extension receives `undefined` (for select/input/editor) or `false` (for confirm).

```json
{"type": "extension_ui_response", "id": "uuid-3", "cancelled": true}
```

## Error Handling

Failed commands return a response with `success: false`. `error` is the human-readable message; `code`, `retryable`, and `details` are additive so clients can branch without parsing text:

```json
{
  "type": "response",
  "id": "req-1",
  "command": "switch_session",
  "success": false,
  "error": "Stored session working directory does not exist: /old/path",
  "code": "missing_session_cwd",
  "retryable": true
}
```

Common codes: `unknown_command`, `parse_error`, `command_failed`, `missing_session_cwd`, `engine_exited`, `timeout`, `cancelled`. Transport-level cancellation uses the client-supplied `id`: the desktop sends `cancel_command { id }` and stops waiting (the engine may still finish the work).

Parse errors:

```json
{
  "type": "response",
  "command": "parse",
  "success": false,
  "error": "Failed to parse command: Unexpected token..."
}
```

## Types

Source files:
- [`packages/ai/src/types.ts`](../../ai/src/types.ts) - `Model`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`
- [`packages/agent/src/types.ts`](../../agent/src/types.ts) - `AgentMessage`, `AgentEvent`
- [`src/core/messages.ts`](../src/core/messages.ts) - `BashExecutionMessage`
- [`src/modes/rpc/rpc-types.ts`](../src/modes/rpc/rpc-types.ts) - RPC command/response types, extension UI request/response types

### Model

```json
{
  "id": "claude-sonnet-4-20250514",
  "name": "Claude Sonnet 4",
  "api": "anthropic-messages",
  "provider": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "reasoning": true,
  "input": ["text", "image"],
  "contextWindow": 200000,
  "maxTokens": 16384,
  "cost": {
    "input": 3.0,
    "output": 15.0,
    "cacheRead": 0.3,
    "cacheWrite": 3.75
  }
}
```

### UserMessage

```json
{
  "role": "user",
  "content": "Hello!",
  "timestamp": 1733234567890,
  "attachments": []
}
```

The `content` field can be a string or an array of `TextContent`/`ImageContent` blocks.

### AssistantMessage

```json
{
  "role": "assistant",
  "content": [
    {"type": "text", "text": "Hello! How can I help?"},
    {"type": "thinking", "thinking": "User is greeting me..."},
    {"type": "toolCall", "id": "call_123", "name": "bash", "arguments": {"command": "ls"}}
  ],
  "api": "anthropic-messages",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "usage": {
    "input": 100,
    "output": 50,
    "cacheRead": 0,
    "cacheWrite": 0,
    "cost": {"input": 0.0003, "output": 0.00075, "cacheRead": 0, "cacheWrite": 0, "total": 0.00105}
  },
  "stopReason": "stop",
  "timestamp": 1733234567890
}
```

Stop reasons: `"stop"`, `"length"`, `"toolUse"`, `"error"`, `"aborted"`

### ToolResultMessage

```json
{
  "role": "toolResult",
  "toolCallId": "call_123",
  "toolName": "bash",
  "content": [{"type": "text", "text": "total 48\ndrwxr-xr-x ..."}],
  "isError": false,
  "timestamp": 1733234567890
}
```

### BashExecutionMessage

Created by the `bash` RPC command (not by LLM tool calls):

```json
{
  "role": "bashExecution",
  "command": "ls -la",
  "output": "total 48\ndrwxr-xr-x ...",
  "exitCode": 0,
  "cancelled": false,
  "truncated": false,
  "fullOutputPath": null,
  "timestamp": 1733234567890
}
```

### Attachment

```json
{
  "id": "img1",
  "type": "image",
  "fileName": "photo.jpg",
  "mimeType": "image/jpeg",
  "size": 102400,
  "content": "base64-encoded-data...",
  "extractedText": null,
  "preview": null
}
```

## Example: Basic Client (Python)

```python
import subprocess
import json

proc = subprocess.Popen(
    ["a-coder-cli", "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True
)

def send(cmd):
    proc.stdin.write(json.dumps(cmd) + "\n")
    proc.stdin.flush()

def read_events():
    for line in proc.stdout:
        yield json.loads(line)

# Send prompt
send({"type": "prompt", "message": "Hello!"})

# Process events
for event in read_events():
    if event.get("type") == "message_update":
        delta = event.get("assistantMessageEvent", {})
        if delta.get("type") == "text_delta":
            print(delta["delta"], end="", flush=True)
    
    if event.get("type") == "agent_end":
        print()
        break
```

## Example: Interactive Client (Node.js)

See [`test/rpc-example.ts`](../test/rpc-example.ts) for a complete interactive example, or [`src/modes/rpc/rpc-client.ts`](../src/modes/rpc/rpc-client.ts) for a typed client implementation.

For a complete example of handling the extension UI protocol, see [`examples/rpc-extension-ui.ts`](../examples/rpc-extension-ui.ts) which pairs with the [`examples/extensions/rpc-demo.ts`](../examples/extensions/rpc-demo.ts) extension.

```javascript
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");

const agent = spawn("a-coder-cli", ["--mode", "rpc", "--no-session"]);

function attachJsonlReader(stream, onLine) {
    const decoder = new StringDecoder("utf8");
    let buffer = "";

    stream.on("data", (chunk) => {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

        while (true) {
            const newlineIndex = buffer.indexOf("\n");
            if (newlineIndex === -1) break;

            let line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            onLine(line);
        }
    });

    stream.on("end", () => {
        buffer += decoder.end();
        if (buffer.length > 0) {
            onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
        }
    });
}

attachJsonlReader(agent.stdout, (line) => {
    const event = JSON.parse(line);

    if (event.type === "message_update") {
        const { assistantMessageEvent } = event;
        if (assistantMessageEvent.type === "text_delta") {
            process.stdout.write(assistantMessageEvent.delta);
        }
    }
});

// Send prompt
agent.stdin.write(JSON.stringify({ type: "prompt", message: "Hello" }) + "\n");

// Abort on Ctrl+C
process.on("SIGINT", () => {
    agent.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
});
```
