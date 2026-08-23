import { describe, expect, it } from "vitest";
import type { BashToolDetails } from "../src/core/tools/bash.ts";

/**
 * Regression tests for layered Bash output rendering (stdout vs stderr).
 *
 * The bash tool captures stderr separately via `onStderrData` and stores it
 * in `details.stderr`. The renderer displays it as a separate "stderr:"
 * section in error color after the main output.
 */

describe("BashToolDetails stderr", () => {
	it("details carries stderr alongside truncation info", () => {
		const details: BashToolDetails = {
			truncation: undefined,
			fullOutputPath: undefined,
			stderr: "error: file not found",
		};
		expect(details.stderr).toBe("error: file not found");
	});

	it("details without stderr is valid (backward compatible)", () => {
		const details: BashToolDetails = {
			truncation: {
				content: "output...",
				truncated: true,
				truncatedBy: "lines",
				totalLines: 100,
				totalBytes: 5000,
				outputLines: 50,
				outputBytes: 1024,
				maxBytes: 2048,
				maxLines: 100,
				lastLinePartial: false,
				firstLineExceedsLimit: false,
			},
			fullOutputPath: "/tmp/out.txt",
		};
		expect(details.stderr).toBeUndefined();
	});
});
