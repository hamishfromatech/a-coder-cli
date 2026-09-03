/**
 * Procedural coworker avatars — the engine's Face model (shape + color, user
 * uploads override) drawn as SVG with status-driven features: an animated
 * status ring, walk bob and stand/sit scale, thinking dots, tool chip, and
 * name label.
 */

import { STATUS_COLORS, type Palette } from "./palette.ts";
import type { CoworkerVisual } from "./store.ts";
import type { FaceShape } from "./types.ts";

/** Head outline for each face shape, centered on (0,0), radius r. */
function shapePath(shape: FaceShape, r: number): string {
	switch (shape) {
		case "circle":
			return "";
		case "hexagon": {
			const points: string[] = [];
			for (let i = 0; i < 6; i++) {
				const angle = (Math.PI / 3) * i - Math.PI / 6;
				points.push(`${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`);
			}
			const first = points[0] ?? "0,0";
			return `M${first} L ${points.slice(1).join(" L ")} Z`;
		}
		case "squircle":
			return "";
		case "triangle":
			return `M0,${-r} L${r * 0.95},${r * 0.75} L${-r * 0.95},${r * 0.75} Z`;
		case "drop":
			return `M0,${-r} C ${r * 0.85},${-r * 0.35} ${r * 0.8},${r * 0.55} 0,${r * 0.85} C ${-r * 0.8},${r * 0.55} ${-r * 0.85},${-r * 0.35} 0,${-r} Z`;
		case "cloud":
			return `M${-r * 0.7},${r * 0.45} a ${r * 0.45},${r * 0.45} 0 0 1 ${-r * 0.15},${-r * 0.75} a ${r * 0.55},${r * 0.5} 0 0 1 ${r * 0.75},${-r * 0.45} a ${r * 0.5},${r * 0.5} 0 0 1 ${r * 0.8},${r * 0.35} a ${r * 0.42},${r * 0.42} 0 0 1 ${-r * 0.1},${r * 0.85} Z`;
		default:
			return "";
	}
}

const R = 7;
const SPAWN_MS = 3200;
/** Walk cycles across the whole path length. */
const BOB_CYCLES = 5;

export function CoworkerAvatar({ visual, now, theme }: { visual: CoworkerVisual; now: number; theme: Palette }) {
	const speaking = visual.bubble !== null && visual.bubble.until > now;
	const errored = visual.bubble?.text.startsWith("Hit an error") ?? false;
	const spawnActive = visual.spawnUntil > 0 && now - visual.spawnUntil < SPAWN_MS;

	const statusColor = errored
		? STATUS_COLORS.error
		: speaking
			? STATUS_COLORS.speaking
			: visual.status === "tool_calling"
				? STATUS_COLORS.tool_calling
				: visual.status === "thinking"
					? STATUS_COLORS.thinking
					: STATUS_COLORS.idle;

	// Walk bob: gentle sine across the walk; stand-up / sit-down scale.
	let bobY = 0;
	let scale = 1;
	if (visual.walkT !== null) {
		const t = visual.walkT;
		bobY = Math.sin(t * Math.PI * 2 * BOB_CYCLES) * 0.9;
		if (t < 0.1) scale = 0.9 + t;
		else if (t > 0.9) {
			const tail = (t - 0.9) / 0.1;
			scale = 1 - 0.06 * Math.sin(tail * Math.PI);
		}
	}

	const ring = (() => {
		if (visual.status === "idle" && !speaking && !errored) {
			return <circle r={9.2} fill="none" stroke={STATUS_COLORS.idle} strokeWidth={0.55} opacity={0.5} />;
		}
		const cls =
			visual.status === "thinking" && !speaking
				? "vo-pulse"
				: visual.status === "tool_calling" && !speaking
					? "vo-ring"
					: errored
						? "vo-pulse-fast"
						: "vo-pulse";
		return (
			<circle
				r={9.4}
				fill="none"
				stroke={statusColor}
				strokeWidth={errored ? 1 : 0.7}
				className={cls}
				opacity={0.9}
			/>
		);
	})();

	return (
		<g>
			{/* ground shadow */}
			<ellipse cx={0} cy={8.6} rx={6} ry={1.8} fill="#000" opacity={0.25} />
			{spawnActive && (
				<circle r={10} fill="none" stroke={STATUS_COLORS.spawn} strokeWidth={0.8} className="vo-spawn" />
			)}
			{ring}
			<g transform={`translate(0, ${bobY.toFixed(2)}) scale(${scale.toFixed(3)})`}>{body(visual, speaking, errored)}</g>
			{visual.currentTool && !speaking && (
				<g transform={`translate(${R + 1}, -${R - 1})`}>
					<rect
						x={0}
						y={-2.6}
						width={Math.min(16, visual.currentTool.length * 1.7 + 3)}
						height={5}
						rx={2.5}
						fill={theme.bubbleBg}
						opacity={0.95}
						stroke={STATUS_COLORS.tool_calling}
						strokeWidth={0.4}
					/>
					<text x={1.5} y={1.3} fontSize={3.4} fill={STATUS_COLORS.tool_calling} fontFamily="ui-monospace, monospace">
						{visual.currentTool}
					</text>
				</g>
			)}
			{visual.status === "thinking" && !speaking && (
				<g className="vo-dots" transform="translate(0, -11.5)">
					{[-2.6, 0, 2.6].map((dx, i) => (
						<circle key={dx} cx={dx} cy={0} r={0.55} fill={statusColor} style={{ animationDelay: `${i * 0.15}s` }} />
					))}
				</g>
			)}
			<text
				x={0}
				y={R + 6}
				textAnchor="middle"
				fontSize={4}
				fontWeight={600}
				fill={theme.label}
				fontFamily="system-ui, sans-serif"
			>
				{visual.name}
			</text>
		</g>
	);
}

