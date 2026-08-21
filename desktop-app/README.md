# A-Coder Desktop

<p align="center">
  <a href="https://pi.dev">
    <img alt="a-coder-cli logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>

A cross-platform desktop wrapper around the `a-coder-cli` engine, built with Tauri (Rust + React). Provides a friendly graphical interface for the a-coder-cli coding agent, making it accessible to users who prefer a GUI over the terminal.

## Features

- **Desktop GUI** — Native desktop app for macOS, Windows, and Linux
- **Project Selection** — Browse and open projects from your workspace
- **Chat Interface** — Conversational AI interface with markdown support
- **Settings Management** — Configure providers, models, and preferences
- **Session Persistence** — Chat history saved across app restarts
- **Auto-Update** — Automatic updates on launch (opt-in)

## User Guide

### Getting Started

1. **Install a-coder-cli globally** — The desktop app requires `a-coder-cli` installed and available on your `PATH`
2. **Launch the app** — Open A-Coder Desktop from your applications
3. **Select a project** — Choose a directory to work in, or use the current working directory
4. **Authenticate** — Set your API key via environment variable, or use `/login` to authenticate with your subscription
5. **Start chatting** — Ask questions, request code changes, or explore your codebase

### Main Interface

- **Project Selector** — Top bar shows current project; click to switch
- **Chat Panel** — Conversation history with the AI assistant
- **Input Field** — Type messages, use `@` to reference files
- **Status Bar** — Shows current model, token usage, and cost

### Key Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+L` / `Ctrl+L` | Open model selector |
| `Cmd+N` / `Ctrl+N` | New session |
| `Cmd+Shift+S` | Open settings |

### Settings

Access settings via the gear icon or `Cmd+,` / `Ctrl+,`:

- **Provider** — Choose your AI provider (Anthropic, OpenAI, etc.)
- **Model** — Select the model to use
- **Thinking Level** — Set reasoning depth (off, minimal, low, medium, high)
- **Theme** — Light or dark mode

Custom providers configured in `~/.a-coder/agent/models.json` sync automatically with the desktop app.

## Installation

### System Requirements

