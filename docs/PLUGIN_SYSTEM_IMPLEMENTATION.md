# Plugin System Implementation

## Overview

This document describes the plugin system implementation for a-coder CLI, based on the Claude Code plugin architecture.

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
   - Loads plugin manifests and validates structure

3. **PluginRegistry** (`packages/core/src/plugins/registry.ts`)
   - Tracks installed plugins
   - Supports filtering by scope, source, and state

4. **PluginManager** (`packages/core/src/plugins/manager.ts`)
   - Handles plugin lifecycle operations:
     - `install()` - Install from marketplace
     - `uninstall()` - Remove plugin
     - `enable()` / `disable()` - Toggle state
     - `reload()` - Refresh plugin list
   - Manages marketplace configurations

5. **Marketplace System**
   - Marketplace catalog format: `.claude-plugin/marketplace.json`
   - Supports multiple source types:
     - GitHub (owner/repo format)
     - Git URLs
     - Local paths
     - Remote URLs

### Plugin Directory Structure

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

### Plugin Manifest Schema

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
  }
}
```

## CLI Commands

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
/plugin marketplace add ./local-marketplace
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

## Skill Discovery Integration

The skill discovery system (`packages/core/src/skills/discovery.ts`) has been updated to:

1. Discover plugin skills from installed plugins
2. Support `SkillSource.Plugin` with proper namespacing
3. Priority ordering: Enterprise > Personal > Project > Plugin > Nested

Plugin skills are automatically discovered when:
- Plugin is installed in a recognized scope
- Plugin state is `enabled`
- Plugin has a `skills/` directory with valid skill folders

## Installation Scopes

| Scope     | Location                          | Shared With          |
|-----------|-----------------------------------|----------------------|
| User      | `~/.a-coder-cli/plugins/`         | All projects         |
| Project   | `.a-coder-cli/plugins/`           | Repository collabs   |
| Local     | `plugins/`                        | Current directory    |
| Managed   | Enforced by team/organization     | Team members         |

## Marketplace Catalog Format

```json
{
  "name": "my-marketplace",
  "description": "A curated collection of plugins",
  "version": "1.0.0",
  "plugins": [
    {
      "name": "greeting-plugin",
      "description": "Provides greeting skills",
      "version": "1.0.0",
      "source": {
        "type": "github",
        "repo": "user/greeting-plugin",
        "ref": "v1.0.0"
      },
      "keywords": ["greeting"],
      "categories": ["utilities"],
      "homepage": "https://...",
      "codeSnippets": 5,
      "sourceReputation": "High",
      "benchmarkScore": 85,
      "versions": ["1.0.0", "0.9.0"]
    }
  ]
}
```

## Implementation Status

### Completed

- [x] Plugin manifest types (`packages/core/src/plugins/types.ts`)
- [x] Plugin discovery service (`packages/core/src/plugins/discovery.ts`)
- [x] Plugin registry (`packages/core/src/plugins/registry.ts`)
- [x] Plugin manager (`packages/core/src/plugins/manager.ts`)
- [x] Plugin CLI commands (`packages/cli/src/ui/commands/pluginCommand.ts`)
- [x] Skill discovery integration for plugins
- [x] CommandService integration with plugin commands
- [x] Export plugin modules from core index

### Pending

- [ ] Interactive plugin manager UI (like Claude Code's `/plugin` tabbed interface)
- [ ] Auto-update support for marketplaces
- [ ] Plugin hooks loader integration
- [ ] Plugin MCP/LSP config loader integration
- [ ] Plugin settings scope support in settings system
- [ ] Plugin cache directory management
- [ ] Git clone with proper error handling
- [ ] Plugin validation and security checks

## Testing

To test the plugin system:

1. Create a test plugin:
   ```bash
   mkdir -p test-plugin/.claude-plugin
   mkdir -p test-plugin/skills/hello
   ```

2. Create manifest:
   ```json
   {
     "name": "test-plugin",
     "description": "Test plugin",
     "version": "1.0.0"
   }
   ```

3. Create skill:
   ```markdown
   ---
   name: hello
   description: Greet the user
   ---

   Greet the user warmly.
   ```

4. Run with plugin:
   ```bash
   claude --plugin-dir ./test-plugin
   /test-plugin:hello
   ```

## Next Steps

1. Build interactive plugin manager UI
2. Add plugin hooks loading
3. Add MCP/LSP config loading
4. Implement plugin settings scope
5. Add auto-update support
6. Create sample marketplace for testing
