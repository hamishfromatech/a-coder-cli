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

try:
    from toon import encode as toon_encode, decode as toon_decode
except ImportError:  # pragma: no cover - optional dependency
    toon_encode = None
    toon_decode = None

# Suppress MCP root-related warnings and logs at multiple levels
import logging
import warnings
import sys
import io
from contextlib import redirect_stderr, redirect_stdout
from contextlib import contextmanager

# Set all MCP-related loggers to ERROR level
mcp_loggers = [
    'fastmcp', 'mcp', 'MCP', 'MCPClient', 'mcp.client', 
    'mcp_client', 'client', 'Client', 'server', 'Server'
]
for logger_name in mcp_loggers:
    try:
        logging.getLogger(logger_name).setLevel(logging.ERROR)
    except:
        pass  # Logger might not exist yet

# Suppress MCP-specific warning messages that are non-critical
warnings.filterwarnings("ignore", message=".*List roots not supported.*")
warnings.filterwarnings("ignore", message=".*Failed to request initial roots.*")
warnings.filterwarnings("ignore", message=".*MCP error -32603.*")
warnings.filterwarnings("ignore", message=".*MCP.*")
warnings.filterwarnings("ignore", category=UserWarning, module=".*mcp.*")
warnings.filterwarnings("ignore", category=DeprecationWarning, module=".*mcp.*")

# Enhanced MCP error patterns to suppress
MCP_SUPPRESS_PATTERNS = [
    "List roots not supported",
    "Failed to request initial roots",
    "MCP error -32603",
    "MCP",
    "mcp",
    "fastmcp"
]

class EnhancedMCPSuppressor:
    """Enhanced MCP suppressor that handles all possible output channels"""
    def __init__(self):
        self.original_stderr = sys.stderr
        self.original_stdout = sys.stdout
        self.original_warnings_showwarning = warnings.showwarning
        
        # Store original built-in print function
        self.original_print = print
        
    def _filter_mcp_output(self, text):
        """Filter out MCP-related messages that should be suppressed"""
        if not text:
            return ""
        
        # Split into lines and filter out lines containing MCP patterns
        lines = text.split('\n')
        filtered_lines = []
        
        for line in lines:
            # Skip lines that contain MCP suppression patterns
            if not any(pattern in line for pattern in MCP_SUPPRESS_PATTERNS):
                filtered_lines.append(line)
        
        return '\n'.join(filtered_lines).strip()
    
    def _showwarning_suppressed(self, message, category, filename, lineno, file=None, line=None):
        """Custom warning handler that suppresses MCP warnings"""
        message_str = str(message)
        if not any(pattern in message_str for pattern in MCP_SUPPRESS_PATTERNS):
            # Only show non-MCP warnings
            self.original_warnings_showwarning(message, category, filename, lineno, file, line)
    
    def _suppressed_print(self, *args, **kwargs):
        """Override print to filter out MCP messages"""
        # Convert args to string and check if any contain MCP patterns
        text_parts = [str(arg) for arg in args]
        text = ' '.join(text_parts)
        
        # Only print if no MCP patterns found
        if not any(pattern in text for pattern in MCP_SUPPRESS_PATTERNS):
            self.original_print(*args, **kwargs)
    
    def __enter__(self):
        # Set up suppressed streams
        self.stderr_buffer = io.StringIO()
        self.stdout_buffer = io.StringIO()
        
        # Replace stderr/stdout with buffers
        sys.stderr = self.stderr_buffer
        sys.stdout = self.stdout_buffer
        
        # Replace warnings showwarning function
        warnings.showwarning = self._showwarning_suppressed
        
        # Override built-in print function
        import builtins
        builtins.print = self._suppressed_print
        
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        # Restore original streams
        sys.stderr = self.original_stderr
        sys.stdout = self.original_stdout
        warnings.showwarning = self.original_warnings_showwarning
        
        # Restore original print function
        import builtins
        builtins.print = self.original_print
        
        # Get buffered content and filter out MCP messages
        stderr_content = self._filter_mcp_output(self.stderr_buffer.getvalue())
        stdout_content = self._filter_mcp_output(self.stdout_buffer.getvalue())
        
        # Print any remaining content that wasn't MCP-related
        if stderr_content:
            self.original_print(stderr_content, file=sys.stderr)
        if stdout_content:
            self.original_print(stdout_content, file=sys.stdout)

