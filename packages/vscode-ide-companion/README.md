# IDE Companion

A VS Code extension that runs an [MCP (Model Context Protocol) server](https://modelcontextprotocol.io/) to provide IDE tools to AI coding agents. It works with VS Code, A-Coder, and other VS Code-based editors.

## Features

- Exposes an MCP server on port 3000 for IDE integration
- Provides tools like `getActiveFile` to get the currently open file
- Automatically detects the host application (VS Code, A-Coder, etc.) and names the MCP server accordingly

## Local Development

To test the extension locally, follow these steps:

1. Open the `packages/vscode-ide-companion` directory in VS Code.
2. Run `npm install`.
3. Run the extension development host via Run + Debug -> Extension

## MCP Server Configuration

When running, the extension establishes an MCP server that can be connected to via `http://localhost:3000/mcp`.

The server name is automatically determined based on the host application:
- `a-coder-ide-server` when running in A-Coder
- `vscode-ide-server` for VS Code and other VS Code-based editors

Configure it in your A-Coder `settings.json`:

```json
{
  "mcpServers": {
    "_ide_server": {
      "httpUrl": "http://localhost:3000/mcp",
      "description": "IDE connection"
    }
  }
}
```

Or use the `--ide-mode` flag when running A-Coder to automatically configure the IDE server connection.
