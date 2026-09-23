/**
 * 2D furniture — every piece of office dressing as a small SVG component.
 * Units are floor coordinates (160x100 space); each component centers on its
 * anchor. Every piece casts a soft contact shadow; materials are two-tone
 * (surface + edge highlight) so flat fills read as objects.
 */

import { STATUS_COLORS, type Palette } from "./palette.ts";

function Shadow({ w, y = 0, opacity = 0.2 }: { w: number; y?: number; opacity?: number }) {
	return <ellipse cx={0} cy={y + 0.6} rx={w / 2} ry={w / 6.5} fill="#000" opacity={opacity} />;
}

/** Desk: two-tone wood top, monitor with a neck + glowing screen (with code
 *  lines while in use), keyboard + mouse, mug with steam, desk pad. */
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
	const mugX = flip ? -6.6 : 6.6;
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={20} y={9.2} />
			{/* legs */}
			<rect x={-8.4} y={4.2} width={1.3} height={4.4} rx={0.5} fill={theme.wood} />
			<rect x={7.1} y={4.2} width={1.3} height={4.4} rx={0.5} fill={theme.wood} />
			<rect x={-8.4} y={7.9} width={17.1} height={0.7} rx={0.35} fill={theme.wood} opacity={0.7} />
			{/* top: slab + edge highlight */}
			<rect x={-9.8} y={-4.6} width={19.6} height={8.8} rx={1.6} fill={theme.wood} />
			<rect x={-9.2} y={-4.6} width={18.4} height={2.2} rx={1.1} fill={theme.woodTop} />
			<rect x={-9.2} y={-2.7} width={18.4} height={0.5} rx={0.25} fill="#000" opacity={0.14} />
			{/* desk mat under keyboard */}
			<rect x={-5.2} y={-1.4} width={10.4} height={5.2} rx={1} fill={theme.chairSeat} opacity={0.45} />
			{/* monitor */}
			<g transform={`translate(0, -4.6)`}>
				{/* screen glow wash on the desk while working */}
				{on && <ellipse cx={0} cy={7.2} rx={7.5} ry={2.2} fill={theme.screenGlow} opacity={0.14} />}
				<rect x={-4.8} y={-5.2} width={9.6} height={6} rx={1.1} fill={theme.monitorBezel} />
				<rect x={-4.1} y={-4.55} width={8.2} height={4.7} rx={0.6} fill={theme.monitor} />
				<rect x={-3.6} y={-4.05} width={7.2} height={3.7} rx={0.4} fill={on ? theme.accent : theme.monitorOn} opacity={on ? 0.72 : 0.85} />
				{on ? (
					<g fill={theme.bubbleBg} opacity={0.85}>
						<rect x={-2.9} y={-3.5} width={4.6} height={0.75} rx={0.35} opacity={0.9} />
						<rect x={-2.9} y={-2.3} width={3.1} height={0.75} rx={0.35} opacity={0.6} />
						<rect x={-1.6} y={-1.1} width={4.1} height={0.75} rx={0.35} opacity={0.75} />
						<rect x={-2.9} y={0.1} width={2.2} height={0.75} rx={0.35} opacity={0.45} />
					</g>
				) : (
					<rect x={-3.6} y={-4.55} width={7.2} height={1.1} rx={0.4} fill={theme.wallEdge} opacity={0.16} />
				)}
				{/* neck + stand */}
				<rect x={-0.7} y={0.8} width={1.4} height={1.5} rx={0.4} fill={theme.monitorBezel} />
				<rect x={-2.4} y={2.3} width={4.8} height={0.9} rx={0.45} fill={theme.monitorBezel} />
				{/* keyboard + mouse */}
				<rect x={-3.4} y={3.6} width={6.4} height={1.7} rx={0.7} fill={theme.metal} opacity={0.75} />
				<line x1={-2.6} y1={4.45} x2={2.2} y2={4.45} stroke={theme.monitorBezel} strokeWidth={0.35} opacity={0.7} />
				<circle cx={4.3} cy={4.45} r={0.75} fill={theme.metal} opacity={0.75} />
			</g>
			{/* mug with steam */}
			<g>
				<g className="vo-steam" opacity={0}>
					<circle cx={mugX} cy={-8.2} r={0.5} fill={theme.labelMuted} />
				</g>
				<g className="vo-steam" opacity={0} style={{ animationDelay: "1.2s" }}>
					<circle cx={mugX + 0.5} cy={-8.2} r={0.38} fill={theme.labelMuted} />
				</g>
				<circle cx={mugX} cy={-2.9} r={1.05} fill={theme.chairBack} />
				<circle cx={mugX} cy={-2.9} r={0.62} fill={theme.screenGlow} opacity={0.5} />
				<path d={`M ${mugX + 1.05} -3.4 a 0.75 0.75 0 0 1 0 1.2`} fill="none" stroke={theme.chairBack} strokeWidth={0.4} />
			</g>
		</g>
	);
}

