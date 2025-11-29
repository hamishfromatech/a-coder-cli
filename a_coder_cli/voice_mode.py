"""
Voice mode implementation for A-Coder CLI
Enables speech-to-text input using faster-whisper and pyaudio
"""

import asyncio
import io
import os
import tempfile
import threading
import time
from typing import Optional, Callable
import wave

import pyaudio
from pynput import keyboard
from faster_whisper import WhisperModel
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.text import Text


class VoiceRecorder:
    """Handles audio recording from microphone"""
    
    CHUNK = 1024
    FORMAT = pyaudio.paInt16
    CHANNELS = 1
    RATE = 16000  # 16kHz optimal for Whisper
    
    def __init__(self):
        self.is_recording = False
        self.frames = []
        self.stream = None
        self.audio = None
        
    def start_recording(self) -> None:
        """Start recording audio from microphone"""
        try:
            self.audio = pyaudio.PyAudio()
            self.stream = self.audio.open(
                format=self.FORMAT,
                channels=self.CHANNELS,
                rate=self.RATE,
                input=True,
                frames_per_buffer=self.CHUNK
            )
            self.is_recording = True
            self.frames = []
        except Exception as e:
            raise RuntimeError(f"Failed to start recording: {e}")
    
    def stop_recording(self) -> bytes:
        """Stop recording and return audio data"""
        if not self.is_recording:
            return b''
        
        self.is_recording = False
        
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
        
        if self.audio:
            self.audio.terminate()
        
        # Convert frames to bytes
        audio_data = b''.join(self.frames)
        return audio_data
    
    def record_chunk(self) -> None:
        """Record a single chunk of audio"""
        if self.is_recording and self.stream:
            try:
                data = self.stream.read(self.CHUNK, exception_on_overflow=False)
                self.frames.append(data)
            except Exception:
                pass
    
    def save_to_wav(self, audio_data: bytes, filepath: str) -> None:
        """Save audio data to WAV file"""
        with wave.open(filepath, 'wb') as wav_file:
            wav_file.setnchannels(self.CHANNELS)
            wav_file.setsampwidth(self.audio.get_sample_size(self.FORMAT) if self.audio else 2)
            wav_file.setframerate(self.RATE)
            wav_file.writeframes(audio_data)


class VoiceTranscriber:
    """Handles speech-to-text transcription using faster-whisper"""
    
    def __init__(self, model_name: str = "base", device: str = "cpu", compute_type: str = "int8"):
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.model = None
        self.console = Console()
    
    def load_model(self) -> None:
        """Load the Whisper model"""
        try:
            self.console.print(f"[dim]Loading {self.model_name} model on {self.device}...[/dim]")
            self.model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type
            )
        except Exception as e:
            raise RuntimeError(f"Failed to load Whisper model: {e}")
    
    def transcribe(self, audio_path: str, language: str = "en") -> str:
        """Transcribe audio file to text"""
        if not self.model:
            self.load_model()
        
        try:
            segments, info = self.model.transcribe(
                audio_path,
                language=language,
                beam_size=5,
                vad_filter=True,
                without_timestamps=False
            )
            
            # Combine all segments into single text
            text = " ".join([segment.text.strip() for segment in segments])
            return text.strip()
        except Exception as e:
            raise RuntimeError(f"Transcription failed: {e}")


class VoiceMode:
    """Main voice mode handler for A-Coder CLI"""
    
    def __init__(self, console: Console, config: Optional[dict] = None):
        self.console = console
        self.config = config or {}
        self.recorder = VoiceRecorder()
        
        # Get voice config
        model_name = self.config.get("model", "base")
        device = self.config.get("device", "cpu")
        compute_type = self.config.get("compute_type", "int8")
        
        self.transcriber = VoiceTranscriber(model_name, device, compute_type)
        self.is_recording = False
        self.spacebar_pressed = False
        self.transcribed_text = None
        self.recording_thread = None
    
    def _on_press(self, key) -> bool:
        """Handle key press events"""
        try:
            if key == keyboard.Key.space:
                if not self.spacebar_pressed:
                    self.spacebar_pressed = True
                    if not self.is_recording:
                        # Start recording
                        self.is_recording = True
                        self.recorder.start_recording()
                    else:
                        # Stop recording
                        self.is_recording = False
                        return False  # Stop listener
        except AttributeError:
            pass
        return True
    
    def _on_release(self, key) -> bool:
        """Handle key release events"""
        try:
            if key == keyboard.Key.space:
                self.spacebar_pressed = False
        except AttributeError:
            pass
        return True
    
    def _recording_loop(self) -> None:
        """Background thread for recording audio chunks"""
        while self.is_recording:
            self.recorder.record_chunk()
            time.sleep(0.01)
    
    async def record_voice_input(self) -> Optional[str]:
        """
        Record voice input and transcribe to text
        Returns transcribed text or None if cancelled
        """
        try:
            # Display instructions
            instructions = Text()
            instructions.append("🎤 Voice mode active\n", style="bold cyan")
            instructions.append("Press ", style="dim")
            instructions.append("SPACEBAR", style="bold yellow")
            instructions.append(" to start recording", style="dim")
            
            self.console.print(Panel(instructions, border_style="cyan", padding=(1, 2)))
            
            # Wait for spacebar to start recording
            with keyboard.Listener(on_press=self._on_press, on_release=self._on_release) as listener:
                # Wait for recording to start
                while not self.is_recording:
                    await asyncio.sleep(0.1)
                
                # Show recording status
                self.console.print("[bold red]🔴 Recording...[/bold red] [dim](Press SPACEBAR to stop)[/dim]")
                
                # Start recording in background thread
                self.recording_thread = threading.Thread(target=self._recording_loop, daemon=True)
                self.recording_thread.start()
                
                # Wait for spacebar to stop recording
                listener.join()
            
            # Stop recording
            audio_data = self.recorder.stop_recording()
            
            if not audio_data:
                self.console.print("[yellow]No audio recorded[/yellow]")
                return None
            
            # Save to temporary WAV file
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                tmp_path = tmp_file.name
            
            self.recorder.save_to_wav(audio_data, tmp_path)
            
            # Transcribe
            self.console.print("[dim]⏳ Transcribing...[/dim]")
            
            try:
                text = self.transcriber.transcribe(tmp_path)
                
                # Clean up temp file
                os.unlink(tmp_path)
                
                if text:
                    self.console.print(f"[green]✓ Transcribed:[/green] {text}")
                    return text
                else:
                    self.console.print("[yellow]No speech detected in recording[/yellow]")
                    return None
                    
            except Exception as e:
                os.unlink(tmp_path)
                self.console.print(f"[red]Transcription error: {e}[/red]")
                return None
        
        except Exception as e:
            self.console.print(f"[red]Voice recording error: {e}[/red]")
            return None
        finally:
            # Ensure recording is stopped
            if self.is_recording:
                self.is_recording = False
                self.recorder.stop_recording()
