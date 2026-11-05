/*
 * Portions of this file are derived from:
 * - ansi-regex (https://github.com/chalk/ansi-regex)
 * - strip-ansi (https://github.com/chalk/strip-ansi)
 *
 * MIT License
 *
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { sanitizeBinaryOutput } from "./shell.ts";

// Valid string terminator sequences are BEL, ESC\, and 0x9c
const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
// OSC sequences: ESC ] ... ST
const OSC_START = "\\u001B\\]";
// CSI and related: ESC/C1, optional intermediates, optional params (supports ; and :), then final byte.
// A private prefix (<, =, >) is accepted only right after a real CSI introducer (ESC [ or 0x9B), so
// ESC[<35;59;1M (SGR mouse report) is stripped whole. After a bare ESC these bytes stay final bytes:
// ESC = and ESC > (keypad modes) must not swallow the digits of the text that follows.
const CSI_START = "(?:(?:\\u001B\\[|\\u009B)[<=>]|[\\u001B\\u009B][[\\]()#;?]*)(?:\\d{1,4}(?:[;:]\\d{0,4})*)?";
const CSI_FINAL = "[\\dA-PR-TZcf-nq-uy=><~]";

function ansiRegex({ onlyFirst = false }: { onlyFirst?: boolean } = {}): RegExp {
	// Complete sequences. OSC is non-greedy until the first ST.
	return new RegExp(`(?:${OSC_START}[\\s\\S]*?${ST})|${CSI_START}${CSI_FINAL}`, onlyFirst ? undefined : "g");
}

const regex = ansiRegex();

// Unfinished sequence at the end of the text: OSC without its ST (a trailing ESC may start ESC\),
// or CSI without its final byte.
const unfinishedAnsiAtEndRegex = new RegExp(
	`(?:${OSC_START}(?:[^\\u0007\\u009C\\u001B]|\\u001B(?!\\\\))*|${CSI_START})$`,
);

// Longest unfinished sequence held back while streaming. Longer ones are processed as-is.
const MAX_PENDING_ANSI_LENGTH = 256;

/**
 * Split streamed text into a part that is safe to pass to stripAnsi now and a trailing
 * unfinished escape sequence that should be prepended to the next chunk.
 */
export function splitIncompleteAnsiSuffix(value: string): { complete: string; pending: string } {
	if (!value.includes("\u001B") && !value.includes("\u009B")) {
		return { complete: value, pending: "" };
	}
	const windowStart = Math.max(0, value.length - MAX_PENDING_ANSI_LENGTH);
	const match = unfinishedAnsiAtEndRegex.exec(value.slice(windowStart));
	if (!match) {
		return { complete: value, pending: "" };
	}
	const splitAt = windowStart + match.index;
	return { complete: value.slice(0, splitAt), pending: value.slice(splitAt) };
}

export function stripAnsi(value: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`Expected a \`string\`, got \`${typeof value}\``);
	}

	// Fast path: ANSI codes require ESC (7-bit) or CSI (8-bit) introducer
	if (!value.includes("\u001B") && !value.includes("\u009B")) {
		return value;
	}

	// Even though the regex is global, we don't need to reset the `.lastIndex`
	// because unlike `.exec()` and `.test()`, `.replace()` does it automatically
	// and doing it manually has a performance penalty.
	return value.replace(regex, "");
}

/** True when the escape token is an SGR sequence (color/style; final byte `m`). */
function isSgrToken(token: string): boolean | undefined {
	const body = token.startsWith("\u001B[") ? token.slice(2) : token.startsWith("\u009B") ? token.slice(1) : undefined;
	return body?.endsWith("m");
}

/** Classify an OSC 8 token: "open" carries a non-empty url, "close" has none. */
function osc8LinkKind(token: string): "open" | "close" | null {
	if (!token.startsWith("\u001B]8;")) return null;
	const body = token.slice(4, token.endsWith("\u001B\\") ? -2 : token.endsWith("\u0007") ? -1 : undefined);
	if (body === undefined) return null;
	const separator = body.indexOf(";");
	if (separator === -1) return null;
	return body.length > separator + 1 ? "open" : "close";
}

/**
 * Sanitize raw tool output for DISPLAY while preserving terminal color.
 *
 * Unlike `stripAnsi`, SGR sequences (the only styling ANSI) survive, so color
 * emitted by test runners, compilers, and `--color` CLI output reaches the
 * result cards. Everything else an emitter might send — cursor movement,
 * scroll regions, window titles, malformed OSC — is dropped, and text runs
 * pass through `sanitizeBinaryOutput` (control characters that would break
 * width math are removed). Each styled line ends with an explicit reset so a
 * truncated/wrapped line can never bleed its style into frame chrome.
 */
export function sanitizeToolAnsi(value: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`Expected a \`string\`, got \`${typeof value}\``);
	}
	if (!value.includes("\u001B") && !value.includes("\u009B")) {
		return sanitizeBinaryOutput(value);
	}

	const result: string[] = [];
	let cursor = 0;
	let inLink = false;
	for (const match of value.matchAll(ansiRegex())) {
		const token = match[0];
		const tokenStart = match.index ?? cursor;
		result.push(sanitizeBinaryOutput(value.slice(cursor, tokenStart)));
		if (isSgrToken(token)) {
			result.push(token);
		} else {
			const linkKind = osc8LinkKind(token);
			// Open links are kept; close tokens only keep when an open one is
			// still active, so stray closers (and leaked link state) cannot ship.
			if (linkKind === "open") {
				inLink = true;
				result.push(token);
			} else if (linkKind === "close" && inLink) {
				inLink = false;
				result.push(token);
			}
		}
		cursor = tokenStart + token.length;
	}
	result.push(sanitizeBinaryOutput(value.slice(cursor)));

	// Re-close any surviving style per line so wrapping/truncation downstream
	// cannot inherit a dangling SGR state.
	return result
		.join("")
		.split("\n")
		.map((line) => (line.includes("\u001B[") && !line.endsWith("\u001B[0m") ? `${line}\u001B[0m` : line))
		.join("\n");
}
