import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

function makeFooter(options: { cwd?: string; sessionName?: string } = {}): FooterComponent {
	const cwd = options.cwd ?? `${process.env.HOME ?? "/Users/tester"}/projects/a-coder-cli`;
	const session = {
		state: {
			model: { id: "claude-sonnet-4-5", provider: "anthropic", contextWindow: 200_000, reasoning: true },
			thinkingLevel: "medium",
		},
		sessionManager: {
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: {
							input: 12_345,
							output: 6_789,
							cacheRead: 2_000,
							cacheWrite: 500,
							cost: { total: 0.123 },
						},
					},
				},
			],
			getCwd: () => cwd,
			getSessionName: () => options.sessionName,
		},
		getContextUsage: () => ({ percent: 42.5, contextWindow: 200_000 }),
		modelRegistry: { isUsingOAuth: () => false },
	} as unknown as AgentSession;

	const footerData = {
		getGitBranch: () => "feat/desktop-unified-release",
		getAvailableProviderCount: () => 2,
		getExtensionStatuses: () => new Map<string, string>(),
	} as unknown as ReadonlyFooterDataProvider;

	return new FooterComponent(session, footerData);
}

describe("FooterComponent adaptive status bar", () => {
	it("shows every statistic when the terminal is wide", () => {
		const out = makeFooter().render(170).join("\n");
		expect(out).toContain("↑12k");
		expect(out).toContain("↓6.8k");
		expect(out).toContain("R2.0k");
		expect(out).toContain("$0.123");
		expect(out).toContain("42.5%");
		expect(out).toContain("(anthropic) claude-sonnet-4-5");
	});

	it("drops whole low-priority segments instead of clipping the context meter", () => {
		const footer = makeFooter();
		for (const width of [64, 52, 40, 30]) {
			const lines = footer.render(width);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			const out = lines.join("\n");
			expect(out).toContain("42.5%");
		}
		const narrow = footer.render(40).join("\n");
		expect(narrow).not.toContain("CH");
		expect(narrow).not.toContain("$0.123");
		expect(narrow).toContain("claude-sonnet-4-5");
	});

	it("keeps the leaf directory when the path must be shortened", () => {
		const footer = makeFooter({ cwd: "/Users/tester/projects/clients/acme/very-long-project-name" });
		const line = footer.render(34)[0] ?? "";
		expect(visibleWidth(line)).toBeLessThanOrEqual(34);
		expect(line).toContain("…");
		expect(line).toContain("very-long-project-name");
	});

	it("drops the session name before the branch and path", () => {
		const footer = makeFooter({ sessionName: "a-very-long-session-name" });
		const line = footer.render(64)[0] ?? "";
		expect(line).toContain("~");
		expect(line).toContain("feat/desktop-unified-release");
		expect(line).not.toContain("a-very-long-session-name");
	});
});
