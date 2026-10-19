/**
 * Out-of-band image attachments for history pages.
 *
 * Contract-2 clients opt into `attachments`: image blocks in pages become
 * `{ type: "image", mimeType, bytes, attachment: { id, mimeType, bytes } }`
 * and the base64 payload is fetched lazily with `get_attachment`. Contract-1
 * clients keep the inline `data` field unchanged.
 */

export interface RpcAttachmentRef {
	id: string;
	mimeType: string;
	bytes: number;
}

export interface RpcAttachmentData extends RpcAttachmentRef {
	data: string;
}

export type AttachmentRegistrar = (mimeType: string, data: string, bytes: number) => RpcAttachmentRef;

function isImageBlock(value: unknown): value is { type: "image"; data: string; mimeType: string } {
	if (typeof value !== "object" || value === null) return false;
	const block = value as { type?: unknown; data?: unknown; mimeType?: unknown };
	return block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string";
}

/** Replace inline image data with refs, without mutating the live messages. */
export function externalizeAttachments(messages: readonly unknown[], register: AttachmentRegistrar): unknown[] {
	const seen = new Map<string, RpcAttachmentRef>();
	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk);
		if (typeof value !== "object" || value === null) return value;
		if (isImageBlock(value)) {
			const key = `${value.mimeType}:${value.data.length}:${value.data.slice(0, 64)}`;
			let ref = seen.get(key);
			if (!ref) {
				const bytes = Math.floor((value.data.length * 3) / 4);
				ref = register(value.mimeType, value.data, bytes);
				seen.set(key, ref);
			}
			return { type: "image", mimeType: ref.mimeType, bytes: ref.bytes, attachment: ref };
		}
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) out[key] = walk(entry);
		return out;
	};
	return messages.map(walk);
}