/** Task chair with a backrest, gas lift, and a five-star base. */
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
			<Shadow w={6.2} y={1.2} opacity={0.15} />
			{/* five-star base */}
			<circle cx={0} cy={1.9} r={1.9} fill={theme.chair} opacity={0.55} />
			<line x1={0} y1={1.9} x2={-1.9} y2={2.6} stroke={theme.chair} strokeWidth={0.5} />
			<line x1={0} y1={1.9} x2={1.9} y2={2.6} stroke={theme.chair} strokeWidth={0.5} />
			<line x1={0} y1={1.9} x2={-1.7} y2={1} stroke={theme.chair} strokeWidth={0.5} />
			<line x1={0} y1={1.9} x2={1.7} y2={1} stroke={theme.chair} strokeWidth={0.5} />
			{/* gas lift */}
			<rect x={-0.35} y={0.2} width={0.7} height={1.9} fill={theme.metal} opacity={0.8} />
			{/* seat + backrest */}
			<ellipse cx={0} cy={-0.3} rx={3} ry={2.1} fill={theme.chairSeat} />
			<ellipse cx={0} cy={-0.75} rx={2.5} ry={1.5} fill={theme.chairBack} opacity={0.75} />
			<path d={`M -2.9 -0.6 A 3.1 3.1 0 0 1 2.9 -0.6 L 2.5 1.5 A 2.7 2.7 0 0 1 -2.5 1.5 Z`} fill={theme.chair} />
			<path d={`M -2.4 -1.2 A 2.6 2.6 0 0 1 2.4 -1.2 L 2.15 0.6 A 2.3 2.3 0 0 1 -2.15 0.6 Z`} fill={theme.chairBack} />
		</g>
	);
}

/** Round meeting table on a pedestal; `active` adds a glow ring, hanging
 *  pendant light, and open laptops for the session. */
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
			{active && <ellipse cx={0} cy={0} rx={12.5} ry={12.5} fill={theme.lightPool} opacity={0.1} />}
			<Shadow w={16.5} opacity={0.22} />
			{/* rug disc */}
			<circle r={10.6} fill={theme.rug} />
			<circle r={10.6} fill="none" stroke={theme.rugRing} strokeWidth={0.5} strokeDasharray="1.6 1.2" opacity={0.8} />
			{/* pedestal + top */}
			<circle r={3.2} cy={2.4} fill={theme.rugRing} opacity={0.5} />
			<circle r={7.4} fill={theme.table} />
			<circle r={7.4} cy={-0.5} fill={theme.tableTop} />
			<circle r={7.4} cy={-0.5} fill="none" stroke={theme.wood} strokeWidth={0.6} opacity={0.8} />
			<circle r={4.6} cy={-0.5} fill={theme.rugRing} opacity={0.28} />
			{active && (
				<>
					<circle r={9.6} fill="none" stroke={theme.accent} strokeWidth={0.6} opacity={0.55} className="vo-pulse" />
					{/* open laptops */}
					{[-90, 30, 150].map((deg) => {
						const rad = (deg * Math.PI) / 180;
						const lx = Math.cos(rad) * 4.9;
						const ly = Math.sin(rad) * 4.9;
						return (
							<g key={deg} transform={`translate(${lx.toFixed(2)}, ${(ly - 0.5).toFixed(2)}) rotate(${deg + 90})`}>
								<rect x={-1.5} y={-1} width={3} height={2} rx={0.4} fill={theme.monitorBezel} />
								<rect x={-1.2} y={-0.8} width={2.4} height={1.15} rx={0.25} fill={theme.screenGlow} opacity={0.8} />
							</g>
						);
					})}
				</>
			)}
		</g>
	);
}

