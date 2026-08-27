/**
 * File history & checkpointing — per-edit backups bound to user turns.
 *
 * Ports easy-agent's session/fileHistory.ts (itself a port of claude-code's
 * fileHistory). Two-phase, turn-bound:
 *
 *   - `makeSnapshot(messageId)` fires at the START of each user turn. It
 *     creates a new snapshot bound to that turn, backing up every currently
 *     tracked file (a new version only when the file changed since its last
 *     backup). The snapshot captures the filesystem state *before* this
 *     turn's edits.
 *   - `trackEdit(filePath)` fires BEFORE each Edit/Write. It backs up the
 *     file's pre-edit content (v1) and attaches it to the most-recent
 *     snapshot, so a later rewind to that turn restores the original content.
 *   - `rewind(messageId)` writes/deletes tracked files on disk to match a
 *     target snapshot.
 *
 * Backups are full file copies stored under
 *   ~/.a-coder/cli/file-history/{sessionId}/{pathHash}@v{N}
 * Snapshot metadata is held in-process on the owning AgentSession (one main
 * session per process; in-process sub-agents share the main session's hook
 * closure, so their edits are tracked against the main session too).
 *
 * All IO is best-effort: a backup/restore failure is swallowed so file
 * history can never break the agent loop. State is in-memory only — /rewind
 * targets the current session (snapshots do not survive a restart).
 */

import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { diffLines } from "diff";
import { USER_CONFIG_DIR_NAME } from "../config.ts";

/** null backupFileName means "the file did not exist in this version". */
type BackupFileName = string | null;

export interface FileHistoryBackup {
	backupFileName: BackupFileName;
	version: number;
	backupTime: string;
}

export interface FileHistorySnapshot {
	/** The user-turn id this snapshot binds to (the user message timestamp). */
	messageId: string;
	trackedFileBackups: Record<string, FileHistoryBackup>;
	timestamp: string;
}

export interface FileHistoryState {
	snapshots: FileHistorySnapshot[];
	trackedFiles: Set<string>;
}

export interface DiffStats {
	filesChanged: string[];
	insertions: number;
	deletions: number;
}

const MAX_SNAPSHOTS = 100;
const DEFAULT_RETENTION_DAYS = 30;

