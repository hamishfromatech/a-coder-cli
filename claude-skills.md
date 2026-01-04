---
title: Skills Loader
subtitle: >-
  A complete implementation of a skills system similar to Claude Code,
  demonstrating the power of `nextTurnParams` for context injection.
headline: Skills Loader Example | OpenRouter SDK
canonical-url: >-
  https://openrouter.ai/docs/sdks/call-model/typescript/tool-examples/skills-loader
'og:site_name': OpenRouter Documentation
'og:title': Skills Loader Example - OpenRouter SDK
'og:description': >-
  Build a complete skills system like Claude Code using nextTurnParams for
  context injection, idempotency, and multi-skill loading.
'og:image':
  type: url
  value: >-
    https://openrouter.ai/dynamic-og?title=Skills%20Loader&description=Context%20Injection%20Pattern
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary_large_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---

## Overview

This example shows how to build encapsulated, self-managing tools that inject domain-specific context into conversations. When a skill is loaded, it automatically enriches subsequent turns with specialized instructions.

## Prerequisites

```bash
pnpm add @openrouter/sdk zod
```

Create a skills directory:

```bash
mkdir -p ~/.claude/skills/pdf-processing
mkdir -p ~/.claude/skills/data-analysis
mkdir -p ~/.claude/skills/code-review
```

## Basic Skills Tool

```typescript
import { OpenRouter, tool } from '@openrouter/sdk';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { z } from 'zod';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SKILLS_DIR = path.join(process.env.HOME || '~', '.claude', 'skills');

// List available skills
const listAvailableSkills = (): string[] => {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => existsSync(path.join(SKILLS_DIR, dirent.name, 'SKILL.md')))
    .map((dirent) => dirent.name);
};

const skillsTool = tool({
  name: 'Skill',
  description: `Load a specialized skill to enhance the assistant's capabilities.
Available skills: ${listAvailableSkills().join(', ') || 'none configured'}
Each skill provides domain-specific instructions and capabilities.`,

  inputSchema: z.object({
    type: z.string().describe("The skill type to load (e.g., 'pdf-processing')"),
  }),

  outputSchema: z.string(),

  // This is where the magic happens - modify context for next turn
  nextTurnParams: {
    input: (params, context) => {
      // Prevent duplicate skill loading
      const skillMarker = `[Skill: ${params.type}]`;
      if (JSON.stringify(context.input).includes(skillMarker)) {
        return context.input;
      }

      // Load the skill's instructions
      const skillPath = path.join(SKILLS_DIR, params.type, 'SKILL.md');
      if (!existsSync(skillPath)) {
        return context.input;
      }

      const skill = readFileSync(skillPath, 'utf-8');
      const skillDir = path.join(SKILLS_DIR, params.type);

      // Inject skill context into the conversation
      const currentInput = Array.isArray(context.input) ? context.input : [context.input];

      return [
        ...currentInput,
        {
          role: 'user',
          content: `${skillMarker}
Base directory for this skill: ${skillDir}

${skill}`,
        },
      ];
    },
  },

  execute: async (params, context) => {
    const skillMarker = `[Skill: ${params.type}]`;

    // Check if already loaded
    if (JSON.stringify(context?.turnRequest?.input || []).includes(skillMarker)) {
      return `Skill ${params.type} is already loaded`;
    }

    const skillPath = path.join(SKILLS_DIR, params.type, 'SKILL.md');
    if (!existsSync(skillPath)) {
      const available = listAvailableSkills();
      return `Skill "${params.type}" not found. Available skills: ${available.join(', ') || 'none'}`;
    }

    return `Launching skill ${params.type}`;
  },
});
```

## Usage

```typescript
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: 'I need to process a PDF and extract tables from it',
  tools: [skillsTool],
});

const text = await result.getText();
// The model will call the Skill tool, loading pdf-processing context
// Subsequent responses will have access to the skill's instructions
```

## Example Skill File

Create `~/.claude/skills/pdf-processing/SKILL.md`:

```markdown
# PDF Processing Skill

You are now equipped with PDF processing capabilities.

## Available Tools
When processing PDFs, you have access to:
- `extract_text`: Extract all text from a PDF
- `extract_tables`: Extract tables as structured data
- `extract_images`: Extract embedded images
- `split_pdf`: Split PDF into individual pages

## Best Practices
1. Always check PDF file size before processing
2. For large PDFs (>50 pages), process in chunks
3. OCR may be needed for scanned documents
4. Tables may span multiple pages - handle accordingly

## Output Formats
- Text: Plain text or markdown
- Tables: JSON, CSV, or markdown tables
- Images: PNG with sequential naming

## Error Handling
- If a PDF is encrypted, request the password
- If OCR fails, suggest alternative approaches
- Report page numbers for any extraction errors
```