/** Sofa: frame, seat + back cushions, throw pillows, wooden feet. */
export function Sofa({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={21} y={3.4} opacity={0.22} />
			{/* feet */}
			<rect x={-9.4} y={2.6} width={1.4} height={1.4} rx={0.4} fill={theme.wood} />
			<rect x={8} y={2.6} width={1.4} height={1.4} rx={0.4} fill={theme.wood} />
			{/* back + arms */}
			<rect x={-10.2} y={-5.9} width={20.4} height={4} rx={1.8} fill={theme.chair} />
			<rect x={-10.9} y={-4.7} width={2.4} height={7.2} rx={1.1} fill={theme.chair} />
			<rect x={8.5} y={-4.7} width={2.4} height={7.2} rx={1.1} fill={theme.chair} />
			{/* seat */}
			<rect x={-9.9} y={-2.4} width={19.8} height={5} rx={1.8} fill={theme.sofa} />
			<line x1={-3.3} y1={-2.4} x2={-3.3} y2={2.6} stroke={theme.chair} strokeWidth={0.55} />
			<line x1={3.3} y1={-2.4} x2={3.3} y2={2.6} stroke={theme.chair} strokeWidth={0.55} />
			<rect x={-9.9} y={-2.4} width={19.8} height={1.1} rx={0.55} fill={theme.chairBack} opacity={0.5} />
			{/* throw pillows */}
			<rect x={-8.6} y={-4.5} width={3.4} height={3.4} rx={1.1} fill={theme.cushion} transform="rotate(-8 -6.9 -2.8)" />
			<rect x={5.2} y={-4.5} width={3.4} height={3.4} rx={1.1} fill={theme.chairBack} transform="rotate(7 6.9 -2.8)" />
		</g>
	);
}

/** Coffee table for the lounge: tray top with a mug + a book. */
export function CoffeeTable({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={9} opacity={0.18} />
			<ellipse cx={0} cy={1.6} rx={2.4} ry={0.8} fill={theme.wood} />
			<ellipse cx={0} cy={1.6} rx={2.4} ry={0.8} fill={theme.wood} />
			<ellipse cx={0} cy={0} rx={4.4} ry={2.6} fill={theme.table} />
			<ellipse cx={0} cy={-0.5} rx={4.4} ry={2.6} fill={theme.tableTop} />
			<ellipse cx={0} cy={-0.5} rx={4.4} ry={2.6} fill="none" stroke={theme.wood} strokeWidth={0.4} opacity={0.7} />
			<circle cx={-1.5} cy={-0.9} r={0.8} fill={theme.chairBack} />
			<circle cx={-1.5} cy={-0.9} r={0.45} fill={theme.screenGlow} opacity={0.55} />
			<rect x={0.6} y={-1.3} width={2.6} height={1.5} rx={0.3} fill={theme.chair} transform="rotate(-6 1.6 -0.55)" />
		</g>
	);
}

/** Round area rug with a stitched border. */
export function Rug({ x, y, theme, r = 9 }: { x: number; y: number; theme: Palette; r?: number }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<ellipse cx={0} cy={0.4} rx={r} ry={r * 0.86} fill={theme.rug} opacity={0.9} />
			<ellipse cx={0} cy={0.4} rx={r - 1.4} ry={(r - 1.4) * 0.86} fill="none" stroke={theme.rugRing} strokeWidth={0.5} strokeDasharray="1.4 1.1" opacity={0.75} />
			<ellipse cx={0} cy={0.4} rx={r * 0.55} ry={r * 0.47} fill={theme.rugRing} opacity={0.18} />
		</g>
	);
}

