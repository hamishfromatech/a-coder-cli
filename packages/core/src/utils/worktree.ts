/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { findGitRoot } from './gitUtils.js';

const execAsync = promisify(exec);

/**
 * Information about a created worktree
 */
export interface WorktreeInfo {
  /** Path to the worktree directory */
  path: string;

  /** Name of the branch created for the worktree */
  branch: string;

  /** Original git repository root */
  repoRoot: string;
}

/**
 * Create a new git worktree for isolated operations
 *
 * @param repoRoot - The root of the git repository
 * @param branchName - Name for the new branch
 * @param baseBranch - Optional base branch to create from (defaults to current branch)
 * @returns Information about the created worktree
 */
export async function createWorktree(
  repoRoot: string,
  branchName: string,
  baseBranch?: string,
): Promise<WorktreeInfo> {
  // Ensure we're in a git repository
  const gitRoot = findGitRoot(repoRoot);
  if (!gitRoot) {
    throw new Error('Not in a git repository');
  }

  // Create worktrees directory
  const worktreesDir = path.join(gitRoot, '.claude', 'worktrees');
  await fs.promises.mkdir(worktreesDir, { recursive: true });

  const worktreePath = path.join(worktreesDir, branchName);

  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree already exists at ${worktreePath}`);
  }

  // Get current branch if baseBranch not specified
  let base = baseBranch;
  if (!base) {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: gitRoot,
    });
    base = stdout.trim() || 'HEAD';
  }

  try {
    // Create the worktree with a new branch
    // git worktree add -b <new-branch> <path> <start-point>
    await execAsync(
      `git worktree add -b "${branchName}" "${worktreePath}" "${base}"`,
      { cwd: gitRoot },
    );

    return {
      path: worktreePath,
      branch: branchName,
      repoRoot: gitRoot,
    };
  } catch (error) {
    // Clean up the worktrees directory if creation failed
    try {
      await fs.promises.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Remove a git worktree
 *
 * @param repoRoot - The root of the git repository
 * @param worktreePath - Path to the worktree to remove
 * @param deleteBranch - Whether to delete the associated branch (default: true)
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  deleteBranch = true,
): Promise<void> {
  const gitRoot = findGitRoot(repoRoot);
  if (!gitRoot) {
    throw new Error('Not in a git repository');
  }

  // Remove the worktree
  try {
    await execAsync(`git worktree remove "${worktreePath}"`, { cwd: gitRoot });
  } catch {
    // Force removal if normal removal fails
    try {
      await execAsync(`git worktree remove --force "${worktreePath}"`, {
        cwd: gitRoot,
      });
    } catch {
      // If force removal also fails, try manual cleanup
      await fs.promises.rm(worktreePath, { recursive: true, force: true });
    }
  }

  // Delete the associated branch if requested
  if (deleteBranch) {
    const branchName = path.basename(worktreePath);
    try {
      await execAsync(`git branch -D "${branchName}"`, { cwd: gitRoot });
    } catch {
      // Branch might not exist or might be checked out elsewhere
      // This is not critical, so we just log and continue
      console.warn(`Could not delete branch ${branchName}: it may not exist`);
    }
  }
}

/**
 * List all worktrees in a repository
 *
 * @param repoRoot - The root of the git repository
 * @returns Array of worktree paths
 */
export async function listWorktrees(repoRoot: string): Promise<string[]> {
  const gitRoot = findGitRoot(repoRoot);
  if (!gitRoot) {
    return [];
  }

  try {
    const { stdout } = await execAsync('git worktree list --porcelain', {
      cwd: gitRoot,
    });
    // Parse output - each worktree is on a line starting with "worktree"
    const lines = stdout.split('\n');
    return lines
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.substring('worktree '.length).trim());
  } catch {
    return [];
  }
}

/**
 * Check if a path is within the worktrees directory
 *
 * @param checkPath - Path to check
 * @param repoRoot - Repository root
 * @returns True if the path is in the worktrees directory
 */
export function isWorktreePath(checkPath: string, repoRoot: string): boolean {
  const worktreesDir = path.join(repoRoot, '.claude', 'worktrees');
  const normalizedPath = path.normalize(checkPath);
  const normalizedWorktreesDir = path.normalize(worktreesDir);
  return normalizedPath.startsWith(normalizedWorktreesDir);
}

/**
 * Clean up stale worktrees (those whose directories no longer exist)
 *
 * @param repoRoot - The root of the git repository
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  const gitRoot = findGitRoot(repoRoot);
  if (!gitRoot) {
    return;
  }

  try {
    await execAsync('git worktree prune', { cwd: gitRoot });
  } catch (error) {
    console.warn('Failed to prune worktrees:', error);
  }
}

/**
 * Generate a unique branch name for a subagent
 *
 * @param prefix - Prefix for the branch name (default: 'subagent')
 * @returns A unique branch name
 */
export function generateWorktreeBranchName(prefix = 'subagent'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}