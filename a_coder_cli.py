#!/usr/bin/env python3
"""
A-Coder CLI - Terminal-based coding agent with natural conversation and MCP-based file operations
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any

from openai import AsyncOpenAI
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table
from rich.syntax import Syntax
from rich.markdown import Markdown
from fastmcp import Client as MCPClient
from config import ACoderConfig
from dotenv import load_dotenv

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

    def setup_openai(self, api_key: str, base_url: Optional[str] = None):
        """Initialize OpenAI client"""
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        self.openai_client = AsyncOpenAI(**client_kwargs)

    async def connect_mcp_server(self, name: str, server_config: Dict[str, Any]) -> bool:
        """Connect to an MCP server"""
        try:
            if not server_config:
                self.console.print(f"[red]✗[/red] No configuration for MCP server: {name}")
                return False
            
            config_dict = {"mcpServers": {name: server_config}}
            client = MCPClient(config_dict)
            await client.__aenter__()
            self.mcp_clients[name] = client
            self.console.print(f"[green]✓[/green] Connected to MCP server: {name}")
            return True
        except Exception as e:
            self.console.print(f"[red]✗[/red] Failed to connect to MCP server {name}: {e}")
            return False

    async def list_mcp_tools(self, server_name: str) -> List[Dict]:
        """List available tools from an MCP server"""
        if server_name not in self.mcp_clients:
            return []
        
        client = self.mcp_clients[server_name]
        try:
            tools = await client.list_tools()
            if isinstance(tools, list):
                return tools
            return []
        except Exception as e:
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
            raise

    def display_welcome_screen(self):
        """Display the welcome screen"""
        welcome_text = """
# A-Coder CLI

**Your AI-powered coding assistant with MCP server integration**

Start chatting naturally! Use commands to manage files:

**File Management** (via MCP):
- `/add <file>` - Add file to conversation context
- `/add-ro <file>` - Add file as read-only reference
- `/files` - Show added files
- `/remove <file>` - Remove file from context
- `/clear-files` - Clear all added files

**Conversation**:
- Just type naturally to chat with the AI
- Files are automatically included in context

