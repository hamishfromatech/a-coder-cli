/**
 * Virtual office palette — zones, statuses, and themes for both 2D and 3D
 * views. Status hues follow the same visual grammar as the office events
 * they represent: thinking blue, tool work orange, speech purple, trouble
 * red, presence green.
 */

export type FloorTheme = "dark" | "light";

/** Status accent hues (2D rings + 3D auras). */
export const STATUS_COLORS = {
	idle: "#22c55e",
	thinking: "#3b82f6",
	tool_calling: "#f97316",
	speaking: "#a855f7",
	error: "#ef4444",
	spawn: "#06b6d4",
} as const;

export interface Palette {
	/* floor */
	floor: string;
	zoneDesk: string;
	zoneMeeting: string;
	zoneLounge: string;
	corridor: string;
	grid: string;
	wall: string;
	wallEdge: string;
	/* furniture */
	wood: string;
	woodTop: string;
	chair: string;
	chairSeat: string;
	monitor: string;
	monitorBezel: string;
	monitorOn: string;
	metal: string;
	table: string;
	rug: string;
	rugRing: string;
	sofa: string;
	plant: string;
	plantDark: string;
	plantPot: string;
	whiteboard: string;
	whiteboardInk: string;
	/* chrome */
	label: string;
	labelMuted: string;
	link: string;
	bubbleBg: string;
	bubbleText: string;
	accent: string;
}

export const THEMES: Record<FloorTheme, Palette> = {
	dark: {
		floor: "#0e1626",
		zoneDesk: "#16233b",
		zoneMeeting: "#131f38",
		zoneLounge: "#1a1830",
		corridor: "#0b1120",
		grid: "#1c2740",
		wall: "#3b4a63",
		wallEdge: "#4c5d7a",
		wood: "#3b4a63",
		woodTop: "#4c5d7a",
		chair: "#26324a",
		chairSeat: "#31405c",
		monitor: "#0d1526",
		monitorBezel: "#141d31",
		monitorOn: "#1d2b45",
		metal: "#8898a8",
		table: "#4c5d7a",
		rug: "#182236",
		rugRing: "#2c3b5c",
		sofa: "#31405c",
		plant: "#2f7d4f",
		plantDark: "#245c3c",
		plantPot: "#8a5a3b",
		whiteboard: "#1b2540",
		whiteboardInk: "#64748b",
		label: "#e2e8f0",
		labelMuted: "#7d8aa3",
		link: "#38bdf8",
		bubbleBg: "#101a2e",
		bubbleText: "#dbe4f0",
		accent: "#38bdf8",
	},
	light: {
		floor: "#eef2f7",
		zoneDesk: "#f6f4ee",
		zoneMeeting: "#eaf1fb",
		zoneLounge: "#f3eff8",
		corridor: "#e2e8f0",
		grid: "#dfe6ef",
		wall: "#93a3b8",
		wallEdge: "#aebccf",
		wood: "#c9b28f",
		woodTop: "#dcc9a7",
		chair: "#8fa1b8",
		chairSeat: "#a8b7cc",
		monitor: "#7d8fa8",
		monitorBezel: "#93a3b8",
		monitorOn: "#eaf2fc",
		metal: "#aab8c8",
		table: "#b8c6d8",
		rug: "#e3eaf3",
		rugRing: "#c3d2e2",
		sofa: "#9fb0c6",
		plant: "#4c9a68",
		plantDark: "#3b7a51",
		plantPot: "#c19a6f",
		whiteboard: "#ffffff",
		whiteboardInk: "#94a3b8",
		label: "#1e293b",
		labelMuted: "#64748b",
		link: "#0284c7",
		bubbleBg: "#ffffff",
		bubbleText: "#26324a",
		accent: "#0284c7",
	},
};

export const SCENE_STYLES = `
.vo-pulse { animation: vo-pulse 1.6s ease-in-out infinite; }
@keyframes vo-pulse { 0%, 100% { opacity: .85; } 50% { opacity: .3; } }
.vo-pulse-fast { animation: vo-pulse 1s ease-in-out infinite; }
.vo-ring { animation: vo-ring 2s ease-in-out infinite; stroke-dasharray: 6 3; }
@keyframes vo-ring { 0%, 100% { opacity: .9; } 50% { opacity: .35; } }
.vo-spawn { animation: vo-spawn 1.2s ease-out infinite; }
@keyframes vo-spawn { 0% { opacity: .9; stroke-width: 1; } 100% { opacity: 0; stroke-width: 3.4; } }
.vo-link { stroke-dasharray: 4 3; animation: vo-march 1.1s linear infinite; }
@keyframes vo-march { to { stroke-dashoffset: -7; } }
.vo-bubble { animation: vo-pop .18s ease-out; }
@keyframes vo-pop { from { opacity: 0; transform: translateY(2px); } }
.vo-dots circle { animation: vo-dot 1.2s ease-in-out infinite; }
@keyframes vo-dot { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
.vo-steam { animation: vo-steam 2.4s ease-in-out infinite; }
@keyframes vo-steam { 0% { opacity: 0; transform: translateY(0); } 40% { opacity: .7; } 100% { opacity: 0; transform: translateY(-2.4); } }
`;