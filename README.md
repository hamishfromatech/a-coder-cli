# A-Coder CLI

## An AI Coding Agent That Respects Your Privacy

**Your code stays on your machine. Always.**

Most AI coding tools require uploading your code to their servers. A-Coder CLI runs entirely locally through Ollama, giving you AI-powered development without the privacy tradeoff.

---

## Why This Matters

You shouldn't have to choose between AI assistance and code security. With A-Coder CLI:

- **Zero data transmission** — All processing happens on your hardware
- **No vendor lock-in** — Works with any Ollama-compatible model
- **Offline capable** — Once set up, you don't need internet
- **Enterprise ready** — Perfect for sensitive codebases and air-gapped environments

---

## What Works Well

| Task | Performance |
|------|-------------|
| Understanding new codebases | ⭐⭐⭐⭐ |
| Refactoring functions | ⭐⭐⭐⭐ |
| Writing tests and docs | ⭐⭐⭐⭐ |
| Automating repetitive tasks | ⭐⭐⭐⭐ |
| Complex architectural decisions | ⭐⭐ (needs larger models) |
| Real-time debugging without reproduction | ⭐⭐ |

**Bottom line**: It's a powerful tool for day-to-day development. Like any local model, it trades some capability for privacy.

---

## Core Capabilities

### File Operations
- **Read files** — Understand any file in your project
- **Edit files** — Make surgical changes with context awareness
- **Write files** — Generate new code, configs, documentation
- **Search** — Grep and glob across your entire codebase

### Advanced Features
- **Memory** — Maintain context across sessions for long projects
- **Subagent** — Execute parallel tasks for complex workflows
- **Shell** — Run commands safely with validation
- **Web Fetch/Search** — Pull from the internet when needed

### Skills System
Pre-built workflows for common patterns:
- Code review automation
- Testing strategies
- Documentation generation
- Git workflow helpers

---

## Quick Setup

### Prerequisites
- Node.js 20+
- Ollama installed and running

### Install (5 minutes)

```bash
git clone https://github.com/hamishfromatech/a-coder-cli.git
cd a-coder-cli
npm install
npm run build
npm install -g .
```

### Configure Ollama

```bash
# Pull a coding model (recommended)
ollama pull qwen3.5:8b

# Alternative models
# ollama pull qwen3.5:14b  # Better reasoning
# ollama pull glm-4.7-flash:30b  # Best 30B class
# ollama pull gemma4:4b  # Vision & coding

# Start the server
ollama serve
```

### Start Coding

```bash
cd your-project/
a-coder-cli
> Describe the main architecture
```

---

## Model Recommendations

| Model | Size | Best For | Speed | Quality |
|-------|------|----------|-------|---------|
| `qwen3.5:4b` | 4B | On-device, fast | Fast | Excellent |
| `gemma4:4b` | 4B | Vision & coding | Fast | Excellent |
| `minstral:3b` | 3B | Edge deployment | Fast | Good |
| `qwen3.5:9b` | 9B | General coding | Good | Outstanding |
| `rnj-1:8b` | 8B | Code & STEM | Good | Excellent |
| `qwen3.5:14b` | 14B | Complex reasoning | Good | Outstanding |
| `devstral-small-2:24b` | 24B | Software agents | Moderate | Outstanding |
| `lfm2:24b` | 24B | On-device hybrid | Moderate | Excellent |
| `glm-4.7-flash:30b` | 30B | Best 30B class | Moderate | Outstanding |
| `nemotron-cascade-2:30b` | 30B (3B activated) | Agentic workflows | Fast | Outstanding |

**Start with 8B or 14B.** Upgrade if you hit limits.

---

## Real Examples

### Understand a New Project

```text
> What are the core business logic components?
> How does authentication work here?
> What security mechanisms are in place?
```

### Refactor Code

```text
> What parts of this module can be optimized?
> Help me refactor this to follow better patterns
> Add proper error handling and logging
```

### Generate Tests

```text
> Write unit tests for this component
> Add integration tests for the API
> Create edge case coverage
```

### Automate Workflows

```text
> Analyze git commits from the last 7 days
> Convert all images to PNG format
> Batch rename files based on pattern
```

---

## Technical Details

**Privacy guarantees:**
- Code never leaves your machine
- No external API calls (unless you use web search)
- No telemetry or usage tracking
- Full visibility into all AI interactions

**Technical guarantees:**
- Works offline after setup
- No vendor lock-in
- Open source (Apache 2.0)
- Runs on any hardware with Ollama

---

## Pricing

**Free.**

This is open source. No tiers, no limits, no "pro" version.

---

## Who This Is For

| ✅ You should use this if... | ❌ You should NOT use this if... |
|------------------------------|---------------------------------|
| You care about code privacy | You need cloud-only features |
| You have an Ollama server | You want the absolute best models |
| You're comfortable with CLI | You need a GUI |
| You want full control | You don't want to run local infrastructure |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Connection refused | Run `ollama serve` in another terminal |
| Model not found | Run `ollama pull <model-name>` first |
| Slow responses | Try a smaller model (8B vs 14B) |
| Out of memory | Increase RAM or use smaller model |

See [docs/troubleshooting.md](docs/troubleshooting.md) for more.

---

## Built On Shoulders of Giants

This is a fork of [Qwen Code](https://github.com/QwenLM/qwen-code), which was originally based on [Google Gemini CLI](https://github.com/google-gemini/gemini-cli).

We've added:
- Ollama integration for local model execution
- Privacy-first architecture
- Skills system with pre-built workflows
- Enhanced MCP support

---

## License

[Apache 2.0](LICENSE)

Managed by **The A-Tech Corporation PTY LTD.**

---

## Ready to Try?

**The 5-Minute Setup:**

1. Install Node.js 20+
2. Install Ollama: `curl -fsSL https://ollama.com/install.sh | sh`
3. Clone & install A-Coder:
   ```bash
   git clone https://github.com/hamishfromatech/a-coder-cli.git
   cd a-coder-cli
   npm install && npm run build
   npm install -g .
   ```
4. Pull a model: `ollama pull qwen3.5:8b`
5. Start server: `ollama serve`
6. Run: `a-coder-cli`

**The 30-Second Test:**

```bash
cd /path/to/your/project
a-coder-cli
> What does this project do?
```

[Install now](#quick-setup) or [read the full docs](docs/cli/commands.md).
