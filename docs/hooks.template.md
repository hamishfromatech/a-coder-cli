{
  "hooks": {
    // Called before a tool is executed. Can allow, deny, or modify tool arguments.
    // Matched by hook "matcher" against the tool name.
    // Supports: exact name "Shell", wildcard "Shell(*)", regex "Shell.*"
    "PreToolUse": [
      // ========================================
      // SHELL COMMAND SAFETY
      // ========================================

      // Deny specific dangerous commands
      {
        "matcher": "Shell",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"permissionDecision\":\"allow\"}'"
          }
        ]
      }

      // Example: deny specific dangerous patterns
      // {
      //   "matcher": "Shell",
      //   "hooks": [
      //     {
      //       "type": "command",
      //       "command": "command=$(jq -r '.tool_input.command // empty') && if [[ \"$command\" =~ 'rm\\ -rf\\ /' ]] || [[ \"$command\" =~ 'format\\ ' ]] || [[ \"$command\" =~ '>\\ /dev/sd' ]] || [[ \"$command\" =~ 'sudo\\ reboot' ]]; then echo '{\"permissionDecision\":\"deny\",\"error\":\"Dangerous shell command blocked by hooks.template.json\"}'; else echo '{\"permissionDecision\":\"allow\"}'; fi"
      //     }
      //   ]
      // }

      // Example: use an LLM prompt to validate shell commands
      // {
      //   "matcher": "Shell",
      //   "hooks": [
      //     {
      //       "type": "prompt",
      //       "prompt": "You are a security gate. Validate this shell command. If it is destructive (rm -rf, rm /*, format, dd, mkfs, chmod 777 /, etc.) or otherwise dangerous, deny it. Otherwise allow it.",
      //       "timeout": 15000
      //     }
      //   ]
      // }

      // ========================================
      // TOOL-SPECIFIC BLOCKS
      // ========================================

      // Block file writes outside the project directory
      // {
      //   "matcher": "Write",
      //   "hooks": [
      //     {
      //       "type": "command",
      //       "command": "file_path=$(jq -r '.tool_input.file_path // empty') && if [[ ! \"$file_path\" =~ ^./ ]]; then echo '{\"permissionDecision\":\"deny\",\"error\":\"Can only write to files in the project directory\"}'; else echo '{\"permissionDecision\":\"allow\"}'; fi"
      //     }
      //   ]
      // }

      // Block network access
      // {
      //   "matcher": "WebFetch",
      //   "hooks": [
      //     {
      //       "type": "command",
      //       "command": "echo '{\"permissionDecision\":\"deny\",\"error\":\"WebFetch blocked by hooks.template.json\"}'"
      //     }
      //   ]
      // }

      // ========================================
      // ARGUMENT MODIFICATION
      // ========================================

      // Example: auto-approve but modify arguments
      // {
      //   "matcher": "Shell",
      //   "hooks": [
      //     {
      //       "type": "command",
      //       "command": "jq '. + {\"updatedInput\": {\"command\": \"echo HOOK: $(jq -r '.tool_input.command')\"}}' << EOF\n$(cat)\nEOF"
      //     }
      //   ]
      // }

      // ========================================
      // OTHER HOOK EVENTS
      // ========================================

      // Called when the session starts. Useful for injecting context.
      // "SessionStart": [
      //   {
      //     "matcher": "startup",
      //     "hooks": [
      //       { "type": "command", "command": "cat ~/.a-coder-cli/projects/*/heartbeat.md 2>/dev/null || true" }
      //     ]
      //   }
      // ],

      // Called when the AI finishes responding.
      // "Stop": [
      //   {
      //     "hooks": [
      //       { "type": "command", "command": "echo 'Session completed'" }
      //     ]
      //   }
      // ],

      // Called when the user submits a prompt.
      // "UserPromptSubmit": [
      //   {
      //     "hooks": [
      //       { "type": "command", "command": "echo 'Prompt received'" }
      //     ]
      //   }
      // ],

      // Called for idle/permission prompts.
      // "Notification": [
      //   {
      //     "matcher": "idle_prompt",
      //     "hooks": [
      //       { "type": "command", "command": "echo 'AI idle - needs input'" }
      //     ]
      //   }
      // ]
    ]
  }
}