## Extended: Multi-Skill Loader

Load multiple skills in a single call:

```typescript
const multiSkillLoader = tool({
  name: 'load_skills',
  description: 'Load multiple skills at once for complex tasks',

  inputSchema: z.object({
    skills: z.array(z.string()).describe('Array of skill names to load'),
  }),

  outputSchema: z.object({
    loaded: z.array(z.string()),
    failed: z.array(
      z.object({
        name: z.string(),
        reason: z.string(),
      })
    ),
  }),

  nextTurnParams: {
    input: (params, context) => {
      let newInput = Array.isArray(context.input) ? context.input : [context.input];

      for (const skillName of params.skills) {
        const skillMarker = `[Skill: ${skillName}]`;

        // Skip if already loaded
        if (JSON.stringify(newInput).includes(skillMarker)) {
          continue;
        }

        const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
        if (!existsSync(skillPath)) {
          continue;
        }

        const skillContent = readFileSync(skillPath, 'utf-8');
        const skillDir = path.join(SKILLS_DIR, skillName);

        newInput = [
          ...newInput,
          {
            role: 'user',
            content: `${skillMarker}
Base directory: ${skillDir}

${skillContent}`,
          },
        ];
      }

      return newInput;
    },
  },

  execute: async ({ skills }) => {
    const loaded: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];

    for (const skill of skills) {
      const skillPath = path.join(SKILLS_DIR, skill, 'SKILL.md');
      if (existsSync(skillPath)) {
        loaded.push(skill);
      } else {
        failed.push({ name: skill, reason: 'Skill not found' });
      }
    }

    return { loaded, failed };
  },
});

// Usage
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: 'I need to analyze a PDF report and create visualizations',
  tools: [multiSkillLoader],
});
// Model might call: load_skills({ skills: ['pdf-processing', 'data-analysis'] })
```

## Extended: Skill with Options

Skills that accept configuration:

```typescript
const configurableSkillLoader = tool({
  name: 'configure_skill',
  description: 'Load a skill with custom configuration options',

  inputSchema: z.object({
    skillName: z.string(),
    options: z
      .object({
        verbosity: z.enum(['minimal', 'normal', 'detailed']).default('normal'),
        strictMode: z.boolean().default(false),
        outputFormat: z.enum(['json', 'markdown', 'plain']).default('markdown'),
      })
      .optional(),
  }),

  outputSchema: z.object({
    status: z.enum(['loaded', 'already_loaded', 'not_found']),
    message: z.string(),
    configuration: z.record(z.unknown()).optional(),
  }),

  nextTurnParams: {
    input: (params, context) => {
      const skillMarker = `[Skill: ${params.skillName}]`;
      if (JSON.stringify(context.input).includes(skillMarker)) {
        return context.input;
      }

      const skillPath = path.join(SKILLS_DIR, params.skillName, 'SKILL.md');
      if (!existsSync(skillPath)) {
        return context.input;
      }

      const skillContent = readFileSync(skillPath, 'utf-8');
      const options = params.options || {};

      // Build configuration header
      const configHeader = `
## Skill Configuration
- Verbosity: ${options.verbosity || 'normal'}
- Strict Mode: ${options.strictMode || false}
- Output Format: ${options.outputFormat || 'markdown'}
`;

      const currentInput = Array.isArray(context.input) ? context.input : [context.input];

      return [
        ...currentInput,
        {
          role: 'user',
          content: `${skillMarker}
${configHeader}

${skillContent}`,
        },
      ];
    },

    // Adjust model behavior based on skill
    temperature: (params, context) => {
      // Lower temperature for strict mode
      if (params.options?.strictMode) {
        return 0.3;
      }
      return context.temperature;
    },
  },

  execute: async ({ skillName, options }) => {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');

    if (!existsSync(skillPath)) {
      return {
        status: 'not_found' as const,
        message: `Skill "${skillName}" not found`,
      };
    }

    return {
      status: 'loaded' as const,
      message: `Skill "${skillName}" loaded with configuration`,
      configuration: options || {},
    };
  },
});
```

## Skill Discovery Tool

List and describe available skills:

```typescript
const skillDiscoveryTool = tool({
  name: 'list_skills',
  description: 'List all available skills with their descriptions',

  inputSchema: z.object({
    category: z.string().optional().describe('Filter by category'),
  }),

  outputSchema: z.object({
    skills: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        hasConfig: z.boolean(),
      })
    ),
    totalCount: z.number(),
  }),

  execute: async ({ category }) => {
    const availableSkills = listAvailableSkills();
    const skills = [];

    for (const skillName of availableSkills) {
      const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf-8');

      // Extract first paragraph as description
      const lines = content.split('\n').filter((l) => l.trim());
      const description = lines.find((l) => !l.startsWith('#')) || 'No description';

      // Check for config file
      const configPath = path.join(SKILLS_DIR, skillName, 'config.json');
      const hasConfig = existsSync(configPath);

      skills.push({
        name: skillName,
        description: description.slice(0, 100),
        hasConfig,
      });
    }

    return {
      skills,
      totalCount: skills.length,
    };
  },
});
```

