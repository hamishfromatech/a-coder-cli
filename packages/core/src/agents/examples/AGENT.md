# Agent Examples

This directory contains example agent templates that demonstrate how to create custom agents.

## Available Examples

### code-reviewer

A code review agent that analyzes code for quality issues, security vulnerabilities, and best practices.

### test-generator

A test generation agent that creates unit tests for existing code.

### doc-writer

A documentation agent that generates documentation for code.

## Creating Your Own Agent

1. Create a new directory in your agents folder:
   - User agents: `~/.claude/agents/my-agent/`
   - Project agents: `.claude/agents/my-agent/`

2. Create an `AGENT.md` file with frontmatter:

```yaml
---
name: my-agent
description: Use this agent when... Examples: <example>...</example>
model: inherit
color: blue
tools: ["Read", "Grep", "Glob"]  # Optional tool restrictions
---

Your system prompt here...
```

3. Use `/agent reload` to load your new agent.

## Agent Properties

| Property | Description | Values |
|----------|-------------|--------|
| `name` | Display name | Any string |
| `description` | When to use this agent | Include usage examples |
| `model` | AI model to use | `inherit`, `haiku`, `sonnet`, `opus` |
| `color` | UI color | `blue`, `green`, `purple`, `cyan`, etc. |
| `tools` | Allowed tools | Array of tool names, or `["*"]` for all |
| `disallowedTools` | Blocked tools | Array of tool names to block |

## Tool Restrictions

By default, agents have access to all tools. You can restrict this:

- **Read-only agent**: `tools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch"]`
- **Write access**: `tools: ["Read", "Write", "Edit", "Grep", "Glob"]`
- **Full access**: `tools: ["*"]` or omit the property
- **Block destructive tools**: `disallowedTools: ["Bash", "shell"]`

## Using Agents

Once created, your agent is available through the Agent tool:

```
Use the my-agent agent to analyze this codebase structure.
```

Or programmatically:

```typescript
{
  "subagent_type": "my-agent",
  "task": "Analyze the codebase structure",
  "description": "Analyze codebase"
}
```