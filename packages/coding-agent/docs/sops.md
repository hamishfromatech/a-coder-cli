# SOPs (Standard Operating Procedures)

An SOP is a skill file with a `.sop.md` extension that defines a parameterized, multi-step workflow the agent executes with discipline: named parameters collected upfront, per-step RFC 2119 constraints (MUST / SHOULD / MAY), and an explicit interactive-vs-auto behavior contract. SOPs are ordinary Agent Skills — same discovery, same frontmatter, same `/skill:<name>` invocation — with an additional structural convention and validation.

The format is adapted from the [Strands Agent SOP](https://github.com/strands-agents/agent-sop) specification.

## Locations

SOPs load from the same directories as skills:

- Global: `~/.a-coder/cli/agent/skills/*.sop.md` (root `.md` files are discovered individually)
- Project (after trust): `.a-coder-cli/skills/*.sop.md`
- Explicit: `--skill <path>` or the `skills` settings array

## File format

````markdown
---
name: code-review
description: Review a pull request or branch using a structured Read, Analyze, Report workflow.
disable-model-invocation: false
parameters:
  - name: pr_number
    required: true
    description: PR number or branch to review
  - name: focus_areas
    required: false
    default: "correctness, security"
---

# Code Review

## Overview

Review the given PR or branch for correctness, security, and style issues, and report findings with severities.

## Parameters

- **pr_number** (required): PR number or branch to review
- **focus_areas** (optional, default: "correctness, security"): Comma-separated focus areas

## Steps

### 1. Setup

Fetch the diff and repository context.

**Constraints:**
- You MUST confirm the target branch or PR exists before proceeding
- You MUST NOT proceed with review if the diff cannot be retrieved, because findings without the real diff are guesses

### 2. Analyze

...

## Examples

### Example Input
/code-review:123 focus_areas="security"

### Example Output
A severity-tagged findings list written to the transcript.

## Troubleshooting

### Diff too large
Review per-file instead of whole-diff; note the truncation in the findings.
````

## Sections

| Section | Required | Purpose |
|---|---|---|
| `# Title` | yes | SOP name |
| `## Overview` | yes | What it does and when to use it. Doubles as the shareable description |
| `## Parameters` | yes | Inputs, one bullet per parameter |
| `## Steps` | yes | Numbered `### 1. Step Name` headings, each with description and constraints |
| `## Examples` | optional | Sample input/output |
| `## Troubleshooting` | optional | Common failures and resolutions |

## Parameters

```markdown
- **parameter_name** (required): Description
- **optional_param** (optional): Description
- **param_with_default** (optional, default: "value"): Description
```

- Use lowercase letters, digits, underscores or hyphens for names.
- An optional `parameters` frontmatter array makes parameters machine-readable (used by tooling; the markdown section remains the source of truth and must list every frontmatter parameter).

## Constraints

- Use RFC 2119 keywords: **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**.
- Provide context for negative constraints — a bare "You MUST NOT do X." is unenforceable; state the reason or the alternative.
- Every step SHOULD carry a `**Constraints:**` block.

## Parameter acquisition

SOPs collect all parameters before executing. Copy this block into the first step of every SOP:

```markdown
**Constraints for parameter acquisition:**
- You MUST ask for all parameters upfront in a single prompt, not just required ones
- You MUST support multiple input methods (direct input, file path, URL) where sensible
- You MUST validate parameter values before proceeding
- You MUST confirm successful acquisition of all parameters before step 2
```

## Mode behavior

SOPs that would otherwise stop to ask questions declare a `mode` parameter:

- **interactive** (default): present proposed actions, ask for confirmation at decision points, explain reasoning.
- **auto**: proceed without interaction; when the SOP would have asked, pick the most conservative option and document the choice in `progress.md`. Warn the user once that no further interaction will be required.

## Progress tracking

For SOPs that outlive a single response, mandate a `progress.md` checklist:

```markdown
**Constraints:**
- You MUST create `{documentation_dir}/{task_name}/progress.md` tracking execution with markdown checklists
- You MUST update progress.md after completing each step
- You MUST NOT skip updating the checklist — it is how execution resumes after an interruption
```

Resumability is a convention, not runtime state: any fresh session can read progress.md and continue.

## Validation

SOP files are validated on load (warnings only — the skill still loads):

- missing Overview / Parameters / Steps sections
- malformed parameter bullets or invalid parameter names
- Steps without numbered headings
- no `**Constraints:**` blocks or no RFC 2119 keywords
- negative constraints without context
- frontmatter parameters not declared in the markdown section

## Dispatching SOPs to subagents

SOPs compose with subagents: spawn a subagent whose task prompt wraps the SOP content plus filled parameters, mirroring the MCP-prompt pattern from upstream:

```
Run this SOP:
<agent-sop name="code-review">
<content>
...sop.md content...
</content>
<user-input>
PR 123, focus on security
</user-input>
</agent-sop>
```

## Workflows (declarative multi-agent runs)

A workflow is an SOP whose frontmatter adds a machine-readable `workflow.steps` array executed by the `run_workflow` tool over background subagents. Each step is an agent-as-function over JSON — there is deliberately no scripting.

```yaml
---
name: audit-routes
description: Audit route handlers for missing auth checks
workflow:
  steps:
    - id: discover
      type: run
      prompt: "List every .ts file under src/routes/ as JSON."
      schema:
        type: object
        required: [files]
        properties:
          files:
            type: array
            items: { type: string }
    - id: audit
      type: fan-out
      over: discover.files
      label: "${item}"
      prompt: "Audit ${item} for missing authentication checks."
      schema:
        type: object
        required: [valid, finding]
        properties:
          valid: { type: boolean }
          finding: { type: string }
    - id: report
      type: run
      prompt: "Rank and dedupe these findings into one report: ${audit}"
---
```

Step fields: `id`, `type` (`run` | `fan-out`), `prompt`, `schema` (JSON Schema; validated output with retries), `over` (fan-out source array), `label`, `model`, `agent_type`, `until` (loop predicate), `max_rounds`, `stop_on_no_progress`.

Guards: agents run with this session's permission rules; launch requires the user's permission; concurrency is capped by `workflowMaxConcurrentAgents` (default 16); runs are bounded (agent cap, 50-minute budget); run state persists under the session directory.

Invoke with the `run_workflow` tool (`{ "workflow": "audit-routes", "args": {...} }`). Pass `resume: "<runId>"` to continue an earlier run from its persisted state: completed steps whose rendered inputs are unchanged return their saved results, and everything after a changed input reruns; a run refuses to resume while its agents are still live.

Monitor runs with `/workflows`: pick a run to see its step results and live agents, and stop running ones (completed steps keep their results for a later resume). While a run executes, a live per-step progress block renders below the editor (and in the desktop's widget surface).

Trigger keyword: with the default `workflowKeywordTrigger` setting on, a typed prompt containing "ultracode" is transformed so the model authors a workflow SOP for the task, saves it under `.a-coder-cli/workflows/`, and executes it via `run_workflow` instead of working turn by turn. Set `workflowKeywordTrigger: false` in settings to disable. See `examples/workflows/` for a worked example and `examples/skills/workflow-authoring/` for the authoring skill.

Hosts and RPC clients follow runs programmatically: the `workflows_update` event streams output-free per-run summaries, and the `stop_workflow_run` command stops a running run (see `docs/rpc.md`). The desktop's Running tasks panel surfaces the same stream.

See `examples/sops/` for a template and a worked example, and `examples/skills/sop-author/` for the authoring skill.