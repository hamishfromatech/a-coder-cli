/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, SlashCommandActionReturn, type CommandContext, CommandCategory } from './types.js';
import { PluginManager, PluginScope, PluginState } from '@a-coder/core';

/**
 * Fuzzy match a query against a string
 */
function fuzzyMatch(query: string, target: string): boolean {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  let queryIndex = 0;

  for (let i = 0; i < lowerTarget.length && queryIndex < lowerQuery.length; i++) {
    if (lowerTarget[i] === lowerQuery[queryIndex]) {
      queryIndex++;
    }
  }

  return queryIndex === lowerQuery.length;
}

/**
 * Completion function for plugin install command
 * Provides fuzzy search suggestions for plugin names from all marketplaces
 */
async function pluginInstallCompletion(
  context: CommandContext,
  partialArg: string,
): Promise<string[]> {
  try {
    const manager = new PluginManager();
    await manager.initialize();

    const marketplaces = manager.listMarketplaces();
    const allPluginNames: string[] = [];

    for (const mp of marketplaces) {
      if (mp.catalog && mp.catalog.plugins) {
        for (const plugin of mp.catalog.plugins) {
          allPluginNames.push(`${plugin.name}@${mp.id}`);
        }
      }
    }

    if (!partialArg || partialArg.trim() === '') {
      return allPluginNames.slice(0, 20);
    }

    // Filter using fuzzy match
    const matches = allPluginNames.filter((name) => fuzzyMatch(partialArg, name));
    return matches.slice(0, 50);
  } catch (error) {
    return [];
  }
}

/**
 * Plugin management command
 */
