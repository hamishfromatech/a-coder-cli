"""
Configuration module for A-Coder CLI
"""

import os
import json
from typing import Dict, Any, Optional
from openai import AsyncOpenAI


def get_default_mcp_servers() -> Dict[str, Any]:
    """Return default MCP server configurations"""
    return {}


class OpenAIConfig:
    """OpenAI configuration management"""
    
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, model: str = "minimax-m2:cloud"):
        self.api_key = api_key or os.getenv('OPENAI_API_KEY')
        self.base_url = base_url or os.getenv('OPENAI_BASE_URL', 'http://localhost:11434/v1')
        self.model = model
        self.max_tokens = 4000
        self.temperature = 0.7
        
    def create_client(self):
        """Create OpenAI client with current configuration"""
        if not self.api_key:
            raise ValueError("OpenAI API key not configured")
        
        # Support for custom base URLs (for local models like Ollama)
        client_params = {
            'api_key': self.api_key,
        }
        
        # Add base_url if it's configured
        if self.base_url:
            client_params['base_url'] = self.base_url
            
        return AsyncOpenAI(**client_params)


class MCPConfig:
    """MCP Server configuration"""
    
    def __init__(self):
        self.servers = {}
        self.default_timeout = 30.0
        
    def add_server(self, name: str, config: Dict[str, Any]):
        """Add or update an MCP server configuration"""
        self.servers[name] = config
        
    def get_server(self, name: str) -> Optional[Dict[str, Any]]:
        """Get MCP server configuration by name"""
        return self.servers.get(name)
        
    def remove_server(self, name: str):
        """Remove an MCP server configuration"""
        if name in self.servers:
            del self.servers[name]


class ACoderConfig:
    """Main configuration class for A-Coder CLI"""
    
    def __init__(self):
        self.openai = OpenAIConfig()
        self.mcp = MCPConfig()
        self.theme = "monokai"
        self.show_line_numbers = True
        self.auto_save_history = True
        self.history_file = os.path.expanduser("~/.acoder_history.json")
        
    @classmethod
    def from_config_file(cls, config_path: str) -> 'ACoderConfig':
        """Load configuration from a JSON file"""
        config = cls()
        
        try:
            with open(config_path, 'r') as f:
                data = json.load(f)
                
            # Handle both old format (direct) and new format (mcpServers wrapper)
            if "mcpServers" in data:
                mcp_servers = data.get("mcpServers", {})
            else:
                mcp_servers = {k: v for k, v in data.items() if k not in ["openai", "theme", "show_line_numbers", "auto_save_history", "history_file"]}
            
            if "openai" in data:
                # New format with explicit openai section
                openai_config = data["openai"]
                config.openai.api_key = openai_config.get("api_key")
                config.openai.base_url = openai_config.get("base_url", "http://localhost:11434/v1")
                config.openai.model = openai_config.get("model", "minimax-m2:cloud")
            
            # Add MCP servers
            for name, server_config in mcp_servers.items():
                config.mcp.add_server(name, server_config)
                    
            # Other settings
            config.theme = data.get("theme", "monokai")
            config.show_line_numbers = data.get("show_line_numbers", True)
            config.auto_save_history = data.get("auto_save_history", True)
            config.history_file = data.get("history_file", os.path.expanduser("~/.acoder_history.json"))
            
            return config
            
        except FileNotFoundError:
            raise FileNotFoundError(f"Configuration file not found: {config_path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in configuration file: {e}")
    
    @classmethod
    def load_default_config(cls) -> 'ACoderConfig':
        """Create a configuration from environment variables and defaults"""
        config = cls()
        
        # Update OpenAI config from environment
        config.openai.api_key = os.getenv('OPENAI_API_KEY')
        config.openai.base_url = os.getenv('OPENAI_BASE_URL', 'http://localhost:11434/v1')
        config.openai.model = os.getenv('OPENAI_MODEL', 'minimax-m2:cloud')
        
        # Load MCP servers from environment
        mcp_servers = os.getenv('MCP_SERVERS', '')
        if mcp_servers:
            try:
                servers = json.loads(mcp_servers)
                for name, server_config in servers.items():
                    config.mcp.add_server(name, server_config)
            except json.JSONDecodeError:
                pass
        
        return config