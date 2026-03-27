# Plugin System - Complete Implementation

## Summary

The plugin system for a-coder CLI has been fully implemented, providing extensibility through skills, hooks, MCP servers, and LSP servers.

## Architecture

### Core Components

1. **Plugin Manifest** (`.claude-plugin/plugin.json`)
   - Defines plugin identity: name, description, version, author
   - Name becomes the namespace for skills (e.g., `my-plugin:skill-name`)

2. **PluginDiscovery** (`packages/core/src/plugins/discovery.ts`)
   - Discovers plugins from multiple scopes:
     - User: `~/.a-coder-cli/plugins/`
     - Project: `.a-coder-cli/plugins/`
     - Local: `plugins/` in current directory

3. **PluginRegistry** (`packages/core/src/plugins/registry.ts`)
   - Tracks installed plugins
   - Supports filtering by scope, source, and state

4. **PluginManager** (`packages/core/src/plugins/manager.ts`)
   - Handles plugin lifecycle: install, uninstall, enable, disable
   - Manages marketplace configurations

5. **PluginHooksLoader** (`packages/core/src/plugins/hooks-loader.ts`)
   - Loads hooks from plugin `hooks/hooks.json` files
   - Merges plugin hooks with settings hooks

6. **PluginMcpLspLoader** (`packages/core/src/plugins/mcp-lsp-loader.ts`)
   - Loads MCP configs from `.mcp.json`
   - Loads LSP configs from `.lsp.json`
   - Merges with base configs

## Files Created

| File | Purpose |
|------|---------|
| `packages/core/src/plugins/types.ts` | Plugin manifest, marketplace, and type definitions |
| `packages/core/src/plugins/discovery.ts` | Plugin discovery from scopes |
| `packages/core/src/plugins/registry.ts` | Plugin registry |
| `packages/core/src/plugins/manager.ts` | Plugin lifecycle management |
| `packages/core/src/plugins/hooks-loader.ts` | Plugin hooks loading and merging |
| `packages/core/src/plugins/mcp-lsp-loader.ts` | MCP/LSP config loading |
| `packages/core/src/plugins/index.ts` | Module exports |
| `packages/cli/src/ui/commands/pluginCommand.ts` | Plugin CLI commands |
| `packages/cli/src/config/settings.ts` | Plugin scope support |
| `demo-marketplace/` | Sample marketplace for testing |

## Files Modified

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Export plugins module |
| `packages/core/src/skills/discovery.ts` | Plugin skill discovery |
| `packages/cli/src/services/CommandService.ts` | Add plugin command |
| `packages/cli/src/ui/commands/reloadSkillsCommand.ts` | Reload plugins |

## Usage

### Plugin Management

```bash
# List installed plugins
/plugin list

# Install a plugin from marketplace
/plugin install plugin-name@marketplace-name

# Uninstall a plugin
/plugin uninstall plugin-name

# Enable/disable plugins
/plugin enable plugin-name
/plugin disable plugin-name
```

### Marketplace Management

```bash
# Add a marketplace
/plugin marketplace add anthropics/claude-code
/plugin marketplace add ./demo-marketplace
/plugin marketplace add https://example.com/marketplace.json

# List marketplaces
/plugin marketplace list

# Update marketplace catalog
/plugin marketplace update marketplace-name

# Remove marketplace
/plugin marketplace remove marketplace-name
```

### Reload Plugins

```bash
# Reload all plugins and skills
/reload-skills
```

## Plugin Directory Structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── skills/
│   └── greeting/
│       └── SKILL.md         # Skill definition
├── hooks/
│   └── hooks.json           # Hook configuration
├── .mcp.json                # MCP server config
└── .lsp.json                # LSP server config
```

## Plugin Manifest Schema

```json
{
  "name": "my-plugin",
  "description": "A greeting plugin",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "your@email.com"
  },
  "homepage": "https://github.com/you/my-plugin",
  "repository": {
    "type": "github",
    "url": "you/my-plugin"
  },
  "license": "MIT",
  "keywords": ["greeting", "demo"],
  "components": {
    "skills": true,
    "hooks": false
  },
  "settings": {
    "theme": "dark"
  }
}
```

## Hooks Configuration

Plugin hooks (`hooks/hooks.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Shell",
        "hooks": [{
          "type": "command",
          "command": "echo 'Validating shell command'"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "WriteFile",
        "hooks": [{
          "type": "command",
          "command": "npm run lint"
        }]
      }
    ]
  }
}
```

## MCP Configuration

Plugin MCP servers (`.mcp.json`):

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@github/mcp-server"],
    "env": {
      "GITHUB_TOKEN": "${GITHUB_TOKEN}"
    }
  }
}
```

