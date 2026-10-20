# A-Coder Bench

Benchmark harness for measuring how well a model drives the A-Coder agent loop.
What is measured is the **(model x harness) pair**: can the model drive A-Coder's
tools, edit formats, and loop to a graded outcome.

No Docker required. Each run gets a fresh copy of the task repo in `bench/runs/`,
a wall-clock timeout, and a grader that lives outside the repo (hidden from the
agent). A `container` field can be added to `task.json` later without changing
the runner's core.

The 5 starter tasks are embedded in the CLI package: outside a checkout,
`a-coder bench` (or `a-coder bench init`) scaffolds them into `./bench`
(existing files are never overwritten). After editing tasks in this repo,
regenerate the embedded snapshot with `node scripts/generate-bench-tasks.mjs`.

## Layout

```
bench/
  runner.ts            # runs (model x task x run) combinations
  report.ts            # aggregates results.jsonl -> leaderboard.md
  results.jsonl        # append-only run records (gitignored)
  runs/                # per-run sandboxes + raw event streams (gitignored)
  tasks/<task-id>/
    task.json          # instruction, timeout, tags
    repo/              # the workspace the agent sees (copied fresh per run)
    grade.mjs          # hidden grader: run from task dir with cwd=<run>/repo
```

## Task format (`task.json`)

```json
{
  "id": "001-fix-crash",
  "title": "Fix import crash",
  "instruction": "Running `node main.js` crashes ...",
  "tags": ["bugfix", "starter"],
  "timeoutSeconds": 300,
  "grader": "grade.mjs"
}
```

- `instruction` is sent verbatim as the agent prompt.
- `grade.mjs` is spawned with a resolved Node/Bun runtime and `cwd` = the run's
  repo copy. Exit code 0 = pass. Stdout may be JSON (recorded as
  `grade.detail`).
- The grader is never copied into the agent's workspace, so hidden tests are free.

## Running

```bash
# Local Ollama model (free smoke tests)
node_modules/.bin/tsx bench/runner.ts --model ollama/gemma3:1b

# Any stored provider/model (uses your ambient auth)
node_modules/.bin/tsx bench/runner.ts --model anthropic/claude-opus-4-8 --runs 3

# Self-trained model served by vLLM / SGLang / ollama serve (OpenAI-compatible)
node_modules/.bin/tsx bench/runner.ts \
  --model mybench/qwen-ft \
  --endpoint http://localhost:8000/v1 \
  --api openai-completions \
  --api-key dummy

# Subset of tasks
node_modules/.bin/tsx bench/runner.ts --model ollama/gemma3:1b --tasks 001-fix-crash,004-precise-json-edit

# Two independent runs at a time (hosted providers may rate-limit)
node_modules/.bin/tsx bench/runner.ts --model ollama-cloud/deepseek-v4.1-flash:1017 --concurrency 2
```

When `--endpoint` is given, the runner writes a per-run agent dir with a
`models.json` custom provider (`baseUrl` + `apiKey`) and points the CLI at it via
`A_CODER_CLI_CODING_AGENT_DIR` - the user's real config is never touched.
Without `--endpoint`, ambient auth is used (whatever `pi` can already use).

Each run gets a scratch agent dir under `bench/runs/<id>/agent/`. Its
`settings.json` disables MCP servers and global memory injection, while
`auth.json` and `models.json` are linked in so ambient providers keep working. Children also run with
`--no-extensions --no-skills --no-prompt-templates --no-themes
--no-context-files --no-approve`. That keeps a score comparable across machines instead of
inheriting the local install's tools and prompts; use `--endpoint` to isolate
the model endpoint as well.

`--concurrency N` (default 1) runs independent (task x run) jobs in parallel.
The desktop Bench panel exposes the same setting. Start at 1 for rate-limited
hosted APIs; local models can usually take 2-4.

## Reporting

```bash
node_modules/.bin/tsx bench/report.ts
```

Writes `bench/leaderboard.md`: per model x task pass rate, pass@any, wall time,
tokens, turns, tool-error rate, edit-failure rate, timeouts, and agent errors.
Endpoint-qualified runs are reported separately from ambient-auth runs.

## Execution details

- Each run gets a unique, filesystem-safe id (`timestamp_provider_model_task_rN_suffix`),
  so model ids containing `/` or `:` are safe on Windows and parallel runs never
  share a directory.
- Agent stdout is streamed to `events.jsonl` while an incremental NDJSON parser
  accumulates turns, usage, tool calls, errors, and the final text. A long run
  does not hold its whole event stream in memory.
- Timeouts kill the child's process group (SIGTERM, then SIGKILL after 5s), so
  shell tools cannot survive a timed-out agent.
- The hidden grader is resolved to a real Node/Bun runtime. In compiled Bun
  binaries `process.execPath` is the CLI, not a script runner, so the core
  searches PATH and common nvm/fnm/volta/Bun/Homebrew locations. Set
  `A_CODER_CLI_NODE_DIR` to add an explicit runtime directory.
- `results.jsonl` is de-duplicated by run id on read, so rerunning a report and
  older duplicate appends do not inflate pass rates.

## What the runner records

Per run (`bench/runs/<run-id>/`):

- `events.jsonl` - the raw `--mode json` event stream (full tool-call telemetry)
- `result.json` - parsed outcome: pass, grade detail, tokens, turns, duration,
  tool-call counts, edit-failure counts, final assistant text
- `repo/` - the workspace exactly as the agent left it

Appended to `bench/results.jsonl` for aggregation.