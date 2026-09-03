import { describe, expect, it } from "vitest";
import {
	classifyHoldDirective,
	deltaFor,
	formatRoomLine,
	heldWatermarkAdvance,
	isEchoOfLastEntry,
	isPassText,
	parseMentions,
	pickReply,
	resolveResponders,
	rotateSpeakers,
	shouldCommitTurn,
	unaddressedMentions,
} from "../../src/core/office/rounds.ts";
import type { Coworker, HuddleData, OfficeMessage } from "../../src/core/office/types.ts";

function coworker(id: string, name: string, handle: string, title?: string): Coworker {
	return {
		id,
		name,
		handle,
		title,
		soul: "",
		face: { shape: "circle" },
		autonomy: "supervised",
		createdAt: 0,
		sessions: {},
	};
}

function userMessage(text: string): OfficeMessage {
	return { id: `u${Math.random()}`, at: 1, from: { kind: "user", name: "User" }, text };
}

function coworkerMessage(id: string, text: string): OfficeMessage {
	return { id: `c${Math.random()}`, at: 1, from: { kind: "coworker", id, name: id }, text };
}

const ATLAS = coworker("a1", "Atlas", "atlas", "Scout");
const NOVA = coworker("n1", "Nova", "nova");

describe("parseMentions", () => {
	it("matches handles case-insensitively and via collapsed forms", () => {
		const members = [ATLAS, NOVA];
		expect(parseMentions("hey @Atlas", members).mentioned).toEqual(new Set(["a1"]));
		expect(parseMentions("hey @ATLAS", members).mentioned).toEqual(new Set(["a1"]));
		expect(parseMentions("hey @nova!", members).mentioned).toEqual(new Set(["n1"]));
	});

	it("matches display names and titles", () => {
		const members = [ATLAS, NOVA];
		expect(parseMentions("@Atlas run it", members).mentioned.has("a1")).toBe(true);
		expect(parseMentions("@Scout run it", members).mentioned.has("a1")).toBe(true);
	});

	it("flags @everyone and @all", () => {
		const parsed = parseMentions("@everyone ship it", [ATLAS]);
		expect(parsed.everyone).toBe(true);
		expect(parseMentions("@all hands", [ATLAS]).everyone).toBe(true);
	});

	it("ignores unknown handles and @user", () => {
		const parsed = parseMentions("@ghost @user hi", [ATLAS]);
		expect(parsed.mentioned.size).toBe(0);
		expect(parsed.everyone).toBe(false);
	});
});

describe("resolveResponders", () => {
	it("returns everyone when no mentions since the last user message", () => {
		const log = [userMessage("hello room"), coworkerMessage("a1", "hi"), coworkerMessage("n1", "(pass)")];
		const responders = resolveResponders(log, [ATLAS, NOVA]);
		expect(responders).toHaveLength(2);
	});

	it("returns only mentioned members when a mention exists", () => {
		const log = [userMessage("hello room"), coworkerMessage("a1", "hey @nova what do you think")];
		const responders = resolveResponders(log, [ATLAS, NOVA]);
		expect(responders).toEqual([NOVA]);
	});

	it("returns everyone on @everyone", () => {
		const log = [userMessage("@all hands on deck")];
		expect(resolveResponders(log, [ATLAS, NOVA])).toHaveLength(2);
	});
});

describe("rotateSpeakers", () => {
	it("rotates the lead each round", () => {
		const members = [ATLAS, NOVA, coworker("o1", "Onyx", "onyx")];
		expect(rotateSpeakers(members, 0)[0]).toBe(ATLAS);
		expect(rotateSpeakers(members, 1)[0]).toBe(NOVA);
		expect(rotateSpeakers(members, 3)[0]).toBe(ATLAS);
	});
});

describe("pass text", () => {
	it("recognizes the silence marker", () => {
		expect(isPassText("(pass)")).toBe(true);
		expect(isPassText("pass.")).toBe(true);
		expect(isPassText("(PASS)")).toBe(true);
		expect(isPassText("")).toBe(true);
		expect(isPassText("  ")).toBe(true);
		expect(isPassText("Pass me the salt")).toBe(false);
		expect(isPassText("I will pass on this one")).toBe(false);
	});
});

describe("pickReply", () => {
	it("prefers the last substantive assistant message over a trailing pass", () => {
		const messages = [
			{ role: "assistant", text: "(pass)" },
			{ role: "assistant", text: "here is the answer" },
			{ role: "assistant", text: "(pass)" },
		];
		expect(pickReply(messages, 0)).toBe("here is the answer");
	});

	it("returns the newest pass when only passes exist", () => {
		const messages = [
			{ role: "assistant", text: "(pass)" },
			{ role: "assistant", text: "pass" },
		];
		expect(pickReply(messages, 0)).toBe("pass");
	});

	it("returns null when no assistant message is in range", () => {
		const messages = [{ role: "user", text: "hi" }];
		expect(pickReply(messages, 0)).toBeNull();
		expect(
			pickReply(
				[
					{ role: "assistant", text: "old" },
					{ role: "assistant", text: "new" },
				],
				2,
			),
		).toBeNull();
	});
});

