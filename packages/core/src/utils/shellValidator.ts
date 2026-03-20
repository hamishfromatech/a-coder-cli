/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell command validation for non-interactive mode.
 * Restricts shell commands to safe operations.
 */

/**
 * Commands that are allowed in non-interactive mode.
 * These are considered safe because they are read-only or controlled operations.
 */
const ALLOWED_COMMAND_PREFIXES = [
  // Directory listing
  'ls',
  'ls ',
  'dir',
  'dir ',
  'tree',
  'tree ',

  // File system info
  'pwd',
  'whoami',
  'echo',
  'echo ',
  'cat',
  'cat ',
  'head',
  'head ',
  'tail',
  'tail ',
  'less',
  'less ',
  'more',
  'more ',
  'wc',
  'wc ',
  'du',
  'du ',
  'df',
  'df ',

  // Git read operations
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'git tag',
  'git remote',
  'git rev-parse',
  'git ls-files',
  'git ls-tree',

  // NPM/Yarn/PNPM scripts
  'npm run',
  'npm test',
  'npm ci',
  'npm install',
  'npm i ',
  'yarn ',
  'pnpm ',
  'npx ',

  // Node.js
  'node ',
  'node --',
  'ts-node',
  'tsx ',

  // Build tools
  'make',
  'make ',
  'cargo build',
  'cargo check',
  'cargo test',
  'gradle ',
  'mvn ',
  'pytest',
  'jest',
  'vitest',

  // Python
  'python ',
  'python3',
  'pip ',
  'pip3 ',

  // Go
  'go build',
  'go test',
  'go run',
  'go vet',

  // Rust
  'rustc',
  'rustup',
];

/**
 * Commands that are explicitly blocked even if they might match allowed prefixes.
 * These are dangerous operations.
 */
const BLOCKED_COMMAND_PATTERNS = [
  // File deletion
  /\brm\s+(-[rf]+\s+|.*-[rf]+)/i,  // rm -rf, rm -r, etc.
  /\brm\s+.*\*/i,                  // rm with wildcards
  /\brmdir\s+.*\/s/i,              // Windows rmdir /s
  /\bdel\s+.*\/[fq]/i,             // Windows del /f /q

  // Privilege escalation
  /\bsudo\b/i,
  /\bsu\s/i,
  /\bsu$/i,

  // System modification
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmkfs\b/i,
  /\bdd\s+/i,                      // dd command
  /\bformat\s+/i,

  // Network dangerous
  /\bcurl\s+.*\|\s*(bash|sh|zsh)/i,  // curl | bash
  /\bwget\s+.*\|\s*(bash|sh|zsh)/i,  // wget | bash
  /\bnc\s+.*-e/i,                     // netcat reverse shell

  // Output redirection to system files
  /\b>\s*\/(dev|etc|usr|bin|sbin|lib)/i,
  /\b>>\s*\/(dev|etc|usr|bin|sbin|lib)/i,

  // Environment variable secrets
  /\bexport\s+[A-Z_]+=.*/i,  // exporting env vars

  // Fork bombs
  /:\(\)\s*\{[^}]*:\(\)\s*\{[^}]*};\s*\};\s*:/i,

  // Shell escape sequences
  /\$\([^)]*\)/i,             // $() command substitution that could be dangerous
  /\$\{[^}]*\}/i,             // ${} variable expansion

  // Process management
  /\bkill\s+-9/i,             // kill -9
  /\bkillall\b/i,
  /\bpkill\b/i,

  // Package managers (allow install but not global)
  /\bnpm\s+(-g|--global)/i,
  /\byarn\s+global/i,
  /\bpip\s+install.*--user/i,  // pip install --user could modify system

  // Curl/Wget with output to sensitive locations
  /\b(curl|wget)\s+.*>\s*\/(etc|usr|bin)/i,
];

/**
 * Validate if a shell command is safe to run in non-interactive mode.
 * @param command The shell command to validate
 * @returns An object with 'allowed' boolean and optional 'reason' string
 */
export function validateShellCommand(command: string): { allowed: boolean; reason?: string } {
  const trimmedCommand = command.trim();

  // Empty command is not allowed
  if (!trimmedCommand) {
    return { allowed: false, reason: 'Empty command' };
  }

  // Check for blocked patterns first
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return { allowed: false, reason: `Command matches blocked pattern: ${pattern.source}` };
    }
  }

  // Check if command starts with an allowed prefix
  const lowerCommand = trimmedCommand.toLowerCase();
  for (const prefix of ALLOWED_COMMAND_PREFIXES) {
    if (lowerCommand.startsWith(prefix.toLowerCase())) {
      // Double-check it's not trying to chain with dangerous commands
      if (containsDangerousChain(trimmedCommand)) {
        return { allowed: false, reason: 'Command chains to dangerous operations' };
      }
      return { allowed: true };
    }
  }

  // Command doesn't match any allowed prefix
  return {
    allowed: false,
    reason: 'Command not in allowed list for non-interactive mode. Use --yolo to run without restrictions.'
  };
}

/**
 * Check if command contains dangerous chaining (e.g., ; or && followed by dangerous command)
 */
function containsDangerousChain(command: string): boolean {
  // Split by command separators
  const parts = command.split(/[;|&]+/).map(p => p.trim());

  for (const part of parts) {
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
      if (pattern.test(part)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get a list of allowed command categories for display
 */
export function getAllowedCommandCategories(): string[] {
  return [
    'Directory listing (ls, dir, tree)',
    'File reading (cat, head, tail, less, more)',
    'File info (pwd, whoami, wc, du, df)',
    'Git read operations (status, log, diff, show)',
    'Package scripts (npm run, yarn, pnpm)',
    'Build tools (make, cargo, gradle, pytest, jest)',
    'Language runtimes (node, python, go, rust)',
  ];
}