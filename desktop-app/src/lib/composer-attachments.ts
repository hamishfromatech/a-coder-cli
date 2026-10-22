/**
 * Composer attachments: images ride the prompt as native vision content;
 * text-like files are inlined as `<file>` blocks; everything else becomes a
 * path reference the agent can read with its normal tools.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import { getFileKind, isTextFile } from "./files";
import { fileInfo, readFileBase64, readTextFile } from "./rpc";

export const FILE_ATTACHMENT_MIME = "application/x-a-coder-path";
export const MAX_COMPOSER_ATTACHMENTS = 8;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_INLINE_TEXT_CHARS = 60_000;
export const MAX_TOTAL_INLINE_TEXT_CHARS = 120_000;

export type ComposerAttachmentKind = "image" | "text" | "file";

export interface ComposerAttachment {
	id: string;
	kind: ComposerAttachmentKind;
	name: string;
	path?: string;
	mimeType?: string;
	bytes: number;
	/** Base64 (no data URL prefix) for `image` attachments. */
	data?: string;
	/** Inline UTF-8 text for `text` attachments. */
	text?: string;
}

const SUPPORTED_IMAGE_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/bmp",
]);

let nextAttachmentId = 1;

function mintAttachmentId(): string {
	return `attachment-${nextAttachmentId++}`;
}

export function attachmentName(path: string): string {
	return path.split(/[/\\]/).pop() || path;
}

export function formatAttachmentBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasNul(text: string): boolean {
	return text.includes("\u0000");
}

function base64Bytes(base64: string): number {
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	return Math.floor((base64.length * 3) / 4) - padding;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Downscale large images before sending them to a provider. */
async function normalizeImageData(data: string, mimeType: string): Promise<string> {
	if (mimeType === "image/gif") return data;
	try {
		const blob = new Blob([base64ToBytes(data)], { type: mimeType });
		const bitmap = await createImageBitmap(blob);
		const maxEdge = Math.max(bitmap.width, bitmap.height);
		if (maxEdge <= 2048) {
			bitmap.close();
			return data;
		}
		const scale = 2048 / maxEdge;
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext("2d");
		if (!context) {
			bitmap.close();
			return data;
		}
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		const outputMime = mimeType === "image/png" ? "image/png" : "image/jpeg";
		const url = canvas.toDataURL(outputMime, 0.86);
		return url.split(",")[1] ?? data;
	} catch {
		return data;
	}
}

function imageAttachment(name: string, mimeType: string, data: string, path?: string): ComposerAttachment {
	return {
		id: mintAttachmentId(),
		kind: "image",
		name,
		path,
		mimeType,
		bytes: base64Bytes(data),
		data,
	};
}

function textAttachment(name: string, text: string, bytes: number, path?: string): ComposerAttachment {
	return {
		id: mintAttachmentId(),
		kind: "text",
		name,
		path,
		mimeType: "text/plain",
		bytes,
		text,
	};
}

function fileAttachment(
	name: string,
	mimeType: string | undefined,
	bytes: number,
	path?: string,
): ComposerAttachment {
	return {
		id: mintAttachmentId(),
		kind: "file",
		name,
		path,
		mimeType,
		bytes,
	};
}

/** Load a native path through the desktop bridge. */
export async function attachmentFromPath(path: string): Promise<ComposerAttachment> {
	const name = attachmentName(path);
	const kind = getFileKind(path);
	const info = await fileInfo(path);

	if (kind === "image" && SUPPORTED_IMAGE_MIME.has(info.mimeType)) {
		if (info.size > MAX_IMAGE_BYTES) {
			throw new Error(`"${name}" is larger than ${formatAttachmentBytes(MAX_IMAGE_BYTES)}.`);
		}
		const file = await readFileBase64(path);
		const mimeType = file.mimeType || info.mimeType;
		const data = await normalizeImageData(file.content, mimeType);
		return imageAttachment(name, mimeType, data, path);
	}

	if (isTextFile(kind) && info.size <= MAX_TEXT_FILE_BYTES) {
		const text = await readTextFile(path);
		if (!hasNul(text)) {
			if (text.length <= MAX_INLINE_TEXT_CHARS) {
				return textAttachment(name, text, info.size, path);
			}
			return fileAttachment(name, info.mimeType, info.size, path);
		}
	}

	return fileAttachment(name, info.mimeType, info.size, path);
}

/** Load a browser `File` (dev server / an HTML5 drop when Tauri does not intercept it). */
export async function attachmentFromFile(file: File): Promise<ComposerAttachment> {
	const kind = getFileKind(file.name);
	if (kind === "image" && SUPPORTED_IMAGE_MIME.has(file.type)) {
		if (file.size > MAX_IMAGE_BYTES) {
			throw new Error(`"${file.name}" is larger than ${formatAttachmentBytes(MAX_IMAGE_BYTES)}.`);
		}
		const dataUrl = await readFileDataUrl(file);
		const data = dataUrl.split(",")[1] ?? "";
		const normalized = await normalizeImageData(data, file.type);
		return imageAttachment(file.name, file.type, normalized);
	}

	if (isTextFile(kind) && file.size <= MAX_TEXT_FILE_BYTES) {
		const text = await file.text();
		if (!hasNul(text)) {
			if (text.length <= MAX_INLINE_TEXT_CHARS) {
				return textAttachment(file.name, text, file.size);
			}
			return fileAttachment(file.name, file.type || "text/plain", file.size);
		}
	}

	return fileAttachment(file.name, file.type || "application/octet-stream", file.size);
}

function readFileDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
		reader.readAsDataURL(file);
	});
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fileReferenceBlock(attachment: ComposerAttachment, reason?: string): string {
	const label = attachment.path ?? attachment.name;
	const type = attachment.mimeType ?? "application/octet-stream";
	const note = reason
		? `${reason} It is available at the path above; use the read tool if you need its contents.`
		: attachment.path
			? "Use the read tool with this absolute path if you need its contents."
			: "The file was attached from the composer.";
	return `<file name="${escapeAttribute(label)}" type="${escapeAttribute(type)}" bytes="${attachment.bytes}">[${note}]</file>`;
}

