/**
 * Virtual office — public surface.
 *
 * The desktop app embeds <VirtualOffice> and feeds it from office RPC state;
 * the standalone dev mode (npm run dev in this folder) renders the same
 * component against the mock scenario.
 */

export { VirtualOffice } from "./VirtualOffice.tsx";
export { Office3D } from "./office3d.tsx";
export { OfficeView, type OfficeViewMode } from "./OfficeView.tsx";
export { createFloorStore, useFloor } from "./store.ts";
export type {
	CollaborationLink,
	CoworkerVisual,
	FloorState,
	FloorStore,
	FloorStatus,
	SpeechBubble,
} from "./store.ts";
export { mockFeed, startMockLoop } from "./mock.ts";
export { STATUS_COLORS, THEMES, type Palette } from "./palette.ts";
export type {
	Face,
	FaceShape,
	FloorTheme,
	OfficeActivityItem,
	OfficeCoworkerInfo,
	OfficeRoomMessage,
	VirtualOfficeFeed,
	VirtualOfficeProps,
} from "./types.ts";