describe("classifyHoldDirective", () => {
	it("holds mentioned members on a stop directive", () => {
		const directive = classifyHoldDirective("stop working on it @atlas", ["a1"], false);
		expect(directive.hold).toEqual(["a1"]);
		expect(directive.release).toEqual([]);
	});

	it("releases mentioned members on a direct non-stop mention", () => {
		const directive = classifyHoldDirective("resume please @atlas", ["a1"], false);
		expect(directive.hold).toEqual([]);
		expect(directive.release).toEqual(["a1"]);
	});

	it("errs toward holding when a stop word rides along (don't stop @atlas)", () => {
		const directive = classifyHoldDirective("don't stop @atlas", ["a1"], false);
		expect(directive.hold).toEqual(["a1"]);
	});

	it("never holds without a mention or @everyone", () => {
		const directive = classifyHoldDirective("stop everything", [], false);
		expect(directive.hold).toEqual([]);
	});

	it("holds every member on @all stop", () => {
		const directive = classifyHoldDirective("@all stop", [], true, ["a1", "a2", "a3"]);
		expect(directive.hold).toEqual(["a1", "a2", "a3"]);
		expect(directive.release).toEqual([]);
	});

	it("releases every member on @all resume", () => {
		const directive = classifyHoldDirective("@all resume", [], true, ["a1", "a2"]);
		expect(directive.hold).toEqual([]);
		expect(directive.release).toEqual(["a1", "a2"]);
	});

	it("a bare @all with no stop/resume word changes nothing", () => {
		const directive = classifyHoldDirective("@all thoughts?", [], true, ["a1", "a2"]);
		expect(directive.hold).toEqual([]);
		expect(directive.release).toEqual([]);
	});
});

describe("heldWatermarkAdvance", () => {
	it("advances once past the log", () => {
		expect(heldWatermarkAdvance(2, 5)).toBe(5);
		expect(heldWatermarkAdvance(5, 5)).toBeNull();
	});
});

describe("shouldCommitTurn", () => {
	it("commits same-epoch turns", () => {
		expect(shouldCommitTurn(3, 3, true)).toBe(true);
	});

	it("commits stale turns only when no newer user entry landed", () => {
		expect(shouldCommitTurn(2, 3, false)).toBe(true);
		expect(shouldCommitTurn(2, 3, true)).toBe(false);
	});
});

describe("formatRoomLine", () => {
	it("formats user and coworker lines with the (you) marker", () => {
		expect(formatRoomLine(userMessage("hello"), undefined)).toBe("User (user): hello");
		expect(formatRoomLine(coworkerMessage("a1", "hi"), "a1")).toBe("a1 (you): hi");
		expect(formatRoomLine(coworkerMessage("n1", "hi"), "a1")).toBe("n1: hi");
	});
});

describe("deltaFor", () => {
	it("returns only entries after the watermark, capped to the history limit", () => {
		const data: HuddleData = {
			epoch: 0,
			log: [coworkerMessage("a1", "one"), userMessage("two"), coworkerMessage("a1", "three")],
			watermarks: { a1: 1, n1: 3 },
			holds: {},
		};
		expect(deltaFor(data, "a1").map((entry) => entry.text)).toEqual(["two", "three"]);
		expect(deltaFor(data, "n1")).toEqual([]);
		expect(deltaFor(data, "unknown").map((entry) => entry.text)).toEqual(["one", "two", "three"]);
	});
});

describe("unaddressedMentions", () => {
	it("flags a cited coworker who never answered", () => {
		const log = [userMessage("kick off"), coworkerMessage("a1", "handing this to @nova")];
		expect(unaddressedMentions(log, [ATLAS, NOVA])).toEqual(["n1"]);
	});

	it("clears once the cited coworker posts after the citing entry", () => {
		const log = [coworkerMessage("a1", "handing to @nova"), coworkerMessage("n1", "on it")];
		expect(unaddressedMentions(log, [ATLAS, NOVA])).toEqual([]);
	});

	it("ignores self-mentions and user sends", () => {
		const log = [userMessage("@nova do the thing"), coworkerMessage("a1", "@atlas checking in")];
		expect(unaddressedMentions(log, [ATLAS, NOVA])).toEqual([]);
	});
});

describe("isEchoOfLastEntry", () => {
	it("matches a back-to-back identical post by the same coworker", () => {
		const log = [userMessage("go"), coworkerMessage("a1", "done")];
		expect(isEchoOfLastEntry(log, "a1", "done")).toBe(true);
	});

	it("never matches across authors, kinds, or different text", () => {
		const log = [coworkerMessage("a1", "done"), coworkerMessage("n1", "done")];
		expect(isEchoOfLastEntry(log, "a1", "done")).toBe(false);
		expect(isEchoOfLastEntry([userMessage("done")], "a1", "done")).toBe(false);
		expect(isEchoOfLastEntry([coworkerMessage("a1", "done")], "a1", "different")).toBe(false);
	});
});
