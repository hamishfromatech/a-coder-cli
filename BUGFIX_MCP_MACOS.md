# MCP Server Connection Bug Fix - macOS

## Problem
MCP server connections were completely failing on macOS while working correctly on Windows.

## Root Causes

### Issue #1: Wrong Field Resolution
The `connect_mcp_server` method was attempting to resolve the **first argument** in the `args` array instead of the `command` field:

```python
# INCORRECT - Before fix
if isinstance(server_config, dict) and 'args' in server_config:
    args = server_config['args']
    if args and len(args) > 0:
        original_cmd = args[0]  # ❌ WRONG! This is often '-y' or a package name
        resolved_cmd = self._resolve_command_path(original_cmd)
```

Given a typical config:
```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  }
}
```

The code tried to resolve `args[0]` which is `"-y"` instead of `"npx"`, causing `shutil.which("-y")` to fail.

### Issue #2: Multiple Client Architecture
The code was creating **separate MCPClient instances for each server**, but FastMCP's `Client` is designed to handle **multiple servers in a single instance**. This caused transport inference failures.

```python
# INCORRECT - Before fix
for name, server_config in servers.items():
    config_dict = {"mcpServers": {name: server_config}}  # ❌ Wrong! Wrapping each server separately
    client = MCPClient(config_dict)
    self.mcp_clients[name] = client  # Multiple clients
```

### Issue #3: Explicit Transport Field
The code was adding explicit `"transport": "stdio"` fields to server configs, but FastMCP **automatically infers transport** from the config structure:
- Presence of `url` → HTTP transport
- Presence of `command` → stdio transport

Adding explicit `transport` fields breaks FastMCP's inference logic.

## The Fix

### Fix #1: Resolve Correct Field
```python
# CORRECT - After fix
if isinstance(server_config, dict) and 'command' in server_config:
    original_cmd = server_config['command']  # ✅ Resolve the actual command
    resolved_cmd = self._resolve_command_path(original_cmd)
    if resolved_cmd != original_cmd:
        server_config['command'] = resolved_cmd
```

### Fix #2: Single Multi-Server Client
```python
# CORRECT - After fix
# Collect all servers
servers_to_connect = {}
for name, server_config in config.mcp.servers.items():
    servers_to_connect[name] = server_config

# Create single multi-server client
config_dict = {"mcpServers": servers_to_connect}  # ✅ All servers in one config
self.mcp_client = MCPClient(config_dict)  # Single client
self.mcp_server_names = list(servers_to_connect.keys())
```

### Fix #3: Remove Explicit Transport Fields
```python
# CORRECT - After fix
# Remove explicit transport fields - let FastMCP infer them
for name, server_config in servers_config.items():
    if 'transport' in server_config:
        del server_config['transport']  # ✅ Let FastMCP infer from url/command
```

### Architecture Changes
- Changed from `self.mcp_clients: Dict[str, MCPClient]` to `self.mcp_client: Optional[MCPClient]`
- Added `self.mcp_server_names: List[str]` to track connected servers
- Updated `connect_mcp_server()` → `connect_mcp_servers()` (plural, takes all servers at once)
- Updated tool calling to use FastMCP's prefixed tool names (e.g., `filesystem_read_file`)

## Impact
- ✅ MCP servers now connect properly on macOS
- ✅ Windows functionality remains unchanged
- ✅ Proper multi-server architecture matching FastMCP design
- ✅ Cross-platform compatibility restored
- ✅ Command resolution works correctly for `npx`, `npm`, `node`, etc.
- ✅ Transport inference works correctly (no explicit transport fields needed)
- ✅ Both stdio and HTTP servers work in multi-server configs

## Testing
To verify the fix works:
1. Configure MCP servers in `config.json`:
   ```json
   {
     "mcpServers": {
       "filesystem": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
       },
       "context7": {
         "url": "https://mcp.context7.com/mcp",
         "headers": {"CONTEXT7_API_KEY": "your-key"}
       }
     }
   }
   ```
2. Run `a-coder-cli` on macOS
3. Verify connections succeed:
   ```
   ✓ Connected to MCP server: filesystem
   ✓ Connected to MCP server: context7
   ```

## Files Changed
- `a_coder_cli.py`:
  - Lines 46-50: Changed to single client architecture
  - Lines 138-184: Refactored `connect_mcp_servers()` method
  - Lines 186-217: Updated `list_mcp_tools()` for single client
  - Lines 219-236: Updated `call_mcp_tool()` for single client
  - Lines 630-673: Updated `build_tools_list()` for single client
  - Lines 687-696: Updated tool name parsing for FastMCP prefixes
  - Lines 1252-1318: Refactored `run()` method to collect and connect all servers at once