**General**:
- `/help` - Show detailed help
- `/clear` - Clear screen
- `/exit` or `/quit` - Exit application
        """
        
        self.console.print(Panel(Markdown(welcome_text), title="Welcome", border_style="blue"))

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

## File Operations

All file operations (read, write, edit, create, delete) are performed through MCP servers:

- **Edit files**: Use `/edit` or ask the AI to modify files
- **Create files**: Ask the AI to create new files
- **Search files**: Use `/search <pattern>` to find files
- **View file tree**: Use `/tree` to see project structure

## MCP Server Commands

- `/mcp-list` - List connected MCP servers
- `/mcp-tools <server>` - List tools from specific server
- `/mcp-call <server> <tool> [args]` - Call MCP tool directly

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
                content = f.read()
            
            self.added_files[filepath] = content
            if read_only:
                self.read_only_files.add(filepath)
                self.console.print(f"[green]✓[/green] Added {filepath} (read-only)")
            else:
                self.console.print(f"[green]✓[/green] Added {filepath}")
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
            self.console.print(f"[green]✓[/green] Removed {filepath}")
        else:
            self.console.print(f"[yellow]File not in context: {filepath}[/yellow]")

    def display_added_files(self):
        """Display all added files"""
        if not self.added_files:
            self.console.print("[yellow]No files added to context[/yellow]")
            return
        
        table = Table(title="Added Files")
        table.add_column("File", style="cyan")
        table.add_column("Status", style="green")
        table.add_column("Size", style="yellow")
        
        for filepath, content in self.added_files.items():
            status = "read-only" if filepath in self.read_only_files else "editable"
            size = f"{len(content)} bytes"
            table.add_row(filepath, status, size)
        
        self.console.print(table)

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

When the user asks you to:
1. Explore/analyze the codebase: Use list_directory and read_file tools
2. Modify files: Use edit_file or write_file tools
3. Search for code: Use search_files tool
4. Understand project structure: Use list_directory with appropriate paths

Current project path: {project_path}
""".format(project_path=self.current_project_path)
        
        if self.added_files:
            system_prompt += "\n## Files Currently in Context:\n"
            for filepath, content in self.added_files.items():
                status = "(read-only)" if filepath in self.read_only_files else "(editable)"
                size = len(content)
                system_prompt += f"- {filepath} {status} ({size} bytes)\n"
        
        return system_prompt

    def build_tools_list(self) -> List[Dict[str, Any]]:
        """Build list of available MCP tools for function calling"""
        tools = []
        
        for server_name, client in self.mcp_clients.items():
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                mcp_tools = loop.run_until_complete(self.list_mcp_tools(server_name))
                
                for tool in mcp_tools:
                    params = tool.get('parameters', {})
                    if isinstance(params, dict) and 'properties' not in params:
                        params = {"type": "object", "properties": params}
                    
                    tool_def = {
                        "type": "function",
                        "function": {
                            "name": f"{server_name}__{tool.get('name', 'unknown')}",
                            "description": tool.get('description', 'No description'),
                            "parameters": params if params else {"type": "object", "properties": {}}
                        }
                    }
                    tools.append(tool_def)
            except Exception as e:
                pass
        
        return tools

    async def process_tool_calls(self, response) -> Optional[str]:
        """Process tool calls from AI response"""
        if not hasattr(response, 'choices') or not response.choices:
            return None
        
        choice = response.choices[0]
        if not hasattr(choice.message, 'tool_calls') or not choice.message.tool_calls:
            return None
        
        tool_results = []
        
        for tool_call in choice.message.tool_calls:
            try:
                # Parse tool name: "server__tool_name"
                tool_name = tool_call.function.name
                if '__' not in tool_name:
                    continue
                
                server_name, actual_tool = tool_name.split('__', 1)
                
                if server_name not in self.mcp_clients:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_call.id,
                        "content": f"Server {server_name} not connected"
                    })
                    continue
                
                # Parse arguments
                import json
                args = json.loads(tool_call.function.arguments)
                
                # Call the tool
                self.console.print(f"[cyan]Calling {server_name}.{actual_tool}...[/cyan]")
                result = await self.call_mcp_tool(server_name, actual_tool, args)
                
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_call.id,
                    "content": json.dumps(result) if not isinstance(result, str) else result
                })
            except Exception as e:
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_call.id,
                    "content": f"Error: {str(e)}"
                })
        
        return tool_results if tool_results else None

    async def chat_with_ai(self, user_message: str) -> str:
        """Send message to AI and get response with tool calling"""
        if not self.openai_client:
            raise ValueError("OpenAI client not initialized")
        
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })
        
        try:
            # Get available tools
            tools = self.build_tools_list()
            
            # First request with tools
            response = await self.openai_client.chat.completions.create(
                model=self.config.openai.model if self.config else "gpt-4",
                messages=[
                    {"role": "system", "content": self.build_system_prompt()}
                ] + self.conversation_history,
                tools=tools if tools else None,
                tool_choice="auto" if tools else None,
                max_tokens=4000,
                temperature=0.7,
                timeout=30.0
            )
            
            # Process tool calls if any
            if response.choices[0].message.tool_calls:
                # Add assistant message with tool calls
                self.conversation_history.append({
                    "role": "assistant",
                    "content": response.choices[0].message.content or "",
                    "tool_calls": response.choices[0].message.tool_calls
                })
                
                # Process the tool calls
                tool_results = await self.process_tool_calls(response)
                
                if tool_results:
                    # Add tool results to history
                    for result in tool_results:
                        self.conversation_history.append({
                            "role": "user",
                            "content": result["content"],
                            "tool_use_id": result.get("tool_use_id")
                        })
                    
                    # Get final response after tool calls
                    final_response = await self.openai_client.chat.completions.create(
                        model=self.config.openai.model if self.config else "gpt-4",
                        messages=[
                            {"role": "system", "content": self.build_system_prompt()}
                        ] + self.conversation_history,
                        max_tokens=4000,
                        temperature=0.7,
                        timeout=30.0
                    )
                    
                    assistant_message = final_response.choices[0].message.content
                    self.conversation_history.append({
                        "role": "assistant",
                        "content": assistant_message
                    })
                    
                    return assistant_message
            else:
                # No tool calls, just return the response
                assistant_message = response.choices[0].message.content
                self.conversation_history.append({
                    "role": "assistant",
                    "content": assistant_message
                })
                
                return assistant_message
        except Exception as e:
            self.console.print(f"[red]Error communicating with AI: {e}[/red]")
            raise

    async def async_prompt(self, text: str) -> str:
        """Async version of prompt"""
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: Prompt.ask(text)
        )

    async def run_interactive_mode(self):
        """Run the interactive conversation loop"""
        self.display_welcome_screen()
        
        while True:
            try:
                user_input = await self.async_prompt("[bold blue]You>[/bold blue]")
                
                if not user_input.strip():
                    continue
                
                # Handle commands
                if user_input.startswith('/'):
                    parts = user_input.split(maxsplit=1)
                    cmd = parts[0].lower()
                    args = parts[1].split() if len(parts) > 1 else []
                    
                    if cmd in ['/exit', '/quit']:
                        self.console.print("[yellow]Goodbye![/yellow]")
                        break
                    elif cmd == '/help':
                        self.display_help()
                    elif cmd == '/clear':
                        self.console.clear()
                    elif cmd == '/add':
                        await self.handle_add_file(args, read_only=False)
                    elif cmd == '/add-ro':
                        await self.handle_add_file(args, read_only=True)
                    elif cmd == '/remove':
                        await self.handle_remove_file(args)
                    elif cmd == '/files':
                        self.display_added_files()
                    elif cmd == '/clear-files':
                        self.added_files.clear()
                        self.read_only_files.clear()
                        self.console.print("[green]✓[/green] Cleared all files")
                    elif cmd == '/mcp-list':
                        if self.mcp_clients:
                            self.console.print("[green]Connected MCP servers:[/green]")
                            for name in self.mcp_clients.keys():
                                self.console.print(f"  - [cyan]{name}[/cyan]")
                        else:
                            self.console.print("[yellow]No MCP servers connected[/yellow]")
                    elif cmd == '/mcp-tools':
                        if not args:
                            self.console.print("[red]Usage: /mcp-tools <server_name>[/red]")
                            continue
                        server_name = args[0]
                        tools = await self.list_mcp_tools(server_name)
                        if tools:
                            table = Table(title=f"Tools from {server_name}")
                            table.add_column("Name", style="cyan")
                            table.add_column("Description", style="green")
                            for tool in tools:
                                table.add_row(
                                    tool.get('name', 'Unknown'),
                                    tool.get('description', 'No description')
                                )
                            self.console.print(table)
                        else:
                            self.console.print(f"[yellow]No tools available[/yellow]")
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
                    else:
                        self.console.print(f"[red]Unknown command: {cmd}[/red]")
                        self.console.print("Type '/help' for available commands.")
                else:
                    # Natural conversation
                    self.console.print("[yellow]Thinking...[/yellow]")
                    try:
                        response = await self.chat_with_ai(user_input)
                        self.console.print(Panel(
                            Markdown(response),
                            title="A-Coder",
                            border_style="green"
                        ))
                    except Exception as e:
                        self.console.print(f"[red]Error: {e}[/red]")
            
            except KeyboardInterrupt:
                self.console.print("\n[yellow]Use '/exit' or '/quit' to leave[/yellow]")
            except Exception as e:
                self.console.print(f"[red]Error: {e}[/red]")

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
            self.console.print(f"[cyan]Connecting to {len(self.config.mcp.servers)} MCP server(s)...[/cyan]")
            for name, server_config in self.config.mcp.servers.items():
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
                await client.__aexit__(None, None, None)
            except Exception as e:
                self.console.print(f"[yellow]Warning: Failed to disconnect from {name}: {e}[/yellow]")


async def main():
    """Main function"""
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
        if args.config:
            config_obj = ACoderConfig.from_config_file(args.config)
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


if __name__ == '__main__':
    asyncio.run(main())
