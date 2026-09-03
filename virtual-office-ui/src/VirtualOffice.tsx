/**
 * The virtual office floor — 2D scene.
 *
 * Zones with distinct floor treatments (planked desk area, carpeted meeting
 * pods, lounge rug, tiled corridor), dressed furniture with shadows, curved
 * collaboration links with glow and flowing dashes, and walk-animated
 * coworker avatars with status rings, thinking dots, tool chips, and speech
 * bubbles. Pure derivation from the feed; motion lives in the store's rAF.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CoworkerAvatar } from "./avatar.tsx";
import { Bookshelf, Chair, CoffeeMachine, Desk, MeetingTable, Plant, Sofa, WallClock, Whiteboard } from "./furniture2d.tsx";
import { CORRIDOR_ENTRANCE, DESK_SLOTS, MEETING_TABLES, SEATS_PER_TABLE, meetingSeat } from "./geometry.ts";
import { SCENE_STYLES, THEMES, type Palette } from "./palette.ts";
import { createFloorStore, useFloor } from "./store.ts";
import type { VirtualOfficeProps } from "./types.ts";

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
	const words = text.replace(/\s+/g, " ").trim().split(" ");
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (next.length > maxChars && line) {
			lines.push(line);
			line = word;
			if (lines.length === maxLines) break;
		} else {
			line = next;
		}
	}
	if (lines.length < maxLines && line) lines.push(line);
	const flat = text.replace(/\s+/g, " ").trim();
	if (lines.length === maxLines && lines.join(" ").length < flat.length) {
		const last = lines[maxLines - 1] ?? "";
		lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
	}
	return lines;
}

function SpeechBubbleTag({ text, color, theme }: { text: string; color: string; theme: Palette }) {
	const lines = wrapText(text, 34, 3);
	const width = Math.min(64, Math.max(26, ...lines.map((line) => line.length * 2.1 + 6)));
	const height = lines.length * 4.4 + 4.5;
	return (
		<g className="vo-bubble" transform="translate(0, -21)">
			<path
				d={`M -1.4 ${height / 2 - 0.2} L 0 ${height / 2 + 3.2} L 1.4 ${height / 2 - 0.2} Z`}
				fill={theme.bubbleBg}
				stroke={color}
				strokeWidth={0.6}
			/>
			<rect
				x={-width / 2}
				y={-height / 2}
				width={width}
				height={height}
				rx={3}
				fill={theme.bubbleBg}
				stroke={color}
				strokeWidth={0.7}
				opacity={0.97}
			/>
			<rect x={-width / 2} y={-height / 2} width={2} height={height} rx={1} fill={color} opacity={0.8} />
			{lines.map((line, i) => (
				<text
					key={`${i}-${line.slice(0, 6)}`}
					x={-width / 2 + 4}
					y={-height / 2 + 4.6 + i * 4.4}
					fontSize={3.6}
					fill={theme.bubbleText}
					fontFamily="system-ui, sans-serif"
				>
					{line}
				</text>
			))}
		</g>
	);
}

/** Curved collaboration link: quadratic bezier with a perpendicular offset,
 *  a soft glow underlayer, and a flowing dash. Strength fades with age. */
function Link({
	x1,
	y1,
	x2,
	y2,
	strength,
	theme,
}: {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	strength: number;
	theme: Palette;
}) {
	const midX = (x1 + x2) / 2;
	const midY = (y1 + y2) / 2;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const dist = Math.max(1, Math.hypot(dx, dy));
	const offset = Math.min(dist * 0.2, 14);
	const cx = midX - (dy / dist) * offset;
	const cy = midY + (dx / dist) * offset;
	const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
	const width = strength >= 0.6 ? 1.1 : 0.65;
	const opacity = Math.max(0.16, strength * 0.8);
	return (
		<g>
			<path d={d} fill="none" stroke={theme.link} strokeWidth={width + 2} opacity={strength * 0.14} style={{ filter: "blur(2px)" }} />
			<path
				d={d}
				fill="none"
				stroke={theme.link}
				strokeWidth={width}
				opacity={opacity}
				className="vo-link"
				strokeLinecap="round"
			/>
			<circle cx={x1} cy={y1} r={1.1} fill={theme.link} opacity={opacity * 0.7} />
			<circle cx={x2} cy={y2} r={1.1} fill={theme.link} opacity={opacity * 0.7} />
		</g>
	);
}

