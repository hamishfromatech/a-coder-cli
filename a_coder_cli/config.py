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
        self.context_window = 128000  # Default context window size (128k)
        # Context management for tool results
        self.max_tool_result_size = 8000  # Max chars per tool result (8k for smaller models)
        
    def create_client(self):
        """Create OpenAI client with current configuration"""
        # For local servers (Ollama, LM Studio), use a placeholder if no key provided
        api_key = self.api_key
        if not api_key:
            # Check if this is a local server that doesn't need a real API key
            if self.base_url and ('localhost' in self.base_url or '127.0.0.1' in self.base_url):
                api_key = 'local-server'
            else:
                raise ValueError("OpenAI API key not configured")
        
        # Support for custom base URLs (for local models like Ollama, LM Studio)
        client_params = {
            'api_key': api_key,
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


class VoiceConfig:
    """Voice mode configuration"""
    
    def __init__(self):
        self.enabled = True
        self.model = "base"  # tiny, base, small, medium, large-v3
        self.device = "cpu"  # cpu or cuda
        self.compute_type = "int8"  # int8, float16, float32
        self.language = "en"
        self.beam_size = 5
        self.vad_filter = True


class TTSConfig:
    """Text-to-Speech configuration"""
    
    def __init__(self):
        self.enabled = False  # Disabled by default (requires Kokoro FastAPI running)
        self.endpoint = "http://localhost:8880/v1"
        self.voice = "af_bella"  # Default voice
        self.speed = 1.0
        self.auto_play_responses = True  # Automatically play AI responses


class ACoderConfig:
    """Main configuration class for A-Coder CLI"""
    
    def __init__(self):
        self.openai = OpenAIConfig()
        self.mcp = MCPConfig()
        self.voice = VoiceConfig()
        self.tts = TTSConfig()
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
                config.openai.context_window = openai_config.get("context_window", 128000)
                config.openai.max_tool_result_size = openai_config.get("max_tool_result_size", 8000)
            
            # Add MCP servers
            for name, server_config in mcp_servers.items():
                config.mcp.add_server(name, server_config)
                    
            # Voice settings
            if "voice" in data:
                voice_config = data["voice"]
                config.voice.enabled = voice_config.get("enabled", True)
                config.voice.model = voice_config.get("model", "base")
                config.voice.device = voice_config.get("device", "cpu")
                config.voice.compute_type = voice_config.get("compute_type", "int8")
                config.voice.language = voice_config.get("language", "en")
                config.voice.beam_size = voice_config.get("beam_size", 5)
                config.voice.vad_filter = voice_config.get("vad_filter", True)
            
            # TTS settings
            if "tts" in data:
                tts_config = data["tts"]
                config.tts.enabled = tts_config.get("enabled", False)
                config.tts.endpoint = tts_config.get("endpoint", "http://localhost:8880/v1")
                config.tts.voice = tts_config.get("voice", "af_bella")
                config.tts.speed = tts_config.get("speed", 1.0)
                config.tts.auto_play_responses = tts_config.get("auto_play_responses", True)
            
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