# Keep the original SuppressedOutput for backward compatibility
SuppressedOutput = EnhancedMCPSuppressor

# Also set up logging filter to suppress MCP messages
class MCPLogFilter(logging.Filter):
    def filter(self, record):
        # Suppress MCP-related log records
        msg = record.getMessage()
        return not any(pattern in msg for pattern in MCP_SUPPRESS_PATTERNS)

# Apply the filter to all relevant loggers
for logger_name in mcp_loggers:
    try:
        logger = logging.getLogger(logger_name)
        logger.addFilter(MCPLogFilter())
    except:
        pass

load_dotenv()

logger = logging.getLogger(__name__)


class MCPErrorHandler:
    """Enhanced error handler for MCP tool call errors with user-friendly messages"""
    
    def __init__(self, console: Console):
        self.console = console
    
    def categorize_error(self, error: Exception, tool_name: str, server_name: str, args: Dict) -> tuple[str, str, str]:
        """Categorize error and return (severity, title, message)"""
        error_str = str(error).lower()
        
        # Connection issues
        if any(pattern in error_str for pattern in ['connection', 'network', 'timeout', 'unreachable']):
            return (
                "red",
                "🔌 Connection Error",
                f"Cannot connect to {server_name} server. The server may be down or unreachable."
            )
        
        # Permission/Access issues
        elif any(pattern in error_str for pattern in ['permission', 'access denied', 'forbidden', 'unauthorized']):
            return (
                "red",
                "🚫 Permission Denied",
                f"Access denied for tool '{tool_name}'. Check file permissions or server configuration."
            )
        
        # File not found
        elif any(pattern in error_str for pattern in ['file not found', 'no such file', 'does not exist']):
            path_info = ""
            if 'path' in args:
                path_info = f"\nFile path: {args['path']}"
            return (
                "yellow",
                "📁 File Not Found",
                f"The requested file could not be found.{path_info}\n\nTip: Use /files to see available files in context."
            )
        
        # Invalid arguments
        elif any(pattern in error_str for pattern in ['invalid', 'bad', 'wrong', 'malformed']):
            return (
                "yellow",
                "⚠️ Invalid Arguments",
                f"The tool '{tool_name}' received invalid or malformed parameters.\n\nTool: {tool_name}\nServer: {server_name}"
            )
        
        # Tool not found
        elif any(pattern in error_str for pattern in ['tool not found', 'unknown tool', 'no such tool']):
            return (
                "yellow",
                "🔧 Tool Not Found",
                f"The tool '{tool_name}' is not available on {server_name} server.\n\nTip: Use /mcp-tools {server_name} to see available tools."
            )
        
        # Server-specific errors
        elif 'server' in error_str and 'error' in error_str:
            return (
                "red",
                "🖥️ Server Error",
                f"The {server_name} server encountered an internal error while processing the request."
            )
        
        # General errors
        else:
            return (
                "red",
                "❌ Tool Execution Failed",
                f"Failed to execute '{tool_name}' on {server_name} server: {str(error)}"
            )
    
    def display_error(self, error: Exception, tool_name: str, server_name: str, args: Dict):
        """Display a user-friendly error message using Rich formatting"""
        severity, title, message = self.categorize_error(error, tool_name, server_name, args)
        
        # Create a detailed error panel
        error_details = f"{message}\n\n[dim]Details:[/dim]\n• Tool: {tool_name}\n• Server: {server_name}\n• Error: {str(error)}"
        
        # Add context for file operations
        if 'path' in args:
            error_details += f"\n• File: {args['path']}"
        
        # Add suggestions based on error type
        suggestions = self._get_suggestions(error, tool_name, server_name)
        if suggestions:
            error_details += f"\n\n[dim]💡 Suggestions:[/dim]\n{suggestions}"
        
        # Display the error panel
        self.console.print(Panel(
            error_details,
            title=f"[bold {severity}]{title}[/bold {severity}]",
            border_style=severity,
            box=ROUNDED,
            padding=(1, 2)
        ))
    
    def _get_suggestions(self, error: Exception, tool_name: str, server_name: str) -> str:
        """Get helpful suggestions based on the error type"""
        error_str = str(error).lower()
        suggestions = []
        
        if 'permission' in error_str or 'access denied' in error_str:
            suggestions.extend([
                "• Check file/directory permissions",
                "• Verify the file is not in a protected location",
                "• Try running with appropriate user privileges"
            ])
        
        elif 'file not found' in error_str or 'does not exist' in error_str:
            suggestions.extend([
                "• Use /files to see files in context",
                "• Use /add <filepath> to add the file to context",
                "• Verify the file path is correct"
            ])
        
        elif 'timeout' in error_str or 'connection' in error_str:
            suggestions.extend([
                "• Check if the MCP server is running",
                "• Verify network connectivity",
                "• Try again in a few moments"
            ])
        
        elif 'invalid' in error_str or 'malformed' in error_str:
            suggestions.extend([
                "• Check the tool parameters",
                "• Use /mcp-tools to see expected parameters",
                "• Verify the file path format"
            ])
        
        elif 'tool not found' in error_str:
            suggestions.extend([
                f"• Use /mcp-tools {server_name} to see available tools",
                "• Check the tool name spelling",
                "• Verify the server supports this tool"
            ])
        
        if not suggestions:
            suggestions.append("• Try rephrasing your request")
            suggestions.append("• Use /help for available commands")
        
        return "\n".join(suggestions)


