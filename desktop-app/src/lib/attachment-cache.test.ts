import { beforeEach, describe, expect, it, vi } from "vitest";

const getAttachment = vi.fn();
vi.mock("./rpc", () => ({ getAttachment: (...args: unknown[]) => getAttachment(...args) }));

import { clearAttachmentCache, inlineDataUrl, loadAttachmentDataUrl } from "./attachment-cache";

beforeEach(() => {
	clearAttachmentCache();
	getAttachment.mockReset();
	getAttachment.mockResolvedValue({
		id: "att-1",
		mimeType: "image/png",
		bytes: 3,
		data: "AAAA",
	});
});

describe("attachment cache", () => {
	it("fetches once and reuses the data URL", async () => {
		const ref = { id: "att-1", mimeType: "image/png", bytes: 3 };
		const first = await loadAttachmentDataUrl(ref);
		const second = await loadAttachmentDataUrl(ref);
		expect(first).toBe(inlineDataUrl("image/png", "AAAA"));
		expect(second).toBe(first);
		expect(getAttachment).toHaveBeenCalledOnce();
	});
});
