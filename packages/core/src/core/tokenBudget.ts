/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Computes the recommended max output tokens based on current context usage.
 *
 * When context usage is low, the model can use its default output budget.
 * As context fills up, this function progressively reserves less space for output
 * to avoid exceeding the model's total token limit.
 *
 * @param modelTokenLimit - The total token limit for the model (input + output).
 * @param currentContextTokens - The current number of tokens used by context/history.
 * @param usagePercentage - The fraction of context used (0.0 to 1.0).
 * @returns The recommended max output tokens, or `undefined` if no constraint is needed.
 */
export function computeOutputTokenBudget(
  modelTokenLimit: number,
  currentContextTokens: number,
  usagePercentage: number,
): number | undefined {
  // If context is under 50%, let the model use its default output budget.
  if (usagePercentage < 0.5) {
    return undefined;
  }

  const remainingTokens = modelTokenLimit - currentContextTokens;

  // If there is no room left, enforce a bare minimum.
  if (remainingTokens <= 0) {
    return 1024;
  }

  let budget: number;

  if (usagePercentage >= 0.95) {
    // Context is over 95%: reserve only 5% of remaining space for output.
    budget = Math.floor(remainingTokens * 0.05);
  } else if (usagePercentage >= 0.8) {
    // Context is 80-95%: reserve 10% of remaining space for output.
    budget = Math.floor(remainingTokens * 0.10);
  } else {
    // Context is 50-80%: reserve 20% of remaining space for output.
    budget = Math.floor(remainingTokens * 0.20);
  }

  // Enforce a minimum of 1024 tokens for output so the model can still be useful.
  const MIN_OUTPUT_TOKENS = 1024;
  return Math.max(budget, MIN_OUTPUT_TOKENS);
}