## Complete Example

Putting it all together:

```typescript
import { OpenRouter, tool, stepCountIs } from '@openrouter/sdk';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { z } from 'zod';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SKILLS_DIR = path.join(process.env.HOME || '~', '.claude', 'skills');

// ... (include skillsTool, multiSkillLoader, skillDiscoveryTool from above)

// Use all skill tools together
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: `I have a complex task:
1. First, show me what skills are available
2. Load the appropriate skills for PDF analysis
3. Then help me extract and analyze data from report.pdf`,
  tools: [skillDiscoveryTool, skillsTool, multiSkillLoader],
  stopWhen: stepCountIs(10),
});

const text = await result.getText();
console.log(text);
```

## Key Patterns

### 1. Idempotency

Always check if a skill is already loaded:

```typescript
nextTurnParams: {
  input: (params, context) => {
    const marker = `[Skill: ${params.type}]`;
    if (JSON.stringify(context.input).includes(marker)) {
      return context.input; // Don't add again
    }
    // ... add skill
  },
},
```

### 2. Graceful Fallbacks

Handle missing skills gracefully:

```typescript
execute: async (params) => {
  if (!existsSync(skillPath)) {
    return `Skill not found. Available: ${listAvailableSkills().join(', ')}`;
  }
  // ...
},
```

### 3. Context Preservation

Always preserve existing input:

```typescript
nextTurnParams: {
  input: (params, context) => {
    const currentInput = Array.isArray(context.input)
      ? context.input
      : [context.input];
    return [...currentInput, newMessage]; // Append, don't replace
  },
},
```

### 4. Clear Markers

Use unique markers to identify injected content:

```typescript
const skillMarker = `[Skill: ${params.type}]`;
// Makes detection reliable and content clearly labeled
```

## See Also

- **[nextTurnParams Guide](/docs/sdks/call-model/next-turn-params)** - Context injection patterns
- **[Dynamic Parameters](/docs/sdks/call-model/dynamic-parameters)** - Adaptive behavior
- **[Tools](/docs/sdks/call-model/tools)** - Multi-turn orchestration
---
---
title: Dynamic Parameters
subtitle: Use async functions for adaptive model behavior across turns
headline: Dynamic Parameters | OpenRouter SDK
canonical-url: 'https://openrouter.ai/docs/sdks/call-model/typescript/dynamic-parameters'
'og:site_name': OpenRouter Documentation
'og:title': Dynamic Parameters - OpenRouter SDK
'og:description': >-
  Use async functions to dynamically compute callModel parameters. Adapt model
  selection, temperature, and instructions based on conversation state.
'og:image':
  type: url
  value: >-
    https://openrouter.ai/dynamic-og?title=Dynamic%20Parameters&description=Adaptive%20Model%20Behavior
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary_large_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---

## Basic Usage

Any parameter in `callModel` can be a function that computes its value based on conversation context. This enables adaptive behavior - changing models, adjusting temperature, or modifying instructions as the conversation evolves.

Pass a function instead of a static value:

```typescript
import { OpenRouter } from '@openrouter/sdk';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = openrouter.callModel({
  // Dynamic model selection based on turn count
  model: (ctx) => {
    return ctx.numberOfTurns > 3 ? 'openai/gpt-5.2' : 'openai/gpt-5-nano';
  },
  input: 'Hello!',
  tools: [myTool],
});
```

## Function Signature

Parameter functions receive a `TurnContext` and return the parameter value:

```typescript
type ParameterFunction<T> = (context: TurnContext) => T | Promise<T>;
```

### TurnContext

| Property | Type | Description |
|----------|------|-------------|
| `numberOfTurns` | `number` | Current turn number (1-indexed) |
| `turnRequest` | `OpenResponsesRequest \| undefined` | Current request object containing messages and model settings |
| `toolCall` | `OpenResponsesFunctionToolCall \| undefined` | The specific tool call being executed |

## Async Functions

