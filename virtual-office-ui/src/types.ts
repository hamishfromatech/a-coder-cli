/**
 * Virtual office — data feed contract.
 *
 * The visualization is driven entirely by a feed the host provides: the
 * desktop app maps office RPC state (roster snapshot, activity events,
 * selected huddle log) onto it; the standalone dev mode generates the same
 * shapes from a mock scenario. The package depends on nothing but React and
 * zustand — engine types stay out so this folder stays self-contained.
 */

import type { CSSProperties } from "react";

/** Face geometry — mirrors the engine's procedural avatar model. */
export type FaceShape = "circle" | "hexagon" | "squircle" | "triangle" | "drop" | "cloud";

export interface Face {
	shape: FaceShape;
	/** Hex color; missing = deterministic from handle. */
	color?: string;
	/** Data URL (user upload); overrides the procedural face. */
	image?: string;
}

/** A roster member as the floor sees it. */
export interface OfficeCoworkerInfo {
	id: string;
	name: string;
	handle: string;
	title?: string;
	face: Face;
}

/** One live activity item from a coworker's turn (ascending by `at`). */
export interface OfficeActivityItem {
	coworkerId: string;
	kind: "turn_start" | "tool_start" | "tool_end" | "speaking" | "turn_end" | "error";
	toolName?: string;
	/** Completed assistant speech (never streaming deltas). */
	text?: string;
	at: number;
}

/** One room-log line from the huddle shown on the floor. */
export interface OfficeRoomMessage {
	id: string;
	at: number;
	kind: "user" | "coworker" | "system";
	/** Coworker id when kind === "coworker". */
	coworkerId?: string;
	text: string;
}

/** Everything the floor needs. The host re-renders `<VirtualOffice>` with a
 *  fresh feed object on every office event; derivation happens in the store. */
export interface VirtualOfficeFeed {
	coworkers: OfficeCoworkerInfo[];
	/** Recent activity, oldest first (the host caps the buffer). */
	activity: OfficeActivityItem[];
	/** Log of the room shown (links + meeting context derive from it). */
	roomLog: OfficeRoomMessage[];
	/** A drive is live in the shown room. */
	roomRunning: boolean;
	/** Coworker ids seated in the shown room. */
	roomMembers: string[];
	/** Room display name, shown in the banner while a drive runs. */
	roomName?: string;
}

export type FloorTheme = "dark" | "light";

export interface VirtualOfficeProps {
	feed: VirtualOfficeFeed;
	theme?: "dark" | "light";
	className?: string;
	style?: CSSProperties;
}