## LSP Configuration

Plugin LSP servers (`.lsp.json`):

```json
{
  "python": {
    "command": "pyright-langserver",
    "args": ["--stdio"],
    "extensionToLanguage": {
      ".py": "python"
    }
  }
}
```

## Installation Scopes

| Scope     | Location                          | Shared With          |
|-----------|-----------------------------------|----------------------|
| User      | `~/.a-coder-cli/plugins/`         | All projects         |
| Project   | `.a-coder-cli/plugins/`           | Repository collabs   |
| Local     | `plugins/`                        | Current directory    |
| Managed   | Enforced by team/organization     | Team members         |

## Settings Integration

Plugin settings are loaded with highest priority:

```
User < Workspace < System < Plugin
```

Plugin settings from `settings.json` in plugin root are merged with user settings.

## Skill Discovery Integration

Plugin skills are automatically discovered when:
- Plugin is installed in a recognized scope
- Plugin state is `enabled`
- Plugin has a `skills/` directory with valid skill folders

Skill priority ordering:
```
Enterprise (4) > Personal (3) > Project (2) > Plugin (1) > Nested (0)
```

## Hooks Integration

Plugin hooks are merged with settings hooks:
- Plugin hooks are appended to existing hooks for each event type
- Hooks from multiple plugins are combined
- Event types: Stop, UserPromptSubmit, Notification, SessionStart, SubagentStart, PreToolUse

## MCP Integration

Plugin MCP servers are added to the base config:
- If there's a name conflict, plugin config takes precedence
- MCP servers are available to all tools

## LSP Integration

Plugin LSP configurations are added to the base config:
- If there's a name conflict, plugin config takes precedence
- Language servers provide code intelligence

## Testing

### Test with Demo Marketplace

```bash
# Start a-coder with demo marketplace
claude --plugin-dir ./demo-marketplace/plugins/greeting-plugin

# Use the greeting skill
/greeting-plugin:hello
```

### Create a Test Plugin

```bash
mkdir -p test-plugin/.claude-plugin
mkdir -p test-plugin/skills/hello
```

Create manifest (`test-plugin/.claude-plugin/plugin.json`):
```json
{
  "name": "test-plugin",
  "description": "Test plugin",
  "version": "1.0.0"
}
```

Create skill (`test-plugin/skills/hello/SKILL.md`):
```markdown
---
name: hello
description: Greet the user
---

Greet the user warmly.
```

Run with plugin:
```bash
claude --plugin-dir ./test-plugin
/test-plugin:hello
```

## Implementation Status

### Completed

- [x] Plugin manifest types
- [x] Plugin discovery service
- [x] Plugin registry
- [x] Plugin manager
- [x] Plugin CLI commands
- [x] Skill discovery integration for plugins
- [x] CommandService integration with plugin commands
- [x] Export plugin modules from core index
- [x] Plugin hooks loader
- [x] Plugin MCP/LSP config loader
- [x] Plugin settings scope support
- [x] Demo marketplace for testing

### Future Enhancements

- [ ] Interactive plugin manager UI (tabbed interface)
- [ ] Auto-update support for marketplaces
- [ ] Plugin validation and security checks
- [ ] Plugin cache directory management
- [ ] Git clone with proper error handling
- [ ] Plugin dependency resolution
- [ ] Plugin version management

## Next Steps

1. **Build interactive plugin manager UI** - Create tabbed interface like Claude Code's `/plugin`
2. **Add auto-update support** - Fetch marketplace updates at startup
3. **Implement plugin validation** - Security checks before installation
4. **Create plugin documentation** - User-facing guide for creating plugins
5. **Add plugin dependency resolution** - Handle plugin dependencies