export const pluginCommand: SlashCommand = {
  name: 'plugin',
  description: 'Manage plugins',
  category: 'plugin' as CommandCategory,
  keywords: ['plugins', 'install', 'marketplace', 'extension', 'add-on'],
  argumentHint: '<subcommand> [args]',
  examples: ['/plugin list', '/plugin install <tab to autocomplete>', '/plugin marketplace list'],
  subCommands: [
    {
      name: 'discover',
      description: 'Browse available plugins from marketplaces',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        try {
          const { PluginManager } = await import('@a-coder/core');
          const manager = new PluginManager();
          await manager.initialize();

          const marketplaces = manager.listMarketplaces();

          if (marketplaces.length === 0) {
            return {
              type: 'message',
              messageType: 'info',
              content: 'No marketplaces configured. Add one with /plugin marketplace add <source>',
            };
          }

          let output = 'Available plugins in marketplaces:\n\n';
          let totalPlugins = 0;

          marketplaces.forEach((mp) => {
            if (mp.catalog && mp.catalog.plugins) {
              output += `${mp.name} (${mp.catalog.plugins.length} plugins):\n`;
              mp.catalog.plugins.slice(0, 50).forEach((plugin) => {
                output += `  - ${plugin.name}: ${plugin.description}\n`;
              });
              totalPlugins += mp.catalog.plugins.length;
              output += '\n';
            }
          });

          return {
            type: 'message',
            messageType: 'info',
            content: output,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to list available plugins: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'install',
      description: 'Install a plugin from a marketplace',
      completion: pluginInstallCompletion,
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const { config } = context.services;

        if (!config) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Config not available',
          };
        }

        if (!args.trim()) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /plugin install <plugin-name>@<marketplace-name>',
          };
        }

        // Parse plugin-name@marketplace-name format
        const parts = args.trim().split('@');
        if (parts.length !== 2) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /plugin install <plugin-name>@<marketplace-name>',
          };
        }

        const [pluginName, marketplaceName] = parts;

        try {
          const { PluginManager } = await import('@a-coder/core');
          const manager = new PluginManager();
          await manager.initialize();

          // Check if marketplace exists
          const marketplaces = manager.listMarketplaces();
          let marketplace = marketplaces.find((m) => m.id === marketplaceName);

          // If not found by exact ID, try to find by name or partial match
          if (!marketplace) {
            marketplace = marketplaces.find((m) =>
              m.name === marketplaceName ||
              m.id.includes(marketplaceName) ||
              marketplaceName.includes(m.id)
            );
          }

          if (!marketplace) {
            return {
              type: 'message',
              messageType: 'error',
              content: `Marketplace '${marketplaceName}' not found. Run /plugin marketplace list to see available marketplaces.`,
            };
          }

          // Install the plugin
          const installed = await manager.install(pluginName, marketplaceName, PluginScope.User);

          return {
            type: 'message',
            messageType: 'info',
            content: `Plugin '${pluginName}' installed successfully from '${marketplaceName}'. Run /reload-plugins to activate.`,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to install plugin: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'uninstall',
      description: 'Uninstall a plugin',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        if (!args.trim()) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /plugin uninstall <plugin-name>',
          };
        }

        try {
          const { PluginManager } = await import('@a-coder/core');
          const manager = new PluginManager();
          await manager.initialize();

          const success = await manager.uninstall(args.trim());

          if (success) {
            return {
              type: 'message',
              messageType: 'info',
              content: `Plugin '${args.trim()}' uninstalled successfully.`,
            };
          } else {
            return {
              type: 'message',
              messageType: 'error',
              content: `Plugin '${args.trim()}' not found.`,
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to uninstall plugin: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'enable',
      description: 'Enable a disabled plugin',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        if (!args.trim()) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /plugin enable <plugin-name>',
          };
        }

        try {
          const { PluginManager } = await import('@a-coder/core');
          const manager = new PluginManager();
          await manager.initialize();

          const success = manager.enable(args.trim());

          if (success) {
            return {
              type: 'message',
              messageType: 'info',
              content: `Plugin '${args.trim()}' enabled. Run /reload-plugins to activate.`,
            };
          } else {
            return {
              type: 'message',
              messageType: 'error',
              content: `Plugin '${args.trim()}' not found.`,
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to enable plugin: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'disable',
      description: 'Disable a plugin',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        if (!args.trim()) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /plugin disable <plugin-name>',
          };
        }

        try {
          const { PluginManager } = await import('@a-coder/core');
          const manager = new PluginManager();
          await manager.initialize();

          const success = manager.disable(args.trim());

          if (success) {
            return {
              type: 'message',
              messageType: 'info',
              content: `Plugin '${args.trim()}' disabled. Run /reload-plugins to apply changes.`,
            };
          } else {
            return {
              type: 'message',
              messageType: 'error',
              content: `Plugin '${args.trim()}' not found.`,
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to disable plugin: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'list',
      description: 'List installed plugins',
      action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        try {
          const { PluginManager } = await import('@a-coder/core');
          const manager = new PluginManager();
          await manager.initialize();

          const plugins = manager.getPlugins();

          if (plugins.length === 0) {
            return {
              type: 'message',
              messageType: 'info',
              content: 'No plugins installed.',
            };
          }

          const enabledCount = plugins.filter((p) => p.state === PluginState.Enabled).length;
          const disabledCount = plugins.filter((p) => p.state === PluginState.Disabled).length;

          let output = `Installed plugins (${plugins.length} total):\n\n`;
          output += `Enabled (${enabledCount}):\n`;
          plugins
            .filter((p) => p.state === PluginState.Enabled)
            .forEach((p) => {
              output += `  - ${p.name}@${p.marketplaceName || 'unknown'} (v${p.version})\n`;
            });

          if (disabledCount > 0) {
            output += `\nDisabled (${disabledCount}):\n`;
            plugins
              .filter((p) => p.state === PluginState.Disabled)
              .forEach((p) => {
                output += `  - ${p.name}@${p.marketplaceName || 'unknown'} (v${p.version})\n`;
              });
          }

          return {
            type: 'message',
            messageType: 'info',
            content: output,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to list plugins: ${errorMessage}`,
          };
        }
      },
    },
    {
      name: 'marketplace',
      description: 'Manage plugin marketplaces',
      subCommands: [
        {
          name: 'add',
          description: 'Add a new marketplace',
          action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
            if (!args.trim()) {
              return {
                type: 'message',
                messageType: 'error',
                content: 'Usage: /plugin marketplace add <source>\n\nSources:\n  - GitHub: owner/repo\n  - Local: ./path/to/marketplace\n  - URL: https://example.com/marketplace.json',
              };
            }

            try {
              const { PluginManager, PluginSource } = await import('@a-coder/core');
              const manager = new PluginManager();
              await manager.initialize();

              const sourceRefOriginal = args.trim();
              let source: typeof PluginSource[keyof typeof PluginSource];
              let id: string;
              let sourceRef = sourceRefOriginal;

              // Determine source type
              if (sourceRef.includes('github.com')) {
                source = PluginSource.GitHub;
                // Extract owner/repo from URL
                const match = sourceRef.match(/github\.com\/([^/]+\/[^/]+)/);
                id = match ? match[1] : sourceRef;
              } else if (sourceRef.startsWith('http')) {
                source = PluginSource.URL;
                id = sourceRef.replace(/[^a-zA-Z0-9-]/g, '-');
              } else if (sourceRef.startsWith('./') || sourceRef.startsWith('/') || sourceRef.startsWith('..')) {
                source = PluginSource.Local;
                id = sourceRef.replace(/[^a-zA-Z0-9-]/g, '-');
              } else if (sourceRef.includes('/')) {
                // Transform owner/repo format to GitHub URL
                source = PluginSource.GitHub;
                // Use a normalized ID (replace special chars with dashes)
                id = sourceRef.replace(/[^a-zA-Z0-9-]/g, '-');
                sourceRef = `https://github.com/${sourceRef}`;
              } else {
                return {
                  type: 'message',
                  messageType: 'error',
                  content: 'Could not determine marketplace source type.',
                };
              }

              const marketplace = await manager.addMarketplace(id, source, sourceRef);

              if (marketplace.error) {
                return {
                  type: 'message',
                  messageType: 'error',
                  content: `Marketplace '${id}' added but failed to fetch: ${marketplace.error}`,
                };
              }

              return {
                type: 'message',
                messageType: 'info',
                content: `Marketplace '${id}' added successfully. Run /plugin discover to browse available plugins.`,
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return {
                type: 'message',
                messageType: 'error',
                content: `Failed to add marketplace: ${errorMessage}`,
              };
            }
          },
        },
        {
          name: 'list',
          description: 'List configured marketplaces',
          action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
            try {
              const { PluginManager } = await import('@a-coder/core');
              const manager = new PluginManager();
              await manager.initialize();

              const marketplaces = manager.listMarketplaces();

              if (marketplaces.length === 0) {
                return {
                  type: 'message',
                  messageType: 'info',
                  content: 'No marketplaces configured. Add one with /plugin marketplace add <source>',
                };
              }

              let output = 'Configured marketplaces:\n\n';
              marketplaces.forEach((m) => {
                const status = m.error ? 'Error' : m.catalog ? 'Ready' : 'Loading';
                output += `  - ${m.name} (${m.source}): ${status}\n`;
                if (m.catalog) {
                  output += `    Plugins: ${m.catalog.plugins.length}\n`;
                }
              });

              return {
                type: 'message',
                messageType: 'info',
                content: output,
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return {
                type: 'message',
                messageType: 'error',
                content: `Failed to list marketplaces: ${errorMessage}`,
              };
            }
          },
        },
        {
          name: 'reload',
          description: 'Reload marketplaces from disk',
          action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
            try {
              const { PluginManager } = await import('@a-coder/core');
              const manager = new PluginManager();
              await manager.initialize();

              await manager.reloadMarketplaces();

              const marketplaces = manager.listMarketplaces();

              if (marketplaces.length === 0) {
                return {
                  type: 'message',
                  messageType: 'info',
                  content: 'No marketplaces found on disk.',
                };
              }

              let output = 'Marketplaces reloaded from disk:\n\n';
              marketplaces.forEach((m) => {
                const status = m.error ? 'Error' : m.catalog ? 'Ready' : 'Loading';
                output += `  - ${m.name} (${m.source}): ${status}\n`;
                if (m.catalog) {
                  output += `    Plugins: ${m.catalog.plugins.length}\n`;
                }
              });

              return {
                type: 'message',
                messageType: 'info',
                content: output,
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return {
                type: 'message',
                messageType: 'error',
                content: `Failed to reload marketplaces: ${errorMessage}`,
              };
            }
          },
        },
        {
          name: 'update',
          description: 'Update a marketplace (refetch catalog)',
          action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
            if (!args.trim()) {
              return {
                type: 'message',
                messageType: 'error',
                content: 'Usage: /plugin marketplace update <marketplace-name>',
              };
            }

            try {
              const { PluginManager } = await import('@a-coder/core');
              const manager = new PluginManager();
              await manager.initialize();

              const marketplace = manager.listMarketplaces().find((m) => m.id === args.trim());
              if (!marketplace) {
                return {
                  type: 'message',
                  messageType: 'error',
                  content: `Marketplace '${args.trim()}' not found.`,
                };
              }

              await manager.fetchMarketplaceCatalog(marketplace);

              return {
                type: 'message',
                messageType: 'info',
                content: `Marketplace '${marketplace.name}' updated. Found ${marketplace.catalog?.plugins.length || 0} plugins.`,
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return {
                type: 'message',
                messageType: 'error',
                content: `Failed to update marketplace: ${errorMessage}`,
              };
            }
          },
        },
        {
          name: 'remove',
          description: 'Remove a marketplace',
          action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
            if (!args.trim()) {
              return {
                type: 'message',
                messageType: 'error',
                content: 'Usage: /plugin marketplace remove <marketplace-name>',
              };
            }

            try {
              const { PluginManager } = await import('@a-coder/core');
              const manager = new PluginManager();
              await manager.initialize();

              const success = manager.removeMarketplace(args.trim());

              if (success) {
                return {
                  type: 'message',
                  messageType: 'info',
                  content: `Marketplace '${args.trim()}' removed.`,
                };
              } else {
                return {
                  type: 'message',
                  messageType: 'error',
                  content: `Marketplace '${args.trim()}' not found.`,
                };
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return {
                type: 'message',
                messageType: 'error',
                content: `Failed to remove marketplace: ${errorMessage}`,
              };
            }
          },
        },
      ],
    },
  ],
};
