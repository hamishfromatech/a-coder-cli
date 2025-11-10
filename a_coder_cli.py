#!/usr/bin/env python3
"""
A-Coder CLI - Terminal-based coding agent with natural conversation and MCP-based file operations
"""

import argparse
import asyncio
import json
import os
import sys
import logging
import platform
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Any
import mimetypes

from openai import AsyncOpenAI
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table
from rich.syntax import Syntax
from rich.markdown import Markdown
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.text import Text
from rich.box import ROUNDED, DOUBLE, HEAVY
from rich.align import Align
from fastmcp import Client as MCPClient
from config import ACoderConfig
import json
from dotenv import load_dotenv
from prompt_toolkit import PromptSession
from prompt_toolkit.history import InMemoryHistory

# Suppress MCP root-related warnings and logs
logging.getLogger('fastmcp').setLevel(logging.ERROR)
logging.getLogger('mcp').setLevel(logging.ERROR)

load_dotenv()


class ACoderCLI:
    """Terminal-based coding agent with MCP-based file operations"""
    
    def __init__(self, config=None):
        self.console = Console()
        self.openai_client = None
        self.mcp_clients: Dict[str, MCPClient] = {}
        self.conversation_history: List[Dict[str, str]] = []
        self.current_project_path = Path.cwd()
        self.config = config
        self.added_files: Dict[str, str] = {}
        self.read_only_files: set = set()
        self.prompt_session = PromptSession(history=InMemoryHistory())
        self.streaming_enabled = False  # Toggle for streaming responses

    async def async_prompt(self, message: str) -> str:
        """Async wrapper for prompt_toolkit prompt with Rich formatting"""
        import asyncio
        from prompt_toolkit.formatted_text import HTML
        
        # Convert Rich markup to plain text for prompt_toolkit
        # Just use a simple prompt without markup for prompt_toolkit
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: self.prompt_session.prompt("\nYou › "))

    def setup_openai(self, api_key: str, base_url: Optional[str] = None):
        """Initialize OpenAI client"""
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        self.openai_client = AsyncOpenAI(**client_kwargs)
    
    async def get_ollama_models(self) -> List[str]:
        """Fetch available models from Ollama"""
        try:
            if not self.config or not self.config.openai.base_url:
                return []
            
            base_url = self.config.openai.base_url
            tags_url = base_url.replace('/v1', '') + '/api/tags'
            
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(tags_url)
                if response.status_code == 200:
                    data = response.json()
                    models = [m['name'] for m in data.get('models', [])]
                    return sorted(models)
        except Exception as e:
            self.console.print(f"[yellow]Could not fetch Ollama models: {e}[/yellow]")
        return []
    
    async def switch_model(self, model_name: str) -> bool:
        """Switch to a different model"""
        if not self.config:
            self.console.print("[red]No config loaded[/red]")
            return False
        
        self.config.openai.model = model_name
        return True

    def _resolve_command_path(self, command: str) -> str:
        """Resolve command path, handling Windows-specific issues"""
        # On Windows, check for .cmd/.bat extensions
        if platform.system() == "Windows":
            # Try to find the command with common Windows extensions
            for ext in [".cmd", ".bat", ".exe", ""]:
                cmd_with_ext = command + ext
                resolved = shutil.which(cmd_with_ext)
                if resolved:
                    return resolved
            
            # If not found, try common npm/node paths
            if command in ["npx", "npm", "node"]:
                # Check common installation paths
                common_paths = [
                    os.path.expandvars(r"%APPDATA%\npm"),
                    os.path.expandvars(r"%ProgramFiles%\nodejs"),
                    os.path.expandvars(r"%ProgramFiles(x86)%\nodejs"),
                ]
                for base_path in common_paths:
                    for ext in [".cmd", ".bat", ".exe"]:
                        full_path = os.path.join(base_path, command + ext)
                        if os.path.exists(full_path):
                            return full_path
        else:
            # On Unix-like systems, use shutil.which
            resolved = shutil.which(command)
            if resolved:
                return resolved
        
        # Return original command if not found
        return command

    async def connect_mcp_server(self, name: str, server_config: Dict[str, Any]) -> bool:
        """Connect to an MCP server"""
        try:
            if not server_config:
                self.console.print(f"[bold red]✗[/bold red] [bright_white]No configuration for MCP server:[/bright_white] [bold]{name}[/bold]")
                return False
            
            # Resolve command path for Windows compatibility
            if isinstance(server_config, dict) and 'args' in server_config:
                args = server_config['args']
                if args and len(args) > 0:
                    # First arg is usually the command (e.g., 'npx')
                    original_cmd = args[0]
                    resolved_cmd = self._resolve_command_path(original_cmd)
                    if resolved_cmd != original_cmd:
                        server_config['args'] = [resolved_cmd] + args[1:]
                        self.console.print(f"[dim]  └─ Resolved {original_cmd} to {resolved_cmd}[/dim]")
            
            config_dict = {"mcpServers": {name: server_config}}
            client = MCPClient(config_dict)
            await client.__aenter__()
            self.mcp_clients[name] = client
            self.console.print(f"[bold green]✓[/bold green] [bright_white]Connected to MCP server:[/bright_white] [bold cyan]{name}[/bold cyan]")
            return True
        except FileNotFoundError as e:
            # Specific handling for command not found errors
            self.console.print(f"[bold red]✗[/bold red] [bright_white]Failed to connect to MCP server[/bright_white] [bold]{name}[/bold]")
            self.console.print(f"[yellow]  └─ Command not found: {e}[/yellow]")
            if platform.system() == "Windows":
                self.console.print(f"[dim]  └─ Tip: Ensure Node.js and npm are installed and in your PATH[/dim]")
                self.console.print(f"[dim]  └─ Try running 'npm install -g @modelcontextprotocol/server-filesystem'[/dim]")
            return False
        except Exception as e:
            error_msg = str(e)
            # Suppress non-critical warnings about roots not being supported
            if "List roots not supported" in error_msg or "-32600" in error_msg:
                return True
            self.console.print(f"[bold red]✗[/bold red] [bright_white]Failed to connect to MCP server[/bright_white] [bold]{name}[/bold]: [red]{e}[/red]")
            return False

    async def list_mcp_tools(self, server_name: str) -> List[Dict]:
        """List available tools from an MCP server"""
        if server_name not in self.mcp_clients:
            return []
        
        client = self.mcp_clients[server_name]
        try:
            tools = await client.list_tools()
            if tools is None:
                return []
            
            tool_list = []
            if isinstance(tools, list):
                tool_list = tools
            elif hasattr(tools, 'tools'):
                tool_list = tools.tools
            else:
                return []
            
            result = []
            for tool in tool_list:
                if hasattr(tool, 'model_dump'):
                    result.append(tool.model_dump())
                elif hasattr(tool, '__dict__'):
                    result.append(tool.__dict__)
                elif isinstance(tool, dict):
                    result.append(tool)
            return result
        except Exception as e:
            self.console.print(f"[yellow]Error listing tools from {server_name}: {e}[/yellow]")
            import traceback
            traceback.print_exc()
            return []

    async def call_mcp_tool(self, server_name: str, tool_name: str, arguments: Dict) -> Any:
        """Call a tool on an MCP server"""
        if server_name not in self.mcp_clients:
            raise ValueError(f"Server {server_name} not connected")
        
        client = self.mcp_clients[server_name]
        try:
            result = await client.call_tool(tool_name, arguments)
            return result
        except Exception as e:
            self.console.print(f"[red]Error calling tool {tool_name}: {e}[/red]")
            import traceback
            traceback.print_exc()
            raise

    def display_welcome_screen(self):
        """Display the welcome screen"""
        # Create a gradient-style header
        header = Text()
        header.append("\n  ╔═══════════════════════════════════════════════════════════╗\n", style="bold cyan")
        header.append("  ║                                                           ║\n", style="bold cyan")
        header.append("  ║  ", style="bold cyan")
        header.append("A-Coder CLI", style="bold white on blue")
        header.append("  ✨                                     ║\n", style="bold cyan")
        header.append("  ║  ", style="bold cyan")
        header.append("Your Premium AI Coding Assistant", style="italic bright_white")
        header.append("                 ║\n", style="bold cyan")
        header.append("  ║                                                           ║\n", style="bold cyan")
        header.append("  ╚═══════════════════════════════════════════════════════════╝\n", style="bold cyan")
        
        self.console.print(header)
        
        welcome_text = """
[bold bright_cyan]🚀 Quick Start[/bold bright_cyan]

[dim]Start chatting naturally or use commands to manage your workspace:[/dim]

[bold bright_magenta]📁 File Management[/bold bright_magenta]
  [cyan]•[/cyan] [bold]/add[/bold] [dim]<file>[/dim]        Add file to context (editable)
  [cyan]•[/cyan] [bold]/add-ro[/bold] [dim]<file>[/dim]     Add as read-only reference
  [cyan]•[/cyan] [bold]/files[/bold]              Show all added files
  [cyan]•[/cyan] [bold]/remove[/bold] [dim]<file>[/dim]     Remove from context
  [cyan]•[/cyan] [bold]/clear-files[/bold]        Clear all files

[bold bright_green]💬 Conversation[/bold bright_green]
  [green]•[/green] Just type naturally - the AI understands context
  [green]•[/green] Use [bold]↑/↓[/bold] arrow keys for command history

[bold bright_yellow]⚡ Quick Commands[/bold bright_yellow]
  [yellow]•[/yellow] [bold]/help[/bold]     Detailed guide
  [yellow]•[/yellow] [bold]/clear[/bold]    Clear screen
  [yellow]•[/yellow] [bold]/exit[/bold]     Quit application

[italic dim]Tip: Type /help for advanced features and MCP server commands[/italic dim]
        """
        
        panel = Panel(
            welcome_text,
            border_style="bright_cyan",
            box=ROUNDED,
            padding=(1, 2)
        )
        self.console.print(panel)
        self.console.print()

    def display_help(self):
        """Display detailed help information"""
        help_text = """
# A-Coder CLI - Complete Guide

## Natural Conversation

Simply type your request and the AI will respond. All added files are automatically included in the conversation context.

## File Management Commands

### Adding Files
- `/add <filepath>` - Add file to conversation (editable)
- `/add-ro <filepath>` - Add file as read-only reference
- `/files` - List all added files with their status

### Managing Files
- `/remove <filepath>` - Remove file from context
- `/clear-files` - Clear all added files

## File Operations via AI

All file operations are performed by chatting naturally with the AI, which uses MCP tools:

- **Edit files**: Ask "Edit file.py to add a new function"
- **Create files**: Ask "Create a new README.md file"
- **Search files**: Ask "Search for all TODO comments"
- **View file tree**: Ask "Show me the project structure"
- **Read files**: Ask "What's in the main.py file?"

## MCP Server Commands

- `/mcp-list` - List connected MCP servers
- `/mcp-tools <server>` - List tools from specific server
- `/mcp-call <server> <tool> [args]` - Call MCP tool directly

## Model Management (Ollama)

- `/models` - List available Ollama models
- `/switch-model <name>` - Switch to a different model

## Display Options

- `/stream` - Toggle streaming responses (on/off)

## Debugging

- `/export-tools` - Export available tools as JSON for debugging

## Tips

1. **Add context files first**: Use `/add` to include relevant files before asking questions
2. **Use read-only for reference**: Use `/add-ro` for files you don't want modified
3. **Let MCP handle file ops**: Don't manually edit files - let the AI use MCP tools
4. **Check file status**: Use `/files` to see what's in context
        """
        
        self.console.print(Panel(Markdown(help_text), title="Help", border_style="green"))

    async def handle_add_file(self, args: List[str], read_only: bool = False):
        """Add a file to conversation context"""
        if not args:
            self.console.print("[red]Usage: /add <filepath>[/red]")
            return
        
        filepath = " ".join(args)
        file_path = Path(filepath)
        
        if not file_path.exists():
            self.console.print(f"[red]File not found: {filepath}[/red]")
            return
        
        if not file_path.is_file():
            self.console.print(f"[red]Not a file: {filepath}[/red]")
            return
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = file_path.read_text()
            self.added_files[str(file_path)] = content
            if read_only:
                self.read_only_files.add(str(file_path))
            
            status_icon = "🔒" if read_only else "📝"
            status_text = "read-only" if read_only else "editable"
            self.console.print(f"[bold green]✓ Added[/bold green] [dim]│[/dim] {status_icon} [cyan]{filepath}[/cyan] [dim]({len(content):,} bytes, {status_text})[/dim]")
        except Exception as e:
            self.console.print(f"[red]Error reading file: {e}[/red]")

    async def handle_remove_file(self, args: List[str]):
        """Remove a file from conversation context"""
        if not args:
            self.console.print("[red]Usage: /remove <filepath>[/red]")
            return
        
        filepath = " ".join(args)
        if filepath in self.added_files:
            del self.added_files[filepath]
            self.read_only_files.discard(filepath)
            self.console.print(f"[bold green]✓ Removed[/bold green] [dim]│[/dim] [cyan]{filepath}[/cyan]")
        else:
            self.console.print(f"[yellow]⚠ File not in context:[/yellow] [dim]{filepath}[/dim]")

    def display_files(self):
        """Display currently added files"""
        if not self.added_files:
            self.console.print("\n[dim]📂 No files in context[/dim]\n")
            return
        
        table = Table(
            title="📂 Files in Context",
            border_style="bright_cyan",
            box=ROUNDED,
            show_header=True,
            header_style="bold bright_white"
        )
        table.add_column("File", style="cyan", no_wrap=False)
        table.add_column("Status", style="bright_magenta", justify="center")
        table.add_column("Size", style="bright_yellow", justify="right")
        
        for filepath in self.added_files.keys():
            status_icon = "🔒 read-only" if filepath in self.read_only_files else "📝 editable"
            size = len(self.added_files[filepath])
            size_str = f"{size:,} bytes" if size < 1024 else f"{size/1024:.1f} KB"
            table.add_row(filepath, status_icon, size_str)
        
        self.console.print("")
        self.console.print(table)
        self.console.print("")

    def build_system_prompt(self) -> str:
        """Build system prompt with file context"""
        system_prompt = """You are A-Coder, an expert coding assistant. You help developers write, debug, and improve code.

Key capabilities:
- Analyze and understand code
- Generate new code solutions
- Debug and fix issues
- Provide architectural guidance
- Suggest improvements and refactoring

IMPORTANT - Tool Usage:
- You have access to MCP tools for file operations and project exploration
- ALWAYS use available tools to explore the codebase, read files, and answer questions
- When asked about the codebase, use list_directory, read_file, and search_files tools
- For file modifications, use edit_file or write_file tools
- Never ask the user to manually perform file operations
- CRITICAL: When tools require a 'path' argument, use the current project path shown below
- NEVER make up or hallucinate information - if a tool fails, say so clearly

CRITICAL - Autonomous Execution:
- DO NOT STOP after gathering information - immediately proceed to execute the task
- When you explore/read files, IMMEDIATELY use that information to complete the user's request
- NEVER say "Now I'll create..." or "I'll use..." - JUST DO IT by calling the tools
- If a tool fails, immediately retry with corrected parameters - do not explain, just retry
- After reading/exploring, you MUST call write_file/edit_file tools to create/modify files
- Keep working until files are created/modified and the task is 100% complete
- You have up to 25 tool call iterations - use them all if needed
- Only provide a final text response AFTER all files have been created/modified

CRITICAL - File Exclusions:
- ALWAYS exclude these patterns when using directory_tree, search_files, or list operations:
  * config.json (A-Coder CLI configuration file)
  * .git/** (Git repository data)
  * node_modules/** (Node dependencies)
  * venv/** (Python virtual environment)
  * env/** (Python virtual environment)
  * .venv/** (Python virtual environment)
  * __pycache__/** (Python cache)
  * *.pyc (Python compiled files)
  * .env (Environment variables)
  * dist/** (Build artifacts)
  * build/** (Build artifacts)
  * *.egg-info/** (Python package metadata)
- Use the excludePatterns parameter in directory_tree and search_files tools
- DO NOT read, modify, or reference config.json in any operations

When the user asks you to:
1. Explore/analyze the codebase: Use list_directory and read_file tools with path="{project_path}"
2. Modify files: Use edit_file or write_file tools
3. Search for code: Use search_files tool with excludePatterns=["config.json", ".git/**", "node_modules/**", "venv/**", "env/**", ".venv/**", "__pycache__/**", "*.pyc", ".env", "dist/**", "build/**", "*.egg-info/**"]
4. Understand project structure: Use directory_tree with path="{project_path}" and excludePatterns=["config.json", ".git/**", "node_modules/**", "venv/**", "env/**", ".venv/**", "__pycache__/**", "*.pyc", ".env", "dist/**", "build/**", "*.egg-info/**"]

Current project path: {project_path}
IMPORTANT: Use this exact path when tools require a 'path' parameter!
""".format(project_path=self.current_project_path)
        
        if self.added_files:
            system_prompt += "\n## Files Currently in Context:\n"
            for filepath, content in self.added_files.items():
                status = "(read-only)" if filepath in self.read_only_files else "(editable)"
                size = len(content)
                system_prompt += f"- {filepath} {status} ({size} bytes)\n"
        
        return system_prompt

    def sanitize_json_schema(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize JSON schema to be compatible with llama.cpp's JSON schema converter.
        
        llama.cpp only supports a subset of JSON Schema features. This function removes
        unsupported fields that cause "Unrecognized schema" errors.
        
        Supported fields: type, properties, required, items, enum, minimum, maximum,
        minLength, maxLength, pattern, additionalProperties, anyOf, oneOf, allOf, $ref
        
        Unsupported fields to remove: default, title, description (at property level),
        examples, const, and other metadata fields
        """
        if not isinstance(schema, dict):
            return schema
        
        # Fields that llama.cpp supports
        supported_fields = {
            'type', 'properties', 'required', 'items', 'enum',
            'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
            'minLength', 'maxLength', 'minItems', 'maxItems',
            'pattern', 'additionalProperties',
            'anyOf', 'oneOf', 'allOf', '$ref'
        }
        
        # Create a new schema with only supported fields
        sanitized = {}
        
        for key, value in schema.items():
            if key in supported_fields:
                # Recursively sanitize nested schemas
                if key == 'properties' and isinstance(value, dict):
                    sanitized[key] = {k: self.sanitize_json_schema(v) for k, v in value.items()}
                elif key == 'items':
                    sanitized[key] = self.sanitize_json_schema(value)
                elif key in ('anyOf', 'oneOf', 'allOf') and isinstance(value, list):
                    sanitized[key] = [self.sanitize_json_schema(item) for item in value]
                elif key == 'additionalProperties' and isinstance(value, dict):
                    sanitized[key] = self.sanitize_json_schema(value)
                else:
                    sanitized[key] = value
        
        # If the sanitized schema is empty (only had unsupported fields),
        # return a minimal valid schema
        if not sanitized:
            return {"type": "object"}
        
        return sanitized

    async def build_tools_list(self) -> List[Dict[str, Any]]:
        """Build list of available MCP tools for function calling"""
        tools = []
        
        if not self.mcp_clients:
            return tools
        
        for server_name, client in self.mcp_clients.items():
            try:
                mcp_tools = await self.list_mcp_tools(server_name)
                
                if not mcp_tools:
                    continue
                
                for tool in mcp_tools:
                    try:
                        if not isinstance(tool, dict):
                            self.console.print(f"[yellow]Tool is not a dict: {type(tool)}[/yellow]")
                            continue
                        
                        tool_name = tool.get('name')
                        if not tool_name:
                            continue
                        
                        # Get and sanitize the input schema for llama.cpp compatibility
                        input_schema = tool.get('inputSchema', {})
                        sanitized_schema = self.sanitize_json_schema(input_schema)
                        
                        # Format tool for OpenAI with server prefix
                        formatted_tool = {
                            "type": "function",
                            "function": {
                                "name": f"{server_name}--{tool_name}",
                                "description": tool.get('description', ''),
                                "parameters": sanitized_schema
                            }
                        }
                        tools.append(formatted_tool)
                    except Exception as e:
                        self.console.print(f"[yellow]Error formatting tool: {e}[/yellow]")
                        continue
            except Exception as e:
                self.console.print(f"[yellow]Error getting tools from {server_name}: {e}[/yellow]")
                continue
        
        return tools

    async def process_tool_calls(self, response) -> List[Dict]:
        """Process tool calls from AI response"""
        tool_results = []
        choice = response.choices[0]
        
        if not hasattr(choice.message, 'tool_calls') or not choice.message.tool_calls:
            return tool_results
        
        for tool_call in choice.message.tool_calls:
            try:
                tool_name = tool_call.function.name
                
                # Handle tool names without server prefix by searching for them
                if '--' not in tool_name:
                    self.console.print(f"[yellow]Tool name missing prefix: {tool_name}, searching...[/yellow]")
                    # Try to find which server has this tool
                    found = False
                    for srv in self.mcp_clients.keys():
                        srv_tools = await self.list_mcp_tools(srv)
                        for t in srv_tools:
                            if t.get('name') == tool_name:
                                server_name = srv
                                actual_tool = tool_name
                                found = True
                                self.console.print(f"[green]Found tool '{tool_name}' in server '{srv}'[/green]")
                                break
                        if found:
                            break
                    if not found:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_call.id,
                            "content": f"Error: Could not find tool '{tool_name}' in any server"
                        })
                        continue
                else:
                    # Split on double dash separator
                    parts = tool_name.split('--', 1)
                    if len(parts) == 2:
                        server_name, actual_tool = parts
                    else:
                        # Fallback: try first server
                        server_name = list(self.mcp_clients.keys())[0]
                        actual_tool = tool_name
                
                
                try:
                    if tool_call.function.arguments:
                        args = json.loads(tool_call.function.arguments)
                        # Handle nested JSON strings in arguments
                        for key, value in args.items():
                            if isinstance(value, str) and (value.startswith('[') or value.startswith('{')):
                                try:
                                    args[key] = json.loads(value)
                                except:
                                    pass  # Keep as string if not valid JSON
                    else:
                        args = {}
                except (json.JSONDecodeError, TypeError) as e:
                    args = {}
                    self.console.print(f"[yellow]Could not parse tool args: {tool_call.function.arguments} - {e}[/yellow]")
                
                # Block access to sensitive files
                blocked_files = ['config.json', '.env']
                path_arg = args.get('path', '')
                if path_arg:
                    # Check if path contains any blocked file
                    if any(blocked in path_arg for blocked in blocked_files):
                        error_msg = f"Access denied: Cannot read or modify '{path_arg}' - this is a sensitive configuration file"
                        self.console.print(f"[bold red]✗ Access Denied[/bold red] [dim]│[/dim] [yellow]{path_arg}[/yellow] [dim]is protected[/dim]")
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_call.id,
                            "content": error_msg
                        })
                        continue
                
                if args:
                    self.console.print(f"[dim]  ├─[/dim] [bold cyan]{server_name}[/bold cyan][dim].[/dim][bright_white]{actual_tool}[/bright_white] [dim]{args}[/dim]")
                else:
                    self.console.print(f"[dim]  ├─[/dim] [bold cyan]{server_name}[/bold cyan][dim].[/dim][bright_white]{actual_tool}[/bright_white]")
                result = await self.call_mcp_tool(server_name, actual_tool, args)
                
                try:
                    if result is None:
                        result_str = ""
                    elif isinstance(result, dict):
                        result_str = json.dumps(result)
                    elif isinstance(result, str):
                        result_str = result
                    else:
                        result_str = str(result)
                except Exception as e:
                    self.console.print(f"[yellow]Could not serialize result: {e}[/yellow]")
                    result_str = str(result) if result else ""
                
                # Truncate very large results to avoid API errors
                MAX_RESULT_SIZE = 50000  # 50k chars max
                if len(result_str) > MAX_RESULT_SIZE:
                    self.console.print(f"[yellow]Result too large ({len(result_str)} chars), truncating to {MAX_RESULT_SIZE}[/yellow]")
                    result_str = result_str[:MAX_RESULT_SIZE] + f"\n\n... (truncated {len(result_str) - MAX_RESULT_SIZE} chars)"
                
                if result_str:
                    self.console.print(f"[dim]  └─ Result: {len(result_str)} chars[/dim]")
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_call.id,
                    "content": result_str if result_str else "(empty result)"
                })
            except Exception as e:
                self.console.print(f"[red]✗ Tool error: {str(e)}[/red]")
                import traceback
                traceback.print_exc()
                # Add error as a tool result so AI knows what happened
                error_msg = f"Tool '{tool_call.function.name}' failed with error: {str(e)}"
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_call.id,
                    "content": error_msg
                })
        
        return tool_results if tool_results else None

    async def chat_with_ai(self, user_message: str) -> str:
        """Send a message to the AI and get a response with tool calling support"""
        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })
        
        # Build tools list from MCP servers
        tools = await self.build_tools_list()
        
        # Make initial API call
        response = await self.openai_client.chat.completions.create(
            model=self.config.openai.model if self.config else "gpt-4",
            messages=[
                {"role": "system", "content": self.build_system_prompt()}
            ] + self.conversation_history,
            tools=tools if tools else None,
            tool_choice="auto" if tools else None,
            max_tokens=4000,
            temperature=0.7,
            timeout=300.0,
            stream=False  # Don't stream during tool calling phase
        )
        
        # Handle tool calling loop
        MAX_ITERATIONS = 25
        iteration = 0
        auto_continue_count = 0
        MAX_AUTO_CONTINUES = 3
        
        while iteration < MAX_ITERATIONS:
            # Check if this response has tool calls
            if not (hasattr(response.choices[0].message, 'tool_calls') and response.choices[0].message.tool_calls):
                # No tool calls - check if we should auto-continue
                response_text = response.choices[0].message.content or ""
                
                # Detect if AI is planning to do more work (intent indicators)
                intent_indicators = [
                    "now i'll", "i'll now", "let me now", "i will now",
                    "now let me", "i'll create", "i'll build", "i'll add",
                    "i'll write", "i'll modify", "i'll update", "i'll use",
                    "next, i'll", "first, i'll", "i need to", "i should",
                    "going to create", "going to build", "going to add"
                ]
                
                # Auto-continue if:
                # 1. Response has intent indicators, OR
                # 2. Response is empty/null after tool execution (likely incomplete)
                has_intent = any(indicator in response_text.lower() for indicator in intent_indicators)
                is_empty_after_tools = (iteration > 0 and len(response_text.strip()) == 0)
                
                should_auto_continue = (
                    auto_continue_count < MAX_AUTO_CONTINUES and
                    (has_intent or is_empty_after_tools)
                )
                
                if should_auto_continue:
                    auto_continue_count += 1
                    reason = "incomplete task" if is_empty_after_tools else "detected intent to act"
                    self.console.print(f"[dim]  └─ Auto-continuing ({reason})[/dim]")
                    
                    # Add the response to history and prompt for action
                    self.conversation_history.append({
                        "role": "assistant",
                        "content": response_text
                    })
                    
                    # Add a system nudge to proceed with the action
                    self.conversation_history.append({
                        "role": "user",
                        "content": "Proceed with the action you just described. Use the appropriate tools now."
                    })
                    
                    # Continue the loop to get next response
                    if self.streaming_enabled:
                        with Progress(
                            SpinnerColumn("dots", style="cyan"),
                            TextColumn("[bold bright_cyan]Auto-continuing...[/bold bright_cyan]"),
                            console=self.console,
                            transient=True
                        ) as progress:
                            progress.add_task("", total=None)
                            response = await self.openai_client.chat.completions.create(
                                model=self.config.openai.model if self.config else "gpt-4",
                                messages=[
                                    {"role": "system", "content": self.build_system_prompt()}
                                ] + self.conversation_history,
                                tools=tools if tools else None,
                                tool_choice="auto" if tools else None,
                                max_tokens=4000,
                                temperature=0.7,
                                timeout=300.0,
                                stream=False
                            )
                    else:
                        response = await self.openai_client.chat.completions.create(
                            model=self.config.openai.model if self.config else "gpt-4",
                            messages=[
                                {"role": "system", "content": self.build_system_prompt()}
                            ] + self.conversation_history,
                            tools=tools if tools else None,
                            tool_choice="auto" if tools else None,
                            max_tokens=4000,
                            temperature=0.7,
                            timeout=300.0,
                            stream=False
                        )
                    continue
                else:
                    # No tool calls and no intent to continue - this is the final response
                    break
            
            iteration += 1
            tool_calls = response.choices[0].message.tool_calls
            tool_names_str = ', '.join([tc.function.name for tc in tool_calls])
            
            # Display "about to act" message if AI provided reasoning
            if response.choices[0].message.content:
                self.console.print(f"\n[bold bright_magenta]🎯 Plan[/bold bright_magenta] [dim]│[/dim] [italic bright_white]{response.choices[0].message.content}[/italic bright_white]")
            
            self.console.print(f"[bold bright_blue]→ Step {iteration}[/bold bright_blue] [dim]│[/dim] [bright_white]AI called {len(tool_calls)} tool(s):[/bright_white] [bold cyan]{tool_names_str}[/bold cyan]")
            
            # Add assistant message with tool calls
            self.conversation_history.append({
                "role": "assistant",
                "content": response.choices[0].message.content or "",
                "tool_calls": response.choices[0].message.tool_calls
            })
            
            # Process tool calls
            tool_results = await self.process_tool_calls(response)
            self.console.print(f"[dim]  └─ Received {len(tool_results) if tool_results else 0} tool results[/dim]")
            
            if tool_results:
                # Add tool results to history in OpenAI format
                for result in tool_results:
                    content = result.get("content", "")
                    if not content:
                        content = "(empty result)"
                    self.conversation_history.append({
                        "role": "tool",
                        "tool_call_id": result.get("tool_use_id"),
                        "content": content
                    })
            
            # Continue the conversation - let AI decide if it needs more tools or can respond
            # Show loading indicator while waiting for next response
            if self.streaming_enabled:
                with Progress(
                    SpinnerColumn("dots", style="cyan"),
                    TextColumn("[bold bright_cyan]Processing...[/bold bright_cyan]"),
                    console=self.console,
                    transient=True
                ) as progress:
                    progress.add_task("", total=None)
                    response = await self.openai_client.chat.completions.create(
                        model=self.config.openai.model if self.config else "gpt-4",
                        messages=[
                            {"role": "system", "content": self.build_system_prompt()}
                        ] + self.conversation_history,
                        tools=tools if tools else None,
                        tool_choice="auto" if tools else None,
                        max_tokens=4000,
                        temperature=0.7,
                        timeout=300.0,
                        stream=False  # Don't stream during tool calling
                    )
            else:
                response = await self.openai_client.chat.completions.create(
                    model=self.config.openai.model if self.config else "gpt-4",
                    messages=[
                        {"role": "system", "content": self.build_system_prompt()}
                    ] + self.conversation_history,
                    tools=tools if tools else None,
                    tool_choice="auto" if tools else None,
                    max_tokens=4000,
                    temperature=0.7,
                    timeout=300.0,
                    stream=False  # Don't stream during tool calling
                )
        
        # After the loop, we have a final response (or hit max iterations)
        if iteration > 0:
            self.console.print(f"\n[bold green]✓ Completed[/bold green] [dim]│[/dim] [bright_white]{iteration} step(s)[/bright_white]\n")
        
        # If streaming is enabled, stream the final response
        if self.streaming_enabled:
            from rich.live import Live
            from rich.text import Text
            
            # Show brief loading indicator before streaming starts
            with Progress(
                SpinnerColumn("dots", style="cyan"),
                TextColumn("[bold bright_cyan]Generating response...[/bold bright_cyan]"),
                console=self.console,
                transient=True
            ) as progress:
                progress.add_task("", total=None)
                # Re-request with streaming for the final response
                stream = await self.openai_client.chat.completions.create(
                    model=self.config.openai.model if self.config else "gpt-4",
                    messages=[
                        {"role": "system", "content": self.build_system_prompt()}
                    ] + self.conversation_history,
                    max_tokens=4000,
                    temperature=0.7,
                    timeout=300.0,
                    stream=True
                )
            
            # Stream the response into a live-updating panel
            assistant_message = ""
            self.console.print()
            
            with Live(
                Panel(
                    Text("⋯", style="dim"),
                    title="[bold bright_white]🤖 A-Coder[/bold bright_white]",
                    border_style="bright_green",
                    box=ROUNDED,
                    padding=(1, 2)
                ),
                console=self.console,
                refresh_per_second=10
            ) as live:
                async for chunk in stream:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        assistant_message += content
                        # Update the live panel with accumulated text
                        live.update(
                            Panel(
                                Markdown(assistant_message),
                                title="[bold bright_white]🤖 A-Coder[/bold bright_white]",
                                border_style="bright_green",
                                box=ROUNDED,
                                padding=(1, 2)
                            )
                        )
            
            self.console.print()  # New line after streaming
        else:
            # Get final message (non-streaming)
            assistant_message = response.choices[0].message.content or "(no response)"
        
        self.conversation_history.append({
            "role": "assistant",
            "content": assistant_message
        })
        
        return assistant_message

    async def run_interactive_mode(self):
        """Run the interactive conversation loop"""
        self.display_welcome_screen()
        
        while True:
            try:
                user_input = await self.async_prompt("")  # Message is now in the method itself
                
                if not user_input.strip():
                    continue
                
                # Handle commands
                if user_input.startswith('/'):
                    parts = user_input.strip().split(maxsplit=1)
                    cmd = parts[0].lower().strip()
                    args = parts[1].split() if len(parts) > 1 else []
                    
                    if cmd in ['/exit', '/quit']:
                        self.console.print("\n[bold bright_cyan]👋 Thanks for using A-Coder![/bold bright_cyan]\n")
                        break
                    elif cmd == '/help':
                        self.console.clear()
                        self.display_help()
                    elif cmd == '/clear':
                        self.console.clear()
                        self.display_welcome_screen()
                    elif cmd == '/add':
                        await self.handle_add_file(args, read_only=False)
                    elif cmd == '/add-ro':
                        await self.handle_add_file(args, read_only=True)
                    elif cmd == '/remove':
                        await self.handle_remove_file(args)
                    elif cmd == '/files':
                        self.console.print()
                        self.display_files()
                    elif cmd == '/clear-files':
                        count = len(self.added_files)
                        self.added_files.clear()
                        self.read_only_files.clear()
                        self.console.print(f"[bold green]✓ Cleared[/bold green] [dim]│[/dim] [bright_white]{count} file(s) removed from context[/bright_white]")
                    elif cmd == '/mcp-list':
                        if self.mcp_clients:
                            self.console.print("\n[bold bright_cyan]🔌 Connected MCP Servers[/bold bright_cyan]")
                            for i, name in enumerate(self.mcp_clients.keys(), 1):
                                self.console.print(f"  [dim]{i}.[/dim] [bold cyan]{name}[/bold cyan]")
                            self.console.print()
                        else:
                            self.console.print("[yellow]⚠ No MCP servers connected[/yellow]")
                    elif cmd == '/mcp-tools':
                        if not args:
                            self.console.print("[red]Usage: /mcp-tools <server_name>[/red]")
                            continue
                        server_name = args[0]
                        self.console.print(f"[cyan]Fetching tools from {server_name}...[/cyan]")
                        tools = await self.list_mcp_tools(server_name)
                        self.console.print(f"[dim]Got {len(tools)} tools[/dim]")
                        if tools:
                            table = Table(
                                title=f"🛠️  Tools from {server_name}",
                                border_style="bright_cyan",
                                box=ROUNDED,
                                show_header=True,
                                header_style="bold bright_white"
                            )
                            table.add_column("Tool Name", style="bold cyan", no_wrap=False)
                            table.add_column("Description", style="bright_white", no_wrap=False)
                            for tool in tools:
                                table.add_row(
                                    tool.get('name', 'Unknown'),
                                    tool.get('description', 'No description')
                                )
                            self.console.print("")
                            self.console.print(table)
                            self.console.print()
                        else:
                            self.console.print(f"[yellow]⚠ No tools available from {server_name}[/yellow]")
                    elif cmd == '/mcp-call':
                        if len(args) < 2:
                            self.console.print("[red]Usage: /mcp-call <server> <tool> [args][/red]")
                            continue
                        server = args[0]
                        tool = args[1]
                        tool_args = {}
                        if len(args) > 2:
                            try:
                                tool_args = json.loads(" ".join(args[2:]))
                            except json.JSONDecodeError:
                                self.console.print("[red]Tool arguments must be valid JSON[/red]")
                                continue
                        try:
                            result = await self.call_mcp_tool(server, tool, tool_args)
                            self.console.print(Panel(
                                json.dumps(result, indent=2),
                                title=f"Tool Result: {tool}"
                            ))
                        except Exception as e:
                            self.console.print(f"[red]Error: {e}[/red]")
                    elif cmd == '/models':
                        models = await self.get_ollama_models()
                        if models:
                            self.console.print("\n[bold bright_cyan]🤖 Available Ollama Models[/bold bright_cyan]\n")
                            current_model = self.config.openai.model if self.config else "unknown"
                            for i, model in enumerate(models, 1):
                                if model == current_model:
                                    self.console.print(f"  [bold green]✓[/bold green] [bold cyan]{model}[/bold cyan] [dim](current)[/dim]")
                                else:
                                    self.console.print(f"  [dim]{i}.[/dim] [cyan]{model}[/cyan]")
                            self.console.print()
                        else:
                            self.console.print("[yellow]⚠ No models available or could not connect to Ollama[/yellow]")
                    elif cmd == '/switch-model':
                        if not args:
                            self.console.print("[red]Usage: /switch-model <model_name>[/red]")
                            models = await self.get_ollama_models()
                            if models:
                                self.console.print("[cyan]Available models:[/cyan]")
                                for model in models:
                                    self.console.print(f"  - {model}")
                            else:
                                self.console.print("[yellow]Could not fetch models[/yellow]")
                            continue
                        model_name = " ".join(args)
                        success = await self.switch_model(model_name)
                        if success:
                            self.console.print(f"[bold green]✓ Switched[/bold green] [dim]│[/dim] [bright_white]Now using:[/bright_white] [bold cyan]{model_name}[/bold cyan]")
                    elif cmd == '/stream':
                        self.streaming_enabled = not self.streaming_enabled
                        status = "enabled" if self.streaming_enabled else "disabled"
                        icon = "🌊" if self.streaming_enabled else "📄"
                        self.console.print(f"[bold green]✓ Streaming {status}[/bold green] [dim]│[/dim] {icon} [bright_white]Responses will be {status}[/bright_white]")
                    elif cmd == '/export-tools':
                        self.console.print("[cyan]Fetching tools from MCP servers...[/cyan]")
                        for server_name in self.mcp_clients.keys():
                            raw_tools = await self.list_mcp_tools(server_name)
                            self.console.print(f"\n[cyan]{server_name}:[/cyan]")
                            self.console.print(f"  Raw tools count: {len(raw_tools)}")
                            if raw_tools:
                                try:
                                    sample_json = json.dumps(raw_tools[:1], indent=2)
                                    self.console.print(Panel(
                                        Syntax(sample_json, "json", theme="monokai", line_numbers=True),
                                        title=f"Sample from {server_name}",
                                        border_style="cyan"
                                    ))
                                except Exception as e:
                                    self.console.print(f"[yellow]Could not serialize tools: {e}[/yellow]")
                        
                        tools = await self.build_tools_list()
                        self.console.print(f"\n[cyan]Formatted tools for OpenAI:[/cyan]")
                        try:
                            tools_json = json.dumps(tools, indent=2)
                            self.console.print(Panel(
                                Syntax(tools_json, "json", theme="monokai", line_numbers=True),
                                title="Available Tools (JSON)",
                                border_style="cyan"
                            ))
                        except Exception as e:
                            self.console.print(f"[red]Error serializing tools: {e}[/red]")
                    else:
                        self.console.print(f"[bold red]✗ Unknown command:[/bold red] [yellow]{cmd}[/yellow]")
                        self.console.print("[dim]Type [bold]/help[/bold] to see all available commands[/dim]")
                else:
                    # Natural conversation (not a command)
                    # Only show spinner if streaming is disabled (streaming has its own live display)
                    if not self.streaming_enabled:
                        with Progress(
                            SpinnerColumn("dots", style="cyan"),
                            TextColumn("[bold bright_cyan]Thinking...[/bold bright_cyan]"),
                            console=self.console,
                            transient=True
                        ) as progress:
                            progress.add_task("", total=None)
                            try:
                                response = await self.chat_with_ai(user_input)
                            except Exception as e:
                                self.console.print(f"[bold red]✗ Error[/bold red] [dim]│[/dim] {e}")
                                continue
                    else:
                        try:
                            response = await self.chat_with_ai(user_input)
                        except Exception as e:
                            self.console.print(f"[bold red]✗ Error[/bold red] [dim]│[/dim] {e}")
                            continue
                    
                    # Display AI response with premium styling (streaming handles its own panel)
                    if not self.streaming_enabled:
                        self.console.print()
                        response_panel = Panel(
                            Markdown(response),
                            title="[bold bright_white]🤖 A-Coder[/bold bright_white]",
                            border_style="bright_green",
                            box=ROUNDED,
                            padding=(1, 2)
                        )
                        self.console.print(response_panel)
                        self.console.print()
                    else:
                        # Streaming already displayed the response in a live panel
                        pass
            
            except KeyboardInterrupt:
                self.console.print("\n[yellow]Use '/exit' or '/quit' to leave[/yellow]")
            except Exception as e:
                self.console.print(f"[red]Error: {e}[/red]")
                import traceback
                traceback.print_exc()

    async def run(self, args):
        """Main entry point"""
        if args.openai_key:
            self.setup_openai(args.openai_key)
        elif self.config and self.config.openai.api_key:
            self.setup_openai(self.config.openai.api_key, self.config.openai.base_url)
        else:
            self.console.print("[red]Error: OpenAI API key not configured[/red]")
            return
        
        # Connect to MCP servers from config
        if self.config and self.config.mcp.servers:
            self.console.print(f"\n[bold bright_cyan]🔌 Connecting to {len(self.config.mcp.servers)} MCP server(s)...[/bold bright_cyan]\n")
            for name, server_config in self.config.mcp.servers.items():
                # Auto-fill project path for filesystem servers
                if isinstance(server_config, dict) and 'args' in server_config:
                    server_args = server_config['args']
                    # Check if this is a filesystem server and needs path configuration
                    if any('server-filesystem' in str(arg) for arg in server_args):
                        # Replace placeholder path with current working directory
                        new_args = [
                            os.getcwd() if arg == '/path/to/your/project' else arg
                            for arg in server_args
                        ]
                        
                        # If no path was provided, append current directory
                        has_path = any(
                            arg not in ['-y', '@modelcontextprotocol/server-filesystem'] and not arg.startswith('-')
                            for arg in new_args
                        )
                        if not has_path:
                            new_args.append(os.getcwd())
                        
                        server_config['args'] = new_args
                        self.console.print(f"[dim]  └─ Auto-configured with path: {os.getcwd()}[/dim]")
                
                await self.connect_mcp_server(name, server_config)
        else:
            self.console.print("[yellow]No MCP servers configured[/yellow]")
        
        # Connect to any specified MCP servers via command line
        if args.mcp_servers:
            for server_config in args.mcp_servers:
                try:
                    name, config_str = server_config.split('=', 1)
                    try:
                        config = json.loads(config_str)
                    except json.JSONDecodeError:
                        config = config_str
                    await self.connect_mcp_server(name, config)
                except ValueError as e:
                    self.console.print(f"[red]Invalid MCP server format {server_config}: {e}[/red]")
                except Exception as e:
                    self.console.print(f"[red]Error connecting to MCP server: {e}[/red]")
        
        # Show connection summary
        if self.mcp_clients:
            self.console.print(f"[green]Ready! Connected to {len(self.mcp_clients)} MCP server(s)[/green]\n")
        else:
            self.console.print("[yellow]Warning: No MCP servers connected. File operations will not be available.\n[/yellow]")
        
        # Run interactive mode
        await self.run_interactive_mode()
        
        # Cleanup MCP connections
        for name, client in self.mcp_clients.items():
            try:
                await client.close()
            except Exception as e:
                self.console.print(f"[yellow]Warning: Failed to disconnect from {name}: {e}[/yellow]")


async def async_main():
    """Async main function"""
    parser = argparse.ArgumentParser(
        description='A-Coder CLI - Terminal-based coding agent with MCP integration'
    )
    parser.add_argument('--openai-key', help='OpenAI API key')
    parser.add_argument('--config', help='Path to config.json file')
    parser.add_argument('--mcp-servers', nargs='*', help='MCP servers (format: name=config)')
    
    args = parser.parse_args()
    
    # Load configuration
    config_obj = None
    try:
        env_config_path = (
            os.getenv("A_CODER_CONFIG_PATH")
            or os.getenv("ACODER_CONFIG_PATH")
            or os.getenv("ACODER_CONFIG")
        )

        if args.config:
            config_obj = ACoderConfig.from_config_file(args.config)
        elif env_config_path:
            resolved_path = Path(os.path.expanduser(env_config_path)).resolve()
            if resolved_path.exists():
                config_obj = ACoderConfig.from_config_file(str(resolved_path))
            else:
                print(
                    "Warning: configured ACoder config path points to missing file:"
                    f" {resolved_path}"
                )
                config_obj = ACoderConfig.load_default_config()
        else:
            config_path = Path("config.json")
            if config_path.exists():
                config_obj = ACoderConfig.from_config_file(str(config_path))
            else:
                config_obj = ACoderConfig.load_default_config()
    except Exception as e:
        print(f"Warning: Error loading config: {e}")
        config_obj = ACoderConfig()
    
    # Override OpenAI key if provided
    if args.openai_key:
        config_obj.openai.api_key = args.openai_key
    
    # Ensure we have an API key
    if not config_obj.openai.api_key:
        print("[red]Error: OpenAI API key not found. Set OPENAI_API_KEY or provide --openai-key[/red]")
        return
    
    app = ACoderCLI(config=config_obj)
    await app.run(args)


def main():
    """Synchronous entry point for setuptools"""
    asyncio.run(async_main())


if __name__ == '__main__':
    main()
