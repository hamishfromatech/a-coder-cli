# A-Coder Bench

Benchmark harness for measuring how well a model drives the A-Coder agent loop.
What is measured is the **(model x harness) pair**: can the model drive A-Coder's
tools, edit formats, and loop to a graded outcome.

No Docker required. Each run gets a fresh copy of the task repo in `bench/runs/`,
a wall-clock timeout, and a grader that lives outside the repo (hidden from the
agent). A `container` field can be added to `task.json` later without changing
the runner's core.

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
- `grade.mjs` is spawned with `cwd` = the run's repo copy and `node grade.mjs`.
  Exit code 0 = pass. Stdout may be JSON (recorded as `grade.detail`).
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
```

When `--endpoint` is given, the runner writes a per-run agent dir with a
`models.json` custom provider (`baseUrl` + `apiKey`) and points the CLI at it via
`A_CODER_CLI_CODING_AGENT_DIR` - the user's real config is never touched.
Without `--endpoint`, ambient auth is used (whatever `pi` can already use).

## Reporting

```bash
node_modules/.bin/tsx bench/report.ts
```

Writes `bench/leaderboard.md`: per model x task pass rate, pass@any, tokens,
turns, tool-error rate, and edit-failure rate (the Aider-polyglot-style signal
that is the most sensitive early-warning metric for fine-tuned coding models).

## What the runner records

Per run (`bench/runs/<run-id>/`):

- `events.jsonl` - the raw `--mode json` event stream (full tool-call telemetry)
- `result.json` - parsed outcome: pass, grade detail, tokens, turns, duration,
  tool-call counts, edit-failure counts, final assistant text
- `repo/` - the workspace exactly as the agent left it

Appended to `bench/results.jsonl` for aggregation.