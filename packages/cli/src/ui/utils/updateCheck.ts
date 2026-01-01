/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import { getPackageJson } from '../../utils/package.js';
import { request } from 'gaxios';

export async function checkForUpdates(): Promise<string | null> {
  try {
    const packageJson = await getPackageJson();
    if (!packageJson || !packageJson.version) {
      return null;
    }

    const currentVersion = packageJson.version;
    const repo = 'hamishfromatech/a-coder-cli';
    
    // Fetch latest release from GitHub
    const response = await request<{ tag_name: string }>({
      url: `https://api.github.com/repos/${repo}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'a-coder-cli',
      },
      timeout: 2000, // Short timeout to not delay startup
    });

    if (response.status === 200 && response.data.tag_name) {
      const latestVersion = response.data.tag_name.replace(/^v/, '');
      
      if (semver.gt(latestVersion, currentVersion)) {
        return `A-Coder CLI update available! ${currentVersion} → ${latestVersion}\nRun 'a-coder --upgrade' to update automatically.`;
      }
    }

    return null;
  } catch (e) {
    // Silently fail to not disturb the user if there's no internet or GitHub is down
    return null;
  }
}