/** Potted plant — one of three leaf clusters, sized by `variant`. */
export function Plant({
	x,
	y,
	theme,
	size = 1,
	variant = 0,
}: {
	x: number;
	y: number;
	theme: Palette;
	size?: number;
	variant?: 0 | 1 | 2;
}) {
	const leaves =
		variant === 1 ? (
			<g>
				<path d="M 0 -3.2 C -2.8 -4.4 -4.6 -7 -4.2 -9.6 C -1.8 -8.6 -0.4 -6.4 0 -3.2 Z" fill={theme.plantDark} />
				<path d="M 0 -3.2 C 2.8 -4.6 4.4 -7.2 4 -9.8 C 2 -8.8 0.4 -6.4 0 -3.2 Z" fill={theme.plant} />
				<path d="M 0 -3.4 C -0.6 -6.4 -0.2 -9.6 1.6 -11.6 C 2.6 -9.2 2.2 -6 0 -3.2 Z" fill={theme.plant} />
			</g>
		) : variant === 2 ? (
			<g>
				<circle cx={-1.9} cy={-3.6} r={2.3} fill={theme.plantDark} />
				<circle cx={2} cy={-4} r={2} fill={theme.plantDark} />
				<circle cx={0} cy={-5.4} r={2.7} fill={theme.plant} />
				<circle cx={0.4} cy={-2.8} r={1.7} fill={theme.plant} />
				<circle cx={-0.6} cy={-7.2} r={1.2} fill={theme.plant} opacity={0.85} />
			</g>
		) : (
			<g>
				<circle cx={-1.6} cy={-3.4} r={2.2} fill={theme.plantDark} />
				<circle cx={1.7} cy={-3.8} r={1.9} fill={theme.plantDark} />
				<circle cx={0} cy={-4.8} r={2.5} fill={theme.plant} />
				<circle cx={0.4} cy={-2.6} r={1.6} fill={theme.plant} />
				<circle cx={-0.2} cy={-6.9} r={1.3} fill={theme.plant} opacity={0.9} />
			</g>
		);
	return (
		<g transform={`translate(${x}, ${y}) scale(${size})`}>
			<Shadow w={5.8} y={3.6} opacity={0.18} />
			{leaves}
			{/* pot with rim */}
			<path d="M -2.3 0 L 2.3 0 L 1.7 3.7 L -1.7 3.7 Z" fill={theme.plantPot} />
			<rect x={-2.5} y={-0.5} width={5} height={1.1} rx={0.5} fill={theme.woodTop} opacity={0.85} />
		</g>
	);
}

/** Floor lamp with a warm pool of light. */
export function FloorLamp({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<ellipse cx={0} cy={-2.4} rx={7.5} ry={7} fill={theme.lampGlow} opacity={0.12} />
			<Shadow w={4} y={4.2} opacity={0.16} />
			<ellipse cx={0} cy={3.9} rx={2.2} ry={0.8} fill={theme.chair} />
			<rect x={-0.4} y={-6.4} width={0.8} height={10.4} fill={theme.metal} opacity={0.8} />
			<path d="M -2.6 -7.4 A 2.6 2.2 0 0 1 2.6 -7.4 L 2 -5.6 L -2 -5.6 Z" fill={theme.screenGlow} />
			<ellipse cx={0} cy={-5.7} rx={2.5} ry={0.7} fill={theme.lampGlow} opacity={0.9} />
		</g>
	);
}

