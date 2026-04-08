/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { BackgroundShell } from '../types.js';

const POLL_INTERVAL_MS = 500;
const MAX_OUTPUT_LENGTH = 10000;

export interface UseBackgroundShellsReturn {
  backgroundShells: BackgroundShell[];
  spawnBackgroundShell: (command: string, cwd: string) => string;
  killShell: (shellId: string) => void;
  getShellOutput: (shellId: string) => string;
}

export const useBackgroundShells = (): UseBackgroundShellsReturn => {
  const [backgroundShells, setBackgroundShells] = useState<BackgroundShell[]>([]);
  const pollIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const processesRef = useRef<Map<string, { pid: number }>>(new Map());

  const killShell = useCallback((shellId: string) => {
    const shellProcess = processesRef.current.get(shellId);
    if (shellProcess && shellProcess.pid) {
      const isWindows = os.platform() === 'win32';
      if (isWindows) {
        spawn('taskkill', ['/pid', shellProcess.pid.toString(), '/f', '/t']);
      } else {
        try {
          process.kill(-shellProcess.pid, 'SIGTERM');
          setTimeout(() => {
            try {
              process.kill(-shellProcess.pid, 'SIGKILL');
            } catch (_e) {
              // Already killed
            }
          }, 200);
        } catch (_e) {
          try {
            process.kill(shellProcess.pid, 'SIGKILL');
          } catch (__e) {
            // Already killed
          }
        }
      }
    }

    setBackgroundShells((prev) =>
      prev.map((s) =>
        s.id === shellId
          ? { ...s, status: 'killed' as const }
          : s
      )
    );
  }, []);

  const getShellOutput = useCallback((shellId: string): string => {
    const shell = backgroundShells.find((s) => s.id === shellId);
    return shell?.output || '';
  }, [backgroundShells]);

  const spawnBackgroundShell = useCallback(
    (command: string, cwd: string): string => {
      const shellId = crypto.randomBytes(4).toString('hex');
      const isWindows = os.platform() === 'win32';

      // Create temp file for output
      const outputFile = path.join(os.tmpdir(), `shell_${shellId}.out`);

      // Build the shell command
      let shellCommand: string;
      if (isWindows) {
        shellCommand = `${command} > "${outputFile}" 2>&1 & echo EXIT:!ERRORLEVEL!>> "${outputFile}"`;
      } else {
        shellCommand = `{ ${command}; } > "${outputFile}" 2>&1; echo "EXIT:$?" >> "${outputFile}" &`;
      }

      const shell = isWindows ? 'cmd.exe' : 'bash';
      const shellArgs = isWindows ? ['/c', shellCommand] : ['-c', shellCommand];

      const child = spawn(shell, shellArgs, {
        cwd,
        detached: !isWindows,
        stdio: 'ignore',
      });

      processesRef.current.set(shellId, { pid: child.pid! });

      const newShell: BackgroundShell = {
        id: shellId,
        command,
        pid: child.pid!,
        output: '',
        status: 'running',
        exitCode: null,
        startTime: Date.now(),
      };

      setBackgroundShells((prev) => [...prev, newShell]);

      // Set up polling for output
      let lastSize = 0;
      const pollInterval = setInterval(() => {
        try {
          if (fs.existsSync(outputFile)) {
            const content = fs.readFileSync(outputFile, 'utf8');
            if (content.length > lastSize) {
              lastSize = content.length;

              // Parse exit code if present
              let output = content;
              let exitCode: number | null = null;
              let status: 'running' | 'completed' | 'killed' = 'running';

              const exitMatch = content.match(/EXIT:(\d+)$/m);
              if (exitMatch) {
                exitCode = parseInt(exitMatch[1], 10);
                output = content.replace(/EXIT:\d+$/m, '').trim();
                status = 'completed';
                clearInterval(pollInterval);
                pollIntervalsRef.current.delete(shellId);

                // Clean up temp file after a delay
                setTimeout(() => {
                  try {
                    if (fs.existsSync(outputFile)) {
                      fs.unlinkSync(outputFile);
                    }
                  } catch (_e) {
                    // Ignore cleanup errors
                  }
                }, 5000);
              }

              // Check if process is still running
              if (status === 'running' && child.pid) {
                try {
                  process.kill(-child.pid, 0); // Signal 0 just checks if process exists
                } catch {
                  status = 'completed';
                  clearInterval(pollInterval);
                  pollIntervalsRef.current.delete(shellId);
                }
              }

              setBackgroundShells((prev) =>
                prev.map((s) =>
                  s.id === shellId
                    ? {
                        ...s,
                        output: output.length > MAX_OUTPUT_LENGTH
                          ? output.slice(-MAX_OUTPUT_LENGTH)
                          : output,
                        status,
                        exitCode: exitCode ?? s.exitCode,
                      }
                    : s
                )
              );
            }
          }
        } catch (_e) {
          // Ignore polling errors
        }
      }, POLL_INTERVAL_MS);

      pollIntervalsRef.current.set(shellId, pollInterval);

      // Handle child exit for short-running commands
      child.on('exit', (code) => {
        // Exit code will be captured via the output file polling
        // This is just a backup handler
      });

      return shellId;
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Kill all processes and clear intervals
      for (const [shellId, interval] of pollIntervalsRef.current.entries()) {
        clearInterval(interval);
        const shellProcess = processesRef.current.get(shellId);
        if (shellProcess?.pid) {
          try {
            process.kill(-shellProcess.pid, 'SIGTERM');
          } catch (_e) {
            // Ignore
          }
        }
      }
      pollIntervalsRef.current.clear();
      processesRef.current.clear();
    };
  }, []);

  return {
    backgroundShells,
    spawnBackgroundShell,
    killShell,
    getShellOutput,
  };
};
