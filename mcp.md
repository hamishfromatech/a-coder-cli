# The FastMCP Client

> Programmatic client for interacting with MCP servers through a well-typed, Pythonic interface.

export const VersionBadge = ({version}) => {
  return <code className="version-badge-container">
            <p className="version-badge">
                <span className="version-badge-label">New in version:</span> 
                <code className="version-badge-version">{version}</code>
            </p>
        </code>;
};

<VersionBadge version="2.0.0" />

The central piece of MCP client applications is the `fastmcp.Client` class. This class provides a **programmatic interface** for interacting with any Model Context Protocol (MCP) server, handling protocol details and connection management automatically.

The FastMCP Client is designed for deterministic, controlled interactions rather than autonomous behavior, making it ideal for:

* **Testing MCP servers** during development
* **Building deterministic applications** that need reliable MCP interactions
* **Creating the foundation for agentic or LLM-based clients** with structured, type-safe operations

All client operations require using the `async with` context manager for proper connection lifecycle management.

<Note>
  This is not an agentic client - it requires explicit function calls and provides direct control over all MCP operations. Use it as a building block for higher-level systems.
</Note>

## Creating a Client

Creating a client is straightforward. You provide a server source and the client automatically infers the appropriate transport mechanism.

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
import asyncio
from fastmcp import Client, FastMCP

# In-memory server (ideal for testing)
server = FastMCP("TestServer")
client = Client(server)

# HTTP server
client = Client("https://example.com/mcp")

# Local Python script
client = Client("my_mcp_server.py")

async def main():
    async with client:
        # Basic server interaction
        await client.ping()
        
        # List available operations
        tools = await client.list_tools()
        resources = await client.list_resources()
        prompts = await client.list_prompts()
        
        # Execute operations
        result = await client.call_tool("example_tool", {"param": "value"})
        print(result)

asyncio.run(main())
```

## Client-Transport Architecture

The FastMCP Client separates concerns between protocol and connection:

* **`Client`**: Handles MCP protocol operations (tools, resources, prompts) and manages callbacks
* **`Transport`**: Establishes and maintains the connection (WebSockets, HTTP, Stdio, in-memory)

### Transport Inference

The client automatically infers the appropriate transport based on the input:

1. **`FastMCP` instance** → In-memory transport (perfect for testing)
2. **File path ending in `.py`** → Python Stdio transport
3. **File path ending in `.js`** → Node.js Stdio transport
4. **URL starting with `http://` or `https://`** → HTTP transport
5. **`MCPConfig` dictionary** → Multi-server client

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
from fastmcp import Client, FastMCP

# Examples of transport inference
client_memory = Client(FastMCP("TestServer"))
client_script = Client("./server.py") 
client_http = Client("https://api.example.com/mcp")
```

<Tip>
  For testing and development, always prefer the in-memory transport by passing a `FastMCP` server directly to the client. This eliminates network complexity and separate processes.
</Tip>

## Configuration-Based Clients

<VersionBadge version="2.4.0" />

Create clients from MCP configuration dictionaries, which can include multiple servers. While there is no official standard for MCP configuration format, FastMCP follows established conventions used by tools like Claude Desktop.

### Configuration Format

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
config = {
    "mcpServers": {
        "server_name": {
            # Remote HTTP/SSE server
            "transport": "http",  # or "sse" 
            "url": "https://api.example.com/mcp",
            "headers": {"Authorization": "Bearer token"},
            "auth": "oauth"  # or bearer token string
        },
        "local_server": {
            # Local stdio server
            "transport": "stdio",
            "command": "python",
            "args": ["./server.py", "--verbose"],
            "env": {"DEBUG": "true"},
            "cwd": "/path/to/server",
        }
    }
}
```

### Multi-Server Example

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
config = {
    "mcpServers": {
        "weather": {"url": "https://weather-api.example.com/mcp"},
        "assistant": {"command": "python", "args": ["./assistant_server.py"]}
    }
}

client = Client(config)

async with client:
    # Tools are prefixed with server names
    weather_data = await client.call_tool("weather_get_forecast", {"city": "London"})
    response = await client.call_tool("assistant_answer_question", {"question": "What's the capital of France?"})
    
    # Resources use prefixed URIs
    icons = await client.read_resource("weather://weather/icons/sunny")
    templates = await client.read_resource("resource://assistant/templates/list")
