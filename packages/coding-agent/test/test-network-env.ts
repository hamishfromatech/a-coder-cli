import { vi } from "vitest";

/** Enable network code paths for tests that replace external I/O with local fixtures or mocks. */
export function allowNetwork(): void {
	vi.stubEnv("A_CODER_CLI_OFFLINE", undefined);
}
