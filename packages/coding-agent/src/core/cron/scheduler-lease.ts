/**
 * Machine-wide scheduler lease.
 *
 * Every engine process runs a CronService ticker, but cron jobs live in one
 * shared `<agentDir>/cron/jobs.json`. Without a cross-process lease, every
 * tab/desktop session fires the same due window. Only the lease owner ticks;
 * followers keep reading/writing the store and spool host events for the
 * leader to drain.
 *
 * The lease is deliberately conservative: a live process on the same host
 * keeps ownership even after the TTL, so a wedged leader cannot be replaced
 * by mistake. A crashed owner releases through normal exit, and a dead PID
 * allows immediate takeover. Cross-host leases fall back to the TTL.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";
import { withFileLockRetrySync } from "../../utils/file-retry.ts";

const LEASE_TTL_MS = 60_000;

interface LeaseRecord {
	token: string;
	pid: number;
	host: string;
	acquiredAt: number;
	updatedAt: number;
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function readLease(path: string): LeaseRecord | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<LeaseRecord>;
		if (
			typeof parsed.token !== "string" ||
			typeof parsed.pid !== "number" ||
			typeof parsed.host !== "string" ||
			typeof parsed.acquiredAt !== "number" ||
			typeof parsed.updatedAt !== "number"
		) {
			return undefined;
		}
		return parsed as LeaseRecord;
	} catch {
		return undefined;
	}
}

export class CronSchedulerLease {
	private readonly path = join(getAgentDir(), "cron", "scheduler.lock");
	private readonly token = randomUUID();
	private leader = false;

	get isLeader(): boolean {
		return this.leader;
	}

	/** Acquire, renew, or observe another process's lease. */
	acquireOrRenew(): boolean {
		mkdirSync(dirname(this.path), { recursive: true });
		const now = Date.now();
		const current = readLease(this.path);

		if (current) {
			if (current.token === this.token) {
				this.leader = true;
				this.write(now, current.acquiredAt);
				return true;
			}
			const sameHost = current.host === hostname();
			if (sameHost && processAlive(current.pid)) {
				this.leader = false;
				return false;
			}
			if (!sameHost && now - current.updatedAt < LEASE_TTL_MS) {
				this.leader = false;
				return false;
			}
			// Dead local process or expired remote lease. Rename the stale file
			// first: the rename is atomic and means two contenders cannot both
			// delete a freshly-created replacement. Whoever wins the subsequent
			// `wx` create owns the lease. A short retry ride out a transient
			// Windows lock on the stale file; otherwise takeover waits a full tick.
			const stale = `${this.path}.stale-${current.token}-${this.token}`;
			try {
				withFileLockRetrySync(() => renameSync(this.path, stale), {
					retries: 4,
					baseDelayMs: 25,
					maxDelayMs: 100,
				});
			} catch {
				return false;
			}
			try {
				unlinkSync(stale);
			} catch {
				// Best effort cleanup.
			}
		}

		try {
			writeFileSync(
				this.path,
				JSON.stringify({
					token: this.token,
					pid: process.pid,
					host: hostname(),
					acquiredAt: now,
					updatedAt: now,
				} satisfies LeaseRecord),
				{ encoding: "utf-8", flag: "wx" },
			);
			this.leader = true;
			return true;
		} catch {
			this.leader = false;
			return false;
		}
	}

	/** Release only our own lease. */
	release(): void {
		const current = readLease(this.path);
		if (!current || current.token !== this.token) {
			this.leader = false;
			return;
		}
		try {
			unlinkSync(this.path);
		} catch {
			// Already gone.
		}
		this.leader = false;
	}

	private write(now: number, acquiredAt: number): void {
		if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
		try {
			writeFileSync(
				this.path,
				JSON.stringify({
					token: this.token,
					pid: process.pid,
					host: hostname(),
					acquiredAt,
					updatedAt: now,
				} satisfies LeaseRecord),
				"utf-8",
			);
		} catch {
			// A failed renewal lets another host take over after the TTL; keep
			// the in-process leader flag so a transient write error does not
			// stop a run that is already executing.
		}
	}
}
