# TTS Implementation for A-Coder CLI

## Overview

Text-to-Speech (TTS) integration enables A-Coder to automatically speak AI responses using Kokoro FastAPI. This provides a hands-free, immersive coding experience where you can listen to AI guidance while working.

## Features

- **Automatic Response Playback**: AI responses are automatically spoken when TTS is enabled
- **Plan Box TTS**: Plans are spoken while tools execute in the background
- **Final Response TTS**: Final AI responses are spoken after tool execution completes
- **Smart Text Filtering**: Automatically removes code blocks, file paths, and URLs before speaking
- **Multiple Voices**: 30+ voice options with voice blending support
- **OpenAI-Compatible API**: Uses standard OpenAI audio.speech API
- **Background Playback**: Audio plays in background thread without blocking interaction
- **Configurable**: Voice, speed, and endpoint all configurable
- **Error Handling**: Graceful fallback if TTS endpoint unavailable

## Setup

### Prerequisites

Users must run Kokoro FastAPI locally. This is a self-hosted TTS service.

### Starting Kokoro FastAPI

**CPU Version (Recommended for most users):**
```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

**GPU Version (NVIDIA GPU required):**
```bash
docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
```

The service will be available at `http://localhost:8880/v1`

### Configuration

Add TTS settings to your `config.json`:

```json
{
  "tts": {
    "enabled": false,
    "endpoint": "http://localhost:8880/v1",
    "voice": "af_bella",
    "speed": 1.0,
    "auto_play_responses": true
  }
}
```