```

## Connection Lifecycle

The client operates asynchronously and uses context managers for connection management:

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
async def example():
    client = Client("my_mcp_server.py")
    
    # Connection established here
    async with client:
        print(f"Connected: {client.is_connected()}")
        
        # Make multiple calls within the same session
        tools = await client.list_tools()
        result = await client.call_tool("greet", {"name": "World"})
        
    # Connection closed automatically here
    print(f"Connected: {client.is_connected()}")
```

## Operations

FastMCP clients can interact with several types of server components:

### Tools

Tools are server-side functions that the client can execute with arguments.

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
async with client:
    # List available tools
    tools = await client.list_tools()
    
    # Execute a tool
    result = await client.call_tool("multiply", {"a": 5, "b": 3})
    print(result.data)  # 15
```

See [Tools](/clients/tools) for detailed documentation.

### Resources

Resources are data sources that the client can read, either static or templated.

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
async with client:
    # List available resources
    resources = await client.list_resources()
    
    # Read a resource
    content = await client.read_resource("file:///config/settings.json")
    print(content[0].text)
```

See [Resources](/clients/resources) for detailed documentation.

### Prompts

Prompts are reusable message templates that can accept arguments.

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
async with client:
    # List available prompts
    prompts = await client.list_prompts()
    
    # Get a rendered prompt
    messages = await client.get_prompt("analyze_data", {"data": [1, 2, 3]})
    print(messages.messages)
```

See [Prompts](/clients/prompts) for detailed documentation.

### Server Connectivity

Use `ping()` to verify the server is reachable:

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
async with client:
    await client.ping()
    print("Server is reachable")
```

### Initialization and Server Information

When you enter the client context manager, the client automatically performs an MCP initialization handshake with the server. This handshake exchanges capabilities, server metadata, and instructions. The result is available through the `initialize_result` property.

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
from fastmcp import Client, FastMCP

mcp = FastMCP(name="MyServer", instructions="Use the greet tool to say hello!")

@mcp.tool
def greet(name: str) -> str:
    """Greet a user by name."""
    return f"Hello, {name}!"

async with Client(mcp) as client:
    # Initialization already happened automatically
    print(f"Server: {client.initialize_result.serverInfo.name}")
    print(f"Version: {client.initialize_result.serverInfo.version}")
    print(f"Instructions: {client.initialize_result.instructions}")
    print(f"Capabilities: {client.initialize_result.capabilities.tools}")
```

#### Manual Initialization Control

In advanced scenarios, you might want precise control over when initialization happens. For example, you may need custom error handling, want to defer initialization until after other setup, or need to measure initialization timing separately.

Disable automatic initialization and call `initialize()` manually:

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
from fastmcp import Client

# Disable automatic initialization
client = Client("my_mcp_server.py", auto_initialize=False)

async with client:
    # Connection established, but not initialized yet
    print(f"Connected: {client.is_connected()}")
    print(f"Initialized: {client.initialize_result is not None}")  # False

    # Initialize manually with custom timeout
    result = await client.initialize(timeout=10.0)
    print(f"Server: {result.serverInfo.name}")

    # Now ready for operations
    tools = await client.list_tools()
```

The `initialize()` method is idempotent - calling it multiple times returns the cached result from the first successful call.

## Client Configuration

Clients can be configured with additional handlers and settings for specialized use cases.

### Callback Handlers

The client supports several callback handlers for advanced server interactions:

```python  theme={"theme":{"light":"snazzy-light","dark":"dark-plus"}}
from fastmcp import Client
from fastmcp.client.logging import LogMessage

async def log_handler(message: LogMessage):
    print(f"Server log: {message.data}")

async def progress_handler(progress: float, total: float | None, message: str | None):
    print(f"Progress: {progress}/{total} - {message}")

async def sampling_handler(messages, params, context):
    # Integrate with your LLM service here
    return "Generated response"

client = Client(
    "my_mcp_server.py",
    log_handler=log_handler,
    progress_handler=progress_handler,
    sampling_handler=sampling_handler,
    timeout=30.0
)
```

The `Client` constructor accepts several configuration options:

* `transport`: Transport instance or source for automatic inference
* `log_handler`: Handle server log messages
* `progress_handler`: Monitor long-running operations
* `sampling_handler`: Respond to server LLM requests
* `roots`: Provide local context to servers
* `timeout`: Default timeout for requests (in seconds)

