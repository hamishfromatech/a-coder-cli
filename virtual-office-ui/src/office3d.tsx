/**
 * The virtual office floor — 3D scene.
 *
 * A compact React Three Fiber rendering of the same floor store the 2D view
 * uses: desk rows with glowing monitors, meeting pods, a lounge, and capsule
 * characters that lerp to the store's positions with walk bob, work bounce,
 * status auras, name labels, and canvas-texture speech bubbles. Hand-rolled
 * orbit rig (drag to rotate, wheel to zoom) — no drei dependency.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { DESK_SLOTS, MEETING_TABLES, meetingSeat } from "./geometry.ts";
import { STATUS_COLORS, THEMES, type FloorTheme, type Palette } from "./palette.ts";
import { createFloorStore, useFloor, type CoworkerVisual, type FloorStore } from "./store.ts";
import type { VirtualOfficeProps } from "./types.ts";

/** Floor (2D) coordinates to world: x 0..160, y 0..100 → centered grid. */
const SCALE = 1 / 5.5;
function to3d(x: number, y: number): [number, number, number] {
	return [(x - 80) * SCALE, 0, (y - 50) * SCALE];
}

const WALL_H = 3.4;

// ── textures ────────────────────────────────────────────────────────────────

function labelTexture(text: string, palette: Palette): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 72;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.clearRect(0, 0, 256, 72);
		ctx.fillStyle = palette.bubbleBg;
		ctx.beginPath();
		ctx.roundRect(0, 0, 256, 72, 18);
		ctx.fill();
		ctx.strokeStyle = palette.rugRing;
		ctx.lineWidth = 3;
		ctx.stroke();
		ctx.fillStyle = palette.label;
		ctx.font = "600 34px system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(text.length > 12 ? `${text.slice(0, 11)}…` : text, 128, 38);
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function bubbleTexture(text: string, color: string, palette: Palette): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 160;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.clearRect(0, 0, 512, 160);
		ctx.fillStyle = palette.bubbleBg;
		ctx.strokeStyle = color;
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.roundRect(4, 4, 504, 132, 22);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(236, 136);
		ctx.lineTo(256, 158);
		ctx.lineTo(276, 136);
		ctx.closePath();
		ctx.fillStyle = palette.bubbleBg;
		ctx.fill();
		ctx.strokeStyle = color;
		ctx.stroke();
		const words = text.replace(/\s+/g, " ").trim().split(" ");
		const lines: string[] = [];
		let line = "";
		for (const word of words) {
			const next = line ? `${line} ${word}` : word;
			if (next.length > 38 && line) {
				lines.push(line);
				line = word;
				if (lines.length === 3) break;
			} else {
				line = next;
			}
		}
		if (lines.length < 3 && line) lines.push(line);
		ctx.fillStyle = palette.bubbleText;
		ctx.font = "400 30px system-ui, sans-serif";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		for (let i = 0; i < Math.min(3, lines.length); i++) {
			ctx.fillText(lines[i] ?? "", 28, 40 + i * 36);
		}
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

// ── furniture ───────────────────────────────────────────────────────────────

function Box({
	position,
	args,
	color,
	roughness = 0.7,
	emissive,
}: {
	position: [number, number, number];
	args: [number, number, number];
	color: string;
	roughness?: number;
	emissive?: string;
}) {
	return (
		<mesh position={position} castShadow receiveShadow>
			<boxGeometry args={args} />
			<meshStandardMaterial
				color={color}
				roughness={roughness}
				metalness={0.05}
				{...(emissive ? { emissive, emissiveIntensity: 0.55 } : {})}
			/>
		</mesh>
	);
}

