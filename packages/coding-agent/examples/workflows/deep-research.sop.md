---
name: deep-research
description: Investigate a question across many web sources — fan out searches, fetch and cross-check sources adversarially, and synthesize a cited report. Claims that fail verification are filtered or listed as unverified.
disable-model-invocation: true
parameters:
  - name: question
    required: true
    description: The research question
---

# Deep Research

## Overview

Investigate a question across many sources. Phase 1 fans out web searches across angles; phase 2 fetches the strongest sources; phase 3 cross-checks every claim against a second reader; the report keeps only claims that survived verification and cites its sources.

## Parameters

- **question** (required): The research question to investigate

**Constraints for parameter acquisition:**
- You MUST confirm the research question and its scope before starting
- You MUST warn that a full run spawns many agents and takes a while

## Steps

### 1. Search

Fan out one search agent per angle, then merge into a candidate source list.

**Constraints:**
- You MUST return ONLY JSON matching the schema

### 2. Read

Fetch the top sources and extract claims.

**Constraints:**
- You MUST return ONLY JSON matching the schema

### 3. Verify

Cross-check every claim with an independent reader; drop or mark claims that fail.

**Constraints:**
- You MUST return ONLY JSON matching the schema

### 4. Report

Synthesize the verified claims into one cited report.

**Constraints:**
- You MUST mark claims that could not be verified (e.g. after errors) as unverified instead of refuted
- You MUST include the source for every claim