export function VirtualOffice({ feed, theme: themeName = "dark", className, style }: VirtualOfficeProps) {
	const storeRef = useRef<ReturnType<typeof createFloorStore> | null>(null);
	if (storeRef.current === null) {
		storeRef.current = createFloorStore();
	}
	const floor = useFloor(storeRef.current);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		storeRef.current?.getState().applyFeed(feed);
	}, [feed]);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	const byId = useMemo(() => new Map(floor.coworkers.map((c) => [c.id, c])), [floor.coworkers]);
	const theme = THEMES[themeName];
	const roomLabel = feed.roomRunning ? feed.roomName : undefined;
	const activeTable = feed.roomRunning ? Math.floor((feed.roomMembers.length - 1) / 3) % MEETING_TABLES.length : -1;

	return (
		<svg viewBox="0 0 160 100" className={className} style={style} role="img" aria-label="Virtual office floor">
			<defs>
				{/* desk-zone planks */}
				<pattern id="vo-planks" width="12" height="5" patternUnits="userSpaceOnUse">
					<rect width="12" height="5" fill={theme.zoneDesk} />
					<line x1="0" y1="0" x2="12" y2="0" stroke={theme.grid} strokeWidth="0.3" opacity="0.5" />
					<line x1="6" y1="0" x2="6" y2="5" stroke={theme.grid} strokeWidth="0.25" opacity="0.3" />
				</pattern>
				{/* meeting-zone carpet */}
				<pattern id="vo-carpet" width="4" height="4" patternUnits="userSpaceOnUse">
					<rect width="4" height="4" fill={theme.zoneMeeting} />
					<circle cx="2" cy="2" r="0.35" fill={theme.grid} />
				</pattern>
				{/* corridor tiles */}
				<pattern id="vo-tiles" width="5" height="5" patternUnits="userSpaceOnUse">
					<rect width="5" height="5" fill={theme.corridor} />
					<rect x="0.4" y="0.4" width="4.2" height="4.2" fill="none" stroke={theme.grid} strokeWidth="0.25" opacity="0.6" />
				</pattern>
				{/* lounge rug weave */}
				<pattern id="vo-weave" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
					<rect width="3.2" height="3.2" fill={theme.zoneLounge} />
					<line x1="0" y1="0" x2="0" y2="3.2" stroke={theme.grid} strokeWidth="0.3" opacity="0.5" />
				</pattern>
				<filter id="vo-soft" x="-20%" y="-20%" width="140%" height="140%">
					<feGaussianBlur stdDeviation="0.5" />
				</filter>
			</defs>

			<style>{SCENE_STYLES}</style>

			{/* building shell */}
			<rect x={0} y={0} width={160} height={100} fill={theme.wall} />
			<rect x={1.6} y={1.6} width={156.8} height={96.8} rx={2.5} fill={theme.floor} stroke={theme.wallEdge} strokeWidth={0.5} />

			{/* zone floors */}
			<rect x={9} y={8} width={72} height={68} fill="url(#vo-planks)" />
			<rect x={9} y={8} width={72} height={68} fill="none" stroke={theme.rugRing} strokeWidth={0.35} opacity={0.5} rx={1.5} />
			<rect x={88} y={6} width={66} height={58} fill="url(#vo-carpet)" rx={2} />
			<rect x={90} y={66} width={64} height={28} fill="url(#vo-weave)" rx={2} />
			<rect x={6} y={80} width={22} height={15} fill="url(#vo-tiles)" rx={1} />

			{/* zone labels */}
			<text x={12} y={12.6} fontSize={2.8} fontWeight={700} letterSpacing={0.6} fill={theme.labelMuted} fontFamily="system-ui, sans-serif">
				WORKSTATIONS
			</text>
			<text x={148} y={62.4} textAnchor="end" fontSize={2.8} fontWeight={700} letterSpacing={0.6} fill={theme.labelMuted} fontFamily="system-ui, sans-serif">
				MEETING PODS
			</text>
			<text x={152} y={69.4} textAnchor="end" fontSize={2.8} fontWeight={700} letterSpacing={0.6} fill={theme.labelMuted} fontFamily="system-ui, sans-serif">
				LOUNGE
			</text>
			<text x={17} y={93.4} textAnchor="middle" fontSize={2.6} fill={theme.labelMuted} fontFamily="system-ui, sans-serif">
				entrance
			</text>

			{/* wall dressing */}
			<WallClock x={64} y={13.5} theme={theme} />
			<Whiteboard x={120} y={12} theme={theme} />

			{/* desks + chairs (empty slots stay made-up) */}
			{DESK_SLOTS.map((slot, i) => {
				const owner = floor.coworkers.find((c) => c.deskIndex === i);
				const working = owner?.status === "tool_calling" || owner?.status === "thinking";
				const flip = slot.x > 53;
				return (
					<g key={`desk-${i}`}>
						<Chair x={slot.x} y={slot.y - 4.6} theme={theme} angle={flip ? 180 : 0} />
						<Desk x={slot.x} y={slot.y + 6.4} theme={theme} on={working} flip={flip} />
					</g>
				);
			})}

			{/* meeting pods */}
			{MEETING_TABLES.map((table, i) => (
				<g key={`table-${i}`}>
					{Array.from({ length: SEATS_PER_TABLE }, (_, seat) => {
						const pos = meetingSeat(i, seat);
						const angle = (Math.atan2(table.y - pos.y, table.x - pos.x) * 180) / Math.PI;
						return <Chair key={seat} x={pos.x} y={pos.y} theme={theme} angle={angle} />;
					})}
					<MeetingTable x={table.x} y={table.y} theme={theme} active={i === activeTable && feed.roomRunning} />
				</g>
			))}

			{/* lounge */}
			<Sofa x={122} y={84} theme={theme} />
			<Plant x={100} y={88} theme={theme} size={1.25} />
			<Plant x={148} y={90} theme={theme} size={1.1} />

			{/* plants + coffee + shelf */}
			<Plant x={12} y={13} theme={theme} />
			<Plant x={78} y={12.5} theme={theme} size={0.85} />
			<Plant x={88} y={60} theme={theme} />
			<Plant x={150} y={10} theme={theme} size={0.85} />
			<CoffeeMachine x={86} y={8} theme={theme} />
			<Bookshelf x={150} y={44} theme={theme} />

			{/* collaboration links */}
			{floor.links.map((link) => {
				const a = byId.get(link.a);
				const b = byId.get(link.b);
				if (!a || !b) return null;
				const age = Math.max(0, now - link.born);
				const strength = Math.max(0.15, 1 - age / 90_000);
				return (
					<Link
						key={`${link.a}\u0000${link.b}`}
						x1={a.pos.x}
						y1={a.pos.y}
						x2={b.pos.x}
						y2={b.pos.y}
						strength={strength}
						theme={theme}
					/>
				);
			})}

			{/* coworkers */}
			{floor.coworkers.map((visual) => (
				<g key={visual.id} transform={`translate(${visual.pos.x}, ${visual.pos.y})`}>
					<CoworkerAvatar visual={visual} now={now} theme={theme} />
					{visual.bubble && visual.bubble.until > now && (
						<SpeechBubbleTag text={visual.bubble.text} color={visual.color} theme={theme} />
					)}
				</g>
			))}

			{/* room banner */}
			{roomLabel && (
				<g>
					<rect
						x={49}
						y={0.9}
						width={62}
						height={6.6}
						rx={3.3}
						fill={theme.bubbleBg}
						opacity={0.96}
						stroke={theme.accent}
						strokeWidth={0.5}
					/>
					<circle cx={54.5} cy={4} r={1.3} fill={THEMES[themeName].labelMuted} className="vo-pulse" />
					<circle cx={54.5} cy={4} r={1.3} fill="#22c55e" />
					<text
						x={57}
						y={5.3}
						fontSize={3.6}
						fill={theme.bubbleText}
						fontFamily="system-ui, sans-serif"
						fontWeight={600}
					>
						{roomLabel} in session
					</text>
				</g>
			)}

			<circle cx={CORRIDOR_ENTRANCE.x} cy={CORRIDOR_ENTRANCE.y} r={0.8} fill={theme.labelMuted} opacity={0.6} />
		</svg>
	);
}