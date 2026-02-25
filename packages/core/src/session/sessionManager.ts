/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { Content } from '@google/genai';
import {
  SessionMetadata,
  SessionData,
  SessionSummary,
  SessionIndex,
  SessionIndexEntry,
  ListSessionsOptions,
  SessionSettings,
} from './types.js';

const SESSIONS_DIR_NAME = 'sessions';
const INDEX_FILE_NAME = 'index.json';
const SESSION_FILE_SUFFIX = '.json';
const CURRENT_INDEX_VERSION = 1;

/**
 * Default session settings.
 */
export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  autoSave: true,
  autoSaveInterval: 60000, // 1 minute
  maxSessions: 100,
};

/**
 * Manages persistent sessions for the CLI.
 * Sessions are stored in ~/.a-coder-cli/sessions/
 */
export class SessionManager {
  private sessionsDir: string;
  private indexPath: string;
  private index: SessionIndex;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private currentSessionId: string | null = null;
  private settings: SessionSettings;

  constructor(settings: Partial<SessionSettings> = {}) {
    this.sessionsDir = path.join(os.homedir(), '.a-coder-cli', SESSIONS_DIR_NAME);
    this.indexPath = path.join(this.sessionsDir, INDEX_FILE_NAME);
    this.settings = { ...DEFAULT_SESSION_SETTINGS, ...settings };
    this.index = { version: CURRENT_INDEX_VERSION, sessions: [] };
  }

  /**
   * Initialize the session manager. Must be called before using other methods.
   */
  async initialize(): Promise<void> {
    // Ensure sessions directory exists
    await fs.promises.mkdir(this.sessionsDir, { recursive: true });

    // Load or create index
    try {
      const indexContent = await fs.promises.readFile(this.indexPath, 'utf-8');
      const parsed = JSON.parse(indexContent);
      if (parsed.version === CURRENT_INDEX_VERSION && Array.isArray(parsed.sessions)) {
        this.index = parsed;
      } else {
        // Migrate or recreate index
        await this.rebuildIndex();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Index doesn't exist, create it
        await this.saveIndex();
      } else {
        // Corrupted index, rebuild it
        await this.rebuildIndex();
      }
    }
  }

  /**
   * Rebuild the index from existing session files.
   */
  private async rebuildIndex(): Promise<void> {
    const files = await fs.promises.readdir(this.sessionsDir);
    const sessionFiles = files.filter(
      (f) => f.endsWith(SESSION_FILE_SUFFIX) && f !== INDEX_FILE_NAME,
    );

    const entries: SessionIndexEntry[] = [];

    for (const file of sessionFiles) {
      try {
        const filePath = path.join(this.sessionsDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as SessionData;
        entries.push(this.sessionToIndexEntry(data));
      } catch {
        // Skip corrupted files
      }
    }

    // Sort by updatedAt descending
    entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    this.index = { version: CURRENT_INDEX_VERSION, sessions: entries };
    await this.saveIndex();
  }

  /**
   * Save the index to disk.
   */
  private async saveIndex(): Promise<void> {
    await fs.promises.writeFile(
      this.indexPath,
      JSON.stringify(this.index, null, 2),
      'utf-8',
    );
  }

  /**
   * Convert session data to an index entry.
   */
  private sessionToIndexEntry(data: SessionData): SessionIndexEntry {
    const preview = this.extractPreview(data.history);
    return {
      id: data.metadata.id,
      name: data.metadata.name,
      createdAt: data.metadata.createdAt,
      updatedAt: data.metadata.updatedAt,
      projectName: data.metadata.projectName,
      messageCount: data.metadata.messageCount,
      preview,
    };
  }

  /**
   * Extract a preview from the history (first user message).
   */
  private extractPreview(history: Content[]): string | undefined {
    const firstUserMessage = history.find((c) => c.role === 'user');
    if (!firstUserMessage?.parts) return undefined;

    const text = firstUserMessage.parts
      .filter((p): p is { text: string } => typeof p.text === 'string')
      .map((p) => p.text)
      .join('');

    if (!text) return undefined;

    // Limit preview to 100 characters
    return text.length > 100 ? text.substring(0, 97) + '...' : text;
  }

  /**
   * Generate a unique session ID.
   */
  generateSessionId(): string {
    return randomUUID();
  }

  /**
   * Generate an automatic session name.
   */
  private generateSessionName(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
    return `session-${dateStr}-${timeStr}`;
  }

  /**
   * Save a session to disk.
   */
  async saveSession(
    id: string,
    history: Content[],
    metadata: Partial<SessionMetadata>,
  ): Promise<SessionMetadata> {
    const now = new Date().toISOString();
    const isExisting = this.index.sessions.some((s) => s.id === id);

    const fullMetadata: SessionMetadata = {
      id,
      name: metadata.name || this.generateSessionName(),
      createdAt: metadata.createdAt || now,
      updatedAt: now,
      projectPath: metadata.projectPath || process.cwd(),
      projectName: metadata.projectName || path.basename(process.cwd()),
      messageCount: history.length,
      modelUsed: metadata.modelUsed || 'unknown',
    };

    const sessionData: SessionData = {
      metadata: fullMetadata,
      history,
    };

    // Save session file
    const sessionPath = path.join(this.sessionsDir, `${id}${SESSION_FILE_SUFFIX}`);
    await fs.promises.writeFile(
      sessionPath,
      JSON.stringify(sessionData, null, 2),
      'utf-8',
    );

    // Update index
    const indexEntry = this.sessionToIndexEntry(sessionData);
    if (isExisting) {
      const idx = this.index.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) {
        this.index.sessions[idx] = indexEntry;
      }
    } else {
      this.index.sessions.unshift(indexEntry);
    }

    // Sort by updatedAt descending
    this.index.sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    await this.saveIndex();

    return fullMetadata;
  }

