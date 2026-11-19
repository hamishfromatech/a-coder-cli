import { describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { isRetryableAssistantError, type RetryPolicy, retryAssistantCall } from "../src/utils/retry.ts";

const openAIExplicitRetryMessage =
	"An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID req_******** in your message.";
const bedrockExplicitRetryMessage =
	'{"message":"The system encountered an unexpected error during processing. Try your request again."}';
const nvidiaNIMResourceExhaustedMessage = "ResourceExhausted: Worker local total request limit reached (288/48)";
const bunFetchSocketClosedMessage =
	"The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
const openAIResponsesEarlyEofMessage = "OpenAI Responses stream ended before a terminal response event";
const wrappedDnsLookupError =
	"The pending stream has been canceled (caused by: getaddrinfo ENOTFOUND bedrock-runtime.us-east-1.amazonaws.com)";

describe("provider retry classification", () => {
	it("matches explicit provider retry guidance", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: openAIExplicitRetryMessage }),
			),
		).toBe(true);
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: bedrockExplicitRetryMessage }),
			),
		).toBe(true);
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: nvidiaNIMResourceExhaustedMessage }),
			),
		).toBe(true);
	});

	it("matches Bun fetch socket drop wording", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: bunFetchSocketClosedMessage }),
			),
		).toBe(true);
	});

	it("matches gateway wording for a closed connection", () => {
		// Regression for #12064: a gateway ends the stream with an OpenAI-style payload.
		const errorMessage = '{"type":"error","error":{"type":"api_error","message":"Connection closed."}}';
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it("matches upstream request buffer exhaustion wording", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", {
					stopReason: "error",
					errorMessage: "Error: exceeded request buffer limit while retrying upstream",
				}),
			),
		).toBe(true);
	});

	it.each([
		// Regression for #10278.
		"Selected model is at capacity. Please try a different model.",
		// Regression for #12289: fork-original, no upstream patch.
		"The model is currently at capacity due to high demand.",
		// Capacity/overload family.
		"server_busy",
		"All servers are currently busy. Please try again.",
		"The system is currently experiencing high demand and cannot process your request.",
		"Our servers are currently overloaded. Please try again later.",
	])("matches capacity and overload wording: %s", (errorMessage) => {
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it("does not match a bare at-capacity phrase", () => {
		// @smithy/node-http-handler emits "socket usage at capacity=..." for
		// unrelated client-side limits.
		const errorMessage = "socket usage at capacity=10";
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(false);
	});

	it.each([
		// Regression for #10842.
		"The upstream provider returned an error",
		// Regressions for #10920: gateway upstream failures sent as `response.failed` error codes.
		"unknown: Unable to forward upstream stream",
		"upstream_error: Upstream request failed",
		"upstream_stream_read_error: Upstream response stream was interrupted",
		"Upstream HTTP/2 stream failed",
		// Regression for #11057: Codex CLI mid-stream disconnect relayed by a proxy.
		"stream disconnected before completion: stream closed before response.completed",
		// Regression for #10379: Node ERR_HTTP2_STREAM_CANCEL.
		"The pending stream has been canceled",
	])("matches gateway and stream-drop wording: %s", (errorMessage) => {
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it.each([
		// Regression for #10965 (provider unknown, no status code in the message).
		"The service is temporarily unavailable. Please retry later.",
		// Bedrock ServiceUnavailableException as formatted by formatBedrockError.
		"Service unavailable: The service is temporarily unavailable.",
		// Regression for #10996: node-fetch errors from the google-vertex OAuth token refresh.
		"request to https://oauth2.googleapis.com/token failed, reason:",
		"request to https://oauth2.googleapis.com/token failed, reason: connect ECONNREFUSED 127.0.0.1:9",
	])("matches service unavailable and node-fetch failure wording: %s", (errorMessage) => {
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it.each([
		"subscription_sharing_usage_unavailable: Usage cannot be checked.",
		"subscription_sharing_user_unavailable: User cannot be loaded.",
	])("retries temporary ChatGPT subscription errors: %s", (errorMessage) => {
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it.each(["HTTP 429 response", "HTTP 520 response", "HTTP 524 response"])(
		"matches anchored HTTP status codes: %s",
		(errorMessage) => {
			expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
		},
	);

	it.each([
		// Regression for #11057: status codes inside ids or other numbers are not status codes.
		"invalid_request_error: unknown model (request id 14290)",
		"exceeded byte count 5001234",
		"account 5023 has no access",
		'401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CU503xyz"}',
		"400 image exceeds 5 MB maximum: 5316784 bytes > 5242880 bytes",
	])("does not match status codes inside ids or longer numbers: %s", (errorMessage) => {
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(false);
	});

	it.each([
		wrappedDnsLookupError,
		"connect ENOTFOUND api.example.com",
		"EAI_AGAIN api.example.com",
		"getaddrinfo failed for api.example.com",
	])("matches DNS transport failure wording: %s", (errorMessage) => {
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it.each([
		// Regression for #12128: provider errors that report only a Node socket code.
		"read ECONNRESET",
		"connect ETIMEDOUT 140.82.113.3:443",
		"write EPIPE",
		"connect ECONNREFUSED 127.0.0.1:443",
		"ECONNABORTED",
		"Connection reset by peer",
	])("matches provider errors that report only a Node socket code: %s", (errorMessage) => {
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it.each(["Invalid value EXECONNRESET", "Unknown field ETIMEDOUTX", "Invalid key ERR_EPIPE_ID"])(
		"does not match a socket code inside a longer identifier: %s",
		(errorMessage) => {
			expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(false);
		},
	);

	it("matches gateway wording for a stream cut short mid-reply", () => {
		// Regression for an upstream Anthropic stream dropped mid-reply (#11879).
		const errorMessage = "Claude Code's stream from Anthropic was cut short after the reply had begun";
		expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }))).toBe(true);
	});

	it("matches OpenAI Responses streams that end before terminal events", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: openAIResponsesEarlyEofMessage }),
			),
		).toBe(true);
	});

	it("keeps provider limit errors non-retryable", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 quota exceeded" }),
			),
		).toBe(false);
	});

	it("classifies assistant error messages", () => {
		expect(
			isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" })),
		).toBe(true);
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "524 status code (no body)" }),
			),
		).toBe(true);
		expect(isRetryableAssistantError(fauxAssistantMessage("not an error"))).toBe(false);
	});
});

