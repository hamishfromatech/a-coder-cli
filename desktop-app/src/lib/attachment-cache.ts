/**
 * Lazy loader/cache for out-of-band history images. The engine sends attachment
 * refs in history pages; the first render fetches base64 once and reuses the
 * data URL for later mounts and session switches.
 */

import { getAttachment } from "./rpc";

const cache = new Map<string, string>();

export interface AttachmentRefLike {
	id: string;
	mimeType: string;
	bytes: number;
}

export function inlineDataUrl(mimeType: string, data: string): string {
	return `data:${mimeType};base64,${data}`;
}

export async function loadAttachmentDataUrl(ref: AttachmentRefLike): Promise<string> {
	const existing = cache.get(ref.id);
	if (existing) return existing;
	const attachment = await getAttachment(ref.id);
	const url = inlineDataUrl(attachment.mimeType, attachment.data);
	cache.set(ref.id, url);
	return url;
}

export function clearAttachmentCache(): void {
	cache.clear();
}
