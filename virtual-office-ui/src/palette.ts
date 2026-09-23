/**
 * Virtual office palette — zones, statuses, and themes for both 2D and 3D
 * views. Status hues follow the same visual grammar as the office events
 * they represent: thinking blue, tool work orange, speech purple, trouble
 * red, presence green.
 *
 * Art direction: a warm, crafted studio shell (deep slate walls, wood
 * furniture) lit by cool daylight through the north windows and warm pools
 * from the ceiling fixtures. The dark theme leans cozy — amber light against
 * a cool night shell; the light theme is a calm daylight studio.
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
	/** Soft radial wash over the floor center (warm pool). */
	floorGlow: string;
	floorEdge: string;
	zoneDesk: string;
	zoneDeskEdge: string;
	zoneMeeting: string;
	zoneMeetingEdge: string;
	zoneLounge: string;
	zoneLoungeEdge: string;
	corridor: string;
	grid: string;
	/** Shell around the slab + walls. */
	wall: string;
	wallDeep: string;
	wallEdge: string;
	baseboard: string;
	/* furniture */
	wood: string;
	woodTop: string;
	chair: string;
	chairSeat: string;
	chairBack: string;
	monitor: string;
	monitorBezel: string;
	monitorOn: string;
	/** Screen glow while the desk is in use. */
	screenGlow: string;
	metal: string;
	table: string;
	tableTop: string;
	rug: string;
	rugRing: string;
	sofa: string;
	cushion: string;
	plant: string;
	plantDark: string;
	plantPot: string;
	whiteboard: string;
	whiteboardInk: string;
	/* architecture */
	windowFrame: string;
	windowGlass: string;
	/** Light shafts + pools (used with opacity). */
	shaft: string;
	lightPool: string;
	lampGlow: string;
	door: string;
	/* chrome */
	label: string;
	labelMuted: string;
	link: string;
	bubbleBg: string;
	bubbleText: string;
	accent: string;
	accentSoft: string;
}

export const THEMES: Record<FloorTheme, Palette> = {
	dark: {
		floor: "#131c2e",
		floorGlow: "rgba(255, 190, 120, 0.05)",
		floorEdge: "#0a1220",
		zoneDesk: "#18263f",
		zoneDeskEdge: "#243754",
		zoneMeeting: "#152340",
		zoneMeetingEdge: "#233a5e",
		zoneLounge: "#1d1a33",
		zoneLoungeEdge: "#2d2850",
		corridor: "#101a2d",
		grid: "#22304d",
		wall: "#2a3650",
		wallDeep: "#1c2540",
		wallEdge: "#43537a",
		baseboard: "#3a4a6e",
		wood: "#8a6a48",
		woodTop: "#b08a5c",
		chair: "#232f4b",
		chairSeat: "#2e3d5e",
		chairBack: "#374a70",
		monitor: "#0d1526",
		monitorBezel: "#151f33",
		monitorOn: "#1d2b45",
		screenGlow: "#ffd9a0",
		metal: "#8fa0b4",
		table: "#8a6a4a",
		tableTop: "#b08a5c",
		rug: "#1f2b46",
		rugRing: "#3a4f78",
		sofa: "#3c4f75",
		cushion: "#d9975f",
		plant: "#3f9e63",
		plantDark: "#2c744a",
		plantPot: "#a06a40",
		whiteboard: "#e9edf4",
		whiteboardInk: "#5b6b85",
		windowFrame: "#1a2438",
		windowGlass: "#1d3050",
		shaft: "#7ea6d8",
		lightPool: "#ffce8f",
		lampGlow: "#ffc987",
		door: "#6e5638",
		label: "#e2e8f0",
		labelMuted: "#7d8aa3",
		link: "#38bdf8",
		bubbleBg: "#121c30",
		bubbleText: "#dbe4f0",
		accent: "#38bdf8",
		accentSoft: "rgba(56, 189, 248, 0.16)",
	},
	light: {
		floor: "#f1ece2",
		floorGlow: "rgba(255, 244, 214, 0.5)",
		floorEdge: "#d8d0c0",
		zoneDesk: "#faf6ec",
		zoneDeskEdge: "#e7ddc8",
		zoneMeeting: "#eaf2fb",
		zoneMeetingEdge: "#cfdff2",
		zoneLounge: "#f5eee6",
		zoneLoungeEdge: "#e2d4c0",
		corridor: "#e8e2d4",
		grid: "#e0d8c6",
		wall: "#b6c2d2",
		wallDeep: "#93a3b8",
		wallEdge: "#cdd6e2",
		baseboard: "#9fb0c4",
		wood: "#c9a678",
		woodTop: "#e2c497",
		chair: "#7d8fa8",
		chairSeat: "#9aaec6",
		chairBack: "#b4c4d8",
		monitor: "#5c6b80",
		monitorBezel: "#93a3b8",
		monitorOn: "#f4f8fd",
		screenGlow: "#ffdf9e",
		metal: "#aab8c8",
		table: "#d9b98a",
		tableTop: "#eccf9f",
		rug: "#f3ead9",
		rugRing: "#d9c8a8",
		sofa: "#8fa3bd",
		cushion: "#e8a86b",
		plant: "#57a874",
		plantDark: "#3f855a",
		plantPot: "#c98f5c",
		whiteboard: "#ffffff",
		whiteboardInk: "#8fa0b4",
		windowFrame: "#ffffff",
		windowGlass: "#cfe6fb",
		shaft: "#ffe9b8",
		lightPool: "#fff3d0",
		lampGlow: "#ffdf9e",
		door: "#a8815a",
		label: "#1e293b",
		labelMuted: "#64748b",
		link: "#0284c7",
		bubbleBg: "#ffffff",
		bubbleText: "#26324a",
		accent: "#0284c7",
		accentSoft: "rgba(2, 132, 199, 0.1)",
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
.vo-blink { animation: vo-blink 4.2s ease-in-out infinite; transform-origin: center -1.6px; }
@keyframes vo-blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(.08); } }
`;