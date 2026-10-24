/**
 * Retry transient filesystem locks.
 *
 * Windows returns EBUSY/EPERM/EACCES when another process has the file open
 * without sharing (editors, test runners, antivirus/indexers). The lock is
 * usually short-lived, so a bounded backoff succeeds without hiding a real
 * permission error.
 */

const RETRYABLE_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ETXTBSY"]);

export interface FileRetryOptions {
	/** Total attempts including the first one. */
	retries?: number;
	/** Initial delay; doubles up to maxDelayMs. */
	baseDelayMs?: number;
	maxDelayMs?: number;
}

export function isRetryableFileLockError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		RETRYABLE_CODES.has(String((error as { code?: unknown }).code))
	);
}

export async function withFileLockRetry<T>(operation: () => Promise<T>, options: FileRetryOptions = {}): Promise<T> {
	const retries = Math.max(1, options.retries ?? 12);
	const maxDelayMs = Math.max(1, options.maxDelayMs ?? 400);
	let delayMs = Math.max(1, options.baseDelayMs ?? 20);

	for (let attempt = 1; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (!isRetryableFileLockError(error) || attempt >= retries) throw error;
			// Jitter avoids two tabs retrying in lockstep against the same file.
			await new Promise((resolve) => setTimeout(resolve, delayMs + Math.random() * delayMs));
			delayMs = Math.min(delayMs * 2, maxDelayMs);
		}
	}
}