describe("retryAssistantCall", () => {
	const disabled: RetryPolicy = { enabled: false, maxRetries: 3, baseDelayMs: 0 };
	const enabled: RetryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 0 };

	it("returns a successful response immediately without retrying", async () => {
		const produce = vi.fn(async () => fauxAssistantMessage("ok"));
		const res = await retryAssistantCall(produce, enabled, undefined);
		expect(res.content).toEqual([{ type: "text", text: "ok" }]);
		expect(produce).toHaveBeenCalledTimes(1);
	});

	it("does not retry an aborted message", async () => {
		const produce = vi.fn(async () => fauxAssistantMessage("", { stopReason: "aborted" }));
		const onRetryScheduled = vi.fn();
		const res = await retryAssistantCall(produce, enabled, undefined, { onRetryScheduled });
		expect(res.stopReason).toBe("aborted");
		expect(produce).toHaveBeenCalledTimes(1);
		expect(onRetryScheduled).not.toHaveBeenCalled();
	});

	it("does not retry a non-retryable error (quota/billing)", async () => {
		const produce = vi.fn(async () =>
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "insufficient_quota" }),
		);
		const onRetryScheduled = vi.fn();
		const onRetryFinished = vi.fn();
		const res = await retryAssistantCall(produce, enabled, undefined, { onRetryScheduled, onRetryFinished });
		expect(res.stopReason).toBe("error");
		expect(produce).toHaveBeenCalledTimes(1);
		expect(onRetryScheduled).not.toHaveBeenCalled();
		expect(onRetryFinished).not.toHaveBeenCalled();
	});

	it("retries a transient error up to maxRetries then returns the final error", async () => {
		const produce = vi.fn(async () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }));
		const onRetryScheduled = vi.fn();
		const onRetryFinished = vi.fn();
		const res = await retryAssistantCall(produce, enabled, undefined, { onRetryScheduled, onRetryFinished });
		expect(res.stopReason).toBe("error");
		expect(produce).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
		expect(onRetryScheduled).toHaveBeenCalledTimes(3);
		expect(onRetryFinished).toHaveBeenCalledWith(false, 3, "terminated");
	});

	it("stops retrying once a call succeeds", async () => {
		let n = 0;
		const produce = vi.fn(async () => {
			n++;
			return n < 3
				? fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" })
				: fauxAssistantMessage("recovered");
		});
		const onRetryFinished = vi.fn();
		const res = await retryAssistantCall(produce, enabled, undefined, { onRetryFinished });
		expect(res.content).toEqual([{ type: "text", text: "recovered" }]);
		expect(produce).toHaveBeenCalledTimes(3);
		expect(onRetryFinished).toHaveBeenCalledWith(true, 2);
	});

	it("reports an aborted retried call as unsuccessful", async () => {
		let n = 0;
		const produce = vi.fn(async () => {
			n++;
			return n === 1
				? fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" })
				: fauxAssistantMessage("", { stopReason: "aborted" });
		});
		const onRetryFinished = vi.fn();
		const res = await retryAssistantCall(produce, enabled, undefined, { onRetryFinished });
		expect(res.stopReason).toBe("aborted");
		expect(produce).toHaveBeenCalledTimes(2);
		expect(onRetryFinished).toHaveBeenCalledWith(false, 1);
	});

	it("does not retry when policy is disabled", async () => {
		const produce = vi.fn(async () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }));
		const onRetryScheduled = vi.fn();
		const onRetryFinished = vi.fn();
		const res = await retryAssistantCall(produce, disabled, undefined, { onRetryScheduled, onRetryFinished });
		expect(res.stopReason).toBe("error");
		expect(produce).toHaveBeenCalledTimes(1);
		expect(onRetryScheduled).not.toHaveBeenCalled();
		expect(onRetryFinished).not.toHaveBeenCalled();
	});

	it("emits onRetryAttemptStart after backoff before each retried call", async () => {
		const events: string[] = [];
		let n = 0;
		const produce = vi.fn(async () => {
			events.push(`produce:${n}`);
			n++;
			return n < 3
				? fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" })
				: fauxAssistantMessage("recovered");
		});
		const onRetryScheduled = vi.fn((attempt: number) => {
			events.push(`retry:${attempt}`);
		});
		const onRetryAttemptStart = vi.fn(() => {
			events.push("attempt-start");
		});
		const res = await retryAssistantCall(produce, enabled, undefined, { onRetryScheduled, onRetryAttemptStart });
		expect(res.content).toEqual([{ type: "text", text: "recovered" }]);
		expect(onRetryScheduled).toHaveBeenCalledTimes(2);
		expect(onRetryAttemptStart).toHaveBeenCalledTimes(2);
		expect(events).toEqual([
			"produce:0",
			"retry:1",
			"attempt-start",
			"produce:1",
			"retry:2",
			"attempt-start",
			"produce:2",
		]);
	});

	it("aborts backoff sleep via signal, returns an aborted message, and emits onRetryFinished(false)", async () => {
		const controller = new AbortController();
		const produce = vi.fn(async () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }));
		const policy: RetryPolicy = { enabled: true, maxRetries: 5, baseDelayMs: 10_000 };
		const onRetryFinished = vi.fn();
		const p = retryAssistantCall(produce, policy, controller.signal, { onRetryFinished });
		// Let one error call resolve and the first backoff sleep start, then abort.
		await vi.waitFor(() => expect(produce).toHaveBeenCalled());
		controller.abort();
		const res = await p;
		expect(res.stopReason).toBe("aborted");
		expect(res.errorMessage).toBeUndefined();
		expect(produce).toHaveBeenCalledTimes(1);
		expect(onRetryFinished).toHaveBeenCalledWith(false, 1, "terminated");
	});
});
