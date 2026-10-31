/**
 * `doctor` — one command that answers "why is it broken".
 *
 * Collects runtime identity, config paths and parse errors, per-provider auth
 * state, MCP server status, session-store health, and disk space. Human
 * readable by default; `--json` for bug reports and scripts.
 */

import { accessSync, constants, readdirSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import process from "node:process";
import chalk from "chalk";
import { getAgentDir, getAuthPath, getSessionsDir, getSettingsPath, VERSION } from "../config.ts";

/**
 * Folders macOS guards with a privacy prompt. Kept local so `doctor` stays
 * independent of the agent package's build output.
 */
const GUARDED_FOLDERS: Array<{ label: string; path: string }> = [
	{ label: "Desktop", path: join(homedir(), "Desktop") },
	{ label: "Documents", path: join(homedir(), "Documents") },
	{ label: "Downloads", path: join(homedir(), "Downloads") },
	{ label: "Movies", path: join(homedir(), "Movies") },
	{ label: "Music", path: join(homedir(), "Music") },
	{ label: "Pictures", path: join(homedir(), "Pictures") },
	{ label: "iCloud Drive", path: join(homedir(), "Library", "Mobile Documents") },
];

function guardedRootFor(path: string): { label: string; path: string } | undefined {
	return GUARDED_FOLDERS.find((root) => path === root.path || path.startsWith(`${root.path}${sep}`));
}

import { AuthStorage } from "../core/auth-storage.ts";
import { getMcpServerStates } from "../core/mcp/status-store.ts";
import { formatBytes, getSessionStoreStats } from "../core/session-maintenance.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { RPC_CONTRACT } from "../modes/rpc/rpc-types.ts";

export interface DoctorReport {
	version: string;
	rpcContract: number;
	node: string;
	platform: string;
	defaultModel?: string;
	paths: {
		agentDir: string;
		settings: string;
		auth: string;
		sessions: string;
	};
	writable: { agentDir: boolean; sessions: boolean };
	/** macOS privacy check for the working directory, when it is a guarded folder. */
	fileAccess: {
		platform: string;
		cwd: string;
		status: "ok" | "denied" | "missing" | "not_applicable";
		guardedFolder?: string;
		hint?: string;
	};
	/** Every guarded folder macOS may prompt for, with a readable probe. */
	guardedFolders: Array<{ label: string; path: string; status: "ok" | "denied" | "missing" }>;
	settingsErrors: string[];
	sessions: {
		count: number;
		totalBytes: number;
		largest: Array<{ path: string; bytes: number }>;
	};
	diskFreeBytes?: number;
	auth: Array<{ provider: string; configured: boolean; source?: string; label?: string }>;
	mcp: Array<{ name: string; status: string; error?: string; toolCount?: number }>;
}

function isWritable(path: string): boolean {
	try {
		accessSync(path, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function freeDiskBytes(path: string): number | undefined {
	try {
		const stats = statfsSync(path);
		return Number(stats.bavail) * Number(stats.bsize);
	} catch {
		return undefined;
	}
}

/**
 * Probe a directory without triggering a write. `readdirSync` is the cheapest read
 * that macOS gates: a TCC denial answers EPERM, an absent folder ENOENT.
 */
function probeDirectory(path: string): "ok" | "denied" | "missing" {
	try {
		readdirSync(path);
		return "ok";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return "missing";
		if (code === "EPERM" || code === "EACCES") return "denied";
		return "ok";
	}
}

export function collectDoctorReport(): DoctorReport {
	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const sessionsDir = getSessionsDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const settingsErrors = settingsManager
		.drainErrors()
		.map((entry) => `${entry.scope}${entry.path ? ` (${entry.path})` : ""}: ${entry.error.message}`);

	let auth: DoctorReport["auth"] = [];
	try {
		const storage = AuthStorage.create(getAuthPath());
		auth = storage.list().map((provider) => {
			const status = storage.getAuthStatus(provider);
			return { provider, configured: status.configured, source: status.source, label: status.label };
		});
	} catch {
		// Unreadable auth.json is reported through the settings errors path.
	}

	const storeStats = getSessionStoreStats(sessionsDir);

	const workingDir = process.cwd();
	const guarded = process.platform === "darwin" ? guardedRootFor(workingDir) : undefined;
	const fileAccess: DoctorReport["fileAccess"] = {
		platform: process.platform,
		cwd: workingDir,
		status: process.platform !== "darwin" ? "not_applicable" : guarded ? probeDirectory(workingDir) : "ok",
		...(guarded ? { guardedFolder: guarded.label } : {}),
		...(guarded && probeDirectory(workingDir) === "denied"
			? {
					hint: `macOS is blocking access to ~/${guarded.label}. Open System Settings → Privacy & Security → Files and Folders (or Full Disk Access), enable access for ${process.env.TERM_PROGRAM ?? "your terminal or A-Coder Desktop"}, then restart it.`,
				}
			: {}),
	};
	const guardedFolders =
		process.platform === "darwin"
			? GUARDED_FOLDERS.map((root) => ({
					label: root.label,
					path: root.path,
					status: probeDirectory(root.path),
				}))
			: [];
	return {
		version: VERSION,
		rpcContract: RPC_CONTRACT,
		node: process.version,
		platform: `${process.platform} ${process.arch}`,
		defaultModel:
			settingsManager.getDefaultProvider() && settingsManager.getDefaultModel()
				? `${settingsManager.getDefaultProvider()}/${settingsManager.getDefaultModel()}`
				: settingsManager.getDefaultModel(),
		paths: {
			agentDir,
			settings: getSettingsPath(),
			auth: getAuthPath(),
			sessions: sessionsDir,
		},
		writable: { agentDir: isWritable(agentDir), sessions: isWritable(sessionsDir) },
		settingsErrors,
		sessions: { count: storeStats.count, totalBytes: storeStats.totalBytes, largest: storeStats.largest },
		diskFreeBytes: freeDiskBytes(agentDir),
		fileAccess,
		guardedFolders,
		auth,
		mcp: getMcpServerStates().map((state) => ({
			name: state.name,
			status: state.status,
			error: state.error,
			toolCount: state.toolCount,
		})),
	};
}

export function formatDoctorReport(report: DoctorReport): string {
	const lines: string[] = [];
	const section = (title: string) => lines.push("", chalk.bold(title));
	const row = (label: string, value: string) => lines.push(`  ${label.padEnd(14)} ${value}`);

	lines.push(chalk.bold(`A-Coder CLI doctor`));

	section("Runtime");
	row("version", report.version);
	row("rpc contract", String(report.rpcContract));
	row("node", report.node);
	row("platform", report.platform);
	if (report.defaultModel) row("default model", report.defaultModel);

	section("Paths");
	row("agent dir", `${report.paths.agentDir}${report.writable.agentDir ? "" : chalk.red("  (not writable)")}`);
	row("settings", report.paths.settings);
	row("auth", report.paths.auth);
	row(
		"sessions",
		`${report.paths.sessions}  (${report.sessions.count} sessions, ${formatBytes(report.sessions.totalBytes)}${report.writable.sessions ? "" : `, ${chalk.red("not writable")}`})`,
	);
	if (report.diskFreeBytes !== undefined) row("disk free", formatBytes(report.diskFreeBytes));

	if (report.fileAccess.platform === "darwin") {
		section("File access (macOS)");
		const status =
			report.fileAccess.status === "denied"
				? chalk.red("blocked by macOS privacy settings")
				: report.fileAccess.status === "missing"
					? chalk.dim("folder not found")
					: report.fileAccess.status === "ok"
						? chalk.green("ok")
						: chalk.dim("not checked");
		row("working dir", `${report.fileAccess.cwd}  ${status}`);
		for (const folder of report.guardedFolders) {
			if (folder.status === "missing") continue;
			const label = folder.status === "denied" ? chalk.red("blocked") : chalk.green("ok");
			lines.push(`  ${folder.label.padEnd(14)} ${label}`);
		}
		if (report.fileAccess.hint) lines.push("", chalk.yellow(`  ${report.fileAccess.hint}`));
	}

	section("Auth");
	if (report.auth.length === 0) {
		lines.push(chalk.dim("  No providers configured — run /login"));
	} else {
		for (const entry of report.auth) {
			const state = entry.configured ? chalk.green("configured") : chalk.yellow("missing");
			const source = entry.source ? chalk.dim(` (${entry.source})`) : "";
			lines.push(`  ${entry.provider.padEnd(14)} ${state}${source}`);
		}
	}

	section("MCP");
	if (report.mcp.length === 0) {
		lines.push(chalk.dim("  No MCP servers configured"));
	} else {
		for (const server of report.mcp) {
			const marker =
				server.status === "ok"
					? chalk.green("ok")
					: server.status === "connecting"
						? chalk.dim("connecting")
						: server.status === "disabled"
							? chalk.dim("disabled")
							: chalk.yellow(server.status);
			const tools = server.toolCount !== undefined ? chalk.dim(` (${server.toolCount} tools)`) : "";
			const error = server.error ? chalk.dim(`: ${server.error}`) : "";
			lines.push(`  ${server.name.padEnd(14)} ${marker}${tools}${error}`);
		}
	}

	section("Problems");
	if (report.settingsErrors.length === 0) {
		lines.push(chalk.dim("  None found"));
	} else {
		for (const problem of report.settingsErrors) lines.push(`  ${chalk.red("•")} ${problem}`);
	}
	if (report.sessions.largest.length > 0) {
		section("Largest sessions");
		for (const item of report.sessions.largest) {
			lines.push(`  ${formatBytes(item.bytes).padStart(8)}  ${chalk.dim(item.path)}`);
		}
	}

	return lines.join("\n");
}

/** `a-coder-cli doctor [--json]` — returns false when this is not the command. */
export async function handleDoctorCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "doctor") return false;
	if (args.includes("--help") || args.includes("-h")) {
		console.log(
			`${chalk.bold("Usage:")} a-coder-cli doctor [--json]\n\nChecks version/contract, config paths, auth, MCP, and the session store.`,
		);
		return true;
	}
	const report = collectDoctorReport();
	if (args.includes("--json")) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(formatDoctorReport(report));
	}
	return true;
}
