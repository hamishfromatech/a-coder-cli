"""
A-Coder CLI - Terminal-based coding agent with OpenAI and MCP server integration.

A powerful command-line interface that combines OpenAI's language models
with Model Context Protocol (MCP) servers to provide intelligent coding assistance,
file operations, and development workflows.

Features:
- Interactive chat-based coding assistance
- MCP server integration for extended functionality
- OpenAI language model support
- File and project management
- Terminal-based interface
"""

__version__ = "1.0.0"
__author__ = "The A-Tech Corporation"
__description__ = "Terminal-based coding agent with OpenAI and MCP server support"

from .a_coder_cli import ACoderCLI

__all__ = ['ACoderCLI']