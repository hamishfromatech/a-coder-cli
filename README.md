# A-Coder CLI

A terminal-based autonomous coding agent with natural conversation and MCP-powered file operations. Works completely free with Ollama and the standard filesystem MCP server, or use Morph (paid) for faster performance.

## Features

- **🤖 Autonomous Agent**: Multi-step tool calling - AI autonomously explores, gathers information, and completes tasks
- **💬 Natural Conversation**: Chat naturally with an AI coding assistant
- **📁 MCP-Based File Operations**: All file operations delegated to MCP servers (read, write, edit, create, delete)
- **🆓 100% Free Option**: Works with Ollama (free) + standard filesystem MCP server (free, no API keys)
- **🗂️ Smart Context Management**: Add files to conversation context for analysis and modification
- **🔒 Read-Only References**: Mark files as read-only to prevent accidental modifications
- **🔌 Multi-Server Support**: Connect to multiple MCP servers for extended functionality
- **🦙 Ollama Support**: Works with Ollama cloud models and local models
- **🏠 LM Studio Support**: Full compatibility with LM Studio's local OpenAI-compatible API
- **🔄 OpenAI Compatible**: Works with any OpenAI-compatible API
- **⚡ Interrupt Control**: Press Ctrl+C to interrupt AI processing and return to prompt (cross-platform)
- **🔄 Command History**: Navigate previous commands with arrow keys (↑/↓)
- **🔀 Model Switching**: Switch between models on-the-fly with `/models` and `/switch-model`
- **🚀 Auto-Configuration**: Automatically detects your project directory
- **📦 TOON-Optimized Tool Results**: MCP tool responses are encoded in Token-Oriented Object Notation by default for lower token usage and higher LLM accuracy

## Quick Start

### 1. Install

```bash
pip install a-coder-cli
```

### 2. Create Config

```bash
cp config.json.example config.json
# Edit config.json with your API key and model settings
```

### 3. Run in Your Project

```bash
# Navigate to your project
cd /path/to/your/project

# Start A-Coder
a-coder --config ~/config.json

# Or use the short form:
a-coder -c ~/config.json
```

That's it! The filesystem server automatically configures itself to your current directory.

## Interactive Features

### Command History

Use the up/down arrow keys to cycle through your command history. Your command history persists between sessions, making it easy to reuse complex commands.

### File Operations

- **Add files**: `/add path/to/file`
- **Read-only mode**: `/readonly path/to/file`
- **List context**: `/context`
- **Clear context**: `/clear`

## Installation

```bash
pip install a-coder-cli
```

Or install from source:

```bash
git clone https://github.com/morph-llm/a-coder-cli.git
cd a-coder-cli
pip install -e .
```

## Configuration

### 1. Create Configuration File

Copy the example configuration and customize it:

```bash
cp config.json.example config.json
```

Then edit `config.json` with your settings:

```json
{
  "openai": {
    "api_key": "your-api-key",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4"
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/your/project"
      ]
    }
  }
}
```

#### Optional: make the config path permanent

Set the `A_CODER_CONFIG_PATH` environment variable to avoid passing `--config` every time:

```bash
export A_CODER_CONFIG_PATH="$HOME/config.json"
```

`ACODER_CONFIG_PATH` and `ACODER_CONFIG` remain as legacy aliases for backwards compatibility.

### Model Provider Options

#### Ollama (Free, Local)

Default configuration uses Ollama running locally:

```json
{
  "openai": {
    "api_key": "ollama",
    "base_url": "http://localhost:11434/v1",
    "model": "deepseek-v3.1:671b-cloud"
  }
}
```

#### LM Studio (Free, Local)

LM Studio provides a local OpenAI-compatible API:

```json
{
  "openai": {
    "api_key": "lm-studio",
    "base_url": "http://localhost:1234/v1",
    "model": "your-loaded-model-name"
  }
}
```

**Setup:**
1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load a model in LM Studio
3. Start the local server (default port: 1234)
4. Set `model` to match the loaded model name exactly
5. Use any non-empty string for `api_key` (e.g., "lm-studio")

#### OpenAI (Paid)

```json
{
  "openai": {
    "api_key": "sk-...",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4"
  }
}
```

### MCP Server Options

**Option 1: Standard Filesystem Server (Free, Recommended)**
```json
"filesystem": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/path/to/your/project"
  ]
}
```

**Note:** The path `/path/to/your/project` will be automatically replaced with your current working directory when you run `a-coder`. You can also specify absolute paths for multiple directories:

```json
"filesystem": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/Users/username/projects/my-app",
    "/Users/username/projects/shared-lib"
  ]
}
```

**Option 2: Morph Filesystem Server (Requires API Key)**
```json
"filesystem-with-morph": {
  "command": "npx",
  "args": ["@morph-llm/morph-fast-apply"],
  "env": {
    "MORPH_API_KEY": "your-morph-api-key",
    "ALL_TOOLS": "true"
  }
}
```

**Option 3: Context7 (Optional, for library documentation)**
```json
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context-sdk"]
}
```

