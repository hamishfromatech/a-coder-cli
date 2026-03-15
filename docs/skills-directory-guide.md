# Skills Directory Guide

A-Coder CLI supports a directory-based skills system similar to Claude Code, allowing you to organize skills in different locations based on their scope and accessibility.

## Skill Discovery Locations

Skills are automatically discovered from multiple locations, searched in this priority order:

### 1. Personal Skills
**Location:** `~/.claude/skills/<skill-name>/SKILL.md`

These are your personal skills that are available across all projects. Use this for:
- General-purpose utilities
- Your preferred workflows
- Tools you want available everywhere

Example:
```bash
mkdir -p ~/.claude/skills/code-review
cat > ~/.claude/skills/code-review/SKILL.md << 'EOF'
---
name: code-review
description: Review code for quality, security, and best practices
---

Review the recent code changes and provide feedback.
EOF
```

### 2. Project Skills
**Location:** `.claude/skills/<skill-name>/SKILL.md`

Project-specific skills that are available only within this project. Use this for:
- Project-specific workflows
- Domain-specific knowledge
- Company/team standards

Example:
```bash
mkdir -p .claude/skills/deploy-prod
cat > .claude/skills/deploy-prod/SKILL.md << 'EOF'
---
name: deploy-prod
description: Deploy to production environment
---

Follow the production deployment process:
1. Run tests
2. Create git tag
3. Deploy to staging
4. Verify staging
5. Promote to production
EOF
```

### 3. Nested Project Skills
**Location:** `<subdirectory>/.claude/skills/<skill-name>/SKILL.md`

Skills for specific subdirectories within your project. Use this for:
- Module-specific workflows
- Component-level tasks
- Microservice-specific operations

Example:
```bash
mkdir -p backend/.claude/skills/db-migrate
cat > backend/.claude/skills/db-migrate/SKILL.md << 'EOF'
---
name: db-migrate
description: Run database migrations for backend
---

1. Check pending migrations
2. Run migration rollback first if needed
3. Apply new migrations
4. Verify schema
EOF
```

### 4. a-coder-cli Project Skills
**Location:** `.a-coder-cli/skills/<skill-name>/SKILL.md`

Legacy project skills location. Still supported but prefer `.claude/skills/`.

### 5. Legacy Skills
**Location:** `~/.a-coder-cli/skills/<skill-name>/SKILL.md`

Legacy personal skills location. Still supported but prefer `~/.claude/skills/`.

## Skill File Format

Each skill must have a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: skill-name              # Required: Skill identifier (matches directory name)
description: What it does     # Required: Human-readable description
argumentHint: <optional>      # Optional: Hint for command-line arguments
userInvocable: true           # Optional: Allow users to invoke via /<skill-name> (default: true)
disableModelInvocation: false # Optional: Prevent AI from auto-invoking (default: false)
---

# Skill Instructions

Your skill instructions go here. This can include:
- Step-by-step procedures
- Context about your project
- Specific guidelines
- Examples
```

## Using Skills

### Via Slash Command (user-invocable skills)

If `userInvocable` is `true` (or not set), you can invoke skills directly:

```bash
# Use the skill
/code-review

# Or with arguments
/deploy-staging --confirm

# Reload skills after adding new ones
/reload-skills
```

### Via AI Invocation

The AI can automatically load skills when helpful:

```
You: I need to review the recent changes
AI: I'll load the code-review skill to help with that.
   ✓ Loaded skill: code-review
   [instructions from code-review skill]
```

## Skill Priority

When multiple skills have the same name, the priority order is:

1. Personal (`~/.claude/skills/`)
2. Project (`.claude/skills/`)
3. a-coder-cli project (`.a-coder-cli/skills/`)
4. Legacy (`~/.a-coder-cli/skills/`)

Higher priority skills override lower priority ones.

## Dynamic Skills Discovery

When working in a subdirectory, nested skills are automatically available:

```bash
cd backend
/help  # Shows db-migrate skill from backend/.claude/skills/
```

Skills are discovered based on the current project root and current working directory.

## Best Practices

### Skill Organization

```
~/.claude/skills/
├── general/
│   └── SKILL.md
├── debugging/
│   └── SKILL.md
└── git-workflows/
    └── SKILL.md

