/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { InstalledPlugin, PluginMcpConfig, PluginLspConfig } from './types.js';
import { MCPServerConfig } from '../tools/mcp-client.js';

/**
 * Plugin MCP/LSP configuration loader
 *
 * Loads .mcp.json and .lsp.json from plugins and merges with existing configs
 */
export class PluginMcpLspLoader {
  private loadedMcpConfigs: Map<string, PluginMcpConfig> = new Map();
  private loadedLspConfigs: Map<string, PluginLspConfig> = new Map();

  /**
   * Load MCP configuration from a plugin
   *
   * @param plugin - The plugin to load MCP config from
   * @returns PluginMcpConfig or null if not found
   */
  async loadPluginMcpConfig(plugin: InstalledPlugin): Promise<PluginMcpConfig | null> {
    const mcpPath = path.join(plugin.pluginDir, '.mcp.json');

    if (!fs.existsSync(mcpPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(mcpPath, 'utf-8');
      const config = JSON.parse(content) as PluginMcpConfig;

      // Validate MCP config structure
      if (typeof config !== 'object' || config === null) {
        console.warn(`Warning: Invalid MCP config format in ${plugin.pluginDir}`);
        return null;
      }

      // Validate each server entry
      for (const [serverName, serverConfig] of Object.entries(config)) {
        if (!serverConfig.command) {
          console.warn(`Warning: MCP server '${serverName}' missing required 'command' field`);
          delete config[serverName];
        }
      }

      this.loadedMcpConfigs.set(plugin.id, config);
      return config;
    } catch (error) {
      console.warn(`Warning: Could not load MCP config from ${plugin.pluginDir}: ${error}`);
      return null;
    }
  }

  /**
   * Load LSP configuration from a plugin
   *
   * @param plugin - The plugin to load LSP config from
   * @returns PluginLspConfig or null if not found
   */
  async loadPluginLspConfig(plugin: InstalledPlugin): Promise<PluginLspConfig | null> {
    const lspPath = path.join(plugin.pluginDir, '.lsp.json');

    if (!fs.existsSync(lspPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(lspPath, 'utf-8');
      const config = JSON.parse(content) as PluginLspConfig;

      // Validate LSP config structure
      if (typeof config !== 'object' || config === null) {
        console.warn(`Warning: Invalid LSP config format in ${plugin.pluginDir}`);
        return null;
      }

      // Validate each language entry
      for (const [languageId, languageConfig] of Object.entries(config)) {
        if (!languageConfig.command) {
          console.warn(`Warning: LSP language '${languageId}' missing required 'command' field`);
          delete config[languageId];
        }
      }

      this.loadedLspConfigs.set(plugin.id, config);
      return config;
    } catch (error) {
      console.warn(`Warning: Could not load LSP config from ${plugin.pluginDir}: ${error}`);
      return null;
    }
  }

  /**
   * Load MCP and LSP configs from multiple plugins
   *
   * @param plugins - Array of plugins to load configs from
   * @returns Object with mcp and lsp configs
   */
  async loadAllPluginConfigs(plugins: InstalledPlugin[]): Promise<{
    mcp: Map<string, PluginMcpConfig>;
    lsp: Map<string, PluginLspConfig>;
  }> {
    const enabledPlugins = plugins.filter(p => p.state === 'enabled');

    for (const plugin of enabledPlugins) {
      await this.loadPluginMcpConfig(plugin);
      await this.loadPluginLspConfig(plugin);
    }

    return {
      mcp: this.loadedMcpConfigs,
      lsp: this.loadedLspConfigs,
    };
  }

  /**
   * Merge plugin MCP configs with base MCP configs
   *
   * Plugin MCP servers are added to the base config
   * If there's a name conflict, plugin config takes precedence
   *
   * @param baseMcpServers - Base MCP servers from settings
   * @param pluginMcpConfigs - MCP configs from plugins
   * @returns Merged MCP servers config
   */
  mergeMcpConfigs(
    baseMcpServers: Record<string, MCPServerConfig> | undefined,
    pluginMcpConfigs: PluginMcpConfig[],
  ): Record<string, MCPServerConfig> {
    const merged: Record<string, MCPServerConfig> = { ...baseMcpServers };

    for (const pluginConfig of pluginMcpConfigs) {
      for (const [serverName, serverConfig] of Object.entries(pluginConfig)) {
        merged[serverName] = new MCPServerConfig(
          serverConfig.command,
          serverConfig.args,
          serverConfig.env,
          serverConfig.cwd,
        );
      }
    }

    return merged;
  }

  /**
   * Merge plugin LSP configs with base LSP configs
   *
   * Plugin LSP configurations are added to the base config
   * If there's a name conflict, plugin config takes precedence
   *
   * @param baseLspConfigs - Base LSP configs from settings
   * @param pluginLspConfigs - LSP configs from plugins
   * @returns Merged LSP configs
   */
  mergeLspConfigs(
    baseLspConfigs: Record<string, any> | undefined,
    pluginLspConfigs: PluginLspConfig[],
  ): Record<string, any> {
    const merged: Record<string, any> = { ...baseLspConfigs };

    for (const pluginConfig of pluginLspConfigs) {
      for (const [languageId, languageConfig] of Object.entries(pluginConfig)) {
        merged[languageId] = {
          command: languageConfig.command,
          args: languageConfig.args,
          env: languageConfig.env,
          extensionToLanguage: languageConfig.extensionToLanguage,
        };
      }
    }

    return merged;
  }

  /**
   * Get MCP config for a specific plugin
   */
  getPluginMcpConfig(pluginId: string): PluginMcpConfig | undefined {
    return this.loadedMcpConfigs.get(pluginId);
  }

  /**
   * Get LSP config for a specific plugin
   */
  getPluginLspConfig(pluginId: string): PluginLspConfig | undefined {
    return this.loadedLspConfigs.get(pluginId);
  }

  /**
   * Get all loaded MCP server names from plugins
   */
  getLoadedMcpServers(): string[] {
    const servers = new Set<string>();
    for (const config of this.loadedMcpConfigs.values()) {
      for (const serverName of Object.keys(config)) {
        servers.add(serverName);
      }
    }
    return Array.from(servers);
  }

  /**
   * Get all loaded LSP languages from plugins
   */
  getLoadedLspLanguages(): string[] {
    const languages = new Set<string>();
    for (const config of this.loadedLspConfigs.values()) {
      for (const languageId of Object.keys(config)) {
        languages.add(languageId);
      }
    }
    return Array.from(languages);
  }

  /**
   * Clear all loaded configs
   */
  clear(): void {
    this.loadedMcpConfigs.clear();
    this.loadedLspConfigs.clear();
  }
}

/**
 * Load and merge MCP configs from all enabled plugins
 *
 * @param plugins - Array of installed plugins
 * @param baseMcpServers - Base MCP servers from settings
 * @returns Merged MCP servers config
 */
export async function loadAndMergePluginMcpConfigs(
  plugins: InstalledPlugin[],
  baseMcpServers: Record<string, MCPServerConfig> | undefined,
): Promise<Record<string, MCPServerConfig>> {
  const loader = new PluginMcpLspLoader();
  const configs = await loader.loadAllPluginConfigs(plugins);
  const pluginMcpConfigs = Array.from(configs.mcp.values());
  return loader.mergeMcpConfigs(baseMcpServers, pluginMcpConfigs);
}

/**
 * Load and merge LSP configs from all enabled plugins
 *
 * @param plugins - Array of installed plugins
 * @param baseLspConfigs - Base LSP configs from settings
 * @returns Merged LSP configs
 */
export async function loadAndMergePluginLspConfigs(
  plugins: InstalledPlugin[],
  baseLspConfigs: Record<string, any> | undefined,
): Promise<Record<string, any>> {
  const loader = new PluginMcpLspLoader();
  const configs = await loader.loadAllPluginConfigs(plugins);
  const pluginLspConfigs = Array.from(configs.lsp.values());
  return loader.mergeLspConfigs(baseLspConfigs, pluginLspConfigs);
}
