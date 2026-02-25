# Skills System

The A-Coder CLI includes a powerful skills system that allows users to extend the AI's capabilities with specialized instructions and workflows. Skills are reusable, shareable instruction sets that can be loaded on demand to enhance the AI's behavior for specific domains, frameworks, or tasks.

## Overview

Skills are markdown files (`SKILL.md`) that contain specialized instructions for the AI. They can include:

- **Domain-specific knowledge**: Instructions for working with specific frameworks, languages, or tools
- **Workflow automation**: Step-by-step procedures for common tasks
- **Custom behaviors**: Modified AI behavior for specific use cases
- **Dynamic content**: Commands that execute at load time to inject real-time data
- **Lifecycle hooks**: Scripts that run at specific points in the skill lifecycle

## Skill File Structure

A skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```
my-skill/
├── SKILL.md          # Required: Main skill file
├── templates/        # Optional: Template files
│   └── example.tmpl
├── examples/         # Optional: Example files
│   └── demo.md
└── scripts/          # Optional: Hook scripts
    └── setup.sh
```

### SKILL.md Format

```markdown
---
name: my-skill
description: A brief description of what this skill does
license: MIT
compatibility: Node.js 18+
allowed-tools: read_file write_file run_shell_command
userInvocable: true
disableModelInvocation: false
argumentHint: <file-path>
hooks:
  onLoad: setup.sh
  onActivate: activate.sh
---

# Skill Instructions

Your detailed instructions go here. This content will be loaded
into the AI's context when the skill is activated.

## Arguments

You can use argument placeholders:
- $ARGUMENTS - All arguments as a single string
- $1, $2, $3 - Individual arguments by position (1-based)
- $ARGUMENTS[1], $ARGUMENTS[2] - Alternative syntax for arguments

## Dynamic Commands

Use !`command` syntax to execute shell commands at load time:
- Current git branch: !`git branch --show-current`
- Node version: !`node --version`
```

## Frontmatter Specification