/** Coffee bar: counter, machine with steam, stacked cups. */
export function CoffeeMachine({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={13} y={7.4} opacity={0.18} />
			{/* counter */}
			<rect x={-7.5} y={1.4} width={15} height={6.2} rx={1.1} fill={theme.wood} />
			<rect x={-7.1} y={0.2} width={14.2} height={1.8} rx={0.8} fill={theme.woodTop} />
			<rect x={-7.5} y={4.4} width={15} height={0.7} fill="#000" opacity={0.12} />
			{/* machine */}
			<rect x={-4.6} y={-4.6} width={5.6} height={4.9} rx={1} fill={theme.metal} />
			<rect x={-4.2} y={-4.2} width={4.8} height={1.5} rx={0.6} fill={theme.wallDeep} />
			<rect x={-3.2} y={-1.9} width={2.8} height={1.6} rx={0.4} fill={theme.monitor} />
			<rect x={-2.6} y={-0.5} width={1.6} height={0.8} rx={0.2} fill={theme.screenGlow} opacity={0.8} />
			<circle cx={3.1} cy={-1.1} r={0.45} fill={STATUS_COLORS.idle} opacity={0.9} />
			{/* steam */}
			<g className="vo-steam" opacity={0}>
				<circle cx={-1.4} cy={-5.4} r={0.55} fill={theme.labelMuted} />
			</g>
			<g className="vo-steam" opacity={0} style={{ animationDelay: "1.2s" }}>
				<circle cx={-0.7} cy={-5.4} r={0.4} fill={theme.labelMuted} />
			</g>
			{/* cups stack */}
			<rect x={4.2} y={-0.9} width={2.2} height={1.1} rx={0.4} fill={theme.chairSeat} />
			<rect x={4.5} y={-1.8} width={1.7} height={1} rx={0.35} fill={theme.chairSeat} opacity={0.85} />
		</g>
	);
}

/** Whiteboard with a sprint chart sketch — hangs in the meeting area. */
export function Whiteboard({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<rect x={-8.4} y={-0.9} width={16.8} height={9.6} rx={1.1} fill={theme.metal} opacity={0.85} />
			<rect x={-7.7} y={-0.2} width={15.4} height={8} rx={0.6} fill={theme.whiteboard} />
			{/* tray + markers */}
			<rect x={-6.4} y={8.1} width={12.8} height={0.9} rx={0.4} fill={theme.metal} opacity={0.7} />
			<rect x={-5.4} y={7.4} width={1.5} height={0.8} rx={0.3} fill={STATUS_COLORS.tool_calling} opacity={0.8} />
			<rect x={-3.4} y={7.4} width={1.5} height={0.8} rx={0.3} fill={STATUS_COLORS.thinking} opacity={0.8} />
			{/* sketch: rising bars + trend line + note */}
			<g stroke={theme.whiteboardInk} strokeWidth={0.55} strokeLinecap="round">
				<line x1={-5.6} y1={6.2} x2={-5.6} y2={3.2} />
				<line x1={-3.6} y1={6.2} x2={-3.6} y2={4.4} />
				<line x1={-1.6} y1={6.2} x2={-1.6} y2={2.6} />
				<line x1={0.4} y1={6.2} x2={0.4} y2={3.8} />
				<line x1={2.4} y1={6.2} x2={2.4} y2={1.9} />
				<path d="M -5.9 3.6 Q -2.4 1.4 0.9 2.9 T 5.6 1.4" fill="none" strokeWidth={0.7} />
				<path d="M 4.6 1.1 L 5.6 1.4 L 4.9 2.4" fill="none" strokeWidth={0.7} />
			</g>
		</g>
	);
}