function Desk3D({ x, y, theme, on, flip }: { x: number; y: number; theme: Palette; on: boolean; flip: boolean }) {
	const [wx, , wz] = to3d(x, y + 6.4);
	const rotY = flip ? Math.PI : 0;
	return (
		<group position={[wx, 0, wz]} rotation={[0, rotY, 0]}>
			{/* top */}
			<Box position={[0, 0.78, 0]} args={[2.1, 0.12, 1]} color={theme.woodTop} />
			<Box position={[-0.9, 0.38, 0]} args={[0.12, 0.76, 0.9]} color={theme.wood} />
			<Box position={[0.9, 0.38, 0]} args={[0.12, 0.38, 1]} color={theme.wood} />
			{/* monitor */}
			<Box position={[0, 1.18, -0.32]} args={[0.95, 0.6, 0.06]} color={theme.monitorBezel} />
			<group position={[0, 1.18, -0.24]}>
				<mesh castShadow={false}>
					<planeGeometry args={[0.82, 0.46]} />
					<meshStandardMaterial
						color={on ? "#9ed1ff" : theme.monitorOn}
						emissive={on ? "#7fc4ff" : theme.accent}
						emissiveIntensity={on ? 1.2 : 0.25}
						roughness={0.4}
					/>
				</mesh>
			</group>
			<Box position={[0, 1.02, -0.14]} args={[0.1, 0.22, 0.08]} color={theme.monitorBezel} />
			{/* keyboard */}
			<Box position={[0, 0.87, 0.32]} args={[0.85, 0.03, 0.3]} color={theme.metal} />
			{/* chair behind (opposite the monitor) */}
			<group position={[0, 0, 0.9]}>
				<Box position={[0, 0.45, 0]} args={[0.62, 0.1, 0.55]} color={theme.chairSeat} />
				<Box position={[0, 0.72, 0.26]} args={[0.5, 0.55, 0.08]} color={theme.chair} />
				<Box position={[0, 0.2, 0]} args={[0.08, 0.4, 0.08]} color={theme.chair} />
			</group>
		</group>
	);
}

function MeetingTable3D({ index, theme, active }: { index: number; theme: Palette; active: boolean }) {
	const table = MEETING_TABLES[index];
	if (!table) return null;
	const [wx, , wz] = to3d(table.x, table.y);
	return (
		<group position={[wx, 0, wz]}>
			{active && <pointLight position={[0, 2.4, 0]} color={theme.accent} intensity={6} distance={6} />}
			{active && (
				<mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
					<ringGeometry args={[1.9, 2.05, 48]} />
					<meshBasicMaterial color={theme.accent} transparent opacity={0.5} />
				</mesh>
			)}
			<mesh position={[0, 0.78, 0]} castShadow>
				<cylinderGeometry args={[1.35, 1.35, 0.12, 32]} />
				<meshStandardMaterial color={theme.table} roughness={0.6} />
			</mesh>
			<mesh position={[0, 0.4, 0]}>
				<cylinderGeometry args={[0.18, 0.28, 0.8, 16]} />
				<meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.4} />
			</mesh>
			{[0, 1, 2].map((seat) => {
				const seatPos = meetingSeat(index, seat);
				const sx = seatPos.x;
				const sz = seatPos.y;
				const px = sx - table.x;
				const pz = sz - table.y;
				return (
					<group key={seat} position={[px * SCALE, 0, pz * SCALE]}>
						<Box position={[0, 0.42, 0]} args={[0.55, 0.09, 0.5]} color={theme.chairSeat} />
						<Box position={[0, 0.68, pz >= 0 ? 0.24 : -0.24]} args={[0.48, 0.5, 0.07]} color={theme.chair} />
					</group>
				);
			})}
		</group>
	);
}

// ── characters ──────────────────────────────────────────────────────────────

