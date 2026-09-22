---
name: sop-author
description: Use when creating, editing, or validating SOPs (.sop.md workflow files) — structured, parameterized agent workflows with RFC 2119 constraints, upfront parameter acquisition, interactive/auto modes, and progress.md resumability. Also for converting an existing skill or prompt template into an SOP.
---

You are authoring an SOP (Standard Operating Procedure): a `.sop.md` skill file that guides an agent through a multi-step workflow with discipline. The format spec lives in `packages/coding-agent/docs/sops.md` — read it if available; the essentials are below.

## Procedure

### 1. Understand the workflow

Identify: the objective, the inputs (parameters), the phases, the decision points, and what "done" means.

**Constraints:**
- You MUST read the target repository's AGENTS.md / CONTRIBUTING.md before authoring an SOP for it, because house rules override generic workflow advice
- You SHOULD check `examples/sops/code-review.sop.md` for a worked example and `examples/sops/TEMPLATE.sop.md` for the skeleton

### 2. Write the SOP

Follow the template structure: `# Title`, `## Overview`, `## Parameters`, `## Steps` (numbered `### 1.` headings with `**Constraints:**` blocks), optional `## Examples` / `## Troubleshooting`.

**Constraints:**
- You MUST set frontmatter `name` (kebab-case) and `description` (one sentence with trigger conditions — this is what the model sees when deciding to invoke)
- You MUST declare every input in `## Parameters` as `- **name** (required|optional, default: "x"): description`
- You MUST include the "Constraints for parameter acquisition" block in the first step (copy from the template verbatim and adapt)
- You MUST use RFC 2119 keywords in constraints and provide context for every negative constraint (MUST NOT ... because ..., or state the alternative)
- You MUST include a `progress.md` tracking step for any workflow that can span multiple responses
- You MUST declare a `mode` parameter (interactive/auto) when the workflow contains decision points
- You SHOULD NOT create steps that depend on unstated state; each step starts from a defined condition
- You MAY add `parameters` frontmatter for machine-readability, but every entry MUST also appear in the markdown section

### 3. Validate

**Constraints:**
- You MUST validate the file before delivering it. The loader validates `.sop.md` files automatically; to preview the diagnostics, load the skill dir or run the structure checks manually: sections present (Overview, Parameters, Steps with numbered headings), parameter syntax, constraints with RFC 2119 keywords, negative constraints with context, frontmatter parameters mirrored in markdown
- You MUST fix all reported warnings or explicitly justify leaving them

### 4. Deliver

Tell the user where the file lives, how to install it (copy into `~/.a-coder/cli/agent/skills/` or `.a-coder-cli/skills/`), and how to invoke it (`/sop-name` or `--skill path`).

**Constraints:**
- You MUST NOT place the SOP in a skills directory without the user's confirmation of the destination
- You SHOULD offer to test the SOP with one dry run before finalizing