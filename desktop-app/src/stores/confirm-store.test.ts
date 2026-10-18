// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm, useConfirmStore } from "./confirm-store";

const reset = () => {
	useConfirmStore.getState().request?.resolve(false);
	useConfirmStore.setState({ request: null, pending: false, done: false, error: null });
};

beforeEach(() => {
	reset();
});

describe("confirm store", () => {
	it("resolves true only after a successful confirm action", async () => {
		const onConfirm = vi.fn();
		const answer = confirm({ title: "Delete?", onConfirm });
		expect(useConfirmStore.getState().request?.title).toBe("Delete?");

		await useConfirmStore.getState().confirm();
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(useConfirmStore.getState().done).toBe(true);

		await vi.waitFor(() => expect(useConfirmStore.getState().request).toBeNull());
		await expect(answer).resolves.toBe(true);
	});

	it("keeps the dialog open with an inline error when the action fails", async () => {
		const answer = confirm({
			title: "Save?",
			onConfirm: async () => {
				throw new Error("disk full");
			},
		});

		await useConfirmStore.getState().confirm();
		expect(useConfirmStore.getState().error).toBe("disk full");
		expect(useConfirmStore.getState().request).not.toBeNull();
		expect(useConfirmStore.getState().done).toBe(false);

		// Cancel out of the failed dialog.
		useConfirmStore.getState().cancel();
		await expect(answer).resolves.toBe(false);
	});

	it("resolves false on cancel and ignores cancel while pending", async () => {
		let release: (() => void) | undefined;
		const answer = confirm({
			title: "Wait",
			onConfirm: () =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		});

		const running = useConfirmStore.getState().confirm();
		useConfirmStore.getState().cancel();
		expect(useConfirmStore.getState().request).not.toBeNull();

		release?.();
		await running;
		await vi.waitFor(() => expect(useConfirmStore.getState().request).toBeNull());
		await expect(answer).resolves.toBe(true);
	});

	it("supersedes an unanswered request without hanging its promise", async () => {
		const first = confirm({ title: "First" });
		const second = confirm({ title: "Second" });
		await expect(first).resolves.toBe(false);
		expect(useConfirmStore.getState().request?.title).toBe("Second");

		useConfirmStore.getState().cancel();
		await expect(second).resolves.toBe(false);
	});

	it("runs the secondary action and resolves false", async () => {
		const onSelect = vi.fn();
		const answer = confirm({
			title: "Update",
			secondaryAction: { label: "Release notes", onSelect },
		});

		useConfirmStore.getState().runSecondary();
		expect(onSelect).toHaveBeenCalledOnce();
		await expect(answer).resolves.toBe(false);
	});
});