function Character({ visual, store, theme }: { visual: CoworkerVisual; store: FloorStore; theme: Palette }) {
	const group = useRef<THREE.Group>(null);
	const bodyRef = useRef<THREE.Group>(null);
	const aura = useRef<THREE.Mesh>(null);
	const labelTex = useMemo(() => labelTexture(visual.name, theme), [visual.name, theme]);
	const [worldX, , worldZ] = to3d(visual.pos.x, visual.pos.y);

	useEffect(() => () => labelTex.dispose(), [labelTex]);

	const bubble = visual.bubble && Date.now() < visual.bubble.until ? visual.bubble : null;
	const bubbleTex = useMemo(
		() => (bubble ? bubbleTexture(bubble.text, visual.color, theme) : null),
		[bubble, visual.color, theme],
	);
	useEffect(() => () => bubbleTex?.dispose(), [bubbleTex]);

	useFrame((state, delta) => {
		const live = store.getState().coworkers.find((c) => c.id === visual.id);
		if (!live || !group.current) return;
		const [tx, , tz] = to3d(live.pos.x, live.pos.y);
		const lerp = 1 - Math.pow(0.02, delta);
		const pos = group.current.position;
		pos.x += (tx - pos.x) * lerp;
		pos.z += (tz - pos.z) * lerp;
		const t = state.clock.elapsedTime;
		if (bodyRef.current) {
			if (live.walkT !== null) {
				bodyRef.current.position.y = Math.abs(Math.sin(t * 9)) * 0.06;
			} else if (bubble) {
				bodyRef.current.position.y = Math.abs(Math.sin(t * 5)) * 0.04;
			} else if (live.status === "tool_calling") {
				bodyRef.current.position.y = Math.abs(Math.sin(t * 12)) * 0.025;
			} else {
				bodyRef.current.position.y = Math.sin(t * 1.8 + pos.x) * 0.015;
			}
		}
		if (aura.current) {
			const show = live.status === "thinking" || live.status === "tool_calling";
			aura.current.visible = show;
			if (show) {
				aura.current.rotation.y = t * 1.4;
				aura.current.position.y = 1.85 + Math.sin(t * 2.2) * 0.05;
			}
		}
	});

	const auraColor =
		visual.status === "tool_calling" ? STATUS_COLORS.tool_calling : STATUS_COLORS.thinking;

	return (
		<group ref={group} position={[worldX, 0, worldZ]}>
			{/* shadow blob */}
			<mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<circleGeometry args={[0.42, 24]} />
				<meshBasicMaterial color="#000000" transparent opacity={0.25} />
			</mesh>
			<group ref={bodyRef}>
				<mesh position={[0, 0.62, 0]} castShadow>
					<capsuleGeometry args={[0.3, 0.45, 8, 16]} />
					<meshStandardMaterial color={visual.color} roughness={0.45} />
				</mesh>
				<mesh position={[0, 1.26, 0]} castShadow>
					<sphereGeometry args={[0.33, 24, 16]} />
					<meshStandardMaterial color={visual.color} roughness={0.4} />
				</mesh>
				{/* eyes */}
				<mesh position={[-0.12, 1.3, 0.3]}>
					<sphereGeometry args={[0.045, 8, 8]} />
					<meshBasicMaterial color="#ffffff" />
				</mesh>
				<mesh position={[0.12, 1.3, 0.3]}>
					<sphereGeometry args={[0.045, 8, 8]} />
					<meshBasicMaterial color="#ffffff" />
				</mesh>
				{/* status aura ring */}
				<mesh ref={aura} position={[0, 1.85, 0]} rotation={[Math.PI / 2.6, 0, 0]}>
					<torusGeometry args={[0.42, 0.025, 8, 40]} />
					<meshBasicMaterial color={auraColor} transparent opacity={0.85} />
				</mesh>
			</group>
			{/* name label */}
			<sprite position={[0, 2.35, 0]} scale={[1.5, 0.42, 1]}>
				<spriteMaterial map={labelTex} transparent depthTest={false} />
			</sprite>
			{bubbleTex && (
				<sprite position={[0, 3.15, 0]} scale={[2.6, 0.82, 1]}>
					<spriteMaterial map={bubbleTex} transparent depthTest={false} />
				</sprite>
			)}
		</group>
	);
}

// ── camera rig ──────────────────────────────────────────────────────────────

