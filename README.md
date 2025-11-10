# A-Coder CLI

A terminal-based coding agent with natural conversation and MCP-powered file operations.

## Features

- **Natural Conversation**: Chat naturally with an AI coding assistant
- **MCP-Based File Operations**: All file operations delegated to MCP servers (read, write, edit, create, delete)
- **File Context Management**: Add files to conversation context for analysis and modification
- **Read-Only References**: Mark files as read-only to prevent accidental modifications
- **Multi-Server Support**: Connect to multiple MCP servers for extended functionality
- **OpenAI Integration**: Powered by GPT-4 for intelligent code assistance

## Installation

```bash
pip install -r requirements.txt
```

## Configuration

### Environment Variables

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"  # Optional
export OPENAI_MODEL="gpt-4"  # Optional
```

### Config File

Create `config.json` in the project directory:

```json
{
  "openai": {
    "api_key": "your-api-key",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4"
  },
  "mcpServers": {
    "filesystem-with-morph": {
      "command": "npx",
      "args": ["@morph-llm/morph-fast-apply"],
      "env": {
        "MORPH_API_KEY": "your-morph-api-key",
        "ALL_TOOLS": "true"
      }
    }
  }
}
```

## Usage

### Starting the CLI

```bash
python a_coder_cli.py
```

Or with command-line options:

```bash
python a_coder_cli.py --openai-key "your-key" --config config.json
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

#### General

- `/help` - Show detailed help
- `/clear` - Clear screen
- `/exit` or `/quit` - Exit application

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

- **filesystem-with-morph**: Fast file editing via Morph Apply (10,500+ tokens/sec)
- **context7**: Documentation and code context
- Custom servers: Any MCP-compatible server

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

## Support

For issues and feature requests, visit the [GitHub repository](https://github.com/morph-llm/a-coder-cli).
