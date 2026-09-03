/**
 * 2D furniture — every piece of office dressing as a small SVG component.
 * Units are floor coordinates (160x100 space); each component centers on its
 * anchor. Furniture casts a soft ellipse shadow for depth.
 */

import { STATUS_COLORS, type Palette } from "./palette.ts";

function Shadow({ w, y = 0, opacity = 0.22 }: { w: number; y?: number; opacity?: number }) {
	return <ellipse cx={0} cy={y + 0.6} rx={w / 2} ry={w / 6} fill="#000" opacity={opacity} />;
}

/** Desk with legs, keyboard, and a monitor whose screen glows while in use. */
export function Desk({
	x,
	y,
	theme,
	on = false,
	flip = false,
}: {
	x: number;
	y: number;
	theme: Palette;
	on?: boolean;
	flip?: boolean;
}) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={19} y={9} />
			<rect x={-9.5} y={-4.4} width={19} height={8.8} rx={1.2} fill={theme.wood} />
			<rect x={-9} y={-4.4} width={18} height={2} rx={1} fill={theme.woodTop} />
			{/* legs */}
			<rect x={-8} y={4.4} width={1.4} height={3} fill={theme.chair} />
			<rect x={6.6} y={4.4} width={1.4} height={3} fill={theme.chair} />
			{/* monitor */}
			<g transform={`translate(0, -4.4)`}>
				<rect x={-4.6} y={-5} width={9.2} height={5.6} rx={0.8} fill={theme.monitorBezel} />
				<rect x={-3.9} y={-4.35} width={7.8} height={4.3} rx={0.5} fill={on ? theme.accent : theme.monitorOn} opacity={on ? 0.5 : 0.85} />
				{on && <rect x={-3.9} y={-4.35} width={7.8} height={4.3} rx={0.5} fill={theme.monitorOn} opacity={0.45} />}
				<rect x={-0.7} y={0.6} width={1.4} height={1.6} fill={theme.monitorBezel} />
				<rect x={-2.2} y={2.2} width={4.4} height={0.8} rx={0.4} fill={theme.monitorBezel} />
				{/* keyboard */}
				<rect x={-3.4} y={-0.2} width={6.8} height={1.6} rx={0.5} fill={theme.metal} opacity={0.55} />
			</g>
			{/* mug on the free end */}
			<circle cx={flip ? -6.2 : 6.2} cy={-2.6} r={0.9} fill={theme.chairSeat} />
			<circle cx={flip ? -6.2 : 6.2} cy={-2.6} r={0.55} fill={theme.monitorOn} />
		</g>
	);
}

/** Task chair; `angle` in degrees points the backrest away from the desk. */
export function Chair({
	x,
	y,
	theme,
	angle = 0,
}: {
	x: number;
	y: number;
	theme: Palette;
	angle?: number;
}) {
	return (
		<g transform={`translate(${x}, ${y}) rotate(${angle})`}>
			<Shadow w={5.4} y={0.8} opacity={0.16} />
			<ellipse cx={0} cy={0} rx={2.9} ry={2.2} fill={theme.chairSeat} />
			<path d={`M -2.8 -0.4 A 3 3 0 0 1 2.8 -0.4 L 2.4 1.6 A 2.6 2.6 0 0 1 -2.4 1.6 Z`} fill={theme.chair} />
		</g>
	);
}

/** Round meeting table; `active` glows while a session runs there. */
export function MeetingTable({
	x,
	y,
	theme,
	active = false,
}: {
	x: number;
	y: number;
	theme: Palette;
	active?: boolean;
}) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			{active && (
				<circle r={10.5} fill="none" stroke={theme.accent} strokeWidth={0.7} opacity={0.65} className="vo-pulse" />
			)}
			<Shadow w={16} opacity={0.2} />
			<circle r={7.2} fill={theme.table} />
			<circle r={7.2} fill="none" stroke={theme.woodTop} strokeWidth={0.8} />
			<circle r={4.4} fill={theme.rugRing} opacity={0.45} />
		</g>
	);
}

/** Sofa with two cushions and armrests. */
export function Sofa({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={20} opacity={0.2} />
			<rect x={-9.5} y={-3.4} width={19} height={6.2} rx={2.2} fill={theme.sofa} />
			<rect x={-9.5} y={-5.6} width={19} height={3.4} rx={1.6} fill={theme.chairSeat} />
			<rect x={-10.6} y={-4.4} width={2.2} height={6} rx={1} fill={theme.chair} />
			<rect x={8.4} y={-4.4} width={2.2} height={6} rx={1} fill={theme.chair} />
			<line x1={0} y1={-5.2} x2={0} y2={2.6} stroke={theme.chair} strokeWidth={0.5} />
		</g>
	);
}

