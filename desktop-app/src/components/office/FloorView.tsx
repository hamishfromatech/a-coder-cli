/**
 * The virtual office floor — renders <VirtualOffice> from office store state.
 *
 * The shown room is the open huddle, else the most recently active group
 * huddle; its drive state gathers seated coworkers into the meeting pods.
 */

import { useMemo } from "react";
import {
	type OfficeActivityItem,
	type OfficeCoworker,
	type OfficeHuddlePayload,
	type OfficeMessage,
	type OfficeHuddleSummary,
} from "../../lib/rpc";
import { useOfficeStore } from "../../stores/office-store";
import { OfficeView, type OfficeRoomMessage, type VirtualOfficeFeed } from "../../../../virtual-office-ui/src";
import { useSettingsStore } from "../../stores/settings-store";

function toRoomMessages(log: OfficeMessage[]): OfficeRoomMessage[] {
	return log.map((entry) => ({
		id: entry.id,
		at: entry.at,
		kind: entry.from.kind,
		coworkerId: entry.from.id,
		text: entry.text,
	}));
}

interface ShownRoom {
	summary: OfficeHuddleSummary;
	payload?: OfficeHuddlePayload;
}

function buildFeed(
	coworkers: OfficeCoworker[],
	activity: OfficeActivityItem[],
	shown: ShownRoom | undefined,
): VirtualOfficeFeed {
	return {
		coworkers: coworkers
			.filter((c) => !c.hidden)
			.map((c) => ({
				id: c.id,
				name: c.name,
				handle: c.handle,
				title: c.title,
				face: { shape: c.face.shape, color: c.face.color, image: c.face.image },
			})),
		activity,
		roomLog: shown?.payload ? toRoomMessages(shown.payload.data.log) : [],
		roomRunning: shown?.payload?.data.running !== undefined,
		roomMembers: shown?.summary.members ?? [],
		roomName: shown?.summary.name,
	};
}

function resolveFloorTheme(theme: "system" | "dark" | "light"): "dark" | "light" {
	if (theme !== "system") return theme;
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function FloorView() {
	const snapshot = useOfficeStore((s) => s.snapshot);
	const activity = useOfficeStore((s) => s.activity);
	const openHuddleId = useOfficeStore((s) => s.openHuddleId);
	const huddles = useOfficeStore((s) => s.huddles);
	const theme = useSettingsStore((s) => s.theme);

	const shown = useMemo<ShownRoom | undefined>(() => {
		const summaries = snapshot?.huddles ?? [];
		if (openHuddleId) {
			const summary = summaries.find((h) => h.id === openHuddleId);
			if (summary) return { summary, payload: huddles[openHuddleId] };
		}
		// Fall back to the most recently active group huddle.
		const latest = [...summaries]
			.filter((h) => !h.id.startsWith("dm:"))
			.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))[0];
		return latest ? { summary: latest, payload: huddles[latest.id] } : undefined;
	}, [openHuddleId, huddles, snapshot]);

	const feed = useMemo(
		() => buildFeed(snapshot?.coworkers ?? [], activity, shown),
		[snapshot, activity, shown],
	);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<OfficeView
				feed={feed}
				theme={resolveFloorTheme(theme)}
				className="min-h-0 w-full flex-1"
				style={{ display: "flex" }}
			/>
		</div>
	);
}