import { describe, expect, it } from "vitest";
import { sessionJsonlToMarkdown } from "./session-export";

const session = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-10-01T10:00:00.000Z", cwd: "/work/proj", ...extra });
const message = (m: unknown) => JSON.stringify({ type: "message", id: `m${Math.random()}`, message: m });
const nameEntry = (name: string) => JSON.stringify({ type: "session_info", name });

describe("sessionJsonlToMarkdown", () => {
	it("formats user, assistant, and tool rounds in file order", () => {
		const raw = [
			session(),
			message({ role: "user", content: [{ type: "text", text: "list the files" }] }),
			message({
				role: "assistant",
				content: [
					{ type: "text", text: "On it." },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				],
			}),
			message({ role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "a.txt\nb.txt" }] }),
			message({ role: "assistant", content: [{ type: "text", text: "Two files." }] }),
		].join("\n");

		const out = sessionJsonlToMarkdown(raw);
		expect(out.name).toBeUndefined();
		expect(out.cwd).toBe("/work/proj");
		expect(out.messageCount).toBe(4);
		expect(out.markdown).toContain("## User\n\nlist the files");
		expect(out.markdown).toContain("On it.");
		expect(out.markdown).toContain("**Tool call:** `bash`");
		expect(out.markdown).toContain('"command": "ls"');
		expect(out.markdown).toContain("**Tool result:** `bash`");
		expect(out.markdown).toContain("a.txt");
		expect(out.markdown).toContain("Two files.");
		// File order, not role grouping.
		expect(out.markdown.indexOf("list the files")).toBeLessThan(out.markdown.indexOf("Two files."));
	});

	it("uses the latest session_info as the title", () => {
		const raw = [session(), nameEntry("first"), nameEntry("Final name"), message({ role: "user", content: [{ type: "text", text: "hi" }] })].join("\n");
		const out = sessionJsonlToMarkdown(raw);
		expect(out.name).toBe("Final name");
		expect(out.markdown.startsWith("# Final name")).toBe(true);
	});

	it("falls back to the project leaf when unnamed", () => {
		const out = sessionJsonlToMarkdown(session());
		expect(out.markdown.startsWith("# proj")).toBe(true);
	});

	it("survives a truncated final line and skips bookkeeping entries", () => {
		const raw = [
			session(),
			JSON.stringify({ type: "model_change", provider: "x", modelId: "y" }),
			JSON.stringify({ type: "file_history_snapshot", snapshot: {} }),
			message({ role: "user", content: [{ type: "text", text: "kept" }] }),
			'{"type":"message","message":{"role":"assistant","cont',
		].join("\n");

		const out = sessionJsonlToMarkdown(raw);
		expect(out.messageCount).toBe(1);
		expect(out.markdown).toContain("kept");
	});

	it("handles string content and thinking-only assistant messages", () => {
		const raw = [
			session(),
			message({ role: "user", content: "plain string" }),
			message({ role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] }),
		].join("\n");
		const out = sessionJsonlToMarkdown(raw);
		expect(out.markdown).toContain("plain string");
		expect(out.messageCount).toBe(1);
	});
});
