---
name: workflow-authoring
description: Use when creating or editing workflow scripts (.js files with a meta block that orchestrate subagents via agent()/pipeline()/parallel()) executed by the run_workflow tool. Also for converting a repeated multi-session task (audits, migrations, research) into a reusable workflow.
---

You are authoring a workflow script: a plain JavaScript file whose body orchestrates background subagents. Read `packages/coding-agent/docs/sops.md` ("Workflows" section) if available.

## Procedure

### 1. Understand the task

Decide whether it needs a workflow at all: workflows fit work larger than one context window or the same step across many items (audits, migrations, cross-checked research). Simple tasks are better served by one subagent.

**Constraints:**
- You MUST check `.a-coder-cli/workflows/` and `~/.a-coder/cli/agent/workflows/` for an existing workflow before writing a new one
- You SHOULD prefer the smallest agent count that answers the question; every agent run costs tokens

### 2. Design the orchestration

The script holds the plan: loops, conditionals, filtering, and intermediate results are plain JavaScript. Agents see only their own prompt, so every prompt must be self-contained.

**Constraints:**
- You MUST structure the workflow so verification is adversarial and separate from production (a verify phase with a `{pass, reason}` schema, run against each finding)
- You MUST give every agent whose output feeds further logic a JSON `schema`, and write prompts that ask for JSON matching it
- You MUST treat `agent()` as nullable (returns null on stop/failure) and handle nulls before using results
- You SHOULD use `phase()` to group agents into readable stages and `label` for readable per-agent progress
- You MAY pass per-agent `model` (cheaper for mechanical steps) and `agentType`
- You MUST NOT use import()/require, Date.now(), Math.random(), or new Date() without arguments — they throw by design (deterministic replay); pass timestamps through args

### 3. Write the file

```js
export const meta = { name: 'audit-routes', description: 'Audit route handlers for missing auth checks' }

const found = await agent('List every .ts file under src/routes/.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})

const audits = await pipeline(found.files, (file) =>
  agent(`Audit ${file} for missing auth checks.`, { label: file }),
)

return audits.filter(Boolean)
```

**Constraints:**
- You MUST start the file with `export const meta = { name, description }` — a plain object literal, name in kebab-case; you MAY add `phases: ['...']` listing the phase titles the script passes to phase() so progress and approval surfaces can show groups before the run starts
- You MUST validate before delivering: no import()/require, no module state, every schema free of required keys ruled out by `additionalProperties: false`, loops bounded (pipeline/parallel lists <= 4096 items, total agents <= 1000)
- You SHOULD read `args` for invocation input and pass through `run_workflow { args }` rather than hardcoding task specifics

### 4. Install and test

**Constraints:**
- You MUST place the file in `.a-coder-cli/workflows/<name>.js` (project, shared) or `~/.a-coder/cli/agent/workflows/` (personal) after confirming the destination with the user
- You MUST recommend a small-slice first run (one directory, not the whole repo) to gauge token cost
- You MUST NOT run the workflow without the user's go-ahead
- You MUST tell the user how to resume after an interrupted run: `run_workflow { workflow, resume: "<runId>" }` replays completed agents whose prompts are unchanged and reruns from the first change onward; `/workflows` lists run ids