.claude/skills/
├── deploy/
│   └── SKILL.md
├── test/
│   └── SKILL.md
└── docs/
    └── SKILL.md

backend/.claude/skills/
└── db-migrate/
    └── SKILL.md

frontend/.claude/skills/
└── build/
    └── SKILL.md
```

### Skill Content Guidelines

✅ **Do:**
- Keep skills focused and specific
- Use clear, actionable steps
- Include project-specific context
- Reference project files with relative paths
- Use examples

❌ **Don't:**
- Create overly general skills
- Include sensitive information (use environment variables)
- Duplicate content across multiple skills
- Make skills too complex or long

### Frontmatter Best Practices

```yaml
---
name: deploy                # Short, lowercase, hyphen-separated
description: Deploy to production environment
argumentHint: [--dry-run]   # Show optional arguments
userInvocable: true         # Users can run /deploy
disableModelInvocation: false # AI can suggest it
---
```

## Example Skills

### Simple Workflow Skill

```yaml
---
name: commit-work
description: Commit current changes with standard message format
---

1. Run `git status` to see what changed
2. Stage relevant files
3. Create a conventional commit message:
   - feat: New feature
   - fix: Bug fix
   - docs: Documentation
   - refactor: Code refactoring
   - test: Test changes
4. Commit with staged files
```

### Complex Skill with Arguments

```yaml
---
name: api-client
description: Generate API client code from OpenAPI spec
argumentHint: <spec-file> <language>
---

Generate API client for specified language:

1. Read OpenAPI spec from $1
2. Generate types and client code for $2
3. Handle authentication headers
4. Include error handling
5. Add example usage
```

### Skill with Context

```yaml
---
name: onboarding
description: Set up a new developer environment
---

Follow our team's onboarding checklist:

**Development Tools:**
- Node.js 20+
- Python 3.11
- Docker Desktop

**Project Setup:**
1. Clone repo: `git clone https://github.com/org/project.git`
2. Install deps: `npm ci`
3. Copy env: `cp .env.example .env`

**Required Config:**
- API key: See secrets manager
- Database: Contact DBA team

**Testing:**
- Run `npm test` to verify setup
- Check /test/skills/ for project-specific test helpers
```

## Troubleshooting

### Skill Not Found

```bash
# Check where skills are being loaded from
# (Look for skill loading messages at startup)

# Reload skills after adding new ones
/reload-skills

# List available skills
/help  # Look for the "Skills" section
```

### Conflicting Skills

If you have skills with the same name in multiple locations:

1. Personal skills override project skills
2. Project skills override a-coder-cli skills
3. Rename conflicting skills to avoid confusion

### Invalid Skill Format

Skills with invalid frontmatter will be silently skipped. Check the console for warnings during startup.

## Advanced Features

### Dynamic Command Support

Skills can include dynamic commands that execute at runtime:

```markdown
## Recent Changes

```<exec>git log -5 --oneline</exec>```

This shows the 5 most recent commits automatically.
```

### Argument Substitution

Skills support argument placeholders:

```markdown
Run tests for $1 module version $2:
```

Usage: `/test-api backend v2`

### Hooks

Skills can define hooks for custom behavior:

```yaml
---
name: deploy
hooks:
  onLoad: scripts/deploy-setup.sh
  onActivate: scripts/deploy-run.sh
---
```

See [Skills System Documentation](./tools/skills-system.md) for advanced features.

## Related Documentation

- [Skills System Overview](./tools/skills-system.md)
- [SKILL.md Frontmatter Spec](#) (TODO: link to spec)
- [Example Skills](../../example-skills/)