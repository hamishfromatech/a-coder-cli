"""
Text-to-Speech mode implementation for A-Coder CLI
Enables speech output for AI responses using Kokoro FastAPI
"""

import asyncio
import io
import re
import threading
from typing import Optional

import pyaudio
from openai import AsyncOpenAI
from rich.console import Console


class TTSPlayer:
    """Handles audio playback from TTS"""
    
    def __init__(self):
        self.is_playing = False
        self.player = None
        self.audio = None
    
    def play_audio_stream(self, audio_data: bytes, sample_rate: int = 24000) -> None:
        """Play audio data using PyAudio"""
        try:
            self.audio = pyaudio.PyAudio()
            self.player = self.audio.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=sample_rate,
                output=True
            )
            self.is_playing = True
            
            # Write audio data in chunks
            chunk_size = 4096
            for i in range(0, len(audio_data), chunk_size):
                if not self.is_playing:
                    break
                chunk = audio_data[i:i + chunk_size]
                self.player.write(chunk)
            
            self.is_playing = False
        except Exception as e:
            raise RuntimeError(f"Failed to play audio: {e}")
        finally:
            if self.player:
                self.player.stop_stream()
                self.player.close()
            if self.audio:
                self.audio.terminate()
    
    def stop(self) -> None:
        """Stop audio playback"""
        self.is_playing = False


