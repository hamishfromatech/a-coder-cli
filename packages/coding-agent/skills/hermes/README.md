# Hermes skills vendored for a-coder-cli

The built-in skills in this directory come from
[Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT, Nous
Research). Only the skills relevant to coding, engineering, marketing,
computer and browser use are vendored (built-in and optional); the rest of the
Hermes library is deliberately omitted.

## Tool mapping

Hermes and a-coder-cli expose the same capabilities under different tool names:

| Hermes | a-coder-cli |
|---|---|
| `terminal` | `bash` |
| `read_file` / `write_file` / `patch` | `read` / `write` / `edit` |
| `search_files` | `bash` (`rg`) |
| `delegate_task` | `spawn_subagent` (one call per subagent) |
| `computer_use` | `computer` |
| `browser_exec` | `browser_run_script` |
| `browser_vision` | `browser_screenshot` |
| `cronjob` | `schedule_task` |

`web_search`, `web_extract`, `image_generate` and `vision_analyze` have no
built-in a-coder-cli equivalent. Use an available MCP or browser tool, or skip
that step.

## Refreshing the set

```sh
node scripts/sync-hermes-skills.mjs --source ../hermes-agent
node scripts/sync-hermes-skills.mjs --source ../hermes-agent --check
```

The sync script owns these files: edit the selection or the porting overrides
there, not the generated copies.
