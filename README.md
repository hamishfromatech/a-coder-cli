<p align="center">
  <a href="https://a-coder-cli.dev">
    <img alt="A-Coder logo" src="https://a-coder-cli.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

# A-Coder CLI & Desktop

A self-extensible AI coding agent by [The A-Tech Corporation PTY LTD](https://github.com/hamishfromatech), available two ways:

- **A-Coder CLI** (`a-coder-cli`) — the terminal coding agent. Runs anywhere Node 22+ or Bun does.
- **A-Coder Desktop** — a native Tauri desktop app (macOS, Windows, Linux) with project workspaces, a session tree, a model picker, and voice mode (speech-to-text / text-to-speech).

Both share the same engine — the agent runtime, tools, and unified multi-provider LLM API — so providers, models, and sessions work identically across the CLI and the desktop app.

To learn more:

* [Visit a-coder-cli.dev](https://a-coder-cli.dev), the project website with demos
* [Read the documentation](https://a-coder-cli.dev/docs/latest), or just ask the agent to explain itself

## All Packages

| Package | Description |
|---------|-------------|
| **[coding-agent](packages/coding-agent)** | Interactive coding agent CLI (`a-coder-cli`) |
| **[desktop-app](desktop-app)** | Native Tauri desktop app (A-Coder Desktop) |
| **[agent](packages/agent)** | Agent runtime with tool calling and state management |
| **[ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[tui](packages/tui)** | Terminal UI library with differential rendering |

## Install

### A-Coder CLI

One-line install (downloads the self-contained binary for your platform):

```bash
# macOS / Linux
curl -sSf https://raw.githubusercontent.com/hamishfromatech/pi-mono/main/install-a-coder.sh | bash

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/hamishfromatech/pi-mono/main/Install-A-Coder.ps1 | iex"
```

This installs the `a-coder-cli` command (symlinked onto your `PATH`). Run `a-coder-cli` in any project folder to start chatting; `a-coder-cli --help` lists all flags.

> **Launch the desktop app from the terminal:** `a-coder-cli --desktop` (or `-d`) opens A-Coder Desktop in the current folder, so you can start the GUI right where you're working. Set `A_CODER_DESKTOP_BINARY` to point at a custom build, or `A_CODER_DESKTOP_DEV=1` to run it via `npm run tauri:dev` from a monorepo checkout.

### A-Coder Desktop

**Option A — Download an installer** from the [GitHub Releases](https://github.com/hamishfromatech/pi-mono/releases):

| Platform | Installer |
|----------|-----------|
| macOS (Apple Silicon / Intel) | `A-Coder Desktop_<version>_aarch64.dmg` / `..._x64.dmg` |
| Windows | `A-Coder Desktop_<version>_x64-setup.exe` (NSIS) or `..._x64_en-US.msi` |
| Linux | `A-Coder Desktop_<version>_amd64.deb`, `..._x64.AppImage`, or `..._amd64.rpm` |

Drag the `.app` to `/Applications` (macOS), run the `.exe`/`.msi` (Windows), or install the `.deb`/`.AppImage` (Linux). On first launch the app asks you to pick a workspace folder.

**Option B — Build from source** (needs Node 22+, Rust, and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)):

```bash
git clone https://github.com/hamishfromatech/pi-mono.git
cd pi-mono
npm install --ignore-scripts        # monorepo deps
cd desktop-app
npm install --ignore-scripts        # desktop-app deps
npm run tauri:build                 # -> src-tauri/target/release/bundle/ (dmg/exe/deb/...)
# or, for a live dev window:
npm run tauri:dev
```

### Voice mode (desktop)

A-Coder Desktop supports voice I/O through your own OpenAI-compatible endpoints. Open **Settings → Voice**, enter your speech-to-text and text-to-speech base URLs (STT uses `/v1/audio/transcriptions`, TTS uses `/v1/audio/speech`), enable voice mode, and use the mic button in the composer. Any OpenAI-compatible provider works.

## Permissions & Containerization

A-Coder does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox the CLI. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `a-coder-cli` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `a-coder-cli` process in a local container for simple isolation.
- **OpenShell**: run the whole `a-coder-cli` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run a-coder-cli from sources (can be run from any directory)
```

Desktop development lives in [`desktop-app/`](desktop-app) — see its [README](desktop-app/README.md) for Tauri build/run details.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `A_CODER_CLI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `a-coder-cli update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## License

MIT &copy; The A-Tech Corporation PTY LTD