### Transport Configuration

For detailed transport configuration (headers, authentication, environment variables), see the [Transports](/clients/transports) documentation.

## Next Steps

Explore the detailed documentation for each operation type:

### Core Operations

* **[Tools](/clients/tools)** - Execute server-side functions and handle results
* **[Resources](/clients/resources)** - Access static and templated resources
* **[Prompts](/clients/prompts)** - Work with message templates and argument serialization

### Advanced Features

* **[Logging](/clients/logging)** - Handle server log messages
* **[Progress](/clients/progress)** - Monitor long-running operations
* **[Sampling](/clients/sampling)** - Respond to server LLM requests
* **[Roots](/clients/roots)** - Provide local context to servers

### Connection Details

* **[Transports](/clients/transports)** - Configure connection methods and parameters
* **[Authentication](/clients/auth/oauth)** - Set up OAuth and bearer token authentication

<Tip>
  The FastMCP Client is designed as a foundational tool. Use it directly for deterministic operations, or build higher-level agentic systems on top of its reliable, type-safe interface.
</Tip>


---

# MCP Integration

> Connect to Morph's blazing-fast file editing via Model Context Protocol


## Overview

Connect AI tools to Morph's 10,500+ tokens/sec file editing via Model Context Protocol. Works with Claude, Cursor, VS Code, and other MCP clients with automatic workspace detection.

## Tool Modes

<CardGroup cols={2}>
  <Card title="Edit-Only Mode" icon="code">
    **ALL\_TOOLS: "false"**

    Perfect for fast, focused editing:

    * `edit_file` - Lightning-fast code edits using Morph Apply
  </Card>

  <Card title="Full Filesystem Mode" icon="settings">
    **ALL\_TOOLS: "true"**

    Complete filesystem access:

    * `edit_file` - Fast code edits via Morph Apply
    * `read_file`, `write_file`
    * `list_directory`, `create_directory`
    * `search_files`, `move_file`
    * `get_file_info` + more filesystem tools
  </Card>
</CardGroup>

## Installation

