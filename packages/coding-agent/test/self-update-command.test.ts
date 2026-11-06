import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandSelfUpdateCommand, getConfiguredSelfUpdateCommand } from "../src/utils/cli-self-update.ts";

const ENV_KEYS = ["A_CODER_SELF_UPDATE_COMMAND", "PI_SELF_UPDATE_COMMAND"];

describe("configured self-update command", () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved.set(key, process.env[key]);
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			const value = saved.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("is undefined without the environment variable", () => {
		expect(getConfiguredSelfUpdateCommand()).toBeUndefined();
	});

	it("splits the command on whitespace", () => {
		process.env.A_CODER_SELF_UPDATE_COMMAND = "  mise   use -g  npm:pkg  ";
		expect(getConfiguredSelfUpdateCommand()).toEqual(["mise", "use", "-g", "npm:pkg"]);
	});

	it("prefers A_CODER_ over PI_", () => {
		process.env.PI_SELF_UPDATE_COMMAND = "nix profile upgrade pi";
		process.env.A_CODER_SELF_UPDATE_COMMAND = "mise use -g npm:pkg";
		expect(getConfiguredSelfUpdateCommand()).toEqual(["mise", "use", "-g", "npm:pkg"]);
	});

	it("expands release placeholders", () => {
		expect(
			expandSelfUpdateCommand(["mise", "use", "-g", "npm:{packageName}@{version}", "{installSpec}"], {
				packageName: "@scope/pkg",
				version: "1.2.3",
				installSpec: "@scope/pkg@1.2.3",
			}),
		).toEqual(["mise", "use", "-g", "npm:@scope/pkg@1.2.3", "@scope/pkg@1.2.3"]);
	});

	it("leaves unknown placeholders alone", () => {
		expect(
			expandSelfUpdateCommand(["cmd", "{unknown}"], { packageName: "p", version: "1", installSpec: "p@1" }),
		).toEqual(["cmd", "{unknown}"]);
	});
});