**Configuration Options:**
- `enabled`: Enable/disable TTS (default: false)
- `endpoint`: Kokoro FastAPI endpoint URL (default: http://localhost:8880/v1)
- `voice`: Voice to use (default: af_bella)
- `speed`: Speech speed multiplier (default: 1.0)
- `auto_play_responses`: Auto-play when TTS is enabled (default: true)

### Available Voices

Kokoro provides 30+ voices. Common options:

**Female Voices:**
- `af_bella` - Bella (American Female)
- `af_sky` - Sky (American Female)
- `af_heart` - Heart (American Female)
- `af_sarah` - Sarah (American Female)
- `af_nicole` - Nicole (American Female)

**Male Voices:**
- `am_adam` - Adam (American Male)
- `am_michael` - Michael (American Male)
- `bm_george` - George (British Male)
- `bm_lewis` - Lewis (British Male)

**Voice Blending:**
You can blend voices with equal or weighted ratios:
- `af_bella+af_sky` - 50/50 blend
- `af_bella(2)+af_sky(1)` - 67/33 blend

## Usage

### Enabling TTS

In A-Coder CLI:
```
You › /tts
✓ TTS enabled │ 🔊 AI responses will be spoken
Voice: af_bella | Endpoint: http://localhost:8880/v1
```

### Disabling TTS

```
You › /tts
✓ TTS disabled │ 🔇 AI responses will not be spoken
```

### Automatic Playback

Once enabled, every AI response will be automatically spoken:
1. AI generates response
2. Response is displayed in panel
3. Text is cleaned (code blocks, paths, URLs removed)
4. Audio generation starts (shows "🔊 Generating speech...")
5. Audio plays in background while you continue working

### Smart Text Filtering

TTS automatically removes all markdown and non-speech content before generating audio:

**Markdown Removed:**
- Code blocks (```code```)
- Inline code (`` `code` ``)
- Bold (**text** or __text__)
- Italic (*text* or _text_)
- Links ([text](url))
- Headings (#, ##, ###)
- Horizontal rules (---, ***, ___)
- Blockquotes (> text)
- Lists (-, *, +, or numbered)

**Other Content Removed:**
- File paths (/path/to/file, C:\path\to\file, ./relative/path)
- URLs (http://example.com)
- JSON/XML structures (lines starting with {, [, <)

**Example:**

Original response:
```
I've created a new function in `/src/utils.py`:

```python
def calculate_fibonacci(n):
    if n <= 1:
        return n
    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)
```

This **function** calculates the *nth* Fibonacci number recursively.

See [documentation](https://example.com) for more details.
```

Spoken text:
```
This function calculates the nth Fibonacci number recursively. See documentation for more details.
```

Only the meaningful explanation is spoken, with all markdown and code stripped!

### Changing Voice

Edit `config.json` and change the `voice` field:
```json
{
  "tts": {
    "voice": "af_sky"
  }
}
```

Then restart A-Coder or toggle TTS off/on to apply changes.

## Architecture

### Components

#### TTSPlayer
- Handles audio playback using PyAudio
- Plays audio in 16-bit mono format
- Supports streaming playback

#### TTSMode
- Main TTS orchestrator
- Manages OpenAI client connection to Kokoro FastAPI
- Generates speech from text
- Handles voice availability checking

#### Integration
- TTS is lazily initialized on first use
- Runs in background thread to avoid blocking
- Integrated with chat_with_ai() method
- Controlled via `/tts` command

### Flow

**With Tool Calls:**
```
User Input
    ↓
AI Processing
    ↓
Plan Generated
    ↓
Plan Displayed (🎯 Plan box)
    ↓
[If TTS Enabled]
    ├─ Speak Plan (background)
    │
Tool Execution (parallel)
    ├─ Step 1: Execute tool
    ├─ Step 2: Execute tool
    └─ Step 3: Execute tool
    ↓
[Wait for TTS to finish]
    ↓
Get Final Response
    ↓
[If TTS Enabled]
    ├─ Speak Final Response
    │
Ready for Next Input
```

**Without Tool Calls:**
```
User Input
    ↓
AI Processing
    ↓
Response Generated
    ↓
Response Displayed
    ↓
[If TTS Enabled]
    ├─ Speak Response (background)
    │
Ready for Next Input
```

## Configuration Examples

### Minimal Setup (CPU)
```json
{
  "tts": {
    "enabled": false,
    "endpoint": "http://localhost:8880/v1"
  }
}
```

### GPU Optimized
```json
{
  "tts": {
    "enabled": false,
    "endpoint": "http://localhost:8880/v1",
    "voice": "af_bella",
    "speed": 1.0,
    "auto_play_responses": true
  }
}
```

### Custom Voice Blend
```json
{
  "tts": {
    "enabled": false,
    "endpoint": "http://localhost:8880/v1",
    "voice": "af_bella(2)+af_sky(1)",
    "speed": 1.2
  }
}
```

## Troubleshooting

### TTS Endpoint Not Available

**Error:**
```
⚠ TTS endpoint not available
Make sure Kokoro FastAPI is running on http://localhost:8880/v1
```

**Solution:**
1. Start Kokoro FastAPI: `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest`
2. Wait for it to start (first run downloads model ~100MB)
3. Try `/tts` again

### Audio Not Playing

**Possible Causes:**
- PyAudio not installed or misconfigured
- No audio output device
- Audio permissions issue

**Solution:**
```bash
# Reinstall PyAudio
pip install --upgrade pyaudio

# Test audio output
python -c "import pyaudio; print('PyAudio OK')"
```

### Slow Speech Generation

**Causes:**
- Using large model (medium, large-v3)
- CPU-only inference
- Network latency to Kokoro FastAPI

**Solutions:**
- Use smaller model (tiny, base)
- Use GPU version of Kokoro FastAPI
- Ensure Kokoro FastAPI is running locally

### Voice Not Changing

**Solution:**
1. Edit `config.json` with new voice
2. Restart A-Coder
3. Or toggle TTS off/on to reload config

## Performance Notes

- **First Use**: Model downloads on first request (~100MB for base model)
- **Generation Time**: 1-3 seconds for typical response (depends on length and model)
- **Playback**: Non-blocking, runs in background thread
- **Memory**: ~500MB-2GB depending on model size

## API Details

### OpenAI-Compatible Endpoints

Kokoro FastAPI provides OpenAI-compatible endpoints:

**Generate Speech:**
```python
response = await client.audio.speech.create(
    model="kokoro",
    voice="af_bella",
    input="Your text here",
    response_format="pcm"
)
```

**List Voices:**
```python
response = await client.get("http://localhost:8880/v1/audio/voices")
```

## Files Modified/Created

### New Files
- `tts_mode.py` - TTS implementation (TTSPlayer, TTSMode classes)
- `TTS_IMPLEMENTATION.md` - This documentation

### Modified Files
- `config.py` - Added TTSConfig class and configuration loading
- `a_coder_cli.py` - Added `/tts` command handler and TTS integration
- `requirements.txt` - No changes (uses existing httpx dependency)

## Future Enhancements

- [ ] Voice selection command (`/tts-voice <name>`)
- [ ] Speed adjustment command (`/tts-speed <1.0-2.0>`)
- [ ] Endpoint configuration command
- [ ] Voice preview (speak sample text)
- [ ] Streaming audio generation
- [ ] Audio file export
- [ ] Plan box TTS (speak AI plans separately)
- [ ] Selective response TTS (only speak certain types)

## References

- [Kokoro FastAPI GitHub](https://github.com/remsky/Kokoro-FastAPI)
- [Kokoro TTS Model](https://huggingface.co/hexgrad/Kokoro-82M)
- [OpenAI Audio API](https://platform.openai.com/docs/api-reference/audio)
- [PyAudio Documentation](https://people.csail.mit.edu/hubert/pyaudio/)