<Steps>
  <Step title="1. Configure Your MCP Client">
    <Tabs>
      <Tab title="Claude Code">
        **One-liner Installation (Recommended)**:

        ```bash  theme={null}
        claude mcp add filesystem-with-morph -e MORPH_API_KEY=your-api-key-here -e ALL_TOOLS=false -- npx @morph-llm/morph-fast-apply
        ```

        <Note>
          **Configure Claude to prefer Morph**: Add this to your Claude instructions to ensure Claude uses Morph for all code edits:

          ```bash  theme={null}
          echo "IMPORTANT: ALWAYS use mcp__filesystem-with-morph__edit_file tool to make any code edits. Do not use the default edit tool." > .claude/CLAUDE.md
          ```
        </Note>

        **Manual Config File Method**:

        Create or edit `.claude.json` in your workspace:

        ```json  theme={null}
        {
          "mcpServers": {
            "filesystem-with-morph": {
              "command": "npx",
              "args": [
                "@morph-llm/morph-fast-apply"
              ],
              "env": {
                "MORPH_API_KEY": "your-api-key-here",
                "ALL_TOOLS": "false"
              }
            }
          }
        }
        ```
      </Tab>

      <Tab title="Codex">
        **CLI Installation (Recommended)**:

        ```bash  theme={null}
        # Add Morph MCP server to Codex
        codex mcp add filesystem-with-morph -e MORPH_API_KEY=your-api-key-here -e ALL_TOOLS=false -- npx @morph-llm/morph-fast-apply
        ```

        **Manual Config File**:

        Add to `~/.codex/config.toml`:

        ```toml  theme={null}
        [mcp_servers.filesystem-with-morph]
        command = "npx"
        args = ["@morph-llm/morph-fast-apply"]
        env = { "MORPH_API_KEY" = "your-api-key-here", "ALL_TOOLS" = "false" }
        # Optional: adjust timeouts
        startup_timeout_sec = 10
        tool_timeout_sec = 60
        ```

        <Note>
          **CLI Management**: Use `codex mcp list` to see configured servers and `codex mcp remove filesystem-with-morph` to remove.
        </Note>
      </Tab>

      <Tab title="Claude Desktop">
        Add to your Claude Desktop config file:

        **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`\
        **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

        ```json  theme={null}
        {
          "mcpServers": {
            "filesystem-with-morph": {
              "command": "npx",
              "args": [
                "@morph-llm/morph-fast-apply"
              ],
              "env": {
                "MORPH_API_KEY": "your-api-key-here",
                "ALL_TOOLS": "true"
              }
            }
          }
        }
        ```

        <Note>
          **Restart Required**: Completely quit and restart Claude Desktop to load the new configuration.
        </Note>
      </Tab>

      <Tab title="Cursor">
        Add to your Cursor MCP config file:

        **Location**: `~/.cursor/mcp.json`

        ```json  theme={null}
        {
          "mcpServers": {
            "filesystem-with-morph": {
              "command": "npx",
              "args": [
                "@morph-llm/morph-fast-apply"
              ],
              "env": {
                "MORPH_API_KEY": "your-api-key-here",
                "ALL_TOOLS": "true"
              }
            }
          }
        }
        ```

        <Note>
          **Global Config**: This configuration works across all your projects automatically. The MCP server detects workspace boundaries via `.git`, `package.json`, and other project indicators.
        </Note>
      </Tab>

      <Tab title="VS Code">
        Add to your workspace's `.vscode/mcp.json` file:

        ```json  theme={null}
        {
          "mcpServers": {
            "filesystem-with-morph": {
              "command": "npx",
              "args": [
                "@morph-llm/morph-fast-apply"
              ],
              "env": {
                "MORPH_API_KEY": "your-api-key-here",
                "ALL_TOOLS": "true"
              }
            }
          }
        }
        ```
      </Tab>

      <Tab title="Manual">
        Run the MCP server directly:

        ```bash  theme={null}
        export MORPH_API_KEY="your-api-key-here"
        export ALL_TOOLS="true"  # or "false" for edit-only mode
        npx @morph-llm/morph-fast-apply
        ```
      </Tab>
    </Tabs>
  </Step>

  <Step title="2. Get API Key">
    Get your API key from the [dashboard](https://morphllm.com/dashboard/api-keys) and replace `your-api-key-here` in your configuration.
  </Step>

  <Step title="3. Test Installation">
    **Claude**: Type `/mcp` and `/tools` to see Morph's `edit_file` tool\
    **Cursor/VS Code**: Make any code edit request - should use Morph automatically\
    **Codex**: Run `codex mcp list` to verify server is configured, then make edit requests\
    **Manual**: Check server logs show "MCP Server started successfully"
  </Step>
</Steps>

## Configuration

| Variable         | Default   | Description                                                  |
| ---------------- | --------- | ------------------------------------------------------------ |
| `MORPH_API_KEY`  | Required  | Your API key                                                 |
| `ALL_TOOLS`      | `"true"`  | `"false"` for edit-only, `"true"` for full filesystem access |
| `WORKSPACE_MODE` | `"true"`  | Auto workspace detection                                     |
| `DEBUG`          | `"false"` | Debug logging                                                |

## Available Tools

**`edit_file`** - 10,500+ tokens/sec code editing via Morph Apply

**Additional tools** (when `ALL_TOOLS: "true"`):
`read_file`, `write_file`, `list_directory`, `create_directory`, `search_files`, `move_file`, `get_file_info`

## Troubleshooting

**Server won't start**: Check API key, Node.js 16+, run `npm cache clean --force`\
**Tools missing**: Restart client, validate JSON config\
**Workspace issues**: Add `.git` or `package.json`, or set `WORKSPACE_MODE="false"`\
**Slow performance**: Use `edit_file` over `write_file`, check network to api.morphllm.com

## Performance Optimization

### Best Practices

1. **Use `edit_file` for modifications**: Much faster than reading + writing entire files
2. **Minimize edit scope**: Include only the sections that need changes
3. **Batch related edits**: Make multiple changes in a single `edit_file` call
4. **Enable edit-only mode**: Use `ALL_TOOLS: "false"` when you only need editing capabilities

### Performance Comparison

| Method                 | Speed        | Use Case                    |
| ---------------------- | ------------ | --------------------------- |
| `edit_file` (Morph)    | \~11 seconds | Code modifications, updates |
| Search & replace       | \~20 seconds | Simple text substitutions   |
| Traditional read/write | \~60 seconds | Full file rewrites          |