function CameraRig({ target = [0, 0, 0] as [number, number, number] }) {
	const { camera } = useThree();
	const state = useRef({ azimuth: 0.66, polar: 1.02, radius: 21, dragging: false, lx: 0, ly: 0 });

	useEffect(() => {
		const el = camera instanceof THREE.Camera ? (camera as THREE.PerspectiveCamera) : null;
		const dom = document.querySelector("canvas");
		if (!dom || !el) return;
		const down = (e: PointerEvent) => {
			state.current.dragging = true;
			state.current.lx = e.clientX;
			state.current.ly = e.clientY;
		};
		const move = (e: PointerEvent) => {
			if (!state.current.dragging) return;
			state.current.azimuth -= (e.clientX - state.current.lx) * 0.006;
			state.current.polar = Math.min(1.38, Math.max(0.55, state.current.polar - (e.clientY - state.current.ly) * 0.005));
			state.current.lx = e.clientX;
			state.current.ly = e.clientY;
		};
		const up = () => {
			state.current.dragging = false;
		};
		const wheel = (e: WheelEvent) => {
			e.preventDefault();
			state.current.radius = Math.min(34, Math.max(9, state.current.radius + e.deltaY * 0.012));
		};
		dom.addEventListener("pointerdown", down);
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		dom.addEventListener("wheel", wheel, { passive: false });
		return () => {
			dom.removeEventListener("pointerdown", down);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			dom.removeEventListener("wheel", wheel);
		};
	}, [camera]);

	useFrame((_, delta) => {
		const s = state.current;
		if (!s.dragging) s.azimuth += delta * 0.02; // gentle idle orbit
		const [tx, ty, tz] = target;
		camera.position.set(
			tx + s.radius * Math.sin(s.polar) * Math.sin(s.azimuth),
			ty + s.radius * Math.cos(s.polar),
			tz + s.radius * Math.sin(s.polar) * Math.cos(s.azimuth),
		);
		camera.lookAt(tx, ty, tz);
	});
	return null;
}

// ── environment ─────────────────────────────────────────────────────────────

