/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plugin manifest schema (.claude-plugin/plugin.json)
 */
export interface PluginManifest {
  /** Unique identifier and skill namespace */
  name: string;
  /** Human-readable description shown in plugin manager */
  description: string;
  /** Semantic version for tracking releases */
  version: string;
  /** Optional author information */
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  /** Optional homepage URL */
  homepage?: string;
  /** Optional repository reference */
  repository?: {
    type: 'git' | 'github' | 'gitlab' | 'bitbucket';
    url: string;
    directory?: string;
  };
  /** Optional license identifier */
  license?: string;
  /** Plugin keywords for discovery */
  keywords?: string[];
  /** Plugin components configuration */
  components?: {
    skills?: boolean;
    agents?: boolean;
    hooks?: boolean;
    mcp?: boolean;
    lsp?: boolean;
  };
  /** Default settings applied when plugin is enabled */
  settings?: Record<string, unknown>;
}

/**
 * Plugin marketplace catalog entry
 */
export interface MarketplacePluginEntry {
  /** Plugin name (matches manifest.name) */
  name: string;
  /** Plugin description */
  description: string;
  /** Current version */
  version: string;
  /** Source repository reference - can be string (local path) or object (remote) */
  source:
    | string // Local path format: "./plugins/plugin-name"
    | {
        // Standard format (expected by PluginManager)
        type: 'git' | 'github' | 'gitlab' | 'bitbucket' | 'local';
        url?: string;
        repo?: string; // owner/repo format for GitHub
        branch?: string;
        ref?: string; // tag or commit
        path?: string; // for local marketplaces
      }
    | {
        // Actual marketplace format
        source: 'url' | 'git-subdir';
        url: string;
        sha?: string;
      };
  /** Plugin keywords */
  keywords?: string[];
  /** Categories for discovery */
  categories?: string[];
  /** Documentation URL */
  homepage?: string;
  /** Number of available code snippets */
  codeSnippets?: number;
  /** Source reputation indicator */
  sourceReputation?: 'High' | 'Medium' | 'Low' | 'Unknown';
  /** Quality benchmark score (0-100) */
  benchmarkScore?: number;
  /** Available versions */
  versions?: string[];
}

/**
 * Marketplace catalog format (.claude-plugin/marketplace.json)
 */
export interface MarketplaceCatalog {
  /** Marketplace name */
  name: string;
  /** Marketplace description */
  description?: string;
  /** Marketplace version */
  version?: string;
  /** Catalog entries */
  plugins: MarketplacePluginEntry[];
}

/**
 * Plugin source types
 */
export enum PluginSource {
  /** Installed from marketplace */
  Marketplace = 'marketplace',
  /** Local development plugin (--plugin-dir) */
  Local = 'local',
  /** Git repository URL */
  Git = 'git',
  /** GitHub repository (owner/repo) */
  GitHub = 'github',
  /** GitLab repository */
  GitLab = 'gitlab',
  /** Bitbucket repository */
  Bitbucket = 'bitbucket',
  /** Direct URL to marketplace.json */
  URL = 'url',
}

/**
 * Plugin installation scope
 */
export enum PluginScope {
  /** User scope: install for all projects (~/.a-coder-cli/plugins/) */
  User = 'user',
  /** Project scope: install for repository (.a-coder-cli/plugins/) */
  Project = 'project',
  /** Local scope: install for current directory only */
  Local = 'local',
  /** Managed scope: enforced by team/organization */
  Managed = 'managed',
}

/**
 * Plugin installation state
 */
export enum PluginState {
  /** Plugin is installed and enabled */
  Enabled = 'enabled',
  /** Plugin is installed but disabled */
  Disabled = 'disabled',
  /** Plugin installation failed */
  Error = 'error',
}

/**
 * Installed plugin metadata
 */
export interface InstalledPlugin {
  /** Unique plugin identifier */
  id: string;
  /** Plugin name (from manifest) */
  name: string;
  /** Plugin description (from manifest) */
  description: string;
  /** Plugin version (from manifest) */
  version: string;
  /** Installation scope */
  scope: PluginScope;
  /** Current state */
  state: PluginState;
  /** Source type */
  source: PluginSource;
  /** Source reference (URL, repo path, etc.) */
  sourceRef: string;
  /** Marketplace name if installed from marketplace */
  marketplaceName?: string;
  /** Installation timestamp */
  installedAt: Date;
  /** Last updated timestamp */
  updatedAt?: Date;
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Absolute path to plugin directory */
  pluginDir: string;
  /** Error message if state is Error */
  error?: string;
}

/**
 * Marketplace configuration
 */
export interface MarketplaceConfig {
  /** Unique marketplace identifier */
  id: string;
  /** Display name */
  name: string;
  /** Source type */
  source: PluginSource;
  /** Source URL or path */
  sourceRef: string;
  /** Branch/ref for git sources */
  ref?: string;
  /** Auto-update enabled */
  autoUpdate: boolean;
  /** Last fetched timestamp */
  lastFetched?: Date;
  /** Cached catalog */
  catalog?: MarketplaceCatalog;
  /** Fetch error if any */
  error?: string;
}

/**
 * Plugin discovery options
 */
export interface PluginDiscoveryOptions {
  /** Current working path */
  currentPath?: string;
  /** Include nested plugins from subdirectories */
  includeNested?: boolean;
  /** Filter by scope */
  scope?: PluginScope;
  /** Filter by source */
  source?: PluginSource;
}

/**
 * Plugin hooks configuration (hooks/hooks.json)
 */
export interface PluginHooksConfig {
  /** Hook definitions */
  hooks: {
    [eventName: string]: Array<{
      matcher?: string;
      hooks: Array<{
        type: 'command' | 'file';
        command?: string;
        file?: string;
      }>;
    }>;
  };
}

/**
 * MCP server configuration for plugins (.mcp.json)
 */
export interface PluginMcpConfig {
  [serverName: string]: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
}

/**
 * LSP server configuration for plugins (.lsp.json)
 */
export interface PluginLspConfig {
  [languageId: string]: {
    command: string;
    args?: string[];
    extensionToLanguage?: Record<string, string>;
    env?: Record<string, string>;
  };
}
