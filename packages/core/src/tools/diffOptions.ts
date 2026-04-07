/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PatchOptions } from 'diff';

export const DEFAULT_DIFF_OPTIONS: PatchOptions = {
  context: 3,
  ignoreWhitespace: true,
};
