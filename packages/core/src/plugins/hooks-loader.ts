/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { InstalledPlugin } from './types.js';
import { HooksSettings, HookConfig } from '../hooks/types.js';

/**
 * Plugin hooks loader
 *
 * Loads hooks from plugin hooks/hooks.json files and merges with settings hooks
 */
export class PluginHooksLoader {
  private loadedHooks: Map<string, HooksSettings> = new Map();

  /**
   * Load hooks from a single plugin
   *
   * @param plugin - The plugin to load hooks from
   * @returns HooksSettings or null if no hooks found
   */
  async loadPluginHooks(plugin: InstalledPlugin): Promise<HooksSettings | null> {
    const hooksPath = path.join(plugin.pluginDir, 'hooks', 'hooks.json');

    if (!fs.existsSync(hooksPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(hooksPath, 'utf-8');
      const hooksConfig = JSON.parse(content);

      // Validate the hooks structure
      if (!hooksConfig.hooks || typeof hooksConfig.hooks !== 'object') {
        console.warn(`Warning: Invalid hooks format in ${plugin.pluginDir}`);
        return null;
      }

      const hooksSettings: HooksSettings = {};

      // Convert from hooks.hooks[event] format to HooksSettings format
      const hooks = hooksConfig.hooks;
      for (const [eventName, hookConfigs] of Object.entries(hooks)) {
        if (Array.isArray(hookConfigs)) {
          const typedEventName = eventName as keyof HooksSettings;
          hooksSettings[typedEventName] = hookConfigs.map((config: any) => {
            const hookConfig: HookConfig = {
              matcher: config.matcher,
              hooks: config.hooks?.map((h: any) => ({
                type: h.type,
                command: h.command,
                prompt: h.prompt,
                timeout: h.timeout,
              })),
            };
            return hookConfig;
          });
        }
      }

      this.loadedHooks.set(plugin.id, hooksSettings);
      return hooksSettings;
    } catch (error) {
      console.warn(`Warning: Could not load plugin hooks from ${plugin.pluginDir}: ${error}`);
      return null;
    }
  }

  /**
   * Load hooks from multiple plugins
   *
   * @param plugins - Array of plugins to load hooks from
   * @returns Map of plugin id to hooks settings
   */
  async loadAllPluginHooks(plugins: InstalledPlugin[]): Promise<Map<string, HooksSettings>> {
    const enabledPlugins = plugins.filter(p => p.state === 'enabled');

    for (const plugin of enabledPlugins) {
      await this.loadPluginHooks(plugin);
    }

    return this.loadedHooks;
  }

  /**
   * Merge plugin hooks with base settings hooks
   *
   * Plugin hooks are appended to existing hooks for each event type
   *
   * @param baseHooks - Base hooks from settings
   * @param pluginHooks - Hooks from plugins
   * @returns Merged hooks settings
   */
  mergeHooks(baseHooks: HooksSettings | undefined, pluginHooks: HooksSettings[]): HooksSettings {
    const merged: HooksSettings = { ...baseHooks };

    for (const pluginHooksConfig of pluginHooks) {
      for (const [eventName, configs] of Object.entries(pluginHooksConfig)) {
        const typedEventName = eventName as keyof HooksSettings;

        if (configs && Array.isArray(configs)) {
          if (!merged[typedEventName]) {
            merged[typedEventName] = [];
          }
          merged[typedEventName] = [...merged[typedEventName], ...configs];
        }
      }
    }

    return merged;
  }

  /**
   * Get hooks for a specific plugin
   */
  getPluginHooks(pluginId: string): HooksSettings | undefined {
    return this.loadedHooks.get(pluginId);
  }

  /**
   * Get all loaded hooks event names from plugins
   */
  getLoadedEventNames(): string[] {
    const eventNames = new Set<string>();

    for (const hooksSettings of this.loadedHooks.values()) {
      for (const eventName of Object.keys(hooksSettings)) {
        eventNames.add(eventName);
      }
    }

    return Array.from(eventNames);
  }

  /**
   * Clear all loaded hooks
   */
  clear(): void {
    this.loadedHooks.clear();
  }

  /**
   * Get the number of plugins with hooks loaded
   */
  size(): number {
    return this.loadedHooks.size;
  }
}

/**
 * Load and merge hooks from all enabled plugins
 *
 * @param plugins - Array of installed plugins
 * @param baseHooks - Base hooks from settings
 * @returns Merged hooks settings
 */
export async function loadAndMergePluginHooks(
  plugins: InstalledPlugin[],
  baseHooks: HooksSettings | undefined,
): Promise<HooksSettings> {
  const loader = new PluginHooksLoader();
  const pluginHooksMap = await loader.loadAllPluginHooks(plugins);
  const pluginHooks = Array.from(pluginHooksMap.values());
  return loader.mergeHooks(baseHooks, pluginHooks);
}
