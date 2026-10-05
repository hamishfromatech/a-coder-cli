# Computer Use

The opt-in `computer` tool lets the agent see and drive the desktop: screenshots with clickable element indices, mouse/keyboard input, window and display management. It is disabled by default and gated behind a disclaimer in `/settings`.

## Enabling

| Setting | Effect |
|---------|--------|
| `computerUse` (settings) | `true` enables the tool in new sessions |
| `A_CODER_CLI_COMPUTER_USE=1` (env) | Override without touching settings |

## The cua-driver backend

The tool is a client for [cua-driver](https://github.com/trycua/cua) (the `cua-driver-rs` releases) — an external MCP server binary that performs the actual desktop control. a-coder-cli never bundles it; you install it once per machine.

a-coder-cli resolves the binary in this order:

1. `A_CODER_CUA_DRIVER_CMD` — explicit path override
2. `cua-driver` on `PATH` (`where` on Windows, `which` elsewhere)
3. `<agent-dir>/bin/` — `~/.a-coder/cli/agent/bin/cua-driver` (`cua-driver.exe` on Windows)

### Installing

If the driver is missing, every `computer` call fails with `code: "backend_unavailable"` plus an `install` object matched to your platform/arch: the release asset name, direct URL, the agent bin dir, and copy-pasteable install commands. Run them as-is, or install manually:

**macOS (Apple Silicon):**

```bash
mkdir -p ~/.a-coder/cli/agent/bin
tmp=$(mktemp -d) && cd "$tmp"
curl -fsSL "https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.33.3/cua-driver-rs-0.33.3-darwin-arm64.tar.gz" -o driver.tar.gz
tar -xzf driver.tar.gz
find "$tmp" -name 'cua-driver*' -type f -perm -u+x -exec mv {} ~/.a-coder/cli/agent/bin/cua-driver \;
```

Linux/Windows follow the same shape (`.zip` for Windows; use the `windows-x86_64`/`windows-arm64` asset and place the binary in `%USERPROFILE%\.a-coder\cli\agent\bin`). Release tags advance — prefer the `install.commands` a failed call hands you, or browse the [releases page](https://github.com/trycua/cua/releases?q=cua-driver-rs).

TCC grants (macOS) — Accessibility and Screen Recording — are requested by the driver on first interact; `action: "doctor"` reports their status afterward.

## Diagnostics

```text
computer action=doctor
```

Free, read-only: reports driver health (`overall=ok|degraded`), driver version, and per-check status (window reachability, TCC accessibility, TCC screen recording) with hints. On an older driver build it falls back to `check_permissions`.

## Security posture

- Input actions require approval (the settings screen shows the disclaimer; RPC/desktop surfaces prompt the same way).
- The driver child process runs with telemetry disabled and provider secrets (`*_API_KEY`, AWS credentials, …) stripped from its environment.
- Destructive key combos are hard-blocked before approval is even considered.