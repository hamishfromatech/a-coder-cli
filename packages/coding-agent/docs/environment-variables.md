# Environment Variables

A-Coder uses environment variables in three ways:

- Variables such as `A_CODER_CLI_OFFLINE` configure the A-Coder CLI process.
- A-Coder sets `A_CODER_CLI_CODING_AGENT` so child processes can detect that they run inside A-Coder.
- Commands run by the LLM-callable bash tool receive `A_CODER_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#environment-variables-or-auth-file).

## Process Marker

The CLI and RPC entry points set `A_CODER_CLI_CODING_AGENT=true`. Child processes inherit it and can use it to detect that they run inside A-Coder. It is not session-specific and is not set automatically when A-Coder is embedded through the SDK.

## Bash Tool Session Environment

Commands run by the bash tool receive the current A-Coder session state:

| Variable | Description |
|----------|-------------|
| `A_CODER_SESSION_ID` | Current session ID |
| `A_CODER_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `A_CODER_PROVIDER` | Currently selected model provider |
| `A_CODER_MODEL` | Currently selected model ID |
| `A_CODER_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next bash command without restarting A-Coder. `A_CODER_PROVIDER` and `A_CODER_MODEL` identify the selected A-Coder model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$PI_PROVIDER" "$PI_MODEL"
printf 'reasoning=%s session=%s\n' "$PI_REASONING_LEVEL" "$PI_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$PI_SESSION_FILE" ]; then
  tail -n 1 "$PI_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable bash tool. They are not injected into user-entered `!` or `!!` commands.

### Custom Bash Tools

Bash tools created with `createBashTool()` expose the session environment by default when registered with A-Coder. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const bashTool = createBashTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, A-Coder removes inherited values for these variables so nested A-Coder processes do not expose stale parent-session metadata.

## A-Coder Process Configuration

These variables are read by A-Coder itself:

| Variable | Description |
|----------|-------------|
| `A_CODER_CODING_AGENT_DIR` | Override the config directory; default is `~/.pi/agent` |
| `A_CODER_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `A_CODER_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `A_CODER_OFFLINE` | Disable startup network operations, including update checks, package updates, and install/update telemetry |
| `A_CODER_SKIP_VERSION_CHECK` | Disable the `pi.dev` latest-version request |
| `A_CODER_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `A_CODER_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `A_CODER_SHARE_VIEWER_URL` | Override the base URL used by `/share` |
| `A_CODER_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and cloud-provider configuration are listed in [Providers](providers.md#environment-variables-or-auth-file).
