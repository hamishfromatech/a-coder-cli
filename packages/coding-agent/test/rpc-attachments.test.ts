import { describe, expect, it } from "vitest";
import { externalizeAttachments, type RpcAttachmentRef } from "../src/modes/rpc/rpc-attachments.ts";

const register = (mimeType: string, _data: string, bytes: number): RpcAttachmentRef => ({
	id: "att-1",
	mimeType,
	bytes,
});

describe("externalizeAttachments", () => {
	it("replaces inline image data with a ref and keeps the rest", () => {
		const messages = [
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
				],
			},
		];
		const result = externalizeAttachments(messages, register) as Array<{
			content: Array<Record<string, unknown>>;
		}>;
		expect(result[0]?.content[0]).toEqual({ type: "text", text: "look" });
		expect(result[0]?.content[1]).toEqual({
			type: "image",
			mimeType: "image/png",
			bytes: 3,
			attachment: { id: "att-1", mimeType: "image/png", bytes: 3 },
		});
		expect("data" in (result[0]?.content[1] ?? {})).toBe(false);
	});

	it("does not mutate the source messages", () => {
		const image = { type: "image", data: "AAAA", mimeType: "image/png" };
		const messages = [{ role: "user", content: [image] }];
		externalizeAttachments(messages, register);
		expect(image.data).toBe("AAAA");
	});

	it("registers duplicate image data once per page", () => {
		let calls = 0;
		const counting = (mimeType: string, _data: string, bytes: number): RpcAttachmentRef => {
			calls += 1;
			return { id: `att-${calls}`, mimeType, bytes };
		};
		const image = { type: "image", data: "AAAA", mimeType: "image/png" };
		externalizeAttachments(
			[
				{ role: "user", content: [image] },
				{ role: "user", content: [image] },
			],
			counting,
		);
		expect(calls).toBe(1);
	});
});
