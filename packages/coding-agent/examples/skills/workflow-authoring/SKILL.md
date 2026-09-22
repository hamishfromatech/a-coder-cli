---
name: workflow-authoring
description: Use when creating or editing declarative workflows (.sop.md files with a workflow: frontmatter block) — multi-step fan-out/verify/synthesize orchestrations the run_workflow tool executes over background subagents. Also for converting a repeated multi-session task (audits, migrations, research) into a reusable workflow.
---

You are authoring a declarative workflow: a `.sop.md` file whose frontmatter `workflow.steps` the runner executes over background subagents. Read `packages/coding-agent/docs/sops.md` ("Workflows" section) if available.

## Procedure

### 1. Understand the task

Decide whether it needs a workflow at all: workflows fit work larger than one context window or the same step across many items (audits, migrations, cross-checked research). Simple tasks are better served by one subagent.

**Constraints:**
- You MUST check `.a-coder-cli/workflows/` and `~/.a-coder/cli/agent/workflows/` for an existing workflow before writing a new one
- You SHOULD prefer the smallest step graph that answers the question; every step is an agent run that costs tokens

### 2. Design the data flow

Each step's agent receives a prompt and returns text, or — when the step declares a `schema` — JSON validated against it. Steps reference earlier outputs via `${stepId}` / `${stepId.path}`; fan-out steps iterate `${item}` over a previous array.

**Constraints:**
- You MUST structure the workflow so verification is adversarial and separate from production (a fan-out `verify` step with a `{pass: boolean, reason: string}` schema)
- You MUST give every structured step a `schema` and design prompts that ask for JSON matching it
- You MUST bound any loop with `until` + `max_rounds`, and use `stop_on_no_progress` for search-style loops
- You MUST keep prompts self-contained (a workflow agent sees nothing else from the session)
- You SHOULD give fan-out steps a `label` template for readable progress (e.g. `label: "${item}"`)
- You MAY set per-step `model` (cheaper for mechanical steps) and `agent_type`

### 3. Write the file

Standard SOP sections (Overview / Parameters / Steps) describe the workflow for humans; the `workflow:` frontmatter block is what executes. Both must agree.

**Constraints:**
- You MUST set frontmatter `name` (kebab-case) and `description`
- You MUST use only these step fields: `id`, `type` ("run" | "fan-out"), `prompt`, `schema`, `over`, `label`, `model`, `agent_type`, `until`, `max_rounds`, `stop_on_no_progress`
- You MUST make `over` reference an earlier step or `<stepId>.<path>` array
- You MUST validate before delivering: check every `over`/`${...}` reference resolves against an earlier step or `args`; check schemas have no required key ruled out by `additionalProperties: false`

### 4. Install and test

**Constraints:**
- You MUST place the file in `.a-coder-cli/workflows/<name>.sop.md` (project, shared) or `~/.a-coder/cli/agent/workflows/` (personal) after confirming the destination with the user
- You MUST recommend a small-slice first run (one directory, not the whole repo) to gauge token cost
- You MUST NOT run the workflow without the user's go-ahead
- You MUST tell the user how to resume after an interrupted run: `run_workflow { workflow, resume: "<runId>" }` reuses saved step results and reruns only what changed; `/workflows` lists run ids