# Voice Mode Implementation for A-Coder CLI

## Overview

Voice mode enables users to interact with A-Coder using speech-to-text input. Users can activate voice mode with the `/voice` command, then press SPACEBAR to start/stop recording. The audio is transcribed using faster-whisper and sent to the AI for processing.

## Features

- **Spacebar-based Recording**: Press SPACEBAR to start recording, press again to stop
- **Real-time Transcription**: Uses faster-whisper for fast, accurate speech-to-text
- **Configurable Models**: Support for tiny, base, small, medium, and large-v3 models
- **GPU Acceleration**: Optional CUDA support for faster transcription
- **Voice Activity Detection**: Automatic silence filtering
- **Error Handling**: Graceful fallback if dependencies aren't installed

## Architecture

### Components

#### 1. **VoiceRecorder** (`voice_mode.py`)
- Captures audio from microphone using PyAudio
- Records in 16kHz mono format (optimal for Whisper)
- Buffers audio frames and saves to temporary WAV file
- Parameters:
  - CHUNK: 1024 frames per buffer
  - FORMAT: 16-bit PCM
  - CHANNELS: 1 (mono)
  - RATE: 16000 Hz

#### 2. **VoiceTranscriber** (`voice_mode.py`)
- Loads and manages faster-whisper model
- Transcribes audio files to text
- Configurable model size and compute type
- Supports language detection and specification

#### 3. **VoiceMode** (`voice_mode.py`)
- Main orchestrator for voice recording workflow
- Manages keyboard listener for spacebar events
- Handles recording lifecycle
- Displays UI feedback to user

#### 4. **Integration** (`a_coder_cli.py`)
- `/voice` command handler in interactive mode
- Configuration management for voice settings
- Sends transcribed text to AI for processing

### Configuration

Voice settings are stored in `config.json`:

```json
{
  "voice": {
    "enabled": true,
    "model": "base",
    "device": "cpu",
    "compute_type": "int8",
    "language": "en",
    "beam_size": 5,
    "vad_filter": true
  }
}
```

**Configuration Options:**
- `enabled`: Enable/disable voice mode
- `model`: Model size (tiny, base, small, medium, large-v3)
- `device`: Compute device (cpu, cuda)
- `compute_type`: Precision (int8, float16, float32)
- `language`: Language code (e.g., "en" for English)
- `beam_size`: Beam search width for transcription
- `vad_filter`: Enable voice activity detection

## User Workflow

1. User types `/voice` in A-Coder CLI
2. System displays: "🎤 Voice mode active. Press SPACEBAR to start recording..."
3. User presses SPACEBAR → "🔴 Recording... (Press SPACEBAR to stop)"
4. User speaks into microphone
5. User presses SPACEBAR again → "⏳ Transcribing..."
6. System displays transcribed text: "✓ Transcribed: [text]"
7. Transcribed text is sent to AI as user input
8. AI processes and responds normally

## Installation

### Dependencies

Add to `requirements.txt`:
```
faster-whisper>=0.10.0
pyaudio>=0.2.13
pynput>=1.7.6
```

### Installation Steps

```bash
# Install dependencies
pip install -r requirements.txt

# macOS (using Homebrew)
brew install portaudio
pip install pyaudio

# Linux (Ubuntu/Debian)
sudo apt-get install portaudio19-dev
pip install pyaudio

# Windows
pip install pyaudio
```

## Performance Considerations

### Model Selection

- **tiny**: ~39M parameters, fastest, lowest accuracy
- **base**: ~74M parameters, good balance
- **small**: ~244M parameters, better accuracy
- **medium**: ~769M parameters, high accuracy
- **large-v3**: ~1.5B parameters, best accuracy

### Compute Type

- **int8**: Smallest memory footprint, fastest
- **float16**: Good balance of speed and accuracy
- **float32**: Highest accuracy, slowest

### Device Selection

- **cpu**: Works everywhere, slower
- **cuda**: GPU acceleration (requires NVIDIA GPU), much faster

