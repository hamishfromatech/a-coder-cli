# TTS Setup Guide for A-Coder CLI

## Quick Start

### 1. Start Kokoro FastAPI

```bash
# CPU version (recommended)
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest

# GPU version (NVIDIA GPU required)
docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
```

Wait for the service to start. First run will download the model (~100MB).

### 2. Enable TTS in A-Coder

```
You › /tts
✓ TTS enabled │ 🔊 AI responses will be spoken
Voice: af_bella | Endpoint: http://localhost:8880/v1
```

### 3. Start Coding

AI responses will now be automatically spoken!

## Configuration

Edit `config.json` to customize TTS:

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

### Voice Options

**Female Voices:**
- `af_bella` - Bella (American Female) - Default
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
- `af_bella+af_sky` - 50/50 blend
- `af_bella(2)+af_sky(1)` - 67/33 blend

## Commands

### Toggle TTS
```
/tts
```
Enables or disables TTS. Shows current voice and endpoint.

### Change Voice
Edit `config.json`:
```json
{
  "tts": {
    "voice": "af_sky"
  }
}
```

### Adjust Speed
Edit `config.json`:
```json
{
  "tts": {
    "speed": 1.2
  }
}
```
Values: 0.5 (slow) to 2.0 (fast)

## Troubleshooting

### "TTS endpoint not available"

**Problem:** Kokoro FastAPI is not running

**Solution:**
```bash
# Start Kokoro FastAPI
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest

# Wait for startup message
# Then try /tts again in A-Coder
```

### Audio not playing

**Problem:** PyAudio not working

**Solution:**
```bash
# Reinstall PyAudio
pip install --upgrade pyaudio

# Test audio
python -c "import pyaudio; p = pyaudio.PyAudio(); print('OK')"
```

### Slow speech generation

**Causes:**
- Using large model in Kokoro
- CPU-only inference
- Network latency

**Solutions:**
- Use GPU version: `docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest`
- Kokoro FastAPI runs locally, so network shouldn't be an issue

### Voice not changing

**Solution:**
1. Edit `config.json` with new voice
2. Restart A-Coder
3. Or toggle TTS: `/tts` then `/tts` again

## Performance

- **First Use**: Model downloads (~100MB)
- **Generation Time**: 1-3 seconds per response
- **Playback**: Non-blocking, background thread
- **Memory**: ~500MB-2GB

## Features

✅ Automatic AI response playback
✅ Plan box TTS (speaks while tools execute)
✅ Final response TTS (speaks after tools complete)
✅ Complete markdown stripping (bold, italic, links, code, etc.)
✅ Smart content filtering (removes paths, URLs, JSON/XML)
✅ 30+ voice options
✅ Voice blending
✅ Configurable speed
✅ Background playback
✅ Error handling
✅ Endpoint checking

## Architecture

**With Tool Calls (Plan + Tools + Final Response):**
```
AI Plan Generated
    ↓
Plan Displayed (🎯 Plan box)
    ↓
[If TTS Enabled]
    ├─ Generate & Play Plan Speech (background)
    │
Tool Execution (parallel)
    ├─ Step 1, 2, 3... (while plan is speaking)
    │
[Wait for TTS to finish]
    ↓
Final Response Generated
    ↓
[If TTS Enabled]
    ├─ Generate & Play Response Speech
    │
Ready for Next Input
```

**Without Tool Calls (Direct Response):**
```
AI Response Generated
    ↓
Response Displayed
    ↓
[If TTS Enabled]
    ├─ Generate & Play Speech (background)
    │
Ready for Next Input
```

## Files

- `tts_mode.py` - TTS implementation
- `TTS_IMPLEMENTATION.md` - Full documentation
- `config.json.example` - Example configuration
- `a_coder_cli.py` - Integration and `/tts` command

## Next Steps

1. Start Kokoro FastAPI
2. Enable TTS with `/tts`
3. Ask AI a question
4. Listen to the response!

## Support

For issues with Kokoro FastAPI, see:
https://github.com/remsky/Kokoro-FastAPI

For A-Coder issues, check the documentation in TTS_IMPLEMENTATION.md