/** Bookshelf: frame, shelves, varied book spines, a plant and a trophy. */
export function Bookshelf({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	const spineColors = [theme.cushion, theme.plant, theme.link, theme.cushion, theme.chairBack];
	return (
		<g transform={`translate(${x}, ${y})`}>
			<Shadow w={7.4} y={16} opacity={0.16} />
			<rect x={-3.6} y={0} width={7.2} height={16} rx={1} fill={theme.wood} />
			<rect x={-3.1} y={0.5} width={6.2} height={15} rx={0.6} fill={theme.wallDeep} opacity={0.55} />
			<line x1={-3.6} y1={5.4} x2={3.6} y2={5.4} stroke={theme.woodTop} strokeWidth={0.7} />
			<line x1={-3.6} y1={10.8} x2={3.6} y2={10.8} stroke={theme.woodTop} strokeWidth={0.7} />
			{[0, 1, 2].map((row) =>
				[-2.7, -1.8, -0.9, 0.2, 1.1].map((dx, i) => {
					const h = 3 + ((i + row) % 3) * 0.5;
					return (
						<rect
							key={`${row}-${i}`}
							x={dx}
							y={0.9 + row * 5.4 + (3.9 - h)}
							width={0.8}
							height={h}
							rx={0.15}
							fill={spineColors[(i + row) % spineColors.length]}
							opacity={0.85}
						/>
					);
				}),
			)}
			{/* trophy on the middle shelf */}
			<g transform="translate(2.4, 9.2)">
				<rect x={-0.5} y={1} width={1} height={0.5} fill={theme.screenGlow} opacity={0.7} />
				<path d="M -0.9 -0.9 A 0.9 0.9 0 1 1 0.9 -0.9 L 0.5 0.6 L -0.5 0.6 Z" fill={theme.screenGlow} opacity={0.85} />
			</g>
			{/* trailing plant on the top shelf */}
			<circle cx={-1.9} cy={-0.9} r={1} fill={theme.plant} />
			<path d="M -2.2 -0.4 Q -2.8 0.8 -3.2 1.6" stroke={theme.plantDark} strokeWidth={0.4} fill="none" />
		</g>
	);
}

/** Wall clock with hands driven by the actual time. */
export function WallClock({ x, y, theme, now }: { x: number; y: number; theme: Palette; now: Date }) {
	const minutes = now.getMinutes();
	const hours = now.getHours() % 12;
	const minuteAngle = minutes * 6;
	const hourAngle = hours * 30 + minutes * 0.5;
	return (
		<g transform={`translate(${x}, ${y})`}>
			<circle r={3.1} fill={theme.wallDeep} opacity={0.4} />
			<circle r={2.7} fill={theme.whiteboard} stroke={theme.metal} strokeWidth={0.6} />
			<circle r={0.35} cy={-1.7} fill={theme.whiteboardInk} opacity={0.7} />
			<circle r={0.35} cy={1.6} fill={theme.whiteboardInk} opacity={0.7} />
			<circle r={0.35} cx={-1.6} fill={theme.whiteboardInk} opacity={0.7} />
			<circle r={0.35} cx={1.6} fill={theme.whiteboardInk} opacity={0.7} />
			<g transform={`rotate(${hourAngle})`}>
				<line x1={0} y1={0.5} x2={0} y2={-1.3} stroke={theme.label} strokeWidth={0.55} strokeLinecap="round" />
			</g>
			<g transform={`rotate(${minuteAngle})`}>
				<line x1={0} y1={0.7} x2={0} y2={-2.1} stroke={theme.label} strokeWidth={0.4} strokeLinecap="round" />
			</g>
			<circle r={0.4} fill={theme.accent} />
		</g>
	);
}

/** Framed wall art — two small prints with abstract marks. */
export function WallArt({ x, y, theme, variant = 0 }: { x: number; y: number; theme: Palette; variant?: 0 | 1 }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<rect x={-3.4} y={-4.2} width={6.8} height={8.4} rx={0.7} fill={theme.wood} />
			<rect x={-2.8} y={-3.6} width={5.6} height={7.2} rx={0.4} fill={theme.whiteboard} />
			{variant === 0 ? (
				<g>
					<circle cx={-0.6} cy={-0.9} r={1.5} fill={theme.accent} opacity={0.65} />
					<path d="M -2.3 2.4 L 0.2 -0.6 L 2.3 2.4 Z" fill={theme.cushion} opacity={0.75} />
					<line x1={-2.2} y1={2.9} x2={2.3} y2={2.9} stroke={theme.whiteboardInk} strokeWidth={0.4} />
				</g>
			) : (
				<g>
					<line x1={-1.9} y1={-2.4} x2={-1.9} y2={2.6} stroke={theme.plant} strokeWidth={1.3} />
					<line x1={0} y1={-1.4} x2={0} y2={2.6} stroke={theme.accent} strokeWidth={1.3} opacity={0.75} />
					<line x1={1.9} y1={-2.9} x2={1.9} y2={2.6} stroke={theme.cushion} strokeWidth={1.3} opacity={0.85} />
					<line x1={-2.6} y1={2.9} x2={2.6} y2={2.9} stroke={theme.whiteboardInk} strokeWidth={0.4} opacity={0.7} />
				</g>
			)}
		</g>
	);
}