  /**
   * Load a session from disk.
   */
  async loadSession(id: string): Promise<SessionData | null> {
    const sessionPath = path.join(this.sessionsDir, `${id}${SESSION_FILE_SUFFIX}`);
    try {
      const content = await fs.promises.readFile(sessionPath, 'utf-8');
      return JSON.parse(content) as SessionData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a session from disk.
   */
  async deleteSession(id: string): Promise<boolean> {
    const sessionPath = path.join(this.sessionsDir, `${id}${SESSION_FILE_SUFFIX}`);
    try {
      await fs.promises.unlink(sessionPath);

      // Remove from index
      this.index.sessions = this.index.sessions.filter((s) => s.id !== id);
      await this.saveIndex();

      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Rename a session.
   */
  async renameSession(id: string, newName: string): Promise<boolean> {
    const sessionData = await this.loadSession(id);
    if (!sessionData) return false;

    sessionData.metadata.name = newName;
    sessionData.metadata.updatedAt = new Date().toISOString();

    // Save updated session
    const sessionPath = path.join(this.sessionsDir, `${id}${SESSION_FILE_SUFFIX}`);
    await fs.promises.writeFile(
      sessionPath,
      JSON.stringify(sessionData, null, 2),
      'utf-8',
    );

    // Update index
    const idx = this.index.sessions.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.index.sessions[idx].name = newName;
      this.index.sessions[idx].updatedAt = sessionData.metadata.updatedAt;
      await this.saveIndex();
    }

    return true;
  }

  /**
   * List sessions with optional filtering and sorting.
   */
  async listSessions(options: ListSessionsOptions = {}): Promise<SessionSummary[]> {
    let sessions = [...this.index.sessions];

    // Filter by project name
    if (options.projectName) {
      sessions = sessions.filter((s) => s.projectName === options.projectName);
    }

    // Sort
    const sortBy = options.sortBy || 'updatedAt';
    const sortOrder = options.sortOrder || 'desc';
    sessions.sort((a, b) => {
      let comparison: number;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else {
        comparison =
          new Date(a[sortBy]).getTime() - new Date(b[sortBy]).getTime();
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Limit
    if (options.limit && options.limit > 0) {
      sessions = sessions.slice(0, options.limit);
    }

    return sessions.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      projectName: s.projectName,
      messageCount: s.messageCount,
      preview: s.preview,
    }));
  }

  /**
   * Get a session by ID or name.
   */
  async getSession(idOrName: string): Promise<SessionData | null> {
    // Try as ID first
    const byId = await this.loadSession(idOrName);
    if (byId) return byId;

    // Try as name
    const entry = this.index.sessions.find(
      (s) => s.name.toLowerCase() === idOrName.toLowerCase(),
    );
    if (entry) {
      return this.loadSession(entry.id);
    }

    return null;
  }

  /**
   * Set the current session ID.
   */
  setCurrentSessionId(id: string | null): void {
    this.currentSessionId = id;
  }

  /**
   * Get the current session ID.
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Start auto-save for the current session.
   */
  startAutoSave(
    getHistory: () => Content[],
    getMetadata: () => Partial<SessionMetadata>,
    interval?: number,
  ): void {
    this.stopAutoSave();

    const saveInterval = interval || this.settings.autoSaveInterval;

    this.autoSaveTimer = setInterval(async () => {
      if (this.currentSessionId) {
        try {
          const history = getHistory();
          const metadata = getMetadata();
          await this.saveSession(this.currentSessionId, history, metadata);
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      }
    }, saveInterval);
  }

  /**
   * Stop auto-save.
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Check if auto-save is active.
   */
  isAutoSaveActive(): boolean {
    return this.autoSaveTimer !== null;
  }

  /**
   * Cleanup old sessions when max limit is reached.
   */
  async cleanupOldSessions(): Promise<number> {
    if (this.index.sessions.length <= this.settings.maxSessions) {
      return 0;
    }

    const toRemove = this.index.sessions.length - this.settings.maxSessions;
    const removed = this.index.sessions.splice(toRemove);

    for (const session of removed) {
      try {
        const sessionPath = path.join(
          this.sessionsDir,
          `${session.id}${SESSION_FILE_SUFFIX}`,
        );
        await fs.promises.unlink(sessionPath);
      } catch {
        // Ignore errors during cleanup
      }
    }

    await this.saveIndex();
    return removed.length;
  }

  /**
   * Get completion suggestions for session names/IDs.
   */
  async getCompletionSuggestions(partial: string): Promise<string[]> {
    const sessions = this.index.sessions;
    const lowerPartial = partial.toLowerCase();

    return sessions
      .filter(
        (s) =>
          s.name.toLowerCase().includes(lowerPartial) ||
          s.id.toLowerCase().includes(lowerPartial),
      )
      .slice(0, 10)
      .map((s) => s.name);
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.stopAutoSave();
  }
}