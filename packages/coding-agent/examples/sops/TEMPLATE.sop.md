---
name: sop-template
description: SOP template — copy, rename, fill in. Delete this comment block and the frontmatter name is the /skill:<name> command.
disable-model-invocation: true
---

# SOP Title

## Overview

One paragraph: what this SOP does, when to use it, and what it produces.

## Parameters

- **task_description** (required): Description of the task to perform
- **mode** (optional, default: "interactive"): "interactive" or "auto"
- **optional_param** (optional, default: "value"): Description

**Constraints for parameter acquisition:**
- You MUST ask for all parameters upfront in a single prompt, not just required ones
- You MUST support multiple input methods for task_description (direct input, file path, URL)
- You MUST normalize mode input to "interactive" or "auto"
- You MUST validate all parameter values before proceeding
- You MUST confirm successful acquisition of all parameters before step 2
- If mode is "auto", you MUST warn the user once that no further interaction will be required

## Mode Behavior

**Interactive mode:**
- Present proposed actions and ask for confirmation before proceeding
- When multiple approaches exist, explain trade-offs and ask for preference

**Auto mode:**
- Proceed without interaction; pick the most conservative option at decision points
- Document each decision in progress.md

## Steps

### 1. Setup

Prepare the workspace and start the progress record.

**Constraints:**
- You MUST create `progress.md` tracking execution with markdown checklists before starting step 2
- You MUST validate the working directory state before making changes
- You MUST NOT modify files outside the agreed scope, because unintended edits are expensive to unwind

### 2. Work

Primary work of this SOP.

**Constraints:**
- You MUST keep progress.md current after completing each sub-item
- You SHOULD verify each result before moving on

### 3. Wrap up

Summarize results and hand back.

**Constraints:**
- You MUST mark all progress.md checklist items complete or explicitly note what remains
- You SHOULD record follow-up suggestions in progress.md

## Examples

### Example Input
`/sop-template:refactor the storage layer` mode="auto"

### Example Output
A summary of changes made, with the checklist state in progress.md.

## Troubleshooting

### Missing prerequisites
State what is missing, stop, and record the blocker in progress.md rather than improvising.