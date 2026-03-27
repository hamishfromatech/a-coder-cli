/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InstalledPlugin,
  PluginScope,
  PluginSource,
  PluginState,
} from './types.js';

/**
 * Plugin registry for tracking installed plugins
 */
export class PluginRegistry {
  private plugins: Map<string, InstalledPlugin> = new Map();

  /**
   * Register a plugin
   */
  register(plugin: InstalledPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * Register multiple plugins
   */
  registerAll(plugins: InstalledPlugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * Get a plugin by id
   */
  get(id: string): InstalledPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get a plugin by name
   */
  getByName(name: string): InstalledPlugin | undefined {
    return Array.from(this.plugins.values()).find(
      (plugin) => plugin.name === name || plugin.id.endsWith(`:${name}`),
    );
  }

  /**
   * Get all registered plugins
   */
  getAll(): InstalledPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins by scope
   */
  getByScope(scope: PluginScope): InstalledPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.scope === scope,
    );
  }

  /**
   * Get plugins by source
   */
  getBySource(source: PluginSource): InstalledPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.source === source,
    );
  }

  /**
   * Get enabled plugins
   */
  getEnabled(): InstalledPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.state === PluginState.Enabled,
    );
  }

  /**
   * Get disabled plugins
   */
  getDisabled(): InstalledPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.state === PluginState.Disabled,
    );
  }

  /**
   * Check if a plugin exists
   */
  has(idOrName: string): boolean {
    return this.plugins.has(idOrName) || this.getByName(idOrName) !== undefined;
  }

  /**
   * Delete a plugin
   */
  delete(id: string): boolean {
    return this.plugins.delete(id);
  }

  /**
   * Update a plugin
   */
  update(id: string, updates: Partial<InstalledPlugin>): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      return false;
    }
    const updated = { ...plugin, ...updates };
    this.plugins.set(id, updated);
    return true;
  }

  /**
   * Get the number of registered plugins
   */
  size(): number {
    return this.plugins.size;
  }

  /**
   * Clear all registered plugins
   */
  clear(): void {
    this.plugins.clear();
  }
}