/** Potted plant, three sizes. */
export function Plant({
	x,
	y,
	theme,
	size = 1,
}: {
	x: number;
	y: number;
	theme: Palette;
	size?: number;
}) {
	return (
		<g transform={`translate(${x}, ${y}) scale(${size})`}>
			<Shadow w={5.6} y={3.6} opacity={0.18} />
			<circle cx={-1.6} cy={-3.4} r={2.2} fill={theme.plantDark} />
			<circle cx={1.7} cy={-3.8} r={1.9} fill={theme.plantDark} />
			<circle cx={0} cy={-4.8} r={2.5} fill={theme.plant} />
			<circle cx={0.4} cy={-2.6} r={1.6} fill={theme.plant} />
			<rect x={-2.2} y={0} width={4.4} height={3.6} rx={0.7} fill={theme.plantPot} />
			<rect x={-2.2} y={0} width={4.4} height={1} rx={0.5} fill={theme.woodTop} opacity={0.5} />
		</g>
	);
}

/** Wall-mounted coffee machine with animated steam. */
export function CoffeeMachine({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<rect x={-3} y={0} width={6} height={5.4} rx={0.9} fill={theme.metal} />
			<rect x={-3} y={0} width={6} height={1.2} rx={0.45} fill={theme.wallEdge} />
			<rect x={-1.7} y={1.5} width={3.4} height={1.9} rx={0.4} fill={theme.monitorOn} />
			<circle cx={2} cy={3.9} r={0.5} fill={STATUS_COLORS.idle} opacity={0.85} />
			<g className="vo-steam" opacity={0}>
				<circle cx={0} cy={-0.8} r={0.55} fill={theme.labelMuted} />
			</g>
			<g className="vo-steam" opacity={0} style={{ animationDelay: "1.2s" }}>
				<circle cx={0.7} cy={-0.8} r={0.42} fill={theme.labelMuted} />
			</g>
		</g>
	);
}

/** Whiteboard with scribbles — sits in the meeting area. */
export function Whiteboard({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<rect x={-7.5} y={-0.4} width={15} height={8} rx={0.8} fill={theme.whiteboard} stroke={theme.metal} strokeWidth={0.6} />
			<line x1={-5} y1={2.4} x2={3} y2={2.4} stroke={theme.whiteboardInk} strokeWidth={0.5} />
			<line x1={-5} y1={4} x2={5} y2={4} stroke={theme.whiteboardInk} strokeWidth={0.5} opacity={0.7} />
			<line x1={-5} y1={5.6} x2={0.5} y2={5.6} stroke={theme.whiteboardInk} strokeWidth={0.5} opacity={0.5} />
			<circle cx={5.6} cy={2.4} r={0.7} fill="none" stroke={theme.whiteboardInk} strokeWidth={0.4} />
		</g>
	);
}

/** Bookshelf against a wall. */
export function Bookshelf({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={7} y={15} opacity={0.16} />
			<rect x={-3.2} y={0} width={6.4} height={15} rx={0.8} fill={theme.wood} />
			<line x1={-3.2} y1={5} x2={3.2} y2={5} stroke={theme.woodTop} strokeWidth={0.6} />
			<line x1={-3.2} y1={10} x2={3.2} y2={10} stroke={theme.woodTop} strokeWidth={0.6} />
			{[0, 1, 2].map((row) =>
				[-2.4, -1.4, -0.4, 0.9, 1.9].map((dx, i) => (
					<rect
						key={`${row}-${i}`}
						x={dx}
						y={0.8 + row * 5}
						width={0.85}
						height={3.4}
						fill={theme.plant}
						opacity={0.55 + ((i + row) % 3) * 0.15}
					/>
				)),
			)}
		</g>
	);
}

/** Wall clock. */
export function WallClock({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<circle r={2.4} fill={theme.whiteboard} stroke={theme.metal} strokeWidth={0.6} />
			<line x1={0} y1={0} x2={0} y2={-1.5} stroke={theme.label} strokeWidth={0.45} strokeLinecap="round" />
			<line x1={0} y1={0} x2={1.1} y2={0.4} stroke={theme.label} strokeWidth={0.45} strokeLinecap="round" opacity={0.7} />
		</g>
	);
}