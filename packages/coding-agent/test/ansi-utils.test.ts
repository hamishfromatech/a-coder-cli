import { describe, expect, it } from "vitest";
import { DisplayTail } from "../src/core/tools/bash.ts";
import { sanitizeToolAnsi, stripAnsi } from "../src/utils/ansi.ts";

function referenceAnsiRegex(): RegExp {
	const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
	const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;
	const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
	return new RegExp(`${osc}|${csi}`, "g");
}

const referenceRegex = referenceAnsiRegex();

function referenceStripAnsi(value: string): string {
	if (!value.includes("\u001B") && !value.includes("\u009B")) {
		return value;
	}
	return value.replace(referenceRegex, "");
}

function getCompatibilityInputs(): string[] {
	const inputs = [
		"plain",
		"a\x1b[31mred\x1b[0mz",
		"a\x1b]8;;https://example.com\x07link\x1b]8;;\x07z",
		"a\x1b]unterminated",
		"a\x1b]funterminated",
		"a\x1bPabc\x1b\\z",
		"a\x1b^abc\x07z",
		"a\x1b_abc\x9cz",
		"a\x90abc\x9cz",
		"a\x9dabc\x9cz",
		"a\x9b31mred",
		"a\x1b(0x",
		"a\x1b*0x",
		"a\x1b+c",
		"a\x1b/0x",
		"a\x1bcok",
		"a\x1b\\ok",
	];
	const chars = [
		"a",
		"f",
		"0",
		"1",
		";",
		":",
		"[",
		"]",
		"(",
		")",
		"#",
		"?",
		"m",
		"P",
		"_",
		"\\",
		"\x07",
		"\x1b",
		"\x9b",
		"\x9c",
		"\x90",
		"\x9d",
	];

	for (const char of chars) {
		inputs.push(`x\x1b${char}y`);
		inputs.push(`x\x9b${char}y`);
		for (let index = 0; index < chars.length; index += 3) {
			inputs.push(`x\x1b${char}${chars[index]}y`);
		}
	}

	return inputs;
}

describe("stripAnsi", () => {
	it("matches chalk strip-ansi for generated compatibility inputs", () => {
		for (const input of getCompatibilityInputs()) {
			expect(stripAnsi(input)).toBe(referenceStripAnsi(input));
		}
	});

	it("throws the same TypeError as chalk strip-ansi for non-string values", () => {
		const stripAnsiUnknown = stripAnsi as (value: unknown) => string;

		for (const value of [undefined, null, 123, {}, Object("x")]) {
			const message = `Expected a \`string\`, got \`${typeof value}\``;
			expect(() => stripAnsiUnknown(value)).toThrow(TypeError);
			expect(() => stripAnsiUnknown(value)).toThrow(message);
		}
	});

	it("strips RIS without leaking the final byte", () => {
		expect(stripAnsi("\x1bcdone")).toBe("done");
	});

	it("strips single-byte ESC sequences without leaking final bytes", () => {
		for (let code = "g".charCodeAt(0); code <= "m".charCodeAt(0); code++) {
			expect(stripAnsi(`\x1b${String.fromCharCode(code)}ok`)).toBe("ok");
		}
		for (let code = "r".charCodeAt(0); code <= "t".charCodeAt(0); code++) {
			expect(stripAnsi(`\x1b${String.fromCharCode(code)}ok`)).toBe("ok");
		}
	});

	it("strips common ANSI sequences used in tool output", () => {
		const input = "a\x1b[31mred\x1b[0m\x1b]8;;https://example.com\x07link\x1b]8;;\x07z";
		expect(stripAnsi(input)).toBe("aredlinkz");
	});
});

describe("sanitizeToolAnsi", () => {
	it("preserves SGR color sequences and the text they style", () => {
		expect(sanitizeToolAnsi(`\u001B[32mok\u001B[0m`)).toBe(`\u001B[32mok\u001B[0m`);
	});

	it("drops cursor-movement, mode-set, and other non-SGR CSI sequences", () => {
		const input = "\u001B[2Kreset\u001B[Gstart\u001B[?25lhidden\u001B[31mred\u001B[0m";
		expect(sanitizeToolAnsi(input)).toBe("resetstarthidden\u001B[31mred\u001B[0m");
	});

	it("drops OSC sequences that are not well-formed hyperlinks", () => {
		expect(sanitizeToolAnsi("\u001B]0;title\u0007body")).toBe("body");
		expect(sanitizeToolAnsi("\u001B]8;;\u0007broken")).toBe("broken");
	});

	it("preserves well-formed OSC 8 hyperlinks", () => {
		const link = "\u001B]8;;file:///tmp/x.log\u0007log\u001B]8;;\u0007";
		expect(sanitizeToolAnsi(`see ${link}`)).toBe(`see ${link}`);
	});

	it("removes binary control garbage from text runs", () => {
		expect(sanitizeToolAnsi(`a\u0007b\u0011c`)).toBe("abc");
	});

	it("closes styling on every line so color cannot bleed across lines", () => {
		const rendered = sanitizeToolAnsi("\u001B[32mfirst\nsecond").split("\n");
		expect(rendered[0]).toBe("\u001B[32mfirst\u001B[0m");
		expect(rendered[1]).toBe("second");
	});

	it("survives escape sequences split across chunk boundaries", () => {
		const tail = new DisplayTail();
		tail.append(`\u001B[3`);
		tail.append(`8mok\u001B[0m`);
		expect(tail.snapshot()).toBe(`\u001B[38mok\u001B[0m`);
	});

	it("is idempotent (safe to sanitize already-sanitized text)", () => {
		const once = sanitizeToolAnsi("\u001B[31mhello\u001B[0m world");
		expect(sanitizeToolAnsi(once)).toBe(once);
	});
});