Functions can be async for fetching external data:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',

  // Fetch user preferences from database
  temperature: async (ctx) => {
    const prefs = await fetchUserPreferences(userId);
    return prefs.preferredTemperature ?? 0.7;
  },

  // Load dynamic instructions
  instructions: async (ctx) => {
    const rules = await fetchBusinessRules();
    return `Follow these rules:\n${rules.join('\n')}`;
  },

  input: 'Hello!',
});
```

## Common Patterns

### Progressive Model Upgrade

Start with a fast model, upgrade for complex tasks:

```typescript
const result = openrouter.callModel({
  model: (ctx) => {
    // First few turns: fast model
    if (ctx.numberOfTurns <= 2) {
      return 'openai/gpt-5-nano';
    }

    // Complex conversations: capable model
    return 'openai/gpt-5.2';
  },
  input: 'Let me think through this problem...',
  tools: [analysisTool],
});
```

### Adaptive Temperature

Adjust creativity based on context:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  temperature: (ctx) => {
    // Analyze recent messages for task type
    const lastMessage = JSON.stringify(ctx.turnRequest?.input).toLowerCase();

    if (lastMessage.includes('creative') || lastMessage.includes('brainstorm')) {
      return 1.0; // Creative tasks
    }
    if (lastMessage.includes('code') || lastMessage.includes('calculate')) {
      return 0.2; // Precise tasks
    }
    return 0.7; // Default
  },
  input: 'Write a creative story',
});
```

### Context-Aware Instructions

Build instructions based on conversation state:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  instructions: (ctx) => {
    const base = 'You are a helpful assistant.';
    const turnInfo = `This is turn ${ctx.numberOfTurns} of the conversation.`;

    // Add context based on history length
    if (ctx.numberOfTurns > 5) {
      return `${base}\n${turnInfo}\nKeep responses concise - this is a long conversation.`;
    }

    return `${base}\n${turnInfo}`;
  },
  input: 'Continue helping me...',
  tools: [helpTool],
});
```

### Dynamic Max Tokens

Adjust output length based on task:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  maxOutputTokens: (ctx) => {
    const lastMessage = JSON.stringify(ctx.turnRequest?.input).toLowerCase();

    if (lastMessage.includes('summarize') || lastMessage.includes('brief')) {
      return 200;
    }
    if (lastMessage.includes('detailed') || lastMessage.includes('explain')) {
      return 2000;
    }
    return 500;
  },
  input: 'Give me a detailed explanation',
});
```

### Feature Flags

Enable features dynamically:

```typescript
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',

  // Enable thinking for complex turns
  provider: async (ctx) => {
    const enableThinking = ctx.numberOfTurns > 2;

    return enableThinking ? {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 1000 },
      },
    } : undefined;
  },

  input: 'Solve this complex problem',
  tools: [analysisTool],
});
```

## Combining with Tools

Dynamic parameters work alongside tool execution:

```typescript
const smartAssistant = openrouter.callModel({
  // Upgrade model if tools have been used
  model: (ctx) => {
    const hasToolUse = JSON.stringify(ctx.turnRequest?.input).includes('function_call');
    return hasToolUse ? 'anthropic/claude-sonnet-4.5' : 'openai/gpt-5-nano';
  },

  // Lower temperature after tool execution
  temperature: (ctx) => {
    return ctx.numberOfTurns > 1 ? 0.3 : 0.7;
  },

  input: 'Research and analyze this topic',
  tools: [searchTool, analysisTool],
});
```

## Execution Order

Dynamic parameters are resolved at the start of each turn:

```
1. Resolve all parameter functions with current TurnContext
2. Build request with resolved values
3. Send to model
4. Execute tools (if any)
5. Check stop conditions
6. Update TurnContext for next turn
7. Repeat from step 1
```

## Error Handling

Handle errors in async parameter functions:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',

  instructions: async (ctx) => {
    try {
      const rules = await fetchRules();
      return `Follow these rules: ${rules}`;
    } catch (error) {
      // Fallback on error
      console.error('Failed to fetch rules:', error);
      return 'You are a helpful assistant.';
    }
  },

  input: 'Hello!',
});
```

## Best Practices

### Keep Functions Pure

Avoid side effects in parameter functions:

```typescript
// Good: Pure function
model: (ctx) => ctx.numberOfTurns > 3 ? 'gpt-4' : 'gpt-4o-mini',

// Avoid: Side effects
model: (ctx) => {
  logToDatabase(ctx); // Side effect
  return 'gpt-4';
},
```

### Cache Expensive Operations

Cache results for repeated calls:

```typescript
let cachedRules: string | null = null;

const result = openrouter.callModel({
  instructions: async (ctx) => {
    if (!cachedRules) {
      cachedRules = await fetchExpensiveRules();
    }
    return cachedRules;
  },
  input: 'Hello!',
});
```

### Use Sensible Defaults

Always have fallback values:

```typescript
model: (ctx) => {
  const preferredModel = getPreferredModel();
  return preferredModel ?? 'openai/gpt-5-nano'; // Default fallback
},
```

## See Also

- **[nextTurnParams](/docs/sdks/call-model/next-turn-params)** - Tool-driven parameter modification
- **[Stop Conditions](/docs/sdks/call-model/stop-conditions)** - Dynamic execution control
- **[Tools](/docs/sdks/call-model/tools)** - Multi-turn orchestration