function body(visual: CoworkerVisual, speaking: boolean, errored: boolean) {
	const r = R;
	const head = (() => {
		if (visual.image) {
			const clipId = `clip-${visual.id.replace(/[^a-zA-Z0-9-]/g, "")}`;
			return (
				<g>
					<clipPath id={clipId}>
						<circle cx={0} cy={0} r={r} />
					</clipPath>
					<image
						href={visual.image}
						x={-r}
						y={-r}
						width={r * 2}
						height={r * 2}
						clipPath={`url(#${clipId})`}
						preserveAspectRatio="xMidYMid slice"
					/>
					<circle cx={0} cy={0} r={r} fill="none" stroke={visual.color} strokeWidth={1.2} />
				</g>
			);
		}
		const fill = visual.color;
		const path = shapePath(visual.shape, r);
		if (visual.shape === "circle") return <circle cx={0} cy={0} r={r} fill={fill} />;
		if (visual.shape === "squircle") {
			return (
				<rect x={-r * 0.92} y={-r * 0.92} width={r * 1.84} height={r * 1.84} rx={r * 0.55} fill={fill} />
			);
		}
		if (path) return <path d={path} fill={fill} />;
		return <circle cx={0} cy={0} r={r} fill={fill} />;
	})();

	const eyeY = -1.6;
	const eyes = errored ? (
		<g stroke="#fff" strokeWidth={1.1} strokeLinecap="round">
			<line x1={-3.8} y1={eyeY - 1.2} x2={-1.8} y2={eyeY + 1} />
			<line x1={-1.8} y1={eyeY - 1.2} x2={-4} y2={eyeY + 1} />
			<line x1={1.8} y1={eyeY - 1.2} x2={4} y2={eyeY + 1} />
			<line x1={3.8} y1={eyeY - 1.2} x2={1.6} y2={eyeY + 1} />
		</g>
	) : (
		<g fill="#fff">
			<circle cx={-2.6} cy={eyeY} r={1.05} />
			<circle cx={2.6} cy={eyeY} r={1.05} />
		</g>
	);

	const mouth = errored ? (
		<path d="M-2,4 Q0,1.8 2,4" stroke="#fff" strokeWidth={1.1} fill="none" strokeLinecap="round" />
	) : speaking ? (
		<ellipse cx={0} cy={3.4} rx={2} ry={1.6} fill="#fff" />
	) : visual.status === "thinking" ? (
		<circle cx={2.4} cy={3.4} r={1.1} fill="none" stroke="#fff" strokeWidth={1} />
	) : (
		<line x1={-1.8} y1={3.4} x2={1.8} y2={3.4} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
	);

	return (
		<g>
			{head}
			{eyes}
			{mouth}
		</g>
	);
}