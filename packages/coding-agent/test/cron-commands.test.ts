import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { CronTui } from "../src/modes/interactive/cron-commands.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

interface RegistryModel {
	provider: string;
	id: string;
}

interface FixturePorts {
	settingsManager: {
		getCronModel(): string | undefined;
		setCronModel(model: string | undefined): void;
	};
	modelRegistry: {
		find(provider: string, modelId: string): Model<"openai-completions"> | undefined;
		getAvailable(): Model<"openai-completions">[];
		hasConfiguredAuth(model: Model<"openai-completions">): boolean;
	};
}

function stripAnsi(text: string): string {
	const esc = String.fromCharCode(27);
	return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

function fixtureModel(provider: string, id: string): Model<"openai-completions"> {
	return {
		provider,
		id,
		name: id,
		api: "openai-completions",
		baseUrl: "https://example.invalid/v1",
		contextWindow: 128_000,
		maxTokens: 8_192,
	} as unknown as Model<"openai-completions">;
}

function createRuntime(
	known: RegistryModel[],
	authed: Set<string>,
): { runtime: AgentSessionRuntime; settings: FixturePorts["settingsManager"]; setValues: Array<string | undefined> } {
	const setValues: Array<string | undefined> = [];
	let current: string | undefined;

	const settingsManager = {
		getCronModel: () => current,
		setCronModel: (model: string | undefined) => {
			setValues.push(model);
			current = model;
		},
	};
	const modelRegistry = {
		find: (provider: string, modelId: string) => {
			const match = known.find((m) => m.provider === provider && m.id === modelId);
			return match ? fixtureModel(match.provider, match.id) : undefined;
		},
		getAvailable: () => known.map((m) => fixtureModel(m.provider, m.id)),
		hasConfiguredAuth: (model: Model<"openai-completions">) => authed.has(`${model.provider}/${model.id}`),
	};

	const runtime = {
		cwd: "/tmp/project",
		session: {},
		setScheduleService(): void {},
		services: { settingsManager, modelRegistry },
	} as unknown as AgentSessionRuntime;

	return { runtime, settings: settingsManager, setValues };
}

function createTui(
	known: RegistryModel[],
	authed: Set<string>,
): {
	tui: CronTui;
	outputs: string[];
	setValues: Array<string | undefined>;
	settings: FixturePorts["settingsManager"];
} {
	const outputs: string[] = [];
	const { runtime, settings, setValues } = createRuntime(known, authed);
	const tui = new CronTui(runtime, (text) => outputs.push(stripAnsi(text)));
	return { tui, outputs, setValues, settings };
}

describe("CronTui model command", () => {
	it("shows the unset state and the resolution order", async () => {
		const { tui, outputs } = createTui([], new Set());
		await tui.handleModelCommand("");
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toContain("Scheduled task model");
		expect(outputs[0]).toContain("not set");
		expect(outputs[0]).toContain("delegated-work model");
	});

	it("sets a known, authenticated model", async () => {
		const { tui, outputs, setValues } = createTui(
			[{ provider: "anthropic", id: "claude-x" }],
			new Set(["anthropic/claude-x"]),
		);
		await tui.handleModelCommand("anthropic/claude-x");
		expect(setValues).toEqual(["anthropic/claude-x"]);
		expect(outputs[0]).toContain("set as the scheduled task model");
		expect(outputs[0]).not.toContain("warning");
	});

	it("warns but still sets when the provider has no credentials", async () => {
		const { tui, outputs, setValues } = createTui([{ provider: "anthropic", id: "claude-x" }], new Set());
		await tui.handleModelCommand("anthropic/claude-x");
		expect(setValues).toEqual(["anthropic/claude-x"]);
		expect(outputs[0]).toContain("no credentials");
		expect(outputs[0]).toContain("will fail");
	});

	it("rejects a model missing from the catalog without saving", async () => {
		const { tui, outputs, setValues } = createTui([], new Set());
		await tui.handleModelCommand("inception/mercury-9");
		expect(setValues).toEqual([]);
		expect(outputs[0]).toContain("not in the model catalog");
	});

	it("rejects a malformed reference without the provider part", async () => {
		const { tui, outputs, setValues } = createTui([], new Set());
		await tui.handleModelCommand("claude-x");
		expect(setValues).toEqual([]);
		expect(outputs[0]).toContain("provider/model");
	});

	it("clears the setting", async () => {
		const { tui, outputs, setValues } = createTui(
			[{ provider: "anthropic", id: "claude-x" }],
			new Set(["anthropic/claude-x"]),
		);
		await tui.handleModelCommand("anthropic/claude-x");
		await tui.handleModelCommand("clear");
		expect(setValues[setValues.length - 1]).toBeUndefined();
		expect(outputs[outputs.length - 1]).toContain("cleared");
	});

	it("annotates the view with auth state for a configured model", async () => {
		const { tui, outputs, settings } = createTui([{ provider: "anthropic", id: "claude-x" }], new Set());
		await tui.handleModelCommand("anthropic/claude-x");
		outputs.length = 0;
		await tui.handleModelCommand("");
		expect(outputs[0]).toContain("anthropic/claude-x");
		expect(outputs[0]).toContain("no credentials");
		expect(settings.getCronModel()).toBe("anthropic/claude-x");
	});

	it("annotates the view when the setting no longer resolves", async () => {
		const { tui, outputs, settings } = createTui([], new Set());
		settings.setCronModel("inception/mercury-9");
		await tui.handleModelCommand("");
		expect(outputs[0]).toContain("inception/mercury-9");
		expect(outputs[0]).toContain("not in catalog");
	});
});
