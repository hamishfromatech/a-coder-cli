---
name: code-review
description: Review a pull request or branch with a structured Fetch, Analyze, Report workflow. Produces severity-tagged findings and records them in progress.md.
disable-model-invocation: true
parameters:
  - name: target
    required: true
    description: PR number, branch name, or commit range to review
  - name: focus_areas
    required: false
    default: "correctness, security"
---

# Code Review

## Overview

Review the target PR, branch, or commit range for correctness, security, and maintainability issues. Produces severity-tagged findings with file/line references, recorded in a progress file so an interrupted review can resume.

## Parameters

- **target** (required): PR number, branch name, or commit range to review
- **focus_areas** (optional, default: "correctness, security"): Comma-separated focus areas

**Constraints for parameter acquisition:**
- You MUST ask for all parameters upfront in a single prompt, not just required ones
- You MUST support multiple input methods for target (PR number, branch name, URL)
- You MUST validate that target resolves to an existing PR, branch, or commit range before proceeding
- You MUST confirm successful acquisition of all parameters before step 2

## Mode Behavior

**Interactive mode:**
- Present the file list you intend to review before starting
- Ask before spending more than a few minutes on any single finding

**Auto mode:**
- Review everything without pausing; choose conservative severities when uncertain
- Document judgment calls in progress.md

## Steps

### 1. Setup

Resolve the target to a concrete diff and enumerate the changed files.

**Constraints:**
- You MUST fetch the actual diff (`gh pr diff` / `git diff`) — you MUST NOT review from memory or description alone, because findings without the real diff are guesses
- You MUST create `progress.md` with a checklist of files to review before starting step 2
- You MUST NOT modify any files under review; this SOP is read-only except for progress.md

### 2. Analyze

Review each file against the focus areas.

**Constraints:**
- You MUST review every changed file in the checklist, or record explicitly why one was skipped
- You MUST classify each finding with a severity: `critical` (breaks build/security), `major` (likely bug), `minor` (style/clarity), `info`
- You MUST include file path, line reference, and a one-sentence rationale per finding
- You SHOULD verify a suspected bug against actual code paths before reporting it as critical
- You MAY suggest concrete fixes, marked as suggestions
- You MUST update progress.md after each file so an interrupted review resumes cleanly

### 3. Report

Deliver the findings.

**Constraints:**
- You MUST present findings sorted by severity, then by file
- You MUST NOT inflate severities to appear thorough — an empty report with "no issues found" is a valid outcome
- You MUST mark all progress.md checklist items complete and note any skipped files with reasons

## Examples

### Example Input
`/code-review:4821` focus_areas="security, error-handling"

### Example Output
Findings list ordered critical → info, each with file:line, severity, rationale, and optional suggested fix.

## Troubleshooting

### Diff too large to review whole
Review per-file with focused passes; record the truncation boundary in progress.md.

### PR references another repo
Confirm the intended repository with the user in interactive mode; in auto mode, review the local checkout only and note the limitation.