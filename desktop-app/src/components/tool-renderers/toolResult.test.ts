import { describe, expect, it } from "vitest";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
	formatBytes,
	parseJsonPayload,
	readToolVerdict,
	resultImages,
	resultText,
	summarizeComputerResult,
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
	it("summarizes computer actions by intent, target and coordinates", () => {
		expect(summarizeToolArgs("computer", { action: "capture", app: "Safari", mode: "som" })).toBe(
			"capture Safari · SOM",
		);
		expect(summarizeToolArgs("computer", { action: "capture", app: "Safari", since_last: true })).toBe(
			"capture Safari · SOM · diff",
		);
		expect(summarizeToolArgs("computer", { action: "click", app: "Safari", element: 3 })).toBe(
			"click Safari · #3",
		);
		expect(summarizeToolArgs("computer", { action: "click", app: "Safari", coordinate: [10, 20] })).toBe(
			"click Safari · (10, 20)",
		);
		expect(
			summarizeToolArgs("computer", {
				action: "click",
				app: "Safari",
				element: 4,
				button: "right",
				modifiers: ["cmd", "shift"],
			}),
		).toBe("cmd+shift+right-click Safari · #4");
		expect(summarizeToolArgs("computer", { action: "type", app: "Safari", text: "hello world" })).toBe(
			'type into Safari · "hello world"',
		);
		expect(summarizeToolArgs("computer", { action: "key", app: "Safari", keys: "cmd+s" })).toBe(
			"press cmd+s in Safari",
		);
		expect(
			summarizeToolArgs("computer", { action: "set_value", app: "Safari", element: 5, value: "United States" }),
		).toBe('set "United States" on Safari · #5');
		expect(summarizeToolArgs("computer", { action: "drag", app: "Safari", from_coordinate: [1, 2], to_coordinate: [30, 40] })).toBe(
			"drag Safari · (1, 2) → (30, 40)",
		);
		expect(summarizeToolArgs("computer", { action: "zoom", app: "Safari", zoom_rect: [1, 2, 30, 40] })).toBe(
			"zoom Safari · (1, 2) → (30, 40) · native crop",
		);
		expect(summarizeToolArgs("computer", { action: "scroll", direction: "up", amount: 5 })).toBe(
			"scroll current window · up 5",
		);
		expect(summarizeToolArgs("computer", { action: "doctor" })).toBe("doctor");
		expect(summarizeToolArgs("computer", { action: "click", app: "Safari\u001b[31m", element: 1 })).toBe(
			"click Safari · #1",
		);
	});

	it("truncates long typed text and keeps existing tool summaries", () => {
		const long = "x".repeat(60);
		expect(summarizeToolArgs("computer", { action: "type", text: long })).toMatch(
			/^type into current window · "x+…"$/,
		);
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

describe("summarizeComputerResult", () => {
	it("describes captures with element and screenshot counts", () => {
		const result = toolResult({
			content: [
				{ type: "text", text: "capture mode=som app=\"Safari\"\n12 interactable element(s):" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
			] as ToolResultMessage["content"],
			details: { ok: true, action: "capture", app: "Safari", mode: "som", elementCount: 12 },
		});
		expect(summarizeComputerResult(result, null)).toEqual({
			label: "Captured Safari",
			detail: "12 elements · SOM",
			tone: "success",
		});
	});

	it("surfaces verdicts, errors and list/wait outcomes", () => {
		const verify = toolResult({
			details: {
				ok: true,
				action: "click",
				app: "Safari",
				verdict: { decision: "verify_fresh_state", hint: "Re-capture before retrying." },
			},
		});
		expect(summarizeComputerResult(verify, null)).toEqual({
			label: "Verify · Safari",
			detail: "Re-capture before retrying.",
			tone: "warning",
		});

		const failed = toolResult({
			isError: true,
			details: { ok: false, action: "type", code: "input_target_mismatch", error: "Wrong window." },
		});
		expect(summarizeComputerResult(failed, null)).toEqual({
			label: "Failed · input_target_mismatch",
			detail: "Wrong window.",
			tone: "error",
		});

		expect(
			summarizeComputerResult(
				toolResult({ details: { ok: true, action: "list_apps", count: 3 } }),
				null,
			),
		).toEqual({ label: "Listed 3 apps", tone: "success" });
		expect(
			summarizeComputerResult(
				toolResult({ details: { ok: true, action: "wait", seconds: 2 } }),
				null,
			),
		).toEqual({ label: "Waited 2s", tone: "success" });
		expect(summarizeComputerResult(undefined, null)).toBeNull();
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
