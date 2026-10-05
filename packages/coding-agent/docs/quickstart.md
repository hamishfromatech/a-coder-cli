# Quickstart

This page gets you from install to a useful first a-coder-cli session.

## Install

One-line install (self-contained binary):

```bash
# macOS / Linux
curl -sSf https://raw.githubusercontent.com/hamishfromatech/a-coder-cli/feat/desktop-unified-release/install-a-coder.sh | bash

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/hamishfromatech/a-coder-cli/feat/desktop-unified-release/Install-A-Coder.ps1 | iex"
```

Or install the npm package:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. a-coder-cli does not require install scripts for normal npm installs.

### Uninstall

Use the package manager that installed a-coder-cli. The install script and npm both use npm globally, so both are removed with npm:

```bash
# curl installer or npm install -g
npm uninstall -g @earendil-works/pi-coding-agent

# pnpm
pnpm remove -g @earendil-works/pi-coding-agent

# Yarn
yarn global remove @earendil-works/pi-coding-agent

# Bun
bun uninstall -g @earendil-works/pi-coding-agent
```

Uninstalling a-coder-cli leaves settings, credentials, sessions, and installed packages in `~/.a-coder/cli/agent/`.

Then start a-coder-cli in the project directory you want it to work on:

```bash
cd /path/to/project
a-coder-cli
```

## Authenticate

a-coder-cli can use subscription providers through `/login`, or API-key providers through environment variables or the auth file.

### Option 1: subscription login

Start a-coder-cli and run:

```text
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT (Sign in with ChatGPT, or Codex with ChatGPT Plus/Pro), GitHub Copilot, xAI (SuperGrok / X Premium), and Kimi For Coding.

### Option 2: API key

Set an API key before launching a-coder-cli:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
a-coder-cli
```

You can also run `/login` and select an API-key provider to store the key in `~/.a-coder/cli/agent/auth.json`.

See [Providers](providers.md) for all supported providers, environment variables, and cloud-provider setup.

## First session

Once a-coder-cli starts, type a request and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

By default, a-coder-cli enables these tools:

- `read` - read files
- `write` - create or overwrite files
- `edit` - patch files
- `bash` - run shell commands
- `plan_mode` - enter plan mode before larger changes
- `ask_user_question` - ask the user structured questions
- `task_*` and `memory` - persistent task graph and cross-session memory
- `team_create` / `team_delete` / `send_message` - agent teams

Registered but not enabled by default: `grep`, `find`, `ls`, `todo`, `skill`, and the opt-in `computer` (desktop control). Enable them with `defaultTools` in settings or `--tools`. a-coder-cli runs in your current working directory and can modify files there. Use git or another checkpointing workflow if you want easy rollback.

## Give a-coder-cli project instructions

a-coder-cli loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

a-coder-cli loads:

- `~/.a-coder/cli/agent/AGENTS.md` for global instructions
- `AGENTS.md` or `CLAUDE.md` from parent directories and the current directory

Restart a-coder-cli, or run `/reload`, after changing context files.

## Browser control, out of the box

Fresh installs come with a pre-configured chrome-devtools MCP server, so the agent can navigate, inspect, and screenshot Chrome from the first session — an isolated browser profile, telemetry disabled. See [settings > Built-in MCP server](settings.md#built-in-mcp-server).

## Common things to try

### Reference files

Type `@` in the editor to fuzzy-search files, or pass files on the command line:

```bash
a-coder-cli @README.md "Summarize this"
a-coder-cli @src/app.ts @src/app.test.ts "Review these together"
```

Images can be pasted with Ctrl+V (Alt+V on Windows) or dragged into supported terminals.

### Run shell commands

In interactive mode:

```text
!npm run lint
```

The command output is sent to the model. Use `!!command` to run a command without adding its output to the model context.

### Switch models

Use `/model` or Ctrl+L to choose a model. Use Shift+Ctrl+M to cycle thinking level and Shift+Tab to cycle permission mode. Use Ctrl+P / Shift+Ctrl+P to cycle through scoped models.

### Continue later

Sessions are saved automatically:

```bash
a-coder-cli -c                    # Continue most recent session
a-coder-cli -r                    # Browse previous sessions
a-coder-cli --name "my task"      # Set session display name at startup
a-coder-cli --session <path|id>   # Open a specific session
```

Inside pi, use `/resume`, `/new`, `/tree`, `/fork`, and `/clone` to manage sessions.

### Non-interactive mode

For one-shot prompts:

```bash
a-coder-cli -p "Summarize this codebase"
cat README.md | a-coder-cli -p "Summarize this text"
a-coder-cli -p @screenshot.png "What's in this image?"
```

Use `--mode json` for JSON event output or `--mode rpc` for process integration.

## Next steps

- [Usage](usage.md) - interactive mode, slash commands, sessions, context files, and CLI reference.
- [Providers](providers.md) - authentication and model setup.
- [Settings](settings.md) - global and project configuration.
- [Keybindings](keybindings.md) - shortcuts and customization.
- [Packages](packages.md) - install shared extensions, skills, prompts, and themes.

Platform notes: [Windows](windows.md), [Termux](termux.md), [tmux](tmux.md), [Terminal setup](terminal-setup.md), [Shell aliases](shell-aliases.md).
