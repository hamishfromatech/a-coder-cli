import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR_NAME = ".a-coder";
const ENV_CLOUD_DIR = "A_CODER_CLI_CLOUD_DIR";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path)
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

interface PackageJson {
	version?: string;
}

function getPackageJsonPath(): string {
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		const packageJsonPath = join(dir, "package.json");
		if (existsSync(packageJsonPath)) {
			return packageJsonPath;
		}
		dir = dirname(dir);
	}
	return join(__dirname, "package.json");
}

let pkg: PackageJson = {};
try {
	pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8")) as PackageJson;
} catch (e: unknown) {
	const err = e as NodeJS.ErrnoException;
	if (err.code !== "ENOENT") throw err;
}

export const VERSION: string = pkg.version || "0.0.0";

/** Root dir for cloud state: tasks, workspaces, socket. */
export function getCloudDir(): string {
	const envDir = process.env[ENV_CLOUD_DIR];
	if (envDir) return envDir;
	const configDir = process.env.A_CODER_CLI_CONFIG_DIR || join(homedir(), CONFIG_DIR_NAME);
	return join(configDir, "cloud");
}

export function getTasksPath(): string {
	return join(getCloudDir(), "tasks.json");
}

export function getWorkspacesDir(): string {
	return join(getCloudDir(), "workspaces");
}

export function getWorkspacePath(taskId: string): string {
	return join(getWorkspacesDir(), taskId);
}

export function getTaskArtifactsDir(taskId: string): string {
	return join(getCloudDir(), "tasks", taskId);
}

export function getSocketPath(): string {
	return join(getCloudDir(), "cloud.sock");
}

/** Default wall-clock budget per task. */
export const DEFAULT_TIMEOUT_MINUTES = 30;

/** WIP checkpoint cadence during a run. */
export const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

export const TASK_BRANCH_PREFIX = "ac-cloud/";

export const GIT_COMMIT_IDENTITY_NAME = "A-Coder Cloud";
export const GIT_COMMIT_IDENTITY_EMAIL = "cloud@a-coder.local";