## Usage

### Starting the CLI

Navigate to your project directory and run:

```bash
cd /path/to/your/project
a-coder --config config.json
```

The filesystem server will automatically use the current directory. Or with command-line options:

```bash
a-coder --openai-key "your-key" --config config.json
```

**Example:**
```bash
cd ~/projects/my-web-app
a-coder --config ~/config.json
# Filesystem server will automatically access ~/projects/my-web-app
```

### Commands

#### File Management

- `/add <filepath>` - Add file to conversation context (editable)
- `/add-ro <filepath>` - Add file as read-only reference
- `/files` - List all added files with status
- `/remove <filepath>` - Remove file from context
- `/clear-files` - Clear all added files

#### MCP Server Management

- `/mcp-list` - List connected MCP servers
- `/mcp-tools <server>` - List available tools from a server
- `/mcp-call <server> <tool> [args]` - Call an MCP tool directly

#### Model Management

- `/models` - List available models from your provider (Ollama/LM Studio)
- `/switch-model <model>` - Switch to a different model

#### General

- `/help` - Show detailed help
- `/clear` - Clear screen
- `/exit` or `/quit` - Exit application
- **Ctrl+C** - Interrupt AI processing and return to prompt

### Example Workflow

```
You> /add src/app.py
✓ Added src/app.py

You> /add-ro docs/architecture.md
✓ Added docs/architecture.md (read-only)

You> /files
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Added Files                                           ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ File              │ Status    │ Size              │
├───────────────────┼───────────┼───────────────────┤
│ src/app.py        │ editable  │ 2,345 bytes       │
│ docs/architecture │ read-only │ 5,678 bytes       │
└───────────────────┴───────────┴───────────────────┘

You> Can you refactor the main function to be more modular?

A-Coder> I'll analyze the code and suggest improvements...

# Press Ctrl+C during AI processing to interrupt
⚠ AI loop interrupted. Ready for new message.

You> /models
🤖 Available Models
  ✓ deepseek-v3.1:671b-cloud (current)
  2. llama3.2:latest
  3. qwen2.5:14b
```

## Architecture

### Components

- **ACoderCLI**: Main application class managing conversation and file context
- **MCP Integration**: Delegates all file operations to MCP servers
- **OpenAI Integration**: Uses GPT-4 for intelligent responses
- **File Context**: Maintains added files and includes them in conversation

### File Operations Flow

1. User requests file modification
2. AI analyzes request and added files
3. AI calls appropriate MCP tool (edit_file, write_file, etc.)
4. MCP server performs operation
5. Result returned to user

## MCP Servers

The CLI supports any MCP server. Popular options:

### Filesystem Server (Free, Recommended)
The standard MCP filesystem server provides comprehensive file operations:

**Available Tools:**
- `read_text_file` - Read file contents with optional head/tail limits
- `write_file` - Create or overwrite files
- `edit_file` - Make selective edits with pattern matching
- `list_directory` - List directory contents
- `create_directory` - Create new directories
- `move_file` - Move or rename files/directories
- `search_files` - Search for files matching patterns
- `directory_tree` - Get recursive directory structure
- `get_file_info` - Get file metadata
- `list_allowed_directories` - List accessible directories

**Setup:**
```json
"filesystem": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
}
```

### Morph Filesystem Server (Paid, Optional)
Fast file editing via Morph Apply (10,500+ tokens/sec). Same tools as above plus additional optimizations.

**Setup:**
```json
"filesystem-with-morph": {
  "command": "npx",
  "args": ["@morph-llm/morph-fast-apply"],
  "env": {
    "MORPH_API_KEY": "your-morph-api-key",
    "ALL_TOOLS": "true"
  }
}
```

**When to use Morph:**
- ⚡ Need maximum performance (10,500+ tokens/sec)
- 🏢 Enterprise/production environments
- 💼 Professional development workflows

**When to use free filesystem server:**
- 🆓 Personal projects
- 🎓 Learning and experimentation
- 💻 Standard development workflows

### Context7 (Optional)
Documentation and code context for libraries and frameworks.

### Custom Servers
Any MCP-compatible server can be added to the configuration.

## Performance Tips

1. **Use `/add-ro` for reference files**: Prevents accidental modifications
2. **Keep context focused**: Only add relevant files to reduce token usage
3. **Use edit_file over write_file**: Much faster for modifications
4. **Batch related changes**: Make multiple edits in one request

## Troubleshooting

### OpenAI API Key Not Found

Set via environment variable or config file:
```bash
export OPENAI_API_KEY="your-key"
```

### MCP Server Connection Failed

Verify server configuration in `config.json` and check server logs.

### File Not Found

Use absolute paths or ensure files are relative to current working directory.

## Development

### Project Structure

```
a-coder-cli/
├── a_coder_cli.py      # Main application
├── config.py           # Configuration management
├── config.json         # Configuration file
├── requirements.txt    # Python dependencies
├── setup.py            # Package setup
└── README.md           # This file
```

### Running Tests

```bash
python -m pytest tests/
```

## License

MIT

