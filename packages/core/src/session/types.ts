/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content } from '@google/genai';

/**
 * Metadata for a persisted session.
 */
export interface SessionMetadata {
  /** Unique identifier for the session (UUID) */
  id: string;
  /** Auto-generated or custom name for the session */
  name: string;
  /** ISO timestamp when the session was created */
  createdAt: string;
  /** ISO timestamp when the session was last saved */
  updatedAt: string;
  /** Project root directory path */
  projectPath: string;
  /** Project directory name */
  projectName: string;
  /** Number of conversation turns in the session */
  messageCount: number;
  /** The AI model used in this session */
  modelUsed: string;
}

/**
 * Complete session data including history.
 */
export interface SessionData {
  /** Session metadata */
  metadata: SessionMetadata;
  /** Gemini chat history */
  history: Content[];
}

/**
 * Summary of a session for listing purposes.
 */
export interface SessionSummary {
  /** Unique identifier for the session */
  id: string;
  /** Session name */
  name: string;
  /** ISO timestamp when the session was created */
  createdAt: string;
  /** ISO timestamp when the session was last saved */
  updatedAt: string;
  /** Project directory name */
  projectName: string;
  /** Number of conversation turns */
  messageCount: number;
  /** Preview of the first user message (optional) */
  preview?: string;
}

/**
 * Session index entry for fast lookup.
 */
export interface SessionIndexEntry {
  /** Unique identifier for the session */
  id: string;
  /** Session name */
  name: string;
  /** ISO timestamp when the session was created */
  createdAt: string;
  /** ISO timestamp when the session was last saved */
  updatedAt: string;
  /** Project directory name */
  projectName: string;
  /** Number of conversation turns */
  messageCount: number;
  /** Preview of the first user message */
  preview?: string;
}

/**
 * Session index structure for fast lookups.
 */
export interface SessionIndex {
  /** Version of the index format */
  version: number;
  /** Array of session index entries */
  sessions: SessionIndexEntry[];
}

/**
 * Options for listing sessions.
 */
export interface ListSessionsOptions {
  /** Filter by project name */
  projectName?: string;
  /** Maximum number of sessions to return */
  limit?: number;
  /** Sort by field (default: updatedAt) */
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  /** Sort order (default: desc) */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Settings for session management.
 */
export interface SessionSettings {
  /** Enable auto-save (default: true) */
  autoSave: boolean;
  /** Auto-save interval in milliseconds (default: 60000) */
  autoSaveInterval: number;
  /** Maximum number of sessions to keep (default: 100) */
  maxSessions: number;
}