function isEnvTruthy(value: string | undefined): boolean {
	if (!value) return false;
	const v = value.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getFileHistoryRoot(): string {
	const envDir = process.env.A_CODER_CLI_FILE_HISTORY_DIR;
	if (envDir) return envDir;
	return join(homedir(), USER_CONFIG_DIR_NAME, "file-history");
}

export class FileHistory {
	private enabled = true;
	private sessionId = "default";
	private cwd = process.cwd();
	private state: FileHistoryState = this.emptyState();

	private emptyState(): FileHistoryState {
		return { snapshots: [], trackedFiles: new Set() };
	}

	configure(cwd: string, sessionId: string): void {
		this.cwd = cwd;
		this.sessionId = sessionId;
		this.state = this.emptyState();
		this.enabled = !isEnvTruthy(process.env.A_CODER_CLI_DISABLE_FILE_HISTORY);
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	getState(): FileHistoryState {
		return this.state;
	}

	// ─── phase 1: track an edit (backup pre-edit content) ─────────────────

	/**
	 * Back up `filePath`'s current content before it is edited/created,
	 * attaching the backup to the most-recent snapshot. No-op if the file is
	 * already tracked in that snapshot (so repeat edits in the same turn never
	 * clobber v1).
	 */
	async trackEdit(filePath: string, messageId?: string): Promise<void> {
		if (!this.enabled) return;

		const trackingPath = this.maybeShortenFilePath(filePath);

		// Open an empty snapshot for this turn if none exists yet.
		if (this.state.snapshots.length === 0) {
			this.state.snapshots.push({
				messageId: messageId ?? this.synthesizeMessageId(),
				trackedFileBackups: {},
				timestamp: new Date().toISOString(),
			});
		}

		const mostRecent = this.state.snapshots[this.state.snapshots.length - 1]!;
		if (mostRecent.trackedFileBackups[trackingPath]) {
			return;
		}

		let backup: FileHistoryBackup;
		try {
			backup = await this.createBackup(filePath, 1);
		} catch {
			return;
		}

		this.state.trackedFiles.add(trackingPath);
		mostRecent.trackedFileBackups[trackingPath] = backup;
	}

	// ─── phase 2: make a turn snapshot ────────────────────────────────────

	/**
	 * Create a snapshot bound to `messageId`, backing up every tracked file
	 * (reusing the latest backup when the file is unchanged). Pushes the
	 * snapshot and evicts the oldest once past MAX_SNAPSHOTS.
	 */
	async makeSnapshot(messageId: string): Promise<void> {
		if (!this.enabled) return;

		const trackedFileBackups: Record<string, FileHistoryBackup> = {};
		const mostRecentSnapshot = this.state.snapshots[this.state.snapshots.length - 1];

		await Promise.all(
			Array.from(this.state.trackedFiles, async (trackingPath) => {
				try {
					const filePath = this.maybeExpandFilePath(trackingPath);
					const latestBackup = mostRecentSnapshot?.trackedFileBackups[trackingPath];
					const nextVersion = latestBackup ? latestBackup.version + 1 : 1;

					let fileStats: Stats | undefined;
					try {
						fileStats = await stat(filePath);
					} catch (e) {
						if (!isENOENT(e)) throw e;
					}

					if (!fileStats) {
						trackedFileBackups[trackingPath] = {
							backupFileName: null,
							version: nextVersion,
							backupTime: new Date().toISOString(),
						};
						return;
					}

					if (
						latestBackup &&
						latestBackup.backupFileName !== null &&
						!(await this.checkOriginFileChanged(filePath, latestBackup.backupFileName, fileStats))
					) {
						trackedFileBackups[trackingPath] = latestBackup;
						return;
					}

					trackedFileBackups[trackingPath] = await this.createBackup(filePath, nextVersion);
				} catch {
					// best-effort per file
				}
			}),
		);

		const newSnapshot: FileHistorySnapshot = {
			messageId,
			trackedFileBackups,
			timestamp: new Date().toISOString(),
		};
		this.state.snapshots.push(newSnapshot);
		if (this.state.snapshots.length > MAX_SNAPSHOTS) {
			this.state.snapshots = this.state.snapshots.slice(-MAX_SNAPSHOTS);
		}
	}

	// ─── phase 3: rewind / diff ───────────────────────────────────────────

	getSnapshotByOffset(offset: number): FileHistorySnapshot | undefined {
		if (offset < 1) return undefined;
		return this.state.snapshots[this.state.snapshots.length - offset];
	}

	getSnapshotById(messageId: string): FileHistorySnapshot | undefined {
		return [...this.state.snapshots].reverse().find((s) => s.messageId === messageId);
	}

	snapshotCount(): number {
		return this.state.snapshots.length;
	}

	/**
	 * Restore the filesystem to a target snapshot. Returns the list of files
	 * that were actually changed on disk (expanded absolute paths).
	 */
	async rewind(messageId: string): Promise<string[]> {
		if (!this.enabled) return [];
		const target = this.getSnapshotById(messageId);
		if (!target) {
			throw new Error("The selected snapshot was not found");
		}
		return this.applySnapshot(target);
	}

	/** Diff stats that rewinding to `messageId` would produce. */
	async getDiffStats(messageId: string): Promise<DiffStats> {
		const empty: DiffStats = { filesChanged: [], insertions: 0, deletions: 0 };
		if (!this.enabled) return empty;
		const target = this.getSnapshotById(messageId);
		if (!target) return empty;

		const results = await Promise.all(
			Array.from(this.state.trackedFiles, async (trackingPath) => {
				try {
					const filePath = this.maybeExpandFilePath(trackingPath);
					const targetBackup = target.trackedFileBackups[trackingPath];
					const backupFileName: BackupFileName | undefined = targetBackup
						? targetBackup.backupFileName
						: this.getBackupFileNameFirstVersion(trackingPath);
					if (backupFileName === undefined) return null;

					const stats = await this.computeDiffStatsForFile(
						filePath,
						backupFileName === null ? undefined : backupFileName,
					);
					if (stats.insertions || stats.deletions) {
						return { filePath, stats };
					}
					return null;
				} catch {
					return null;
				}
			}),
		);

		const out: DiffStats = { filesChanged: [], insertions: 0, deletions: 0 };
		for (const r of results) {
			if (!r) continue;
			out.filesChanged.push(r.filePath);
			out.insertions += r.stats.insertions;
			out.deletions += r.stats.deletions;
		}
		return out;
	}

	private async applySnapshot(target: FileHistorySnapshot): Promise<string[]> {
		const filesChanged: string[] = [];
		for (const trackingPath of this.state.trackedFiles) {
			try {
				const filePath = this.maybeExpandFilePath(trackingPath);
				const targetBackup = target.trackedFileBackups[trackingPath];
				const backupFileName: BackupFileName | undefined = targetBackup
					? targetBackup.backupFileName
					: this.getBackupFileNameFirstVersion(trackingPath);

				if (backupFileName === undefined) continue;

				if (backupFileName === null) {
					try {
						await unlink(filePath);
						filesChanged.push(filePath);
					} catch (e) {
						if (!isENOENT(e)) throw e;
					}
					continue;
				}

				if (await this.checkOriginFileChanged(filePath, backupFileName)) {
					await this.restoreBackup(filePath, backupFileName);
					filesChanged.push(filePath);
				}
			} catch {
				// best-effort per file
			}
		}
		return filesChanged;
	}

	// ─── cleanup ─────────────────────────────────────────────────────────

	/**
	 * Prune stale per-session backup directories older than the retention
	 * cutoff. Run at startup. Best-effort.
	 */
	async cleanupOldBackups(): Promise<void> {
		let periodDays = DEFAULT_RETENTION_DAYS;
		const configured = process.env.A_CODER_CLI_FILE_HISTORY_RETENTION_DAYS;
		if (configured) {
			const n = Number(configured);
			if (Number.isFinite(n) && n >= 0) periodDays = Math.floor(n);
		}

		const root = getFileHistoryRoot();
		let dirents: import("node:fs").Dirent[];
		try {
			dirents = await readdir(root, { withFileTypes: true });
		} catch (e) {
			if (isENOENT(e)) return;
			return;
		}

		const cutoffMs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
		await Promise.all(
			dirents
				.filter((d) => d.isDirectory())
				.map(async (d) => {
					const sessionDir = join(root, d.name);
					try {
						const stats = await stat(sessionDir);
						if (stats.mtimeMs < cutoffMs) {
							await rm(sessionDir, { recursive: true, force: true });
						}
					} catch {
						// best-effort per directory
					}
				}),
		);
	}

	// ─── backup helpers ──────────────────────────────────────────────────

	private synthesizeMessageId(): string {
		return `turn-${Date.now()}`;
	}

	private getBackupFileName(filePath: string, version: number): string {
		const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 16);
		return `${hash}@v${version}`;
	}

	private resolveBackupPath(backupFileName: string): string {
		return join(getFileHistoryRoot(), this.sessionId, backupFileName);
	}

	private async createBackup(filePath: string, version: number): Promise<FileHistoryBackup> {
		const backupTime = new Date().toISOString();
		const backupFileName = this.getBackupFileName(filePath, version);
		const backupPath = this.resolveBackupPath(backupFileName);

		let srcStats: Stats;
		try {
			srcStats = await stat(filePath);
		} catch (e) {
			if (isENOENT(e)) return { backupFileName: null, version, backupTime };
			throw e;
		}

		try {
			await copyFile(filePath, backupPath);
		} catch (e) {
			if (!isENOENT(e)) throw e;
			await mkdir(dirname(backupPath), { recursive: true });
			await copyFile(filePath, backupPath);
		}
		await chmod(backupPath, srcStats.mode);

		return { backupFileName, version, backupTime };
	}

	private async restoreBackup(filePath: string, backupFileName: string): Promise<void> {
		const backupPath = this.resolveBackupPath(backupFileName);
		let backupStats: Stats;
		try {
			backupStats = await stat(backupPath);
		} catch (e) {
			if (isENOENT(e)) return;
			throw e;
		}

		try {
			await copyFile(backupPath, filePath);
		} catch (e) {
			if (!isENOENT(e)) throw e;
			await mkdir(dirname(filePath), { recursive: true });
			await copyFile(backupPath, filePath);
		}
		await chmod(filePath, backupStats.mode);
	}

	private getBackupFileNameFirstVersion(trackingPath: string): BackupFileName | undefined {
		for (const snapshot of this.state.snapshots) {
			const backup = snapshot.trackedFileBackups[trackingPath];
			if (backup !== undefined && backup.version === 1) {
				return backup.backupFileName;
			}
		}
		return undefined;
	}

	// ─── change detection ─────────────────────────────────────────────────

	async checkOriginFileChanged(
		originalFile: string,
		backupFileName: string,
		originalStatsHint?: Stats,
	): Promise<boolean> {
		const backupPath = this.resolveBackupPath(backupFileName);

		let originalStats: Stats | null = originalStatsHint ?? null;
		if (!originalStats) {
			try {
				originalStats = await stat(originalFile);
			} catch (e) {
				if (!isENOENT(e)) return true;
			}
		}
		let backupStats: Stats | null = null;
		try {
			backupStats = await stat(backupPath);
		} catch (e) {
			if (!isENOENT(e)) return true;
		}

		if ((originalStats === null) !== (backupStats === null)) return true;
		if (originalStats === null || backupStats === null) return false;
		if (originalStats.mode !== backupStats.mode || originalStats.size !== backupStats.size) {
			return true;
		}
		if (originalStats.mtimeMs < backupStats.mtimeMs) return false;

		try {
			const [a, b] = await Promise.all([this.readFileOrNull(originalFile), this.readFileOrNull(backupPath)]);
			return a !== b;
		} catch {
			return true;
		}
	}

	private async computeDiffStatsForFile(
		originalFile: string,
		backupFileName?: string,
	): Promise<{ insertions: number; deletions: number }> {
		let insertions = 0;
		let deletions = 0;
		try {
			const backupPath = backupFileName ? this.resolveBackupPath(backupFileName) : undefined;
			const [originalContent, backupContent] = await Promise.all([
				this.readFileOrNull(originalFile),
				backupPath ? this.readFileOrNull(backupPath) : Promise.resolve(null),
			]);
			if (originalContent === null && backupContent === null) {
				return { insertions, deletions };
			}
			const changes = diffLines(originalContent ?? "", backupContent ?? "");
			for (const c of changes) {
				if (c.added) insertions += c.count ?? 0;
				if (c.removed) deletions += c.count ?? 0;
			}
		} catch {
			// best-effort
		}
		return { insertions, deletions };
	}

	private async readFileOrNull(path: string): Promise<string | null> {
		try {
			return await readFile(path, "utf-8");
		} catch {
			return null;
		}
	}

	// ─── path normalization ───────────────────────────────────────────────

	private maybeShortenFilePath(filePath: string): string {
		if (!isAbsolute(filePath)) return filePath;
		if (filePath.startsWith(this.cwd)) return relative(this.cwd, filePath);
		return filePath;
	}

	private maybeExpandFilePath(filePath: string): string {
		if (isAbsolute(filePath)) return filePath;
		return join(this.cwd, filePath);
	}
}

function isENOENT(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
