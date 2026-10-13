import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_QUESTIONS } from "../src/api/systemone.ts";
import { postDecisions } from "../src/decisions.ts";
import type { DecisionResult, DecisionsContext, DecisionsModel } from "../src/types.ts";

const okModel: DecisionsModel<"systemone"> = {
	id: "jev-1.13",
	name: "Jev 1.13",
	api: "systemone",
	provider: "typesafe",
	baseUrl: "https://api.typesafe.ai/v1",
	contextWindow: 32000,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const visionModel: DecisionsModel<"systemone"> = {
	...okModel,
	provider: "ollama",
	id: "clef-flash",
	baseUrl: "http://localhost:11434/v1",
	input: ["text", "image"],
};

const okContext: DecisionsContext = {
	state: "The checkout returns 500s since 9am.",
	questions: {
		label: {
			type: "choice",
			instructions: "Which label fits?",
			criteria: { billing: "Payments", bug: "Errors" },
		},
		erroring: { type: "noul", instructions: "Is the checkout failing?" },
	},
};

const okResponse = {
	model: "jev-1.13-20260917",
	id: "gen-dec-1",
	answers: {
		label: { type: "choice", choice: "bug", probabilities: { billing: 0.02, bug: 0.97 }, confidence: 0.93 },
		erroring: { type: "noul", noul: 0.9 },
	},
	usage: { input_tokens: 174, output_tokens: 1, cost: 7.3068e-6 },
};

interface FetchState {
	lastUrl?: string;
	lastInit?: RequestInit;
}

function respondsWith(
	status: number,
	body: string | object,
	state: FetchState = {},
): (request: string | URL | Request, init?: RequestInit) => Promise<Response> {
	return async (request, init) => {
		state.lastUrl = typeof request === "string" ? request : (request as Request).url;
		state.lastInit = init;
		return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
	};
}

describe("systemone decision API", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("posts state + typed questions and parses answers", async () => {
		const state: FetchState = {};
		vi.stubGlobal("fetch", respondsWith(200, okResponse, state));
		const result = await postDecisions(okModel, okContext, { apiKey: "sk-ts" });
		expect(result.stopReason).toBe("stop");
		expect(state.lastUrl).toBe("https://api.typesafe.ai/v1/systemone");
		const body = JSON.parse(String(state.lastInit?.body));
		expect(body.model).toBe("jev-1.13");
		expect(body.questions.label.type).toBe("choice");
		expect(state.lastInit?.headers).toMatchObject({ Authorization: "Bearer sk-ts" });
		expect(result.answers.label).toMatchObject({ type: "choice", choice: "bug", confidence: 0.93 });
		expect(result.answers.erroring).toMatchObject({ type: "noul", noul: 0.9 });
		expect(result.usage).toEqual({ inputTokens: 174, outputTokens: 1, cost: 7.3068e-6 });
		expect(result.servedModel).toBe("jev-1.13-20260917");
	});

	it("rejects more questions than the host allows", async () => {
		vi.stubGlobal("fetch", respondsWith(200, okResponse));
		const questions = Object.fromEntries(
			Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => [
				`q${i}`,
				{ type: "noul" as const, instructions: "boom?" },
			]),
		);
		const result = await postDecisions(okModel, { state: "s", questions });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("questions");
	});

	it("rejects oversized bodies without images", async () => {
		vi.stubGlobal("fetch", respondsWith(200, okResponse));
		const result = await postDecisions(okModel, {
			state: "x".repeat(80_000),
			questions: { q: { type: "noul", instructions: "?" } },
		});
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("without images");
	});

	it("rejects images on non-vision models", async () => {
		vi.stubGlobal("fetch", respondsWith(200, okResponse));
		const result = await postDecisions(okModel, { ...okContext, images: ["ZmFrZQ=="] });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("does not accept images");
	});

	it("sends images for vision models", async () => {
		const state: FetchState = {};
		vi.stubGlobal("fetch", respondsWith(200, { ...okResponse, model: "clef-flash" }, state));
		await postDecisions(visionModel, { ...okContext, images: ["ZmFrZQ=="] }, { apiKey: "not-needed" });
		expect(state.lastInit?.headers).not.toHaveProperty("Authorization");
		const body = JSON.parse(String(state.lastInit?.body));
		expect(body.images).toEqual(["ZmFrZQ=="]);
		expect(state.lastInit?.headers).not.toMatchObject({ Authorization: expect.anything() });
	});

	it("guards against served-model substitution", async () => {
		vi.stubGlobal("fetch", respondsWith(200, { ...okResponse, model: "clef-9b" }));
		const result = await postDecisions(okModel, okContext, { apiKey: "sk" });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("mismatch");
	});

	it("retries retryable failures then succeeds", async () => {
		let attempts = 0;
		vi.stubGlobal("fetch", async (request: string | URL | Request, init?: RequestInit) => {
			attempts++;
			if (attempts === 1) {
				return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
			}
			return respondsWith(200, okResponse)(request, init);
		});
		const result = await postDecisions(okModel, okContext, { apiKey: "sk", maxRetries: 2 });
		expect(attempts).toBe(2);
		expect(result.stopReason).toBe("stop");
	});

	it("surfaces non-retryable failures as error results", async () => {
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "bad model" }), { status: 404 }));
		const result = await postDecisions(okModel, okContext, { apiKey: "sk", maxRetries: 0 });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("bad model");
	});

	it("rejects malformed answers with a targeted message", async () => {
		vi.stubGlobal("fetch", respondsWith(200, { model: "jev-1.13", answers: { label: { type: "nope" } } }));
		const result = await postDecisions(okModel, okContext, { apiKey: "sk" });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain('"label"');
	});

	it("maps state objects to serialized state", async () => {
		const state: FetchState = {};
		vi.stubGlobal("fetch", respondsWith(200, okResponse, state));
		await postDecisions(okModel, { ...okContext, state: { a: 1 } }, { apiKey: "sk" });
		expect(JSON.parse(String(state.lastInit?.body)).state).toBe('{"a":1}');
	});
});

describe("type sanity for DecisionResult", () => {
	it("constructs an error result like the runtime surface does", () => {
		// Regression for the images-style "never rejects" contract consumers rely on.
		const result: DecisionResult = {
			api: "systemone",
			provider: "typesafe",
			model: "jev-1.13",
			answers: {},
			stopReason: "error",
			errorMessage: "boom",
			timestamp: Date.now(),
		};
		expect(result.errorMessage).toBe("boom");
	});
});
