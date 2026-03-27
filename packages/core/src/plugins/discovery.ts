/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { homedir } from 'os';
import {
  PluginManifest,
  PluginSource,
  PluginScope,
  PluginState,
  InstalledPlugin,
  MarketplaceCatalog,
  MarketplaceConfig,
  PluginDiscoveryOptions,
  PluginHooksConfig,
  PluginMcpConfig,
  PluginLspConfig,
} from './types.js';

// Import SETTINGS_DIRECTORY_NAME from cli package (plugin system is coupled with cli)
const SETTINGS_DIRECTORY_NAME = '.a-coder-cli';

/**
 * Plugin discovery service
 *
 * Discovers plugins from:
 * - User scope: ~/.a-coder-cli/plugins/
 * - Project scope: .a-coder-cli/plugins/
 * - Local scope: current directory plugin
 * - Plugin-dir: --plugin-dir flag
 */
export class PluginDiscovery {
  private plugins: Map<string, InstalledPlugin> = new Map();

  constructor() {}

  /**
   * Discover all plugins from all scopes
   */
  async discoverAll(options?: PluginDiscoveryOptions): Promise<InstalledPlugin[]> {
    const plugins: InstalledPlugin[] = [];

    // 1. User scope plugins (~/.a-coder-cli/plugins/)
    const userPluginsDir = path.join(homedir(), SETTINGS_DIRECTORY_NAME, 'plugins');
    const userPlugins = await this.discoverFromLocation(
      userPluginsDir,
      PluginScope.User,
      PluginSource.Marketplace,
    );
    plugins.push(...userPlugins);

    // 2. Project scope plugins (.a-coder-cli/plugins/)
    if (options?.currentPath) {
      const projectPluginsDir = path.join(options.currentPath, SETTINGS_DIRECTORY_NAME, 'plugins');
      const projectPlugins = await this.discoverFromLocation(
        projectPluginsDir,
        PluginScope.Project,
        PluginSource.Marketplace,
      );
      plugins.push(...projectPlugins);
    }

    // 3. Local scope plugins (current directory root)
    if (options?.currentPath) {
      const localPluginsDir = path.join(options.currentPath, 'plugins');
      const localPlugins = await this.discoverFromLocation(
        localPluginsDir,
        PluginScope.Local,
        PluginSource.Local,
      );
      plugins.push(...localPlugins);
    }

    return plugins;
  }

  /**
   * Discover plugins from a specific location
   */
  async discoverFromLocation(
    location: string,
    scope: PluginScope,
    source: PluginSource,
  ): Promise<InstalledPlugin[]> {
    const plugins: InstalledPlugin[] = [];

    if (!fs.existsSync(location)) {
      return plugins;
    }

    try {
      const entries = fs.readdirSync(location, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const pluginDir = path.join(location, entry.name);
        const plugin = await this.loadPlugin(pluginDir, scope, source);

        if (plugin) {
          plugins.push(plugin);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read plugins from ${location}: ${error}`);
    }

    return plugins;
  }

  /**
   * Load a single plugin from a directory
   */
  async loadPlugin(
    pluginDir: string,
    scope: PluginScope,
    source: PluginSource,
  ): Promise<InstalledPlugin | null> {
    const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

    if (!fs.existsSync(manifestPath)) {
      // Try legacy location at plugin root
      const legacyManifestPath = path.join(pluginDir, 'plugin.json');
      if (!fs.existsSync(legacyManifestPath)) {
        return null;
      }
      return this.loadPluginFromManifest(legacyManifestPath, pluginDir, scope, source);
    }

    return this.loadPluginFromManifest(manifestPath, pluginDir, scope, source);
  }

  /**
   * Load plugin from manifest file
   */
  private async loadPluginFromManifest(
    manifestPath: string,
    pluginDir: string,
    scope: PluginScope,
    source: PluginSource,
  ): Promise<InstalledPlugin | null> {
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as PluginManifest;

      const pluginName = manifest.name;
      const id = `${scope}:${pluginName}`;

      // Determine state - assume enabled if manifest exists
      const state = PluginState.Enabled;

      const plugin: InstalledPlugin = {
        id,
        name: pluginName,
        description: manifest.description || 'No description',
        version: manifest.version || '0.0.0',
        scope,
        state,
        source,
        sourceRef: pluginDir,
        installedAt: new Date(),
        pluginDir,
        manifest,
      };

      return plugin;
    } catch (error) {
      console.warn(`Warning: Could not load plugin from ${pluginDir}: ${error}`);
      return null;
    }
  }

  /**
   * Discover skills from a plugin
   */
  async discoverPluginSkills(plugin: InstalledPlugin): Promise<any[]> {
    const skillsDir = path.join(plugin.pluginDir, 'skills');

    if (!fs.existsSync(skillsDir)) {
      return [];
    }

    // Reuse skill discovery logic
    const { SkillDiscovery } = await import('../skills/discovery.js');

    // Create a minimal config-like object for skill discovery
    // SkillDiscovery only needs getTargetDir() method
    const tempConfig = {
      getTargetDir: () => plugin.pluginDir,
    } as any;

    const discovery = new SkillDiscovery(tempConfig);
    const skills = await discovery.discoverFromLocation(
      skillsDir,
      'plugin' as any,
      plugin.name,
    );

    return skills;
  }

  /**
   * Load plugin hooks configuration
   */
  async loadPluginHooks(plugin: InstalledPlugin): Promise<PluginHooksConfig | null> {
    const hooksPath = path.join(plugin.pluginDir, 'hooks', 'hooks.json');

    if (!fs.existsSync(hooksPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(hooksPath, 'utf-8');
      return JSON.parse(content) as PluginHooksConfig;
    } catch (error) {
      console.warn(`Warning: Could not load plugin hooks from ${plugin.pluginDir}: ${error}`);
      return null;
    }
  }

  /**
   * Load plugin MCP configuration
   */
  async loadPluginMcpConfig(plugin: InstalledPlugin): Promise<PluginMcpConfig | null> {
    const mcpPath = path.join(plugin.pluginDir, '.mcp.json');

    if (!fs.existsSync(mcpPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(mcpPath, 'utf-8');
      return JSON.parse(content) as PluginMcpConfig;
    } catch (error) {
      console.warn(`Warning: Could not load plugin MCP config from ${plugin.pluginDir}: ${error}`);
      return null;
    }
  }

  /**
   * Load plugin LSP configuration
   */
  async loadPluginLspConfig(plugin: InstalledPlugin): Promise<PluginLspConfig | null> {
    const lspPath = path.join(plugin.pluginDir, '.lsp.json');

    if (!fs.existsSync(lspPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(lspPath, 'utf-8');
      return JSON.parse(content) as PluginLspConfig;
    } catch (error) {
      console.warn(`Warning: Could not load plugin LSP config from ${plugin.pluginDir}: ${error}`);
      return null;
    }
  }

  /**
   * Get plugin directory for --plugin-dir flag
   */
  async loadPluginFromDir(pluginDir: string): Promise<InstalledPlugin | null> {
    return this.loadPlugin(pluginDir, PluginScope.Local, PluginSource.Local);
  }
}

/**
 * Get the user plugins directory path
 */
export function getUserPluginsDir(): string {
  return path.join(homedir(), SETTINGS_DIRECTORY_NAME, 'plugins');
}

/**
 * Get the project plugins directory path
 */
export function getProjectPluginsDir(projectRoot: string): string {
  return path.join(projectRoot, SETTINGS_DIRECTORY_NAME, 'plugins');
}
