# Development

See [AGENTS.md](../../AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/hamishfromatech/a-coder-cli.git a-coder-cli
cd a-coder-cli
npm install --ignore-scripts
npm run build
./test.sh
npm run check
```

Run the CLI from source in any directory:

```bash
/path/to/a-coder-cli/pi-test.sh
```

The script keeps the caller's current working directory.

Notes:
- `PI_SKIP_GENERATE=1 npm run build` in `packages/ai` keeps the committed model catalogs instead of re-fetching upstream (CI sets this in its check/test jobs).
- After changing sources under `packages/ai` or `packages/tui`, rebuild the workspace dists before running the full suite — test CLI spawn resolves workspace dependencies through `packages/*/dist`.
- Never run the raw vitest suite from the repo root: it includes e2e tests that activate with provider credentials. Use `./test.sh` or run specific test files.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.a-coder/cli/agent/pi-debug.log` (debug log; filename retained for compatibility):
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
