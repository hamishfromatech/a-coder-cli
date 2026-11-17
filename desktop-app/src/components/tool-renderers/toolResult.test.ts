import { describe, expect, it } from "vitest";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
	formatBytes,
	parseJsonPayload,
	readToolVerdict,
	resultImages,
	resultText,
	summarizeToolArgs,
} from "./toolResult";

function toolResult(overrides: Partial<ToolResultMessage>): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "computer",
		content: [],
		isError: false,
		...overrides,
	} as ToolResultMessage;
}

describe("summarizeToolArgs", () => {
	it("summarizes computer actions by intent, not raw JSON", () => {
		expect(summarizeToolArgs("computer", { action: "capture", app: "Safari", mode: "som" })).toBe(
			"capture Safari (som)",
		);
		expect(summarizeToolArgs("computer", { action: "click", element: 3 })).toBe("click #3");
		expect(summarizeToolArgs("computer", { action: "click", coordinate: [10, 20] })).toBe("click 10,20");
		expect(summarizeToolArgs("computer", { action: "type", text: "hello world" })).toBe('type "hello world"');
		expect(summarizeToolArgs("computer", { action: "key", keys: "cmd+s" })).toBe("key cmd+s");
		expect(summarizeToolArgs("computer", { action: "zoom", zoom_rect: [1, 2, 30, 40] })).toBe("zoom 1,2,30,40");
		expect(summarizeToolArgs("computer", { action: "doctor" })).toBe("doctor");
	});

	it("truncates long typed text and keeps existing tool summaries", () => {
		const long = "x".repeat(60);
		expect(summarizeToolArgs("computer", { action: "type", text: long })).toMatch(/^type "x+…"$/);
		expect(summarizeToolArgs("bash", { command: "ls -la" })).toBe("ls -la");
		expect(summarizeToolArgs("edit", { path: "a.ts", edits: [{}, {}] })).toBe("a.ts · 2 edits");
	});
});

describe("parseJsonPayload", () => {
	it("pretty-prints an object payload", () => {
		const parsed = parseJsonPayload('{"ok":true,"verdict":{"decision":"done"}}');
		expect(parsed?.value).toMatchObject({ ok: true });
		expect(parsed?.pretty).toContain('\n  "ok": true');
	});

	it("rejects plain text, scalars and malformed JSON", () => {
		expect(parseJsonPayload("hello")).toBeNull();
		expect(parseJsonPayload("42")).toBeNull();
		expect(parseJsonPayload("{ not json")).toBeNull();
	});
});

describe("readToolVerdict", () => {
	it("reads the verdict from details without parsing text", () => {
		const result = toolResult({ details: { verdict: { decision: "escalate", hint: "use foreground" } } });
		expect(readToolVerdict(result, null)).toEqual({ decision: "escalate", hint: "use foreground" });
	});

	it("falls back to the parsed payload and ignores unknown decisions", () => {
		expect(readToolVerdict(undefined, { verdict: { decision: "verify_fresh_state" } })).toEqual({
			decision: "verify_fresh_state",
		});
		expect(readToolVerdict(undefined, { verdict: { decision: "maybe" } })).toBeNull();
		expect(readToolVerdict(undefined, null)).toBeNull();
	});
});

describe("resultImages", () => {
	it("collects inline images and attachment refs", () => {
		const result = toolResult({
			content: [
				{ type: "text", text: "ok" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				{ type: "image", mimeType: "image/jpeg", attachment: { id: "a1", mimeType: "image/jpeg", bytes: 10 } },
			] as ToolResultMessage["content"],
		});
		expect(resultImages(result)).toEqual([
			{ data: "aGVsbG8=", mimeType: "image/png" },
			{ attachment: { id: "a1", mimeType: "image/jpeg", bytes: 10 } },
		]);
	});

	it("drops image blocks with neither data nor a ref", () => {
		const result = toolResult({ content: [{ type: "image" }] as ToolResultMessage["content"] });
		expect(resultImages(result)).toEqual([]);
		expect(resultImages(undefined)).toEqual([]);
	});
});

describe("resultText and formatBytes", () => {
	it("joins text blocks and trims", () => {
		const result = toolResult({
			content: [
				{ type: "text", text: " first " },
				{ type: "image", data: "x", mimeType: "image/png" },
				{ type: "text", text: "second " },
			] as ToolResultMessage["content"],
		});
		expect(resultText(result)).toBe("first second");
	});

	it("formats byte counts compactly", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2048)).toBe("2.0 KB");
		expect(formatBytes(400 * 1024)).toBe("400 KB");
		expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
	});
});