function Environment3D({ theme }: { theme: Palette }) {
	// Floor spans the office: 160x100 floor units → 29.1 x 18.2 world units.
	const halfW = 80 * SCALE;
	const halfD = 50 * SCALE;
	return (
		<group>
			<mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<planeGeometry args={[halfW * 2, halfD * 2]} />
				<meshStandardMaterial color={theme.floor} roughness={0.9} />
			</mesh>
			{/* zone floors */}
			<mesh position={[-(80 - 45) * SCALE * 1, 0.012, -(50 - 42) * SCALE]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<planeGeometry args={[72 * SCALE, 68 * SCALE]} />
				<meshStandardMaterial color={theme.zoneDesk} roughness={0.85} />
			</mesh>
			<mesh position={[(121 - 80) * SCALE, 0.012, (35 - 50) * SCALE]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<planeGeometry args={[66 * SCALE, 58 * SCALE]} />
				<meshStandardMaterial color={theme.zoneMeeting} roughness={0.85} />
			</mesh>
			<mesh position={[(122 - 80) * SCALE, 0.012, (80 - 50) * SCALE]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<planeGeometry args={[64 * SCALE, 28 * SCALE]} />
				<meshStandardMaterial color={theme.zoneLounge} roughness={0.85} />
			</mesh>
			{/* walls: back, left, right (front open for the camera) */}
			<Box position={[0, WALL_H / 2, -halfD - 0.15]} args={[halfW * 2 + 0.6, WALL_H, 0.3]} color={theme.wall} roughness={0.8} />
			<Box position={[-halfW - 0.15, WALL_H / 2, 0]} args={[0.3, WALL_H, halfD * 2]} color={theme.wall} roughness={0.8} />
			<Box position={[halfW + 0.15, WALL_H / 2, 0]} args={[0.3, WALL_H, halfD * 2]} color={theme.wall} roughness={0.8} />
			{/* windows on the back wall */}
			{[-9, -3, 3, 9].map((wx) => (
				<mesh key={wx} position={[wx, 1.9, -halfD + 0.02]} rotation={[0, 0, 0]}>
					<planeGeometry args={[3.4, 1.5]} />
					<meshStandardMaterial
						color="#bfe0ff"
						emissive="#bfe3ff"
						emissiveIntensity={theme.floor === "#0e1626" ? 0.5 : 0.25}
						roughness={0.2}
					/>
				</mesh>
			))}
		</group>
	);
}

function Sofa3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(122, 84);
	return (
		<group position={[wx, 0, wz]}>
			<Box position={[0, 0.3, 0]} args={[3.4, 0.5, 1.2]} color={theme.sofa} />
			<Box position={[0, 0.75, -0.42]} args={[3.4, 0.7, 0.28]} color={theme.chairSeat} />
			<Box position={[-1.75, 0.55, 0]} args={[0.24, 0.75, 1.2]} color={theme.chair} />
			<Box position={[1.75, 0.55, 0]} args={[0.24, 0.75, 1.2]} color={theme.chair} />
		</group>
	);
}

function Plant3D({ x, y, theme, size = 1 }: { x: number; y: number; theme: Palette; size?: number }) {
	const [wx, , wz] = to3d(x, y);
	return (
		<group position={[wx, 0, wz]} scale={size}>
			<mesh position={[0, 0.22, 0]} castShadow>
				<cylinderGeometry args={[0.24, 0.3, 0.44, 12]} />
				<meshStandardMaterial color={theme.plantPot} roughness={0.7} />
			</mesh>
			<mesh position={[0, 0.75, 0]} castShadow>
				<sphereGeometry args={[0.34, 16, 12]} />
				<meshStandardMaterial color={theme.plant} roughness={0.7} />
			</mesh>
			<mesh position={[0.16, 0.98, 0.08]} castShadow>
				<sphereGeometry args={[0.22, 16, 12]} />
				<meshStandardMaterial color={theme.plantDark} roughness={0.7} />
			</mesh>
			<mesh position={[-0.18, 0.92, -0.1]} castShadow>
				<sphereGeometry args={[0.19, 16, 12]} />
				<meshStandardMaterial color={theme.plant} roughness={0.7} />
			</mesh>
		</group>
	);
}

// ── scene ───────────────────────────────────────────────────────────────────

function Scene({ store, theme }: { store: FloorStore; theme: Palette; themeName: FloorTheme }) {
	const floor = useFloor(store);
	const bg = theme.wall === THEMES.dark.wall ? "#0a1020" : "#dfe7f0";
	return (
		<>
			<color attach="background" args={[bg]} />
			<fog attach="fog" args={[bg, 30, 60]} />
			<ambientLight intensity={theme.floor === "#0e1626" ? 0.55 : 0.75} />
			<hemisphereLight intensity={0.5} color="#ffffff" groundColor={theme.floor} />
			<directionalLight
				position={[9, 13, 7]}
				intensity={1.5}
				castShadow
				shadow-mapSize-width={2048}
				shadow-mapSize-height={2048}
				shadow-camera-left={-18}
				shadow-camera-right={18}
				shadow-camera-top={14}
				shadow-camera-bottom={-14}
			/>
			<CameraRig />
			<Environment3D theme={theme} />
			{DESK_SLOTS.map((slot, i) => {
				const owner = floor.coworkers.find((c) => c.deskIndex === i);
				const on = owner?.status === "tool_calling" || owner?.status === "thinking";
				const flip = slot.x > 53;
				return <Desk3D key={`d${i}`} x={slot.x} y={slot.y} theme={theme} on={on} flip={flip} />;
			})}
			{MEETING_TABLES.map((_, i) => (
				<MeetingTable3D key={`m${i}`} index={i} theme={theme} active={i === 0 && floor.coworkers.some((c) => c.inMeeting)} />
			))}
			<Sofa3D theme={theme} />
			<Plant3D x={12} y={13} theme={theme} />
			<Plant3D x={78} y={12.5} theme={theme} size={0.8} />
			<Plant3D x={100} y={88} theme={theme} size={1.2} />
			<Plant3D x={150} y={90} theme={theme} />
			{floor.coworkers.map((visual) => (
				<Character key={visual.id} visual={visual} store={store} theme={theme} />
			))}
		</>
	);
}

export function Office3D({ feed, theme: themeName = "dark", className, style }: VirtualOfficeProps) {
	const storeRef = useRef<FloorStore | null>(null);
	if (storeRef.current === null) {
		storeRef.current = createFloorStore();
	}
	const store = storeRef.current;

	useEffect(() => {
		store.getState().applyFeed(feed);
	}, [feed, store]);

	const theme = THEMES[themeName];
	return (
		<div className={className} style={style}>
			<Canvas
				shadows="percentage"
				gl={{ antialias: true, alpha: false }}
				camera={{ fov: 42, position: [16, 15, 16], near: 0.1, far: 120 }}
				dpr={[1, 2]}
			>
				<Scene store={store} theme={theme} themeName={themeName} />
			</Canvas>
		</div>
	);
}