## Error Handling

### Missing Dependencies
If faster-whisper, pyaudio, or pynput are not installed:
```
Voice mode dependencies not installed: [error]
Install with: pip install faster-whisper pyaudio pynput
```

### Microphone Issues
- No microphone detected → "Failed to start recording"
- Audio capture fails → Error message with details

### Model Download Issues
- First use downloads model (~100MB-1.5GB depending on model)
- Automatic retry on failure
- Falls back to smaller model if needed

### Transcription Errors
- No speech detected → "No speech detected in recording"
- Transcription fails → Shows error and allows retry

## Files Modified/Created

### New Files
- `voice_mode.py` - Voice recording and transcription implementation

### Modified Files
- `a_coder_cli.py` - Added `/voice` command handler and import
- `config.py` - Added VoiceConfig class and configuration loading
- `requirements.txt` - Added voice dependencies

### Updated Documentation
- `VOICE_MODE_IMPLEMENTATION.md` - This file

## Usage Examples

### Basic Voice Input
```
You › /voice
🎤 Voice mode active
Press SPACEBAR to start recording...
[User presses SPACEBAR]
🔴 Recording... (Press SPACEBAR to stop)
[User speaks: "Create a new Python file called hello.py"]
[User presses SPACEBAR]
⏳ Transcribing...
✓ Transcribed: Create a new Python file called hello.py
[AI processes and creates the file]
```

### Configuration for GPU
```json
{
  "voice": {
    "model": "base",
    "device": "cuda",
    "compute_type": "float16"
  }
}
```

### Configuration for CPU (Low Memory)
```json
{
  "voice": {
    "model": "tiny",
    "device": "cpu",
    "compute_type": "int8"
  }
}
```

## Keyboard Shortcuts

- **SPACEBAR**: Toggle recording (press to start, press again to stop)
- **Ctrl+C**: Cancel voice mode and return to normal prompt

## Troubleshooting

### PyAudio Installation Issues

**macOS:**
```bash
brew install portaudio
pip install --global-option='build_ext' --global-option='-I/usr/local/include' --global-option='-L/usr/local/lib' pyaudio
```

**Linux:**
```bash
sudo apt-get install portaudio19-dev
pip install pyaudio
```

**Windows:**
- Use pre-built wheels: `pip install pipwin && pipwin install pyaudio`

### Model Download Issues

Models are downloaded to `~/.cache/huggingface/hub/` on first use. If download fails:
1. Check internet connection
2. Ensure sufficient disk space (100MB-1.5GB)
3. Try smaller model (e.g., "tiny" instead of "base")

### Microphone Not Detected

1. Check system audio settings
2. Verify microphone is connected and enabled
3. Test with system audio recording tools
4. Try different audio input device (if multiple available)

## Future Enhancements

- [ ] Support for multiple microphone devices
- [ ] Real-time transcription (streaming)
- [ ] Speaker diarization
- [ ] Audio preprocessing (noise reduction)
- [ ] Custom vocabulary/context
- [ ] Voice command shortcuts
- [ ] Audio file input support
- [ ] Transcription history

## Technical Details

### Audio Format
- Sample Rate: 16000 Hz (16 kHz)
- Channels: 1 (Mono)
- Format: 16-bit PCM (pyaudio.paInt16)
- Chunk Size: 1024 frames

### Keyboard Listener
- Uses pynput for global keyboard monitoring
- Non-blocking listener in separate thread
- Graceful shutdown on error

### Transcription
- Uses faster-whisper (4x faster than OpenAI Whisper)
- Supports 99+ languages
- Automatic language detection
- Voice Activity Detection (VAD) filtering

## References

- [faster-whisper Documentation](https://github.com/SYSTRAN/faster-whisper)
- [PyAudio Documentation](https://people.csail.mit.edu/hubert/pyaudio/)
- [pynput Documentation](https://pynput.readthedocs.io/)
- [Whisper Model Card](https://huggingface.co/openai/whisper-base)
