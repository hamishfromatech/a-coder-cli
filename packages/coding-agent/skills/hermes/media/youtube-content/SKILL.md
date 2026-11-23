---
name: youtube-content
description: "YouTube transcripts to summaries, threads, blogs."
version: 1.0.0
author: Teknium (teknium1), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [YouTube, Video, Transcripts, Media]
    related_skills: []
---

> Ported from [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT, Nous Research).
> In a-coder-cli: `terminal` is `bash`; `read_file`/`write_file`/`patch` are `read`/`write`/`edit`;
> `search_files` is `bash` (`rg`); `delegate_task` is `spawn_subagent` (one call per subagent);
> `computer_use` is `computer`; `browser_exec` is `browser_run_script`; `browser_vision` is
> `browser_screenshot`; `cronjob` is `schedule_task`. `web_search`, `web_extract`,
> `image_generate` and `vision_analyze` have no built-in equivalent here; use an available
> MCP/browser tool or skip that step.

# YouTube Content Tool

## When to use

Use when the user shares a YouTube URL or video link, asks to summarize a video, requests a transcript, or wants to extract and reformat content from any YouTube video. Transforms transcripts into structured content (chapters, summaries, threads, blog posts).

Extract transcripts from YouTube videos and convert them into useful formats.

## Setup

Use `bash` with a Python interpreter that has `youtube-transcript-api`
installed. If it is missing, create a throwaway venv:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install youtube-transcript-api
python -c "import youtube_transcript_api; print(youtube_transcript_api.__file__)"
```

Run every command below with the interpreter whose import check succeeded.

## Helper Script

`${SKILL_DIR}` is the directory containing this SKILL.md file. The script accepts any standard YouTube URL format, short links (youtu.be), shorts, embeds, live links, or a raw 11-character video ID.

```bash
# JSON output with metadata
python ${SKILL_DIR}/scripts/fetch_transcript.py "https://youtube.com/watch?v=VIDEO_ID"

# Plain text (good for piping into further processing)
python ${SKILL_DIR}/scripts/fetch_transcript.py "URL" --text-only

# With timestamps
python ${SKILL_DIR}/scripts/fetch_transcript.py "URL" --timestamps

# Specific language with fallback chain
python ${SKILL_DIR}/scripts/fetch_transcript.py "URL" --language tr,en
```

## Output Formats

After fetching the transcript, format it based on what the user asks for:

- **Chapters**: Group by topic shifts, output timestamped chapter list
- **Summary**: Concise 5-10 sentence overview of the entire video
- **Chapter summaries**: Chapters with a short paragraph summary for each
- **Thread**: Twitter/X thread format — numbered posts, each under 280 chars
- **Blog post**: Full article with title, sections, and key takeaways
- **Quotes**: Notable quotes with timestamps

### Example — Chapters Output

```
00:00 Introduction — host opens with the problem statement
03:45 Background — prior work and why existing solutions fall short
12:20 Core method — walkthrough of the proposed approach
24:10 Results — benchmark comparisons and key takeaways
31:55 Q&A — audience questions on scalability and next steps
```

## Workflow

1. **Fetch** the transcript using `bash` and the prepared Python with `--text-only --timestamps`.
2. **Validate**: confirm the output is non-empty and in the expected language. If empty, retry without `--language` to get any available transcript. If still empty, tell the user the video likely has transcripts disabled.
3. **Chunk if needed**: if the transcript exceeds ~50K characters, split into overlapping chunks (~40K with 2K overlap) and summarize each chunk before merging.
4. **Transform** into the requested output format. If the user did not specify a format, default to a summary.
5. **Verify**: re-read the transformed output to check for coherence, correct timestamps, and completeness before presenting.

## Error Handling

- **Transcript disabled**: tell the user; suggest they check if subtitles are available on the video page.
- **Private/unavailable video**: relay the error and ask the user to verify the URL.
- **No matching language**: retry without `--language` to fetch any available transcript, then note the actual language to the user.
- **Dependency missing**: repeat PM preparation and reactivation above, then verify the helper uses that Python. Do not repair the selected generation with pip.