class TTSMode:
    """Main TTS handler for A-Coder CLI"""
    
    def __init__(self, console: Console, config: Optional[dict] = None):
        self.console = console
        self.config = config or {}
        self.endpoint = self.config.get("endpoint", "http://localhost:8880/v1")
        self.voice = self.config.get("voice", "af_bella")
        self.speed = self.config.get("speed", 1.0)
        self.player = TTSPlayer()
        
        # Create TTS client pointing to Kokoro FastAPI
        self.tts_client = AsyncOpenAI(
            base_url=self.endpoint,
            api_key="not-needed"
        )
    
    async def check_tts_available(self) -> bool:
        """Check if TTS endpoint is available"""
        try:
            # Try to list voices to verify endpoint is running
            response = await self.tts_client.audio.speech.create(
                model="kokoro",
                voice=self.voice,
                input="test",
                response_format="pcm"
            )
            return True
        except Exception as e:
            self.console.print(f"[yellow]⚠ TTS endpoint not available: {e}[/yellow]")
            self.console.print(f"[dim]Make sure Kokoro FastAPI is running on {self.endpoint}[/dim]")
            return False
    
    def _clean_text_for_tts(self, text: str) -> str:
        """
        Clean text for TTS by removing markdown, code blocks, file paths, emojis, tables, and other non-speech content
        """
        if not text:
            return ""
        
        # Remove emojis (Unicode emoji ranges)
        # This pattern covers most common emoji ranges
        emoji_pattern = re.compile(
            "["
            "\U0001F600-\U0001F64F"  # emoticons
            "\U0001F300-\U0001F5FF"  # symbols & pictographs
            "\U0001F680-\U0001F6FF"  # transport & map symbols
            "\U0001F1E0-\U0001F1FF"  # flags (iOS)
            "\U00002702-\U000027B0"  # dingbats
            "\U000024C2-\U0001F251"  # enclosed characters
            "\U0001F900-\U0001F9FF"  # supplemental symbols and pictographs
            "\U0001FA00-\U0001FA6F"  # chess symbols
            "\U0001FA70-\U0001FAFF"  # symbols and pictographs extended-A
            "\U00002600-\U000026FF"  # miscellaneous symbols
            "\U00002700-\U000027BF"  # dingbats
            "]+",
            flags=re.UNICODE
        )
        text = emoji_pattern.sub('', text)
        
        # Replace code blocks with spoken placeholders before removing formatting
        # This helps maintain context in the spoken output
        text = re.sub(r'```[\s\S]*?```', ' As shown in the code on screen. ', text)
        
        # Detect and mark tables before removing box-drawing characters
        # A table is indicated by multiple lines with box-drawing characters
        lines = text.split('\n')
        table_detected = False
        processed_lines = []
        
        for i, line in enumerate(lines):
            # Check if line contains table characters
            has_table_chars = any(c in line for c in '│┃║╭╮╯╰┌┐└┘├┤┬┴┼┏┓┗┛┣┫┳┻╋╔╗╚╝╠╣╦╩╬')
            
            if has_table_chars:
                if not table_detected:
                    # First line of table - add placeholder
                    processed_lines.append(' As shown in the table on screen. ')
                    table_detected = True
                # Skip the actual table line
            else:
                table_detected = False
                processed_lines.append(line)
        
        text = '\n'.join(processed_lines)
        
        # Remove any remaining box-drawing characters (tables, borders, etc.)
        box_drawing_pattern = re.compile(
            "["
            "\u2500-\u257F"  # Box Drawing
            "\u2580-\u259F"  # Block Elements
            "\u25A0-\u25FF"  # Geometric Shapes
            "\u2600-\u26FF"  # Miscellaneous Symbols
            "\u2700-\u27BF"  # Dingbats
            "\u2B00-\u2BFF"  # Miscellaneous Symbols and Arrows
            "╭╮╯╰│─┌┐└┘├┤┬┴┼"  # Common box drawing chars
            "┏┓┗┛┃━┣┫┳┻╋"
            "╔╗╚╝║═╠╣╦╩╬"
            "╒╕╘╛│═╞╡╤╧╪"
            "╓╖╙╜║═╟╢╥╨╫"
            "]+",
            flags=re.UNICODE
        )
        text = box_drawing_pattern.sub('', text)
        
        # Remove inline code (`...`)
        text = re.sub(r'`[^`]*`', '', text)
        
        # Remove markdown bold (**text** or __text__)
        text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
        text = re.sub(r'__(.+?)__', r'\1', text)
        
        # Remove markdown italic (*text* or _text_)
        text = re.sub(r'\*(.+?)\*', r'\1', text)
        text = re.sub(r'_(.+?)_', r'\1', text)
        
        # Remove markdown links [text](url)
        text = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', text)
        
        # Remove markdown headings (#, ##, ###, etc.)
        text = re.sub(r'^#+\s+', '', text, flags=re.MULTILINE)
        
        # Remove markdown horizontal rules (---, ***, ___)
        text = re.sub(r'^[\-\*_]{3,}$', '', text, flags=re.MULTILINE)
        
        # Remove markdown blockquotes (> text)
        text = re.sub(r'^>\s+', '', text, flags=re.MULTILINE)
        
        # Remove markdown lists (-, *, +, •, or numbered)
        text = re.sub(r'^[\-\*\+•]\s+', '', text, flags=re.MULTILINE)
        text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
        
        # Replace en-dash and em-dash with regular dash or space
        text = text.replace('–', ' - ')
        text = text.replace('—', ' - ')
        
        # Remove file paths (common patterns like /path/to/file, C:\path\to\file, ./relative/path)
        text = re.sub(r'(?:^|\s)(?:[a-zA-Z]:\\|/|\./)[\w\-./\\]+(?:\.\w+)?(?:\s|$)', ' ', text)
        
        # Remove URLs
        text = re.sub(r'https?://[^\s]+', '', text)
        
        # Final cleanup: remove any remaining lines that look like code/config
        # (Most tables should already be replaced with placeholders above)
        lines = text.split('\n')
        cleaned_lines = []
        for line in lines:
            stripped = line.strip()
            
            # Skip empty lines
            if not stripped:
                continue
            
            # Skip lines that look like code/config structures
            if (stripped.startswith('{') or stripped.startswith('[') or 
                stripped.startswith('<') or stripped.startswith('"') or
                stripped.startswith("'")):
                continue
            
            # Skip lines that are mostly special characters (leftover separators)
            special_char_count = sum(1 for c in stripped if not c.isalnum() and not c.isspace())
            if len(stripped) > 0 and special_char_count > len(stripped) * 0.7:
                continue
            
            cleaned_lines.append(line)
        
        text = '\n'.join(cleaned_lines)
        
        # Remove multiple spaces and clean up whitespace
        text = re.sub(r'\s+', ' ', text)
        text = text.strip()
        
        return text
    
    async def generate_speech(self, text: str) -> Optional[bytes]:
        """
        Generate speech from text using Kokoro FastAPI
        Returns audio bytes or None if failed
        """
        if not text or not text.strip():
            return None
        
        # Clean text before generating speech
        cleaned_text = self._clean_text_for_tts(text)
        
        if not cleaned_text or len(cleaned_text) < 10:
            # If text is too short after cleaning, skip TTS
            return None
        
        try:
            self.console.print("[dim]🔊 Generating speech...[/dim]")
            
            response = await self.tts_client.audio.speech.create(
                model="kokoro",
                voice=self.voice,
                input=cleaned_text,
                response_format="pcm"
            )
            
            # Read audio data from response
            audio_data = response.read()
            return audio_data
        
        except Exception as e:
            self.console.print(f"[yellow]⚠ TTS generation failed: {e}[/yellow]")
            return None
    
    async def speak_response(self, text: str) -> None:
        """
        Generate and play speech for AI response
        Runs in background thread to avoid blocking
        """
        try:
            audio_data = await self.generate_speech(text)
            
            if audio_data:
                # Play audio in background thread
                def play_in_thread():
                    try:
                        self.player.play_audio_stream(audio_data)
                    except Exception as e:
                        self.console.print(f"[yellow]⚠ Audio playback failed: {e}[/yellow]")
                
                thread = threading.Thread(target=play_in_thread, daemon=True)
                thread.start()
        
        except Exception as e:
            self.console.print(f"[red]TTS error: {e}[/red]")
    
    async def list_available_voices(self) -> list:
        """List available voices from Kokoro FastAPI"""
        try:
            # Make a direct request to get voices
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.endpoint}/audio/voices")
                if response.status_code == 200:
                    data = response.json()
                    return data.get("voices", [])
        except Exception as e:
            self.console.print(f"[yellow]Could not fetch voices: {e}[/yellow]")
        
        # Return default voices if endpoint unavailable
        return [
            "af_bella", "af_sky", "af_heart", "af_sarah", "af_nicole",
            "am_adam", "am_michael", "bm_george", "bm_lewis"
        ]
    
    def set_voice(self, voice: str) -> None:
        """Change the current voice"""
        self.voice = voice
        self.config["voice"] = voice
