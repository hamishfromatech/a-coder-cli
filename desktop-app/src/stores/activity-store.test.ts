// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	activityStatus,
	attentionCount,
	selectHistoryItems,
	selectOpenItems,
	selectSnoozedItems,
	useActivityStore,
} from "./activity-store";

function reset() {
	useActivityStore.getState().clear();
	useActivityStore.setState({ items: [], seenAt: 0 });
}

beforeEach(reset);

describe("decision inbox store", () => {
	it("dedupes lifecycle updates by stable source key", () => {
		const store = useActivityStore.getState();
		store.add({
			key: "cron:run:1",
			kind: "cron",
			origin: "automation",
			severity: "info",
			title: "Run started",
			at: 100,
			running: true,
		});
		store.add({
			key: "cron:run:1",
			kind: "cron",
			origin: "automation",
			severity: "success",
			title: "Run finished",
			at: 200,
			running: false,
		});
		const items = useActivityStore.getState().items;
		expect(items).toHaveLength(1);
		expect(items[0]?.title).toBe("Run finished");
		expect(items[0]?.running).toBe(false);
	});

	it("moves items through dismiss, snooze, resolve, restore, and history", () => {
		const store = useActivityStore.getState();
		store.add({
			key: "cron:run:2",
			kind: "cron",
			origin: "automation",
			severity: "action",
			title: "Needs attention",
			at: 100,
		});
		expect(attentionCount(useActivityStore.getState())).toBe(1);

		store.dismiss("cron:run:2");
		expect(selectOpenItems(useActivityStore.getState().items)).toHaveLength(0);
		expect(selectHistoryItems(useActivityStore.getState().items)).toHaveLength(1);
		expect(attentionCount(useActivityStore.getState())).toBe(0);

		store.restore("cron:run:2");
		expect(selectOpenItems(useActivityStore.getState().items)).toHaveLength(1);

		store.snooze("cron:run:2", Date.now() + 60_000);
		expect(selectSnoozedItems(useActivityStore.getState().items)).toHaveLength(1);
		expect(attentionCount(useActivityStore.getState())).toBe(0);

		store.snooze("cron:run:2", Date.now() - 1);
		expect(selectOpenItems(useActivityStore.getState().items)).toHaveLength(1);
		expect(activityStatus(useActivityStore.getState().items[0]!)).toBe("open");

		store.resolve("cron:run:2");
		expect(selectHistoryItems(useActivityStore.getState().items)).toHaveLength(1);
	});

	it("keeps a dismissed key suppressed when the source emits again", () => {
		const store = useActivityStore.getState();
		store.add({
			key: "approval:request:a1",
			kind: "approval",
			origin: "automation",
			severity: "action",
			title: "Approval needed",
			at: 100,
		});
		store.dismiss("approval:request:a1");
		store.add({
			key: "approval:request:a1",
			kind: "approval",
			origin: "automation",
			severity: "action",
			title: "Approval needed",
			at: 200,
		});
		const item = useActivityStore.getState().items[0];
		expect(item?.status).toBe("dismissed");
		expect(selectOpenItems(useActivityStore.getState().items)).toHaveLength(0);
	});

	it("counts only unread open errors and actions", () => {
		const store = useActivityStore.getState();
		store.add({ kind: "cron", origin: "automation", severity: "success", title: "Done", at: 100 });
		store.add({ kind: "cron", origin: "automation", severity: "action", title: "Action", at: 200 });
		store.add({ kind: "cron", origin: "automation", severity: "error", title: "Error", at: 300 });
		expect(attentionCount({ items: useActivityStore.getState().items, seenAt: 150 })).toBe(2);
		store.markSeen();
		expect(attentionCount(useActivityStore.getState())).toBe(0);
	});
});