The frontmatter follows the [Agent Skills Specification](https://agentskills.io/specification) with A-Coder CLI extensions.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the skill (1-64 characters, lowercase alphanumeric with hyphens) |
| `description` | string | Human-readable description (1-1024 characters) |

### Optional Spec Fields

| Field | Type | Description |
|-------|------|-------------|
| `license` | string | License information (max 500 characters) |
| `compatibility` | string | Environment compatibility requirements (max 500 characters) |
| `metadata` | object | Arbitrary key-value metadata |
| `allowed-tools` | string | Space-delimited list of pre-approved tools |

### A-Coder CLI Extensions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `argumentHint` | string | - | Hint for command-line arguments (e.g., `<file-path>`) |
| `userInvocable` | boolean | `true` | Whether users can invoke via slash commands |
| `disableModelInvocation` | boolean | `false` | Prevent model from directly invoking the skill |
| `allowedTools` | array | - | Array of tools this skill requires (legacy format) |
| `model` | string | - | Model to use for this skill (optional override) |
| `context` | string | `'inline'` | Context handling mode: `'inline'` or `'fork'` |
| `agent` | string | - | Agent to use for this skill |
| `hooks` | object | - | Lifecycle hook script definitions |

### Hook Definitions

```yaml
hooks:
  onLoad: setup.sh        # Runs when skill is loaded
  onActivate: start.sh    # Runs when skill is executed
  onDeactivate: stop.sh   # Runs when skill is deactivated
  onUnload: cleanup.sh    # Runs when skill is unloaded
```

## Skill Discovery Locations

Skills are discovered from multiple locations with the following priority (highest to lowest):

| Priority | Source | Location |
|----------|--------|----------|
| 4 | Enterprise | (Reserved for future use) |
| 3 | Personal | `~/.claude/skills/<skill-name>/SKILL.md` |
| 2 | Project | `<project>/.claude/skills/<skill-name>/SKILL.md` |
| 2 | Project | `<project>/.a-coder-cli/skills/<skill-name>/SKILL.md` |
| 1 | Plugin | (Plugin namespace: `plugin-name:skill-name`) |
| 0 | Nested | `<current-path>/.claude/skills/<skill-name>/SKILL.md` |
| 3 | Legacy | `~/.a-coder-cli/skills/<skill-name>/SKILL.md` |

When multiple skills with the same name exist, the one with higher priority takes precedence.

## Using Skills

### Listing Available Skills

Use the `/skills` command or the skills tool with `list` action:

```
/skills list
```

Or programmatically:
```json
{
  "action": "list"
}
```

### Loading a Skill

Load a skill to add its instructions to the AI's context:

```
/skills load my-skill
```

Or programmatically:
```json
{
  "action": "load",
  "skill_name": "my-skill"
}
```

### Executing a Skill

Execute a skill as a standalone command with arguments:

```
/my-skill arg1 arg2 arg3
```

Or programmatically:
```json
{
  "action": "execute",
  "skill_name": "my-skill",
  "arguments": "arg1 arg2 arg3"
}
```

## Argument Substitution

Skills support dynamic argument substitution:

| Placeholder | Description |
|-------------|-------------|
| `$ARGUMENTS` | All arguments as a single string |
| `$1`, `$2`, `$3` | Individual arguments by position (1-based indexing) |
| `$ARGUMENTS[1]` | Alternative syntax for positional arguments |
| `${CLAUDE_SESSION_ID}` | Current session ID |

Example skill content:

```markdown
---
name: file-processor
description: Process a file with specific options
argumentHint: <file> [options]
---

Process the file at $1 with the following options: $ARGUMENTS

File path: $1
All arguments: $ARGUMENTS
```

Usage:
```
/file-processor src/index.ts --format --lint
```

Result:
```
Process the file at src/index.ts with the following options: src/index.ts --format --lint

File path: src/index.ts
All arguments: src/index.ts --format --lint
```

## Dynamic Commands

Skills can execute shell commands at load time using the `!`command`` syntax:

```markdown
---
name: git-context
description: Provides current git context
---

# Git Context

Current branch: !`git branch --show-current`
Last commit: !`git log -1 --oneline`
Status: !`git status --short`
```

When this skill is loaded, the commands are executed and their output replaces the placeholders.

## Lifecycle Hooks

Skills can define scripts that run at specific lifecycle events:

### onLoad

Runs when the skill is loaded into context via the `load` action.

```yaml
hooks:
  onLoad: scripts/setup.sh
```

Environment variables available:
- `SKILL_NAME` - The skill name
- `SKILL_DIR` - Absolute path to the skill directory
- `CLAUDE_SESSION_ID` - Current session ID

### onActivate

Runs when the skill is executed via the `execute` action or slash command.

```yaml
hooks:
  onActivate: scripts/activate.sh
```

### onDeactivate

Runs when the skill is deactivated (future use).

### onUnload

Runs when the skill is unloaded from context (future use).

### Script Interpreters

Scripts are automatically executed with the appropriate interpreter based on file extension:

| Extension | Interpreter |
|-----------|-------------|
| `.py` | `python3` |
| `.js` | `node` |
| `.ts` | `npx tsx` |
| `.sh` | `bash` |
| `.bash` | `bash` |
| `.zsh` | `zsh` |
| `.rb` | `ruby` |
| `.php` | `php` |

Scripts without an extension are executed directly, with shebang detection support.

## Permission System

Skills can control who can invoke them:

### userInvocable

When set to `false`, the skill cannot be invoked directly by users via slash commands:

```yaml
userInvocable: false
```

This is useful for skills that should only be loaded by the AI model, not directly by users.

### disableModelInvocation

When set to `true`, the AI model cannot directly invoke the skill:

```yaml
disableModelInvocation: true
```

This is useful for skills that require explicit user initiation.

### Permission Rules

Administrators can define permission rules in settings:

```json
{
  "skillPermissions": [
    { "type": "allow", "pattern": "test*" },
    { "type": "deny", "pattern": "dangerous*" }
  ]
}
```

Patterns support wildcards:
- `test*` matches `test`, `testing`, `test-1`
- `vercel:*` matches `vercel:deploy`, `vercel:logs`

## Slash Command Integration

Skills with `userInvocable: true` (the default) automatically generate slash commands:

```
/my-skill [arguments]
```

The `argumentHint` field provides usage hints:

```yaml
argumentHint: <file> [--option]
```

## Architecture

### Core Components

```
packages/core/src/skills/
├── index.ts              # Public exports
├── types.ts              # Type definitions
├── discovery.ts          # Skill discovery from filesystem
├── frontmatter.ts        # YAML frontmatter parsing
├── registry.ts           # Skill registry and deduplication
├── command-generator.ts  # Slash command generation
├── substitution.ts       # Argument substitution
├── dynamic.ts            # Dynamic command execution
├── permissions.ts        # Permission management
└── hooks.ts              # Lifecycle hook execution
```

### Skill Discovery Flow

1. `SkillDiscovery.discoverAll()` scans all skill locations
2. Each location is scanned for directories containing `SKILL.md`
3. Frontmatter is parsed and validated
4. Skills are registered in `SkillRegistry` with deduplication
5. Higher priority skills override lower priority ones with the same name

### Tool Integration

The `SkillsTool` class provides the AI model with skill capabilities:

```typescript
interface SkillsToolParams {
  action: 'list' | 'load' | 'execute';
  skill_name?: string;
  arguments?: string;
  _sessionId?: string;      // Internal
  _currentPath?: string;    // Internal
}
```

### Registry and Resolution

The `SkillRegistry` manages discovered skills:

```typescript
// Get skill by unique ID
registry.get('personal:my-skill');

// Get skill by name (with namespace resolution)
registry.getByName('my-skill');

// Resolve name considering current path for nested skills
registry.resolveName('my-skill', '/current/path');

// List skills by invocability
registry.listUserInvocable();
registry.listModelInvocable();
```

## Creating a Skill

### Basic Skill

1. Create a directory for your skill:
   ```bash
   mkdir -p ~/.claude/skills/my-skill
   ```

2. Create the `SKILL.md` file:
   ```markdown
   ---
   name: my-skill
   description: A helpful skill for doing X
   ---

   # My Skill Instructions

   When this skill is loaded, follow these instructions:
   1. First step
   2. Second step
   3. Third step
   ```

3. Use the skill:
   ```
   /skills load my-skill
   ```

### Advanced Skill with Hooks

```markdown
---
name: deploy
description: Deploy the current project to production
argumentHint: <environment>
allowed-tools: run_shell_command read_file
hooks:
  onLoad: scripts/check-env.sh
  onActivate: scripts/deploy.sh
---

# Deployment Skill

Deploy to environment: $1

## Pre-deployment Checks

1. Verify environment: !`echo $1`
2. Check git status: !`git status --short`

## Deployment Steps

1. Run tests
2. Build the project
3. Deploy to $1
```

## Best Practices

1. **Clear Descriptions**: Write concise, informative descriptions that help users understand when to use the skill.

2. **Argument Hints**: Provide `argumentHint` for skills that accept arguments to improve discoverability.

3. **Tool Declarations**: Use `allowed-tools` to declare which tools the skill needs, enabling pre-approval for sensitive operations.

4. **Error Handling**: Design skills to handle edge cases gracefully and provide helpful error messages.

5. **Documentation**: Include usage examples and expected outcomes in the skill content.

6. **Modularity**: Create focused, single-purpose skills rather than monolithic ones.

7. **Version Control**: Store project skills in version control alongside your code.

8. **Testing**: Test skills with various argument combinations to ensure robustness.

## Troubleshooting

### Skill Not Found

Ensure the skill directory contains a `SKILL.md` file with valid frontmatter:

```bash
ls -la ~/.claude/skills/my-skill/
# Should show SKILL.md
```

### Frontmatter Errors

Check the frontmatter syntax:

```yaml
# Correct
name: my-skill
description: A valid description

# Incorrect - missing required field
# name: my-skill
description: Missing name field
```

### Hook Failures

Check hook script permissions and paths:

```bash
# Ensure script is executable
chmod +x ~/.claude/skills/my-skill/scripts/setup.sh

# Test script directly
~/.claude/skills/my-skill/scripts/setup.sh
```

### Dynamic Command Failures

Dynamic commands must complete within 30 seconds. Check command syntax:

```markdown
# Correct
Current branch: !`git branch --show-current`

# Incorrect - missing backticks
Current branch: !git branch --show-current
```

## API Reference

### SkillDiscovery

```typescript
class SkillDiscovery {
  constructor(config: Config);
  
  async discoverAll(options?: SkillDiscoveryOptions): Promise<Skill[]>;
  async discoverFromLocation(location: string, source: SkillSource, pluginName?: string): Promise<Skill[]>;
  async loadSkill(skillDir: string, source: SkillSource, pluginName?: string): Promise<Skill | null>;
  loadSupportingFile(skill: Skill, filename: string): string | null;
  getSupportingFileNames(skill: Skill): string[];
  getSkillPriority(source: SkillSource): number;
}
```

### SkillRegistry

```typescript
class SkillRegistry {
  register(skill: Skill): void;
  registerAll(skills: Skill[]): void;
  get(id: string): Skill | undefined;
  getAll(): Skill[];
  getBySource(source: SkillSource): Skill[];
  getByName(name: string): Skill | undefined;
  resolveName(name: string, currentPath?: string): Skill | undefined;
  listUserInvocable(): Skill[];
  listModelInvocable(): Skill[];
  size(): number;
  clear(): void;
  has(id: string): boolean;
  delete(id: string): boolean;
}
```

### SkillPermissionManager

```typescript
class SkillPermissionManager {
  addRule(rule: SkillPermissionRule): void;
  addRules(rules: SkillPermissionRule[]): void;
  clearRules(): void;
  setDefaultAllow(allow: boolean): void;
  canInvoke(skill: Skill, byModel?: boolean): boolean;
  filterSkills(skills: Skill[], byModel?: boolean): Skill[];
  matchesPattern(skill: Skill, pattern: string): boolean;
  getRules(): SkillPermissionRule[];
}
```

### SkillHookExecutor

```typescript
class SkillHookExecutor {
  async executeHook(skill: Skill, hookName: keyof SkillHooks, cwd: string, signal: AbortSignal): Promise<HookResult>;
  async executeHooks(skill: Skill, hookNames: Array<keyof SkillHooks>, cwd: string, signal: AbortSignal): Promise<HookResult[]>;
  hookExists(skill: Skill, hookName: keyof SkillHooks): boolean;
  getDefinedHooks(skill: Skill): Array<keyof SkillHooks>;
}
```

### Utility Functions

```typescript
// Argument substitution
function substituteArguments(content: string, args: string[], sessionId: string): string;
function parseArguments(argsString: string): string[];
function validateArgumentPlaceholders(content: string, args: string[]): { valid: boolean; missingIndices: number[] };

// Dynamic commands
function processDynamicCommands(content: string, cwd: string, signal: AbortSignal): Promise<string>;
function extractDynamicCommands(content: string): string[];
function hasDynamicCommands(content: string): boolean;

// Frontmatter parsing
function parseFrontmatter(content: string, skillDirName?: string): { frontmatter: SkillFrontmatter; content: string };
function validateFrontmatter(frontmatter: SkillFrontmatter, skillDirName?: string): SkillFrontmatter;
function extractDescriptionFromContent(content: string): string;

// Location helpers
function getPersonalSkillsDir(): string;
function getProjectSkillsDir(projectRoot: string): string;
function getACoderCliProjectSkillsDir(projectRoot: string): string;
function getLegacySkillsDir(): string;
```