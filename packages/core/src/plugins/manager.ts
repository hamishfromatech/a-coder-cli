/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import {
  PluginManifest,
  PluginSource,
  PluginScope,
  PluginState,
  InstalledPlugin,
  MarketplaceConfig,
  MarketplaceCatalog,
} from './types.js';
import { PluginRegistry } from './registry.js';
import { PluginDiscovery } from './discovery.js';
// Import SETTINGS_DIRECTORY_NAME from cli package (plugin system is coupled with cli)
const SETTINGS_DIRECTORY_NAME = '.a-coder-cli';

/**
 * Plugin manager for installing, enabling, disabling, and uninstalling plugins
 */
export class PluginManager {
  private registry: PluginRegistry;
  private discovery: PluginDiscovery;
  private marketplaces: Map<string, MarketplaceConfig> = new Map();

  constructor() {
    this.registry = new PluginRegistry();
    this.discovery = new PluginDiscovery();
  }

  /**
   * Initialize by discovering all installed plugins
   */
  async initialize(): Promise<void> {
    const plugins = await this.discovery.discoverAll();
    this.registry.registerAll(plugins);

    // Also load marketplaces from disk
    // Note: This should only run once during initialization
    if (this.marketplaces.size === 0) {
      await this.reloadMarketplaces();
    }
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): InstalledPlugin[] {
    return this.registry.getAll();
  }

  /**
   * Get a plugin by name or id
   */
  getPlugin(nameOrId: string): InstalledPlugin | undefined {
    return this.registry.getByName(nameOrId) || this.registry.get(nameOrId);
  }

  /**
   * Add a marketplace
   */
  async addMarketplace(
    id: string,
    source: PluginSource,
    sourceRef: string,
    ref?: string,
  ): Promise<MarketplaceConfig> {
    const config: MarketplaceConfig = {
      id,
      name: id,
      source,
      sourceRef,
      ref,
      autoUpdate: source === PluginSource.GitHub, // Enable auto-update for official marketplace
      lastFetched: undefined,
      catalog: undefined,
    };

    // Fetch the catalog
    try {
      await this.fetchMarketplaceCatalog(config);
      // Update ID to use the actual marketplace name if available
      if (config.catalog && config.catalog.name) {
        const newId = config.catalog.name;
        config.id = newId;
        config.name = newId;
        this.marketplaces.set(newId, config);
        // Also keep the original ID for backward compatibility
        if (newId !== id) {
          this.marketplaces.set(id, config);
        }
      } else {
        this.marketplaces.set(id, config);
      }
    } catch (error) {
      config.error = error instanceof Error ? error.message : String(error);
      this.marketplaces.set(id, config);
    }

    return config;
  }

  /**
   * Fetch marketplace catalog
   */
  async fetchMarketplaceCatalog(config: MarketplaceConfig): Promise<void> {
    let catalogPath: string;

    switch (config.source) {
      case PluginSource.GitHub:
        // Clone or fetch the repo
        catalogPath = await this.cloneGitSource(
          config.sourceRef,
          config.ref || 'main',
        );
        break;
      case PluginSource.Local:
        catalogPath = config.sourceRef;
        break;
      case PluginSource.URL:
        // Download the marketplace.json
        catalogPath = await this.downloadUrlSource(config.sourceRef);
        break;
      default:
        throw new Error(`Unsupported source type: ${config.source}`);
    }

    // Read and parse the marketplace.json
    const marketplacePath = path.join(catalogPath, '.claude-plugin', 'marketplace.json');
    if (!fs.existsSync(marketplacePath)) {
      throw new Error('marketplace.json not found');
    }

    const content = fs.readFileSync(marketplacePath, 'utf-8');
    config.catalog = JSON.parse(content) as MarketplaceCatalog;
    config.lastFetched = new Date();
    config.error = undefined;
  }

