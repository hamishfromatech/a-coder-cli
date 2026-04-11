/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandCategory } from './types.js';

/**
 * Approximate per-million-token pricing for Gemini models (USD).
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gpt-4o': { input: 2.50, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

const DEFAULT_PRICING = { input: 1.0, output: 4.0 };

function getPricing(modelName: string) {
  if (MODEL_PRICING[modelName]) return MODEL_PRICING[modelName];
  const prefix = Object.keys(MODEL_PRICING).find((k) =>
    modelName.startsWith(k),
  );
  return prefix ? MODEL_PRICING[prefix] : DEFAULT_PRICING;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export const costCommand: SlashCommand = {
  name: 'cost',
  description: 'Show token usage and estimated cost for the session',
  category: 'general' as CommandCategory,
  keywords: ['cost', 'tokens', 'usage', 'spend', 'billing'],
  action: (context) => {
    const { metrics } = context.session.stats;
    const models = Object.entries(metrics.models);

    if (models.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No API calls made yet in this session.',
      };
    }

    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    let totalRequests = 0;

    let message = '\u001b[1mSession Token Usage & Cost\u001b[0m\n\n';

    for (const [model, data] of models) {
      const pricing = getPricing(model);
      const inputCost = (data.tokens.prompt / 1_000_000) * pricing.input;
      const outputCost = (data.tokens.candidates / 1_000_000) * pricing.output;
      const modelCost = inputCost + outputCost;
      totalCost += modelCost;
      totalInput += data.tokens.prompt;
      totalOutput += data.tokens.candidates;
      totalCached += data.tokens.cached;
      totalRequests += data.api.totalRequests;

      message += `\u001b[36m${model}\u001b[0m\n`;
      message += `  Input:  ${formatTokens(data.tokens.prompt)} tokens`;
      if (data.tokens.cached > 0) {
        message += ` (\u001b[32m${formatTokens(data.tokens.cached)} cached\u001b[0m)`;
      }
      message += '\n';
      message += `  Output: ${formatTokens(data.tokens.candidates)} tokens\n`;
      message += `  Cost:   ${formatCost(modelCost)}\n`;
      if (data.api.totalLatencyMs > 0) {
        message += `  Time:   ${(data.api.totalLatencyMs / 1000).toFixed(1)}s total\n`;
      }
      message += '\n';
    }

    // Summary
    message += '\u001b[1mTotal:\u001b[0m\n';
    message += `  Input:  ${formatTokens(totalInput)} tokens`;
    if (totalCached > 0) {
      message += ` (\u001b[32m${formatTokens(totalCached)} cached\u001b[0m)`;
    }
    message += '\n';
    message += `  Output: ${formatTokens(totalOutput)} tokens\n`;
    message += `  Calls:  ${totalRequests} API requests\n`;
    message += `  Cost:   ${formatCost(totalCost)}\n`;
    message += '\u001b[0m';

    return {
      type: 'message',
      messageType: 'info',
      content: message,
    };
  },
};
