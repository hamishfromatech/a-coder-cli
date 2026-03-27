/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Export types
export * from './types.js';

// Export discovery
export { PluginDiscovery } from './discovery.js';
export { getUserPluginsDir, getProjectPluginsDir } from './discovery.js';

// Export registry
export { PluginRegistry } from './registry.js';

// Export manager
export { PluginManager } from './manager.js';

// Export hooks loader
export { PluginHooksLoader, loadAndMergePluginHooks } from './hooks-loader.js';

// Export MCP/LSP loader
export { PluginMcpLspLoader, loadAndMergePluginMcpConfigs, loadAndMergePluginLspConfigs } from './mcp-lsp-loader.js';