/**
 * Build the prompt text and native image content for the next turn. Inline
 * text is bounded so a dropped 1 MB source file cannot swamp the context.
 */
export function buildAttachmentPrompt(
	text: string,
	attachments: ComposerAttachment[],
): { text: string; images: ImageContent[] } {
	const images: ImageContent[] = [];
	const blocks: string[] = [];
	let remainingInline = MAX_TOTAL_INLINE_TEXT_CHARS;

	for (const attachment of attachments) {
		const label = attachment.path ?? attachment.name;
		if (attachment.kind === "image" && attachment.data) {
			const mimeType = attachment.mimeType ?? "image/png";
			images.push({ type: "image", mimeType, data: attachment.data });
			blocks.push(`<file name="${escapeAttribute(label)}" type="${escapeAttribute(mimeType)}"></file>`);
			continue;
		}
		if (attachment.kind === "text" && attachment.text !== undefined) {
			if (attachment.text.length <= remainingInline) {
				blocks.push(`<file name="${escapeAttribute(label)}">\n${attachment.text}\n</file>`);
				remainingInline -= attachment.text.length;
				continue;
			}
			blocks.push(fileReferenceBlock(attachment, "This file is too large to inline."));
			continue;
		}
		blocks.push(fileReferenceBlock(attachment));
	}

	const prompt = [blocks.join("\n"), text.trim()].filter(Boolean).join("\n\n");
	return { text: prompt, images };
}

/** Whether adding `candidate` would exceed the composer's attachment budget. */
export function attachmentBudgetError(
	existing: ComposerAttachment[],
	candidate: ComposerAttachment,
): string | null {
	if (existing.length >= MAX_COMPOSER_ATTACHMENTS) {
		return `At most ${MAX_COMPOSER_ATTACHMENTS} attachments are allowed per message.`;
	}
	if (existing.some((item) => item.path && item.path === candidate.path)) {
		return `"${candidate.name}" is already attached.`;
	}
	if (candidate.kind === "image") {
		const imageBytes =
			existing.reduce((sum, item) => sum + (item.kind === "image" ? item.bytes : 0), 0) +
			candidate.bytes;
		if (imageBytes > MAX_TOTAL_IMAGE_BYTES) {
			return `Images exceed the ${formatAttachmentBytes(MAX_TOTAL_IMAGE_BYTES)} message limit.`;
		}
	}
	return null;
}
