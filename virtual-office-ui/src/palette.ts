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
	/* architecture + joinery */
	glass: string;
	glassEdge: string;
	partition: string;
	partitionFrame: string;
	ceiling: string;
	ceilingBeam: string;
	ceilingLight: string;
	reception: string;
	counter: string;
	counterTop: string;
	appliance: string;
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
		floor: "#172033",
		floorGlow: "rgba(255, 190, 120, 0.05)",
		floorEdge: "#0a1220",
		zoneDesk: "#1b2942",
		zoneDeskEdge: "#2a3d5c",
		zoneMeeting: "#182b49",
		zoneMeetingEdge: "#2a4268",
		zoneLounge: "#211c37",
		zoneLoungeEdge: "#352f59",
		corridor: "#141d30",
		grid: "#22304d",
		wall: "#2b3952",
		wallDeep: "#1a2338",
		wallEdge: "#485a7c",
		baseboard: "#3a4a6e",
		wood: "#8f6d48",
		woodTop: "#bd9563",
		chair: "#24314d",
		chairSeat: "#324264",
		chairBack: "#3e5279",
		monitor: "#0c1524",
		monitorBezel: "#18243a",
		monitorOn: "#1d2b45",
		screenGlow: "#ffd9a0",
		metal: "#8fa0b4",
		table: "#8f6d4c",
		tableTop: "#bd9563",
		rug: "#24324e",
		rugRing: "#425b82",
		sofa: "#42567d",
		cushion: "#df9a60",
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
		glass: "rgba(126, 178, 214, 0.18)",
		glassEdge: "rgba(154, 196, 228, 0.58)",
		partition: "#2d3b56",
		partitionFrame: "#6d7f96",
		ceiling: "#151e30",
		ceilingBeam: "#293650",
		ceilingLight: "#ffe6b0",
		reception: "#283852",
		counter: "#31415c",
		counterTop: "#bd9563",
		appliance: "#a3b3c5",
		label: "#e2e8f0",
		labelMuted: "#7d8aa3",
		link: "#38bdf8",
		bubbleBg: "#121c30",
		bubbleText: "#dbe4f0",
		accent: "#38bdf8",
		accentSoft: "rgba(56, 189, 248, 0.16)",
	},
	light: {
		floor: "#e8e0d1",
		floorGlow: "rgba(255, 244, 214, 0.38)",
		floorEdge: "#cfc5b4",
		zoneDesk: "#f6efe1",
		zoneDeskEdge: "#dccfba",
		zoneMeeting: "#e2edf8",
		zoneMeetingEdge: "#c3d6ea",
		zoneLounge: "#efe3d4",
		zoneLoungeEdge: "#d9c7b2",
		corridor: "#ddd5c5",
		grid: "#d2c7b5",
		wall: "#aab8c8",
		wallDeep: "#7f90a6",
		wallEdge: "#c2cedd",
		baseboard: "#8d9fb3",
		wood: "#b8895a",
		woodTop: "#d8b07c",
		chair: "#5c708a",
		chairSeat: "#7d93ad",
		chairBack: "#9fb2c7",
		monitor: "#334155",
		monitorBezel: "#64748b",
		monitorOn: "#f4f8fd",
		screenGlow: "#ffdf9e",
		metal: "#9cabbc",
		table: "#c99e66",
		tableTop: "#e0b97f",
		rug: "#ead7bd",
		rugRing: "#c9a678",
		sofa: "#728ba8",
		cushion: "#d98d56",
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
		glass: "rgba(155, 205, 232, 0.24)",
		glassEdge: "rgba(116, 149, 178, 0.7)",
		partition: "#d8e2ec",
		partitionFrame: "#6b7f96",
		ceiling: "#f7f3ea",
		ceilingBeam: "#d8d0c0",
		ceilingLight: "#fff2d8",
		reception: "#d9ccb8",
		counter: "#b8895a",
		counterTop: "#d8b07c",
		appliance: "#93a3b5",
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

/* Idle motion is decorative; respect the OS preference and keep status
   changes (which are discrete) intact. */
@media (prefers-reduced-motion: reduce) {
  .vo-pulse, .vo-pulse-fast, .vo-ring, .vo-spawn, .vo-link, .vo-bubble,
  .vo-dots circle, .vo-steam, .vo-blink {
    animation: none !important;
  }
}
`;