/** Entrance door with a swing arc + welcome mat. */
export function Entrance({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			{/* mat */}
			<rect x={-6.4} y={4.4} width={12.8} height={5} rx={1} fill={theme.rugRing} opacity={0.5} />
			<rect x={-5.8} y={5} width={11.6} height={3.8} rx={0.7} fill="none" stroke={theme.rugRing} strokeWidth={0.4} opacity={0.9} />
			<text x={0} y={8.3} textAnchor="middle" fontSize={2.1} letterSpacing={0.5} fill={theme.labelMuted} fontFamily="system-ui, sans-serif">
				WELCOME
			</text>
			{/* door frame + swung door */}
			<rect x={-7.4} y={-1.4} width={0.9} height={5.8} rx={0.3} fill={theme.baseboard} />
			<rect x={6.5} y={-1.4} width={0.9} height={5.8} rx={0.3} fill={theme.baseboard} />
			<path d="M -6.5 -1.4 L -6.5 4.4 A 6.5 6.5 0 0 1 0.1 -2.9 L -6.5 -1.4 Z" fill={theme.door} opacity={0.35} />
			<line x1={-6.5} y1={-1.4} x2={0.2} y2={-2} stroke={theme.door} strokeWidth={0.55} opacity={0.9} />
		</g>
	);
}

/** North-facing window with mullions; `withShaft` casts a light polygon. */
export function Window({
	x,
	y,
	theme,
	w = 13,
	withShaft = false,
}: {
	x: number;
	y: number;
	theme: Palette;
	w?: number;
	withShaft?: boolean;
}) {
	const h = 7.4;
	return (
		<g transform={`translate(${x}, ${y})`}>
			{withShaft && (
				<polygon
					points={`${-w / 2 + 0.8},${h} ${w / 2 - 0.8},${h} ${w / 2 + 5},${h + 20} ${-w / 2 - 4},${h + 5.5}`}
					fill={theme.shaft}
					opacity={0.07}
				/>
			)}
			<rect x={-w / 2} y={0} width={w} height={h} rx={0.9} fill={theme.windowFrame} />
			<rect x={-w / 2 + 0.55} y={0.55} width={w - 1.1} height={h - 1.1} rx={0.4} fill={theme.windowGlass} />
			<line x1={0} y1={0.55} x2={0} y2={h - 0.55} stroke={theme.windowFrame} strokeWidth={0.55} />
			<line x1={-w / 2 + 0.55} y1={h / 2} x2={w / 2 - 0.55} y2={h / 2} stroke={theme.windowFrame} strokeWidth={0.55} />
			{/* sky hint */}
			<circle cx={-w / 6} cy={h / 3.4} r={1.5} fill={theme.shaft} opacity={0.25} />
			<rect x={-w / 2 + 0.55} y={h - 2} width={w - 1.1} height={1.55} fill={theme.shaft} opacity={0.1} />
			{/* sill */}
			<rect x={-w / 2 - 0.5} y={h} width={w + 1} height={0.8} rx={0.35} fill={theme.windowFrame} />
		</g>
	);
}

/** Hanging pendant light over a meeting pod. */
export function Pendant({ x, y, theme, on = false }: { x: number; y: number; theme: Palette; on?: boolean }) {
	return (
		<g transform={`translate(${x}, ${y})`}>
			<line x1={0} y1={-4.5} x2={0} y2={0} stroke={theme.metal} strokeWidth={0.45} opacity={0.8} />
			<path d="M -2.5 0 A 2.5 2.5 0 0 0 2.5 0 Z" fill={theme.chair} />
			<ellipse cx={0} cy={0.25} rx={2.4} ry={0.65} fill={on ? theme.lampGlow : theme.screenGlow} opacity={on ? 0.95 : 0.5} />
			{on && <ellipse cx={0} cy={2} rx={5.2} ry={1.8} fill={theme.lightPool} opacity={0.12} />}
		</g>
	);
}