- **macOS** — Primary platform, fully supported
- **Windows** — Supported, see [Platform Notes](#platform-notes)
- **Linux** — Supported, see [Platform Notes](#platform-notes)

**Prerequisites:**

- Node.js >= 22.19.0
- `a-coder-cli` globally installed and on `PATH`

### Download

Download the latest release from [GitHub Releases](https://github.com/example/pi-mono/releases):

- **macOS** — `.dmg` or `.app.zip`
- **Windows** — `.msi` or `.exe`
- **Linux** — `.AppImage`, `.deb`, or `.rpm`

### Install from Source

From the monorepo root:

```bash
npm install
npm run build:workspace
npm --prefix desktop-app run tauri dev
```

## Troubleshooting

### "a-coder-cli not found" on startup

**Problem:** The app fails to launch because it cannot find `a-coder-cli`.

**Solution:**
1. Install `a-coder-cli` globally: `npm install -g --ignore-scripts @theatechcorporation/pi-coding-agent`
2. Ensure it's on your `PATH`: run `a-coder-cli --version` in a terminal
3. Restart the desktop app

If using a version manager (nvm, fnm, mise), ensure the Node.js installation with `a-coder-cli` is active in your shell profile.

### Session history not loading

**Problem:** Previous chat history doesn't appear when resuming.

**Solution:**
- Sessions are stored in `~/.a-coder/agent/sessions/`
- Use the project selector to navigate to the correct working directory
- Check that sessions exist: `ls ~/.a-coder/agent/sessions/`

### Authentication failures

**Problem:** API key or subscription login fails.

**Solution:**
- For API keys, set the environment variable before launching: `export ANTHROPIC_API_KEY=sk-ant-...`
- For subscriptions, use `/login` in the chat to authenticate via OAuth
- Check `~/.a-coder/agent/auth.json` for stored credentials

### App crashes on startup

**Problem:** The app crashes immediately after launch.

**Solution:**
1. Check logs:
   - **macOS:** `~/Library/Logs/com.a-coder.desktop/`
   - **Windows:** `%APPDATA%\a-coder-desktop\logs\`
   - **Linux:** `~/.local/state/a-coder-desktop/logs/`
2. Ensure Rust and Node.js versions meet requirements
3. Try a clean reinstall, removing config directories

### Slow performance or high memory usage

**Problem:** The app uses excessive memory or responds slowly.

**Solution:**
- Long sessions accumulate history; use `/compact` to summarize older messages
- Close unused project windows
- Check for runaway processes: the desktop app spawns `a-coder-cli --mode rpc` as a child process

## Platform Notes

### macOS

**Permissions:**
- The app may request **Full Disk Access** to read files outside your home directory
- Grant via **System Preferences → Privacy & Security → Full Disk Access**

**Code Signing:**
- Official releases are signed and notarized
- Unsigned builds require right-click → Open on first launch

**Apple Silicon:**
- Both Intel and Apple Silicon builds are available
- Download the correct architecture for your Mac

### Windows

**Path Issues:**
- Windows has a 260-character path limit by default
- Long project paths may cause issues; enable long path support in Group Policy or move projects closer to the drive root

**Windows Security:**
- SmartScreen may warn on unsigned builds
- Official releases are signed; click "More info" → "Run anyway" for unsigned dev builds

**WSL:**
- Running the Windows app with projects in WSL paths (`\\wsl$\...`) works but may have performance overhead
- Recommend installing `a-coder-cli` inside WSL and using the Linux build

### Linux

**AppImage:**
- Requires FUSE: `sudo apt install libfuse2` (Ubuntu/Debian)
- Run with: `chmod +x a-coder-desktop.AppImage && ./a-coder-desktop.AppImage`

**Wayland:**
- Tauri apps work on Wayland but may have minor rendering issues
- Force X11 backend if needed: `GDK_BACKEND=x11 ./a-coder-desktop.AppImage`

## Development

### Architecture

- **Engine:** `a-coder-cli --mode rpc` spawned as a child process
- **Backend:** Rust Tauri app manages the process, JSONL framing, request correlation, and event forwarding
- **Frontend:** React + Vite + Tailwind CSS renders the chat, tools, model/session chrome, and settings

### Requirements

- Node.js >= 22.19.0
- Rust toolchain (latest stable)
- `a-coder-cli` globally installed (resolves from `PATH`)

### Development Commands

From the monorepo root:

```bash
npm install
npm run build:workspace
npm --prefix desktop-app run tauri dev
```

### Building

```bash
npm --prefix desktop-app run tauri build
```

Produces platform binaries in `desktop-app/src-tauri/target/release/bundle/`.

### Project Structure

```
desktop-app/
├── src-tauri/          # Rust backend (process management, IPC)
│   ├── src/
│   │   ├── main.rs     # Tauri entry point
│   │   └── process.rs  # CLI process management
│   └── Cargo.toml
├── src/                # React frontend
│   ├── components/     # UI components
│   ├── hooks/          # React hooks for IPC
│   └── App.tsx
└── package.json
```

## Code Signing Secrets

The desktop app is built on every push to `main` and on pull requests. Signed, notarized releases are published when a tag matching `desktop-v*` is pushed.

### Triggering a Release

```bash
git tag desktop-v0.81.0
git push origin desktop-v0.81.0
```

A draft GitHub release will be created with installers for all platforms. Review the assets and publish the draft when ready.

### Required GitHub Secrets

#### macOS (Code Signing + Notarization)

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | Common name, e.g. `Developer ID Application: Earendil (TEAMID)` |
| `APPLE_ID` | Apple ID (email) of the developer account |
| `APPLE_PASSWORD` | App-specific password generated at appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character team identifier |

**Certificate Setup:**

1. In the Apple Developer portal, create a "Developer ID Application" certificate
2. Export it as a `.p12` file with a strong password
3. Base64-encode it: `base64 -i certificate.p12 | pbcopy`
4. Paste into the `APPLE_CERTIFICATE` secret
5. Generate an app-specific password at appleid.apple.com for `APPLE_PASSWORD`

#### Windows (Code Signing)

Two options are supported:

**Option A: Azure Trusted Signing (Recommended)**

| Secret | Description |
|--------|-------------|
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_CLIENT_ID` | Service principal app ID |
| `AZURE_CLIENT_SECRET` | Service principal secret |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | Trusted Signing account name |
| `AZURE_TRUSTED_SIGNING_PROFILE` | Certificate profile name |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | Endpoint URL, e.g. `https://eus.codesigning.azure.net` |

**Option B: PFX Certificate (Legacy)**

| Secret | Description |
|--------|-------------|
| `WINDOWS_CERTIFICATE` | Base64-encoded PFX code signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the PFX file |

#### Tauri Updater (Optional)

If the updater plugin is enabled, set these secrets to sign update artifacts:

| Secret | Description |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Private key (content, not path) from `tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Optional password for the private key |

## License

MIT

## See Also

- **a-coder-cli** — The underlying CLI engine (`packages/coding-agent`)
- **Tauri** — Cross-platform desktop framework (https://tauri.app)