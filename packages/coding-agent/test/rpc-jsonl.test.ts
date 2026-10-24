import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { attachJsonlLineReader, MAX_JSONL_LINE_BYTES, serializeJsonLine } from "../src/modes/rpc/jsonl.ts";

describe("RPC JSONL framing", () => {
	test("serializes strict JSONL records without escaping Unicode separators", () => {
		const line = serializeJsonLine({ text: "a\u2028b\u2029c" });

		expect(line).toContain("a\u2028b\u2029c");
		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line.trim())).toEqual({ text: "a\u2028b\u2029c" });
	});

	test("splits on LF only and preserves U+2028/U+2029 inside payloads", async () => {
		const lines: string[] = [];
		const stream = Readable.from([serializeJsonLine({ text: "a\u2028b\u2029c" })]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0])).toEqual({ text: "a\u2028b\u2029c" });
	});

	test("handles CRLF-delimited input", async () => {
		const lines: string[] = [];
		const stream = Readable.from([Buffer.from('{"a":1}\r\n{"b":2}\r\n')]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toEqual(['{"a":1}', '{"b":2}']);
	});

	test("emits a final line without trailing LF", async () => {
		const lines: string[] = [];
		const stream = Readable.from([Buffer.from('{"a":1}')]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toEqual(['{"a":1}']);
	});

	test("drops an unterminated line beyond the frame cap and keeps later records", async () => {
		const lines: string[] = [];
		const stream = new Readable({ read() {} });
		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		// A runaway record with no LF must not grow the buffer without bound. The
		// next complete record still parses because the dropped tail never ended.
		stream.push("x".repeat(MAX_JSONL_LINE_BYTES + 1));
		stream.push('{"ok":true}\n');
		stream.push(null);
		await new Promise<void>((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"ok":true}']);
	});
});
