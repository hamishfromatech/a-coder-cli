/**
 * The virtual office floor — renders <VirtualOffice> from office store state.
 *
 * The shown room is the open huddle, else the most recently active group
 * huddle; its drive state gathers seated coworkers into the meeting pods.
 */

import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "../ui/Button";
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
	// Links only live for a minute; the tail is all the floor needs, and long
	// huddles should not be re-mapped on every payload push.
	return log.slice(-200).map((entry) => ({
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
		roomId: shown?.summary.id,
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
	const openHuddle = useOfficeStore((s) => s.openHuddle);
	const theme = useSettingsStore((s) => s.theme);
	const [roomsOpen, setRoomsOpen] = useState(false);

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

	const groupHuddles = useMemo(
		() =>
			[...(snapshot?.huddles ?? [])]
				.filter((huddle) => !huddle.id.startsWith("dm:"))
				.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)),
		[snapshot],
	);

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<OfficeView
				feed={feed}
				theme={resolveFloorTheme(theme)}
				className="min-h-0 w-full flex-1"
				style={{ display: "flex" }}
				onCoworkerClick={(coworkerId) => void openHuddle(`dm:${coworkerId}`)}
				onHuddleClick={(huddleId) => void openHuddle(huddleId)}
			/>
			{groupHuddles.length > 0 && (
				<div className="absolute right-2 top-10 z-20">
					<Button
						variant="ghost"
						size="xs"
						icon={Users}
						aria-expanded={roomsOpen}
						aria-label="Open a huddle"
						title="Open a huddle"
						className="bg-pi-surface/80 backdrop-blur-sm"
						onClick={() => setRoomsOpen((value) => !value)}
					>
						Rooms
					</Button>
					{roomsOpen && (
						<div className="absolute right-0 top-full mt-1 max-h-64 w-52 overflow-y-auto rounded-md border border-pi-border bg-pi-surface-overlay p-1 shadow-overlay">
							{groupHuddles.map((huddle) => (
								<button
									key={huddle.id}
									type="button"
									onClick={() => {
										setRoomsOpen(false);
										void openHuddle(huddle.id);
									}}
									className="flex w-full flex-col rounded px-2 py-1 text-left hover:bg-pi-surface-raised"
								>
									<span className="truncate text-xs text-pi-text">{huddle.name}</span>
									<span className="truncate text-2xs text-pi-text-faint">{huddle.preview ?? `${huddle.members.length} members`}</span>
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}