import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedComposioConfig } from "../src/core/composio.ts";
import { listComposioApps } from "../src/core/composio-apps.ts";

// Mock the shared client factory so listComposioApps runs against an in-memory
// Composio surface (no network). Only createComposioClient is exercised here.
vi.mock("../src/core/composio.ts", () => ({
	createComposioClient: vi.fn(),
}));

const { createComposioClient } = await import("../src/core/composio.ts");

function makeClient(toolkits: unknown[], accounts: unknown[]): unknown {
	return {
		toolkits: { get: vi.fn(async () => toolkits) },
		connectedAccounts: { list: vi.fn(async () => ({ items: accounts })) },
	};
}

const cfg = { apiKey: "k", enabled: true } as unknown as ResolvedComposioConfig;

describe("listComposioApps", () => {
	beforeEach(() => vi.mocked(createComposioClient).mockReset());

	it("marks a toolkit connected only when an ACTIVE account exists for its slug", async () => {
		vi.mocked(createComposioClient).mockReturnValue({
			composio: makeClient(
				[
					{ slug: "github", name: "GitHub", meta: { description: "Code", toolsCount: 30 } },
					{ slug: "slack", name: "Slack", meta: { description: "Chat" } },
					{ slug: "noauth-tool", name: "NoAuth", noAuth: true, meta: {} },
				],
				[
					{ id: "ca_1", status: "ACTIVE", toolkit: { slug: "github" } },
					{ id: "ca_2", status: "INITIATED", toolkit: { slug: "slack" } },
				],
			) as never,
			userId: "u1",
		});

		const apps = await listComposioApps(cfg, "/tmp/agent");

		expect(apps).toHaveLength(3);
		const bySlug = new Map(apps.map((a) => [a.slug, a]));
		expect(bySlug.get("github")?.connected).toBe(true);
		expect(bySlug.get("github")?.connectedAccountId).toBe("ca_1");
		expect(bySlug.get("github")?.toolsCount).toBe(30);
		// INITIATED is not ACTIVE -> not connected.
		expect(bySlug.get("slack")?.connected).toBe(false);
		expect(bySlug.get("slack")?.connectedAccountId).toBeUndefined();
		// Toolkits without any account are still listed, available to connect.
		expect(bySlug.get("noauth-tool")?.connected).toBe(false);
		expect(bySlug.get("noauth-tool")?.noAuth).toBe(true);
	});

	it("returns all toolkits (connectable) when the user has no connections", async () => {
		vi.mocked(createComposioClient).mockReturnValue({
			composio: makeClient([{ slug: "notion", name: "Notion", meta: {} }], []) as never,
			userId: "u1",
		});

		const apps = await listComposioApps(cfg, "/tmp/agent");
		expect(apps).toHaveLength(1);
		expect(apps[0].slug).toBe("notion");
		expect(apps[0].connected).toBe(false);
	});
});
