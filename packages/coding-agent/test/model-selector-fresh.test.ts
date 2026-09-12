import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

function makeModel(provider: string, id: string): Model<any> {
	return {
		provider,
		id,
		name: id,
		api: "openai_completions" as any,
		baseUrl: "https://example.test",
		contextWindow: 128000,
		maxTokens: 8192,
		reasoning: false,
	} as unknown as Model<any>;
}

/** Registry stub: cached list first, expanded after refreshDynamicModels. */
function makeRegistry(cached: Model<any>[], fresh: Model<any>[]) {
	let refreshed = false;
	return {
		refreshDynamicModels: vi.fn(async (force?: boolean) => {
			expect(force).toBe(true);
			refreshed = true;
		}),
		getAvailable: vi.fn(() => (refreshed ? fresh : cached)),
		refreshed: () => refreshed,
	} as unknown as {
		refreshDynamicModels: (force?: boolean) => Promise<string | undefined>;
		getAvailable: () => Model<any>[];
		refreshed: () => boolean;
	};
}

const fakeTui = { requestRender: vi.fn() } as any;

function renderList(selector: ModelSelectorComponent): string {
	return selector.render(100).join("\n");
}

describe("ModelSelectorComponent fresh-catalog load", () => {
	it("paints the cached catalog immediately, then repaints after the forced refresh", async () => {
		const cachedOnly = [makeModel("ollama", "llama3:latest")];
		const withFresh = [...cachedOnly, makeModel("ollama-cloud", "qwen3:cloud")];
		const registry = makeRegistry(cachedOnly, withFresh);

		const selector = new ModelSelectorComponent(
			fakeTui,
			undefined,
			{} as any,
			registry as any,
			() => {},
			() => {},
		);

		// Phase 1 runs synchronously-ish: the cached model is visible before
		// the microtask queue even settles, and the refresh was kicked off.
		const before = renderList(selector);
		expect(before).toContain("llama3:latest");
		expect(before).not.toContain("qwen3:cloud");
		expect(registry.refreshed()).toBe(true);
		expect(registry.refreshDynamicModels).toHaveBeenCalledWith(true);

		// Phase 2: once the forced refresh lands, the fresh catalog is in.
		await vi.waitFor(() => {
			expect(renderList(selector)).toContain("qwen3:cloud");
		});
	});

	it("re-applies the live search query after the refresh repaint", async () => {
		const registry = makeRegistry(
			[makeModel("ollama", "llama3:latest")],
			[makeModel("ollama", "llama3:latest"), makeModel("ollama", "llama4:latest")],
		);

		const selector = new ModelSelectorComponent(
			fakeTui,
			undefined,
			{} as any,
			registry as any,
			() => {},
			() => {},
			"llama3",
		);

		// Type an extra character after the initial paint.
		selector.handleInput("x"); // 'llama3' + 'x' narrows to nothing? 'llama3x'
		const narrowed = renderList(selector);
		expect(narrowed).not.toContain("llama4:latest");

		await vi.waitFor(() => {
			const after = renderList(selector);
			// Repaint kept the user's live filter — llama4 stays filtered out.
			expect(after).not.toContain("llama4:latest");
		});
	});
});
