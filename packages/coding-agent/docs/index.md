# A-Coder CLI Documentation

A-Coder CLI is a terminal coding harness with a small core, designed to be shaped through TypeScript extensions, skills, prompt templates, themes, packages, MCP servers, and multi-agent workflows. The desktop companion (A-Coder Desktop) wraps the same engine in a native GUI.

## Quick start

Install a-coder-cli (self-contained binary):

```bash
# macOS / Linux
curl -sSf https://raw.githubusercontent.com/hamishfromatech/a-coder-cli/feat/desktop-unified-release/install-a-coder.sh | bash

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/hamishfromatech/a-coder-cli/feat/desktop-unified-release/Install-A-Coder.ps1 | iex"
```

Or, install the npm package:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. a-coder-cli does not require install scripts for normal npm installs.

To uninstall a-coder-cli, use npm for install-script and npm installs:

```bash
npm uninstall -g @earendil-works/pi-coding-agent
```

For pnpm, Yarn, or Bun installs, use the matching global remove command: `pnpm remove -g @earendil-works/pi-coding-agent`, `yarn global remove @earendil-works/pi-coding-agent`, or `bun uninstall -g @earendil-works/pi-coding-agent`.

Then run it in a project directory:

```bash
a-coder-cli
```

Authenticate with `/login` for subscription providers, or set an API key such as `ANTHROPIC_API_KEY` before starting a-coder-cli.

For the full first-run flow, see [Quickstart](quickstart.md).

## Start here

- [Quickstart](quickstart.md) - install, authenticate, and run a first session.
- [Usage](usage.md) - interactive mode, slash commands, context files, and CLI reference.
- [Providers](providers.md) - subscription and API-key setup for built-in providers.
- [Security](security.md) - project trust, sandbox boundaries, and vulnerability reporting.
- [Containerization](containerization.md) - sandbox a-coder-cli with Gondolin, Docker, or OpenShell.
- [Settings](settings.md) - global and project settings.
- [Keybindings](keybindings.md) - default shortcuts and custom keybindings.
- [Sessions](sessions.md) - session management, branching, and tree navigation.
- [Compaction](compaction.md) - context compaction and branch summarization.

## Customization

- [Extensions](extensions.md) - TypeScript modules for tools, commands, events, and custom UI.
- [Sub-Agents](subagents.md) - define named sub-agent profiles as Markdown files; the agent scaffolds new ones on request.
- [Skills](skills.md) - Agent Skills for reusable on-demand capabilities.
- [SOPs & Workflows](sops.md) - parameterized SOP skill files and script-orchestrated multi-agent workflow runs.
- [Prompt templates](prompt-templates.md) - reusable prompts that expand from slash commands.
- [Themes](themes.md) - built-in and custom terminal themes.
- [Packages](packages.md) - bundle and share extensions, skills, prompts, themes, and workflows.
- [Custom models](models.md) - add model entries for supported provider APIs.
- [Custom providers](custom-provider.md) - implement custom APIs and OAuth flows.

## Programmatic usage

- [SDK](sdk.md) - embed a-coder-cli in Node.js applications.
- [RPC mode](rpc.md) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](json.md) - print mode with structured events.
- [TUI components](tui.md) - build custom terminal UI for extensions.

## Reference

- [Environment variables](environment-variables.md) - process configuration and session metadata available to bash tools.
- [Session format](session-format.md) - JSONL session file format, entry types, and SessionManager API.

## Also

- A-Coder Desktop (the native GUI over the same engine, with an MCP servers editor, local model servers, mobile access, and the computer-use widget) — see the [desktop-app README](../../desktop-app/README.md).

## Platform setup

- [Windows](windows.md)
- [Termux on Android](termux.md)
- [tmux](tmux.md)
- [Terminal setup](terminal-setup.md)
- [Shell aliases](shell-aliases.md)

## Development

- [Development](development.md) - local setup, project structure, and debugging.
