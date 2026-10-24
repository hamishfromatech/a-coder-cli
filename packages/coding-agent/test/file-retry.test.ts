import { describe, expect, it } from "vitest";
import { isRetryableFileLockError, withFileLockRetry } from "../src/utils/file-retry.ts";

function lockedError(code = "EBUSY"): NodeJS.ErrnoException {
	const error = new Error(`${code}: resource busy or locked`) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

describe("file lock retry", () => {
	it("retries a transient Windows lock and succeeds", async () => {
		let attempts = 0;
		const result = await withFileLockRetry(
			async () => {
				attempts++;
				if (attempts < 3) throw lockedError();
				return "ok";
			},
			{ baseDelayMs: 1, maxDelayMs: 2 },
		);
		expect(result).toBe("ok");
		expect(attempts).toBe(3);
	});

	it("does not retry unrelated failures", async () => {
		let attempts = 0;
		await expect(
			withFileLockRetry(
				async () => {
					attempts++;
					const error = new Error("missing") as NodeJS.ErrnoException;
					error.code = "ENOENT";
					throw error;
				},
				{ baseDelayMs: 1 },
			),
		).rejects.toThrow("missing");
		expect(attempts).toBe(1);
	});

	it("stops after the bounded attempt count", async () => {
		let attempts = 0;
		await expect(
			withFileLockRetry(
				async () => {
					attempts++;
					throw lockedError("EPERM");
				},
				{ retries: 3, baseDelayMs: 1, maxDelayMs: 2 },
			),
		).rejects.toMatchObject({ code: "EPERM" });
		expect(attempts).toBe(3);
	});

	it("recognizes the retryable lock codes", () => {
		for (const code of ["EBUSY", "EPERM", "EACCES", "ETXTBSY"]) {
			expect(isRetryableFileLockError(lockedError(code))).toBe(true);
		}
		expect(isRetryableFileLockError(new Error("nope"))).toBe(false);
	});
});