  /**
   * Clone a git source and return the path
   */
  private async cloneGitSource(repo: string, ref: string): Promise<string> {
    const cacheDir = path.join(homedir(), SETTINGS_DIRECTORY_NAME, 'marketplaces');
    const dirName = repo.replace(/[^a-zA-Z0-9-]/g, '-');
    const targetPath = path.join(cacheDir, dirName);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (fs.existsSync(targetPath)) {
      // Pull latest
      execSync('git pull', { cwd: targetPath, stdio: 'ignore' });
      if (ref && ref !== 'main') {
        execSync(`git checkout ${ref}`, { cwd: targetPath, stdio: 'ignore' });
      }
    } else {
      // Clone
      let url: string;
      if (repo.includes('github.com')) {
        url = repo;
      } else if (repo.includes('/')) {
        // Assume owner/repo format for GitHub
        url = `https://github.com/${repo}.git`;
      } else {
        url = repo;
      }
      execSync(`git clone ${url} ${dirName}`, { cwd: cacheDir, stdio: 'ignore' });
      if (ref && ref !== 'main') {
        execSync(`git checkout ${ref}`, { cwd: targetPath, stdio: 'ignore' });
      }
    }

    return targetPath;
  }

  /**
   * Download a URL source
   */
  private async downloadUrlSource(url: string): Promise<string> {
    const cacheDir = path.join(homedir(), SETTINGS_DIRECTORY_NAME, 'marketplaces');
    const dirName = 'url-' + url.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 50);
    const targetPath = path.join(cacheDir, dirName);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // For URL sources, we'd need to download and parse
    // This is a simplified implementation
    throw new Error('URL marketplace not yet implemented');
  }

  /**
   * List all marketplaces
   */
  listMarketplaces(): MarketplaceConfig[] {
    return Array.from(this.marketplaces.values());
  }

  /**
   * Convert marketplace source format to standard source format
   */
  private convertMarketplaceSource(source: any): {
    type: 'git' | 'github' | 'gitlab' | 'bitbucket' | 'local';
    url?: string;
    repo?: string;
    ref?: string;
    path?: string;
  } {
    if (typeof source === 'string') {
      // Local path format: "./plugins/plugin-name"
      if (source.startsWith('./') || source.startsWith('/') || source.startsWith('..')) {
        return {
          type: 'local',
          path: source,
        };
      } else {
        // Assume it's a GitHub repo
        return {
          type: 'github',
          repo: source,
        };
      }
    } else if (source && typeof source === 'object') {
      // Check if it's already the standard format
      if ('type' in source) {
        return source;
      }
      // Check if it's the marketplace format
      if ('source' in source && source.url) {
        if (source.source === 'url' || source.source === 'git-subdir') {
          return {
            type: 'github',
            url: source.url,
            ref: source.sha,
          };
        }
      }
    }

    throw new Error(`Unsupported plugin source format: ${JSON.stringify(source)}`);
  }

  /**
   * Remove a marketplace
   */
  removeMarketplace(id: string): boolean {
    return this.marketplaces.delete(id);
  }

  /**
   * Install a plugin from a marketplace
   */
  async install(
    pluginName: string,
    marketplaceName: string,
    scope: PluginScope = PluginScope.User,
  ): Promise<InstalledPlugin> {
    const marketplace = this.marketplaces.get(marketplaceName);
    if (!marketplace || !marketplace.catalog) {
      throw new Error(`Marketplace '${marketplaceName}' not found or not loaded`);
    }

    const entry = marketplace.catalog.plugins.find((p) => p.name === pluginName);
    if (!entry) {
      throw new Error(`Plugin '${pluginName}' not found in marketplace '${marketplaceName}'`);
    }

    // Determine install location based on scope
    let installDir: string;
    switch (scope) {
      case PluginScope.User:
        installDir = path.join(homedir(), SETTINGS_DIRECTORY_NAME, 'plugins');
        break;
      case PluginScope.Project:
        installDir = path.join(process.cwd(), SETTINGS_DIRECTORY_NAME, 'plugins');
        break;
      case PluginScope.Local:
        installDir = path.join(process.cwd(), 'plugins');
        break;
      default:
        throw new Error(`Unsupported scope: ${scope}`);
    }

    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    // Clone the plugin repository
    const pluginDir = path.join(installDir, pluginName);

    try {
      let sourceRefValue: string = '';

      // Convert marketplace source to standard format
      const standardSource = this.convertMarketplaceSource(entry.source);

      if (standardSource.type === 'github' || standardSource.type === 'git') {
        const repo = standardSource.repo || standardSource.url;
        if (!repo) {
          throw new Error('No repository specified');
        }

        sourceRefValue = repo;

        // Check if repo is already a full URL
        const url = repo.includes('://')
          ? repo
          : repo.includes('github.com')
            ? `https://github.com/${repo}.git`
            : repo;

        if (fs.existsSync(pluginDir)) {
          // Pull latest
          execSync('git pull', { cwd: pluginDir, stdio: 'ignore' });
        } else {
          execSync(`git clone ${url} ${pluginName}`, { cwd: installDir, stdio: 'ignore' });
        }

        if (standardSource.ref) {
          execSync(`git checkout ${standardSource.ref}`, { cwd: pluginDir, stdio: 'ignore' });
        }
      } else if (standardSource.type === 'local') {
        const srcPath = standardSource.path;
        if (!srcPath || !fs.existsSync(srcPath)) {
          throw new Error('Local plugin path not found');
        }
        sourceRefValue = srcPath;
        // Copy recursively
        this.copyRecursive(srcPath, pluginDir);
      } else {
        throw new Error(`Unsupported plugin source type: ${standardSource.type}`);
      }

      // Load and validate the plugin
      const installedPlugin = await this.discovery.loadPlugin(
        pluginDir,
        scope,
        PluginSource.Marketplace,
      );

      if (!installedPlugin) {
        throw new Error('Failed to load plugin after installation');
      }

      installedPlugin.marketplaceName = marketplaceName;
      // Handle different source formats for sourceRef
      let sourceRefStr = sourceRefValue;
      if (!sourceRefStr && typeof entry.source === 'object') {
        if ('url' in entry.source && entry.source.url) {
          sourceRefStr = entry.source.url;
        } else if ('path' in entry.source && entry.source.path) {
          sourceRefStr = entry.source.path;
        } else if ('source' in entry.source && entry.source.url) {
          // Marketplace format
          sourceRefStr = entry.source.url;
        }
      } else if (!sourceRefStr && typeof entry.source === 'string') {
        sourceRefStr = entry.source;
      }
      installedPlugin.sourceRef = sourceRefStr || '';
      installedPlugin.installedAt = new Date();

      // Register the plugin
      this.registry.register(installedPlugin);

      return installedPlugin;
    } catch (error) {
      // Clean up on failure
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginNameOrId: string): Promise<boolean> {
    const plugin = this.getPlugin(pluginNameOrId);
    if (!plugin) {
      return false;
    }

    // Remove from registry
    this.registry.delete(plugin.id);

    // Remove from disk
    try {
      if (fs.existsSync(plugin.pluginDir)) {
        fs.rmSync(plugin.pluginDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`Warning: Could not remove plugin directory: ${error}`);
    }

    return true;
  }

  /**
   * Enable a disabled plugin
   */
  enable(pluginNameOrId: string): boolean {
    const plugin = this.getPlugin(pluginNameOrId);
    if (!plugin) {
      return false;
    }

    return this.registry.update(plugin.id, { state: PluginState.Enabled });
  }

  /**
   * Disable a plugin
   */
  disable(pluginNameOrId: string): boolean {
    const plugin = this.getPlugin(pluginNameOrId);
    if (!plugin) {
      return false;
    }

    return this.registry.update(plugin.id, { state: PluginState.Disabled });
  }

  /**
   * Reload plugins (e.g., after adding new skills)
   */
  async reload(): Promise<void> {
    await this.initialize();
  }

  /**
   * Reload marketplaces from disk
   */
  async reloadMarketplaces(): Promise<void> {
    const cacheDir = path.join(homedir(), SETTINGS_DIRECTORY_NAME, 'marketplaces');

    if (!fs.existsSync(cacheDir)) {
      return;
    }

    const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const marketplacePath = path.join(cacheDir, entry.name);
        const marketplaceConfigPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json');

        if (fs.existsSync(marketplaceConfigPath)) {
          try {
            const content = fs.readFileSync(marketplaceConfigPath, 'utf-8');
            const catalog = JSON.parse(content);
            // Use the catalog name as the ID, fallback to directory name
            const id = catalog.name || entry.name;

            const config: MarketplaceConfig = {
              id,
              name: catalog.name || id,
              source: PluginSource.GitHub,
              sourceRef: marketplacePath,
              autoUpdate: true,
              lastFetched: fs.statSync(marketplacePath).mtime,
              catalog: catalog,
              error: undefined,
            };

            this.marketplaces.set(id, config);
          } catch (error) {
            console.warn(`Failed to load marketplace ${entry.name}:`, error);
          }
        }
      }
    }
  }

  /**
   * Copy directory recursively
   */
  private copyRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
