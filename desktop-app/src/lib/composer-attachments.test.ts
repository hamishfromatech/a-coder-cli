import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	attachmentBudgetError,
	attachmentFromPath,
	attachmentName,
	buildAttachmentPrompt,
	type ComposerAttachment,
} from "./composer-attachments";
import { fileInfo, readFileBase64, readTextFile } from "./rpc";

vi.mock("./rpc", () => ({
	fileInfo: vi.fn(),
	readTextFile: vi.fn(),
	readFileBase64: vi.fn(),
}));

const mockedFileInfo = vi.mocked(fileInfo);
const mockedReadTextFile = vi.mocked(readTextFile);
const mockedReadFileBase64 = vi.mocked(readFileBase64);

function imageAttachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
	return {
		id: "image-1",
		kind: "image",
		name: "shot.png",
		path: "/tmp/shot.png",
		mimeType: "image/png",
		bytes: 4,
		data: "iVBORw0KGgo=",
		...overrides,
	};
}

describe("composer attachments", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("extracts a display name from POSIX and Windows paths", () => {
		expect(attachmentName("/tmp/report.pdf")).toBe("report.pdf");
		expect(attachmentName("C:\\Users\\a\\notes.md")).toBe("notes.md");
	});

	it("inlines text, attaches images, and references binary files", () => {
		const text: ComposerAttachment = {
			id: "text-1",
			kind: "text",
			name: "main.ts",
			path: "/tmp/main.ts",
			mimeType: "text/plain",
			bytes: 15,
			text: "const x = 1;",
		};
		const file: ComposerAttachment = {
			id: "file-1",
			kind: "file",
			name: "manual.pdf",
			path: "/tmp/manual.pdf",
			mimeType: "application/pdf",
			bytes: 2048,
		};

		const result = buildAttachmentPrompt("Explain these", [imageAttachment(), text, file]);

		expect(result.images).toEqual([
			{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
		]);
		expect(result.text).toContain('<file name="/tmp/shot.png" type="image/png"></file>');
		expect(result.text).toContain('<file name="/tmp/main.ts">\nconst x = 1;\n</file>');
		expect(result.text).toContain("manual.pdf");
		expect(result.text).toContain("Use the read tool");
		expect(result.text.endsWith("Explain these")).toBe(true);
	});

	it("falls back to a path reference when inline text exceeds the budget", () => {
		const text: ComposerAttachment = {
			id: "text-1",
			kind: "text",
			name: "huge.txt",
			path: "/tmp/huge.txt",
			mimeType: "text/plain",
			bytes: 500_000,
			text: "x".repeat(200_000),
		};

		const result = buildAttachmentPrompt("", [text]);

		expect(result.text).toContain("too large to inline");
		expect(result.text).not.toContain("\nx".repeat(10));
	});

	it("loads text-like paths", async () => {
		mockedFileInfo.mockResolvedValue({ size: 5, mimeType: "application/octet-stream" });
		mockedReadTextFile.mockResolvedValue("hello");

		const attachment = await attachmentFromPath("/tmp/hello.ts");

		expect(attachment).toMatchObject({ kind: "text", name: "hello.ts", text: "hello" });
	});

	it("loads supported images through base64", async () => {
		mockedFileInfo.mockResolvedValue({ size: 11, mimeType: "image/png" });
		mockedReadFileBase64.mockResolvedValue({
			content: "iVBORw0KGgo=",
			mimeType: "image/png",
		});

		const attachment = await attachmentFromPath("/tmp/shot.png");

		expect(attachment).toMatchObject({
			kind: "image",
			name: "shot.png",
			mimeType: "image/png",
			data: "iVBORw0KGgo=",
		});
	});

	it("keeps large text and binary files as path references", async () => {
		mockedFileInfo.mockResolvedValue({ size: 2 * 1024 * 1024, mimeType: "text/plain" });
		const large = await attachmentFromPath("/tmp/large.txt");
		expect(large).toMatchObject({ kind: "file", path: "/tmp/large.txt" });

		mockedFileInfo.mockResolvedValue({ size: 2048, mimeType: "application/pdf" });
		const binary = await attachmentFromPath("/tmp/manual.pdf");
		expect(binary).toMatchObject({ kind: "file", mimeType: "application/pdf" });
	});

	it("rejects too many attachments and duplicate paths", () => {
		const eight = Array.from({ length: 8 }, (_, index) =>
			imageAttachment({ id: `image-${index}`, path: `/tmp/${index}.png` }),
		);
		expect(
			attachmentBudgetError(eight, imageAttachment({ id: "new", path: "/tmp/new.png" })),
		).toContain("At most 8");

		expect(
			attachmentBudgetError(
				[imageAttachment({ path: "/tmp/shot.png" })],
				imageAttachment({ id: "dupe", path: "/tmp/shot.png" }),
			),
		).toContain("already attached");
	});
});