class ACoderCLI:
    """Terminal-based coding agent with MCP-based file operations"""
    
    def __init__(self, config=None):
        self.console = Console()
        self.openai_client = None
        self.mcp_client: Optional[MCPClient] = None  # Single multi-server client
        self.mcp_server_names: List[str] = []  # Track connected server names
        self.conversation_history: List[Dict[str, str]] = []
        self.current_project_path = Path.cwd()
        self.config = config
        self.added_files: Dict[str, str] = {}
        self.read_only_files: set = set()
        self.prompt_session = PromptSession(history=InMemoryHistory())
        self.streaming_enabled = False  # Toggle for streaming responses
        self.error_handler = MCPErrorHandler(self.console)  # Enhanced error handling
        self.use_toon_for_mcp = True if toon_encode else False
        self.show_tool_details: bool = False

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
    
    async def get_available_models(self) -> List[str]:
        """Fetch available models from Ollama or LM Studio"""
        try:
            if not self.config or not self.config.openai.base_url:
                return []
            
            base_url = self.config.openai.base_url
            import httpx
            
            # Try LM Studio endpoint first (OpenAI-compatible /v1/models)
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(f"{base_url}/models")
                    if response.status_code == 200:
                        data = response.json()
                        models = [m['id'] for m in data.get('data', [])]
                        if models:
                            return sorted(models)
            except Exception:
                pass  # Fall through to try Ollama endpoint
            
            # Try Ollama endpoint
            tags_url = base_url.replace('/v1', '') + '/api/tags'
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(tags_url)
                if response.status_code == 200:
                    data = response.json()
                    models = [m['name'] for m in data.get('models', [])]
                    return sorted(models)
        except Exception as e:
            self.console.print(f"[yellow]Could not fetch models: {e}[/yellow]")
        return []
    
    async def switch_model(self, model_name: str) -> bool:
        """Switch to a different model"""
        if not self.config:
            self.console.print("[red]No config loaded[/red]")
            return False
        
        self.config.openai.model = model_name
        return True
    
    async def cleanup_mcp(self):
        """Cleanup MCP client connections gracefully"""
        if self.mcp_client:
            try:
                self.console.print("[dim]Closing MCP connections...[/dim]")
                await self.mcp_client.__aexit__(None, None, None)
                self.mcp_client = None
                self.mcp_server_names = []
            except Exception as e:
                # Suppress errors during cleanup
                pass

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
        # On Unix-like systems (macOS, Linux), don't resolve the path
        # Let the system use PATH naturally to find the correct version
        # This avoids locking to a specific Node.js version (e.g., node@20 vs node@22)
        
        # Return original command - system will resolve via PATH
        return command

    async def connect_mcp_servers(self, servers_config: Dict[str, Dict[str, Any]]) -> bool:
        """Connect to multiple MCP servers using a single multi-server client"""
        try:
            if not servers_config:
                self.console.print("[yellow]No MCP servers to connect[/yellow]")
                return False
            
            # Use SuppressedOutput to suppress non-critical MCP error messages
            with SuppressedOutput():
                # Resolve command paths and set transport for all servers
                for name, server_config in servers_config.items():
                    if isinstance(server_config, dict):
                        # Resolve command path if present
                        if 'command' in server_config:
                            original_cmd = server_config['command']
                            resolved_cmd = self._resolve_command_path(original_cmd)
                            if resolved_cmd != original_cmd:
                                server_config['command'] = resolved_cmd
                                self.console.print(f"[dim]  └─ Resolved {original_cmd} to {resolved_cmd} for {name}[/dim]")
                            # Set transport for stdio servers
                            if 'transport' not in server_config:
                                server_config['transport'] = 'stdio'
                        
                        # Set transport for HTTP servers
                        elif 'url' in server_config and 'transport' not in server_config:
                            server_config['transport'] = 'http'
                
                # Create single multi-server client
                config_dict = {"mcpServers": servers_config}
                self.mcp_client = MCPClient(config_dict)
                await self.mcp_client.__aenter__()
                self.mcp_server_names = list(servers_config.keys())
                
                for name in self.mcp_server_names:
                    self.console.print(f"[bold green]✓[/bold green] [bright_white]Connected to MCP server:[/bright_white] [bold cyan]{name}[/bold cyan]")
                
                return True
        except FileNotFoundError as e:
            self.console.print(f"[bold red]✗[/bold red] [bright_white]Failed to connect to MCP servers[/bright_white]")
            self.console.print(f"[yellow]  └─ Command not found: {e}[/yellow]")
            if platform.system() == "Windows":
                self.console.print(f"[dim]  └─ Tip: Ensure Node.js and npm are installed and in your PATH[/dim]")
            else:
                self.console.print(f"[dim]  └─ Tip: Ensure required commands (npx, node) are installed and in your PATH[/dim]")
            return False
        except Exception as e:
            error_msg = str(e)
            # Suppress non-critical warnings about roots not being supported
            if any(pattern in error_msg for pattern in MCP_SUPPRESS_PATTERNS):
                # Silently continue - these are non-critical MCP server warnings
                return True
            self.console.print(f"[bold red]✗[/bold red] [bright_white]Failed to connect to MCP servers:[/bright_white] [red]{e}[/red]")
            import traceback
            traceback.print_exc()
            return False

    async def list_mcp_tools(self, server_name: str = None) -> List[Dict]:
        """List available tools from MCP servers"""
        if not self.mcp_client:
            return []
        
        try:
            tools = await self.mcp_client.list_tools()
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
        """Call a tool on an MCP server with enhanced error handling"""
        if not self.mcp_client:
            raise ValueError("MCP client not connected")
        
        if server_name not in self.mcp_server_names:
            raise ValueError(f"Server {server_name} not connected")
        
        try:
            # For multi-server client, tools are prefixed with server name
            prefixed_tool_name = f"{server_name}_{tool_name}"
            result = await self.mcp_client.call_tool(prefixed_tool_name, arguments)
            return result
        except Exception as e:
            # Use the enhanced error handler to display a user-friendly message
            self.error_handler.display_error(e, tool_name, server_name, arguments)
            # Re-raise the original exception for proper error propagation
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
                    # Sanitize each property and filter out empty ones
                    sanitized_props = {}
                    for k, v in value.items():
                        sanitized_prop = self.sanitize_json_schema(v)
                        # Only include properties that have actual constraints
                        # Skip properties that are just {"type": "object"} or empty
                        if sanitized_prop and sanitized_prop != {"type": "object"}:
                            sanitized_props[k] = sanitized_prop
                    # Always include properties field, even if empty (required by OpenAI API spec)
                    sanitized[key] = sanitized_props
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
            return {"type": "object", "properties": {}}
        
        # Ensure 'properties' exists if type is object (required by OpenAI API spec)
        if sanitized.get('type') == 'object' and 'properties' not in sanitized:
            sanitized['properties'] = {}
        
        return sanitized

    async def _display_tool_calls(self, tool_calls):
        """Display tool calls being made by the AI with beautiful formatting"""
        if not tool_calls:
            return
            
        self.console.print()
        
        # Create a beautiful tool call display
        for i, tool_call in enumerate(tool_calls, 1):
            tool_name = tool_call.function.name
            try:
                args = json.loads(tool_call.function.arguments) if tool_call.function.arguments else {}
            except:
                args = {"raw_arguments": tool_call.function.arguments}
            
            # Parse tool name to get server and tool
            if '_' in tool_name:
                parts = tool_name.split('_', 1)
                server_name = parts[0]
                actual_tool = parts[1] if len(parts) > 1 else tool_name
            else:
                server_name = "unknown"
                actual_tool = tool_name
            
            # Create tool call info
            tool_info = f"[bold bright_cyan]Step {i}│[/bold bright_cyan] [bold white]AI called {len(tool_calls)} tool(s):[/bold white] [bold magenta]{tool_name}[/bold magenta]"
            
            # Add arguments (formatted nicely)
            if args:
                args_str = json.dumps(args, indent=2)
                tool_info += f"\n[dim]├─ {server_name}.{actual_tool}[/dim] [dim]{args_str}[/dim]"
            
            # Create panel for tool call
            tool_panel = Panel(
                tool_info,
                border_style="bright_cyan",
                box=ROUNDED,
                padding=(1, 2)
            )
            
            self.console.print(tool_panel)
        
        self.console.print()
    
    async def _display_tool_result(self, tool_name: str, result: Any, tool_call_id: str):
        """Display the result of a tool call"""
        try:
            # Convert result to string for display
            result_str = self.format_tool_result(result)
            if len(result_str) > 2000:
                result_str = result_str[:2000] + "\n\n... (truncated)"
            
            # Determine result type for styling
            if isinstance(result, dict) and 'error' in str(result).lower():
                border_style = "red"
                title_style = "red"
                title = "❌ Tool Error"
            elif isinstance(result, list) and len(result) == 0:
                border_style = "yellow" 
                title_style = "yellow"
                title = "📋 Empty Result"
            else:
                border_style = "green"
                title_style = "green"
                title = "✅ Tool Success"
            
            # Create result panel
            result_panel = Panel(
                result_str,
                title=f"[bold {title_style}]{title}[/bold {title_style}] [dim]│[/dim] [dim]{tool_name}[/dim]",
                border_style=border_style,
                box=ROUNDED,
                padding=(1, 2)
            )
            
            self.console.print(result_panel)
            self.console.print()
            
        except Exception as e:
            self.console.print(f"[yellow]Error displaying tool result: {e}[/yellow]")

    def smart_truncate_result(self, result_str: str, tool_name: str, max_size: int = 8000) -> str:
        """
        Intelligently truncate tool results based on tool type and content structure.
        Preserves important information while reducing context window usage.
        """
        if len(result_str) <= max_size:
            return result_str
    
    async def build_tools_list(self) -> List[Dict[str, Any]]:
        """Build list of available MCP tools for function calling"""
        tools = []
        
        if not self.mcp_client:
            return tools
        
        try:
            mcp_tools = await self.list_mcp_tools()
            
            if not mcp_tools:
                return tools
                
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
                    
                    # Format tool for OpenAI - tool names are already prefixed by FastMCP
                    formatted_tool = {
                        "type": "function",
                        "function": {
                            "name": tool_name,  # Already prefixed like "filesystem_read_file"
                            "description": tool.get('description', ''),
                            "parameters": sanitized_schema
                        }
                    }
                    tools.append(formatted_tool)
                except Exception as e:
                    self.console.print(f"[yellow]Error formatting tool: {e}[/yellow]")
                    continue
        except Exception as e:
            self.console.print(f"[yellow]Error getting tools: {e}[/yellow]")
        
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
                
                # Parse tool name - FastMCP prefixes with server name using underscore
                # Format: "servername_toolname" (e.g., "filesystem_read_file")
                if '_' in tool_name:
                    parts = tool_name.split('_', 1)
                    server_name = parts[0]
                    actual_tool = parts[1] if len(parts) > 1 else tool_name
                else:
                    # No prefix - try to use as-is
                    server_name = self.mcp_server_names[0] if self.mcp_server_names else "unknown"
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
                        # Log but allow - security should be handled by MCP server
                        self.console.print(f"[yellow]Warning: Attempting to access potentially sensitive file: {path_arg}[/yellow]")
                
                # Display the tool call details
                if hasattr(self, 'show_tool_details') and self.show_tool_details:
                    tool_call_info = f"[bold cyan]🔧 Calling:[/bold cyan] [bold white]{server_name}[/bold white].[bold magenta]{actual_tool}[/bold magenta]"
                    if args:
                        tool_call_info += f"\n[dim]Args:[/dim] [dim]{json.dumps(args, indent=2)}[/dim]"
                    self.console.print(Panel(tool_call_info, border_style="cyan", box=ROUNDED, padding=(1, 2)))
                
                # Execute the tool call
                result = await self.call_mcp_tool(server_name, actual_tool, args)
                
                # Display the tool result
                if hasattr(self, 'show_tool_details') and self.show_tool_details:
                    await self._display_tool_result(tool_name, result, tool_call.id)
                
                # Store result for AI response
                formatted_result = self.prepare_result_payload(result, actual_tool)
                tool_results.append({
                    "tool_call_id": tool_call.id,
                    "tool_name": tool_name,
                    "result": formatted_result
                })
                
            except Exception as e:
                error_msg = f"Error executing tool {tool_name}: {str(e)}"
                self.console.print(f"[red]{error_msg}[/red]")
                
                # Store error result for AI response
                tool_results.append({
                    "tool_call_id": tool_call.id,
                    "tool_name": tool_name,
                    "result": error_msg
                })
        
        return tool_results
        
    def smart_truncate_result(self, result_str: str, tool_name: str, max_size: int = 8000) -> str:
        """
        Intelligently truncate tool results based on tool type and content structure.
        Preserves important information while reducing context window usage.
        """
        if len(result_str) <= max_size:
            return result_str
        
        original_size = len(result_str)
        
        # Special handling for directory trees - extract summary info
        if 'directory_tree' in tool_name or 'list_directory' in tool_name:
            lines = result_str.split('\n')
            
            # Keep first lines (usually the root path) and sample of structure
            header_lines = 10
            sample_lines = 50
            footer_lines = 5
            
            if len(lines) > (header_lines + sample_lines + footer_lines):
                truncated_lines = (
                    lines[:header_lines] +
                    ['', '... [directory tree truncated for context efficiency] ...', ''] +
                    lines[header_lines:header_lines + sample_lines] +
                    ['', '... [additional entries omitted] ...', ''] +
                    lines[-footer_lines:]
                )
                result_str = '\n'.join(truncated_lines)
                
                # Add summary
                total_lines = len(lines)
                summary = f"\n\n[TRUNCATED: Showing {header_lines + sample_lines + footer_lines} of {total_lines} total entries. Original size: {original_size} chars]"
                result_str += summary
                return result_str
        
        # For file content, keep beginning and end
        if 'read_file' in tool_name or 'get_file' in tool_name:
            keep_start = max_size // 2
            keep_end = max_size // 2
            
            result_str = (
                result_str[:keep_start] +
                f"\n\n... [FILE TRUNCATED: {original_size - max_size} chars omitted] ...\n\n" +
                result_str[-keep_end:]
            )
            return result_str
        
        # For JSON results, try to preserve structure
        if result_str.strip().startswith('{') or result_str.strip().startswith('['):
            try:
                data = json.loads(result_str)
                
                # If it's a list, sample items
                if isinstance(data, list) and len(data) > 10:
                    sampled = data[:5] + data[-5:]
                    truncated_data = {
                        "_truncated": True,
                        "_original_count": len(data),
                        "_showing": "first 5 and last 5 items",
                        "items": sampled
                    }
                    return json.dumps(truncated_data, indent=2)
                
                # If it's a large dict, keep keys but truncate values
                if isinstance(data, dict) and len(json.dumps(data)) > max_size:
                    truncated_data = {}
                    for k, v in list(data.items())[:20]:  # Keep first 20 keys
                        if isinstance(v, str) and len(v) > 200:
                            truncated_data[k] = v[:200] + "..."
                        else:
                            truncated_data[k] = v
                    truncated_data["_truncated"] = f"Showing first 20 of {len(data)} keys"
                    return json.dumps(truncated_data, indent=2)
            except:
                pass  # Fall through to simple truncation
        
        # Default: simple truncation with context preservation
        keep_start = int(max_size * 0.7)  # Keep more from the start
        keep_end = max_size - keep_start
        
        result_str = (
            result_str[:keep_start] +
            f"\n\n... [TRUNCATED: {original_size - max_size} chars omitted for context efficiency] ...\n\n" +
            result_str[-keep_end:]
        )
        
        return result_str

    async def build_tools_list(self) -> List[Dict[str, Any]]:
        """Build list of available MCP tools for function calling"""
        tools = []
        
        if not self.mcp_client:
            return tools
        
        try:
            mcp_tools = await self.list_mcp_tools()
            
            if not mcp_tools:
                return tools
                
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
                    
                    # Format tool for OpenAI - tool names are already prefixed by FastMCP
                    formatted_tool = {
                        "type": "function",
                        "function": {
                            "name": tool_name,  # Already prefixed like "filesystem_read_file"
                            "description": tool.get('description', ''),
                            "parameters": sanitized_schema
                        }
                    }
                    tools.append(formatted_tool)
                except Exception as e:
                    self.console.print(f"[yellow]Error formatting tool: {e}[/yellow]")
                    continue
        except Exception as e:
            self.console.print(f"[yellow]Error getting tools: {e}[/yellow]")
        
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
                
                # Parse tool name - FastMCP prefixes with server name using underscore
                # Format: "servername_toolname" (e.g., "filesystem_read_file")
                if '_' in tool_name:
                    parts = tool_name.split('_', 1)
                    server_name = parts[0]
                    actual_tool = parts[1] if len(parts) > 1 else tool_name
                else:
                    # No prefix - try to use as-is
                    server_name = self.mcp_server_names[0] if self.mcp_server_names else "unknown"
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
                
                result_str = self.prepare_result_payload(result, actual_tool)
                
                # Smart truncation based on tool type and model context
                # Use smaller limits for better performance with local models
                MAX_RESULT_SIZE = self.config.openai.max_tool_result_size if self.config else 8000
                original_size = len(result_str)
                
                if original_size > MAX_RESULT_SIZE:
                    self.console.print(f"[yellow]Result large ({original_size} chars), applying smart truncation...[/yellow]")
                    result_str = self.smart_truncate_result(result_str, actual_tool, MAX_RESULT_SIZE)
                    self.console.print(f"[green]✓ Truncated to {len(result_str)} chars (saved {original_size - len(result_str)} chars)[/green]")
                
                if result_str:
                    size_info = f"{len(result_str)} chars"
                    if original_size > len(result_str):
                        size_info += f" (from {original_size})"
                    self.console.print(f"[dim]  └─ Result: {size_info}[/dim]")
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

    def prepare_result_payload(self, result: Any, tool_name: str) -> str:
        """Format MCP tool results using TOON when available"""
        formatted = self.format_tool_result(result)
        max_size = self.config.openai.max_tool_result_size if self.config else 8000
        if len(formatted) > max_size:
            formatted = self.smart_truncate_result(formatted, tool_name, max_size)
        return formatted

    def format_tool_result(self, result: Any) -> str:
        """Convert arbitrary tool result payloads into strings (prefer TOON)"""
        normalized = self._normalize_result(result)
        toon_payload = self._encode_result_to_toon(normalized)
        if toon_payload:
            return toon_payload
        if isinstance(normalized, (dict, list)):
            try:
                return json.dumps(normalized, indent=2)
            except TypeError:
                pass
        return "" if normalized is None else str(normalized)

    def _normalize_result(self, result: Any) -> Any:
        if isinstance(result, str):
            stripped = result.strip()
            if stripped.startswith('{') or stripped.startswith('['):
                try:
                    return json.loads(stripped)
                except Exception:
                    return result
            return result
        if isinstance(result, (bytes, bytearray)):
            try:
                decoded = result.decode('utf-8')
                return self._normalize_result(decoded)
            except Exception:
                return result
        return result

    def _encode_result_to_toon(self, data: Any) -> Optional[str]:
        if not (self.use_toon_for_mcp and toon_encode):
            return None
        serializable = data
        if isinstance(serializable, set):
            serializable = list(serializable)
        if isinstance(serializable, tuple):
            serializable = list(serializable)
        if isinstance(serializable, (dict, list)):
            try:
                return toon_encode(serializable, {
                    "indent": 2,
                    "delimiter": "\t",
                    "lengthMarker": "#",
                })
            except Exception as exc:
                logger.debug("Failed to encode MCP result to TOON: %s", exc)
                return None
        return None

    async def chat_with_ai(self, user_message: str, show_tool_details: bool = False) -> str:
        """Send a message to the AI and get a response with tool calling support"""
        # Persist preference for downstream helpers that check the attribute
        self.show_tool_details = show_tool_details
        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })
        
        try:
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
            MAX_ITERATIONS = 100
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
                if show_tool_details:
                    await self._display_tool_calls(tool_calls)
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
                try:
                    tool_results = await self.process_tool_calls(response)
                    self.console.print(f"[dim]  └─ Received {len(tool_results) if tool_results else 0} tool results[/dim]")
                except (KeyboardInterrupt, asyncio.CancelledError):
                    self.console.print("\n[yellow]⚠ Interrupted by user (Ctrl+C)[/yellow]")
                    raise  # Re-raise to break out of the main loop
                
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
        
        except (KeyboardInterrupt, asyncio.CancelledError):
            # User pressed Ctrl+C during AI processing
            self.console.print("\n[yellow]⚠ AI loop interrupted. Ready for new message.[/yellow]")
            # Remove the last user message from history since it wasn't completed
            if self.conversation_history and self.conversation_history[-1]["role"] == "user":
                self.conversation_history.pop()
            return "[Interrupted by user]"

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
                        # Cleanup MCP connections before exit
                        await self.cleanup_mcp()
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
                        if self.mcp_server_names:
                            self.console.print("\n[bold bright_cyan]🔌 Connected MCP Servers[/bold bright_cyan]")
                            for i, name in enumerate(self.mcp_server_names, 1):
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
                        models = await self.get_available_models()
                        if models:
                            self.console.print("\n[bold bright_cyan]🤖 Available Models[/bold bright_cyan]\n")
                            current_model = self.config.openai.model if self.config else "unknown"
                            for i, model in enumerate(models, 1):
                                if model == current_model:
                                    self.console.print(f"  [bold green]✓[/bold green] [bold cyan]{model}[/bold cyan] [dim](current)[/dim]")
                                else:
                                    self.console.print(f"  [dim]{i}.[/dim] [cyan]{model}[/cyan]")
                            self.console.print()
                        else:
                            self.console.print("[yellow]⚠ No models available or could not connect to server[/yellow]")
                    elif cmd == '/switch-model':
                        if not args:
                            self.console.print("[red]Usage: /switch-model <model_name>[/red]")
                            models = await self.get_available_models()
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
                        raw_tools = await self.list_mcp_tools()
                        self.console.print(f"\n[cyan]All servers:[/cyan]")
                        self.console.print(f"  Raw tools count: {len(raw_tools)}")
                        if raw_tools:
                            try:
                                sample_json = json.dumps(raw_tools[:1], indent=2)
                                self.console.print(Panel(
                                    Syntax(sample_json, "json", theme="monokai", line_numbers=True),
                                    title="Sample Tools",
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
                                response = await self.chat_with_ai(user_input, show_tool_details=True)
                            except (KeyboardInterrupt, asyncio.CancelledError):
                                # User interrupted the AI loop, continue to next prompt
                                continue
                            except Exception as e:
                                self.console.print(f"[bold red]✗ Error[/bold red] [dim]│[/dim] {e}")
                                continue
                    else:
                        try:
                            response = await self.chat_with_ai(user_input, show_tool_details=True)
                        except (KeyboardInterrupt, asyncio.CancelledError):
                            # User interrupted the AI loop, continue to next prompt
                            continue
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
                # Cleanup on Ctrl+C
                await self.cleanup_mcp()
                break
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
        
        # Collect all MCP servers to connect
        servers_to_connect = {}
        
        # Add servers from config
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
                
                servers_to_connect[name] = server_config
        
        # Add command line servers
        if args.mcp_servers:
            for server_config in args.mcp_servers:
                try:
                    name, config_str = server_config.split('=', 1)
                    try:
                        config = json.loads(config_str)
                    except json.JSONDecodeError:
                        config = config_str
                    servers_to_connect[name] = config
                except ValueError as e:
                    self.console.print(f"[red]Invalid MCP server format {server_config}: {e}[/red]")
                except Exception as e:
                    self.console.print(f"[red]Error parsing MCP server config: {e}[/red]")
        
        # Connect to all servers using single multi-server client
        if servers_to_connect:
            await self.connect_mcp_servers(servers_to_connect)
        else:
            self.console.print("[yellow]No MCP servers configured[/yellow]")
        
        # Show connection summary
        if self.mcp_server_names:
            self.console.print(f"\n[green]Ready! Connected to {len(self.mcp_server_names)} MCP server(s)[/green]\n")
        else:
            self.console.print("[yellow]Warning: No MCP servers connected. File operations will not be available.\n[/yellow]")
        
        # Run interactive mode
        await self.run_interactive_mode()
        
        # Final cleanup (in case not already done)
        await self.cleanup_mcp()


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
