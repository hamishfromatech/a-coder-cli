import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalPiExperimental = process.env.A_CODER_CLI_EXPERIMENTAL;

	afterEach(() => {
		if (originalPiExperimental === undefined) {
			delete process.env.A_CODER_CLI_EXPERIMENTAL;
		} else {
			process.env.A_CODER_CLI_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false when A_CODER_CLI_EXPERIMENTAL is unset", () => {
		delete process.env.A_CODER_CLI_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when A_CODER_CLI_EXPERIMENTAL is empty", () => {
		process.env.A_CODER_CLI_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when A_CODER_CLI_EXPERIMENTAL is set to 1", () => {
		process.env.A_CODER_CLI_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when A_CODER_CLI_EXPERIMENTAL is set to 0", () => {
		process.env.A_CODER_CLI_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when A_CODER_CLI_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.A_CODER_CLI_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
