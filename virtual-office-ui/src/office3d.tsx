/**
 * The virtual office floor — 3D scene.
 *
 * The same floor store the 2D view derives from, rendered as a warm little
 * studio: textured zone floors matching the 2D patterns (planks, carpet,
 * weave, corridor tiles), walls with framed windows and baseboards, crafted
 * desks with glowing screens, meeting pods with pendants and laptops, a cozy
 * lounge, a coffee bar, and capsule coworkers that lerp along the store's
 * positions with walk bob, blinking eyes, status auras, name labels, and
 * canvas-texture speech bubbles. Hand-rolled orbit rig — no drei dependency.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DESK_SLOTS, MEETING_TABLES, SEATS_PER_TABLE, meetingSeat } from "./geometry.ts";
import { STATUS_COLORS, THEMES, type Palette } from "./palette.ts";
import { type CoworkerVisual, type FloorStore, createFloorStore, useFloorSelector } from "./store.ts";
import type { VirtualOfficeProps } from "./types.ts";

/** Floor (2D) coordinates to world: x 0..160, y 0..100 → centered grid. */
const SCALE = 1 / 5.5;
function to3d(x: number, y: number): [number, number, number] {
	return [(x - 80) * SCALE, 0, (y - 50) * SCALE];
}

const WALL_H = 3.4;

/** Track tab/window visibility so a hidden sidebar stops rendering frames. */
function useDocumentVisible(): boolean {
	const [visible, setVisible] = useState(
		() => typeof document === "undefined" || document.visibilityState !== "hidden",
	);
	useEffect(() => {
		const onChange = (): void => setVisible(document.visibilityState !== "hidden");
		document.addEventListener("visibilitychange", onChange);
		return () => document.removeEventListener("visibilitychange", onChange);
	}, []);
	return visible;
}

/** Honor the OS reduced-motion preference for ambient camera drift. */
function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const onChange = (): void => setReduced(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);
	return reduced;
}

// ── textures ────────────────────────────────────────────────────────────────

type ZoneTextureKind = "planks" | "carpet" | "weave" | "tiles";

/** Repeating floor texture matching the 2D zone patterns. */
function zoneTexture(kind: ZoneTextureKind, palette: Palette): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.fillStyle = themeColorOf(kind, palette);
		ctx.fillRect(0, 0, 128, 128);
		ctx.strokeStyle = palette.grid;
		if (kind === "planks") {
			ctx.lineWidth = 2;
			for (let y = 0; y <= 128; y += 32) {
				ctx.globalAlpha = 0.55;
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(128, y);
				ctx.stroke();
			}
			ctx.globalAlpha = 0.3;
			for (let y = 16; y < 128; y += 32) {
				for (let x = ((y / 32) % 2) * 32; x < 128; x += 64) {
					ctx.beginPath();
					ctx.moveTo(x, y - 16);
					ctx.lineTo(x, y + 16);
					ctx.stroke();
				}
			}
		} else if (kind === "carpet") {
			ctx.fillStyle = palette.grid;
			for (let y = 16; y < 128; y += 32) {
				for (let x = 16; x < 128; x += 32) {
					ctx.globalAlpha = 0.6;
					ctx.beginPath();
					ctx.arc(x, y, 3.2, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		} else if (kind === "weave") {
			ctx.globalAlpha = 0.5;
			ctx.lineWidth = 2;
			for (let i = -128; i < 256; i += 18) {
				ctx.beginPath();
				ctx.moveTo(i, 0);
				ctx.lineTo(i + 128, 128);
				ctx.stroke();
			}
		} else {
			// tiles
			ctx.globalAlpha = 0.65;
			ctx.lineWidth = 2;
			for (let i = 0; i <= 128; i += 42) {
				ctx.beginPath();
				ctx.moveTo(i, 0);
				ctx.lineTo(i, 128);
				ctx.moveTo(0, i);
				ctx.lineTo(128, i);
				ctx.stroke();
			}
		}
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	return texture;
}

function themeColorOf(kind: ZoneTextureKind, palette: Palette): string {
	switch (kind) {
		case "planks":
			return palette.zoneDesk;
		case "carpet":
			return palette.zoneMeeting;
		case "weave":
			return palette.zoneLounge;
		default:
			return palette.corridor;
	}
}

function fitLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let out = text;
	while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
		out = out.slice(0, -1);
	}
	return `${out}…`;
}

function labelTexture(name: string, title: string | undefined, palette: Palette): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 144;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.clearRect(0, 0, 512, 144);
		ctx.fillStyle = palette.bubbleBg;
		ctx.beginPath();
		ctx.roundRect(4, 4, 504, 136, 32);
		ctx.fill();
		ctx.strokeStyle = palette.rugRing;
		ctx.lineWidth = 4;
		ctx.stroke();
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = palette.label;
		ctx.font = "600 46px system-ui, -apple-system, sans-serif";
		ctx.fillText(
			fitLabel(ctx, name, 440),
			256,
			title ? 58 : 72,
		);
		if (title) {
			ctx.globalAlpha = 0.68;
			ctx.font = "500 24px system-ui, -apple-system, sans-serif";
			ctx.fillText(fitLabel(ctx, title, 440), 256, 102);
			ctx.globalAlpha = 1;
		}
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.anisotropy = 8;
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

/** Whiteboard face: bars + a rising trend line, echoing the 2D sketch. */
function whiteboardTexture(palette: Palette): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 144;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.fillStyle = palette.whiteboard;
		ctx.fillRect(0, 0, 256, 144);
		ctx.strokeStyle = palette.whiteboardInk;
		ctx.lineWidth = 5;
		ctx.lineCap = "round";
		const bars = [58, 40, 70, 52, 86];
		bars.forEach((h, i) => {
			ctx.globalAlpha = 0.75;
			ctx.beginPath();
			ctx.moveTo(30 + i * 34, 118);
			ctx.lineTo(30 + i * 34, 118 - h);
			ctx.stroke();
		});
		ctx.globalAlpha = 0.95;
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(24, 70);
		ctx.quadraticCurveTo(120, 26, 150, 58);
		ctx.quadraticCurveTo(200, 52, 226, 30);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(214, 26);
		ctx.lineTo(228, 28);
		ctx.lineTo(220, 42);
		ctx.stroke();
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

// ── primitives ──────────────────────────────────────────────────────────────

function Box({
	position,
	rotation,
	args,
	color,
	roughness = 0.7,
	metalness = 0.05,
	emissive,
	emissiveIntensity = 0.55,
}: {
	position: [number, number, number];
	rotation?: [number, number, number];
	args: [number, number, number];
	color: string;
	roughness?: number;
	metalness?: number;
	emissive?: string;
	emissiveIntensity?: number;
}) {
	return (
		<mesh position={position} rotation={rotation} castShadow receiveShadow>
			<boxGeometry args={args} />
			<meshStandardMaterial
				color={color}
				roughness={roughness}
				metalness={metalness}
				{...(emissive ? { emissive, emissiveIntensity } : {})}
			/>
		</mesh>
	);
}

// ── furniture ───────────────────────────────────────────────────────────────

function Desk3D({ x, y, theme, on, flip }: { x: number; y: number; theme: Palette; on: boolean; flip: boolean }) {
	const [wx, , wz] = to3d(x, y + 6.4);
	const rotY = flip ? Math.PI : 0;
	return (
		<group position={[wx, 0, wz]} rotation={[0, rotY, 0]}>
			{/* top slab + edge highlight */}
			<Box position={[0, 0.76, 0]} args={[2.15, 0.1, 1.05]} color={theme.woodTop} roughness={0.55} />
			<Box position={[0, 0.68, 0]} args={[2.2, 0.07, 1.1]} color={theme.wood} roughness={0.7} />
			{/* legs */}
			<Box position={[-0.92, 0.34, -0.42]} args={[0.1, 0.68, 0.1]} color={theme.metal} metalness={0.5} roughness={0.35} />
			<Box position={[0.92, 0.34, -0.42]} args={[0.1, 0.68, 0.1]} color={theme.metal} metalness={0.5} roughness={0.35} />
			<Box position={[-0.92, 0.34, 0.42]} args={[0.1, 0.68, 0.1]} color={theme.metal} metalness={0.5} roughness={0.35} />
			<Box position={[0.92, 0.34, 0.42]} args={[0.1, 0.68, 0.1]} color={theme.metal} metalness={0.5} roughness={0.35} />
			{/* acoustic desk screen behind the monitor */}
			<Box position={[0, 1.12, -0.52]} args={[2.02, 0.56, 0.035]} color={theme.partition} roughness={0.9} />
			<Box position={[0, 1.41, -0.52]} args={[2.06, 0.045, 0.06]} color={theme.partitionFrame} roughness={0.5} />
			{/* cable tray + drawer pedestal */}
			<Box position={[0, 0.66, 0.08]} args={[1.55, 0.035, 0.3]} color={theme.metal} roughness={0.4} metalness={0.35} />
			<Box position={[0.72, 0.36, 0.18]} args={[0.38, 0.56, 0.58]} color={theme.wood} roughness={0.65} />
			<Box position={[0.72, 0.57, 0.48]} args={[0.28, 0.025, 0.035]} color={theme.metal} roughness={0.4} />
			{/* monitor */}
			<Box position={[0, 1.16, -0.34]} args={[0.98, 0.62, 0.06]} color={theme.monitorBezel} roughness={0.4} />
			<mesh position={[0, 1.16, -0.3]}>
				<planeGeometry args={[0.84, 0.48]} />
				<meshStandardMaterial
					color={on ? theme.screenGlow : theme.monitorOn}
					emissive={on ? theme.screenGlow : theme.accent}
					emissiveIntensity={on ? 0.9 : 0.18}
					roughness={0.35}
				/>
			</mesh>
			{on && <pointLight position={[0, 1.15, -0.05]} color={theme.screenGlow} intensity={0.7} distance={2.4} decay={2} />}
			<Box position={[0, 0.98, -0.26]} args={[0.12, 0.24, 0.08]} color={theme.monitorBezel} />
			<Box position={[0, 0.86, -0.2]} args={[0.42, 0.05, 0.22]} color={theme.monitorBezel} />
			{/* keyboard + mouse */}
			<Box position={[-0.08, 0.83, 0.3]} args={[0.72, 0.035, 0.26]} color={theme.metal} roughness={0.4} metalness={0.35} />
			<mesh position={[0.42, 0.83, 0.3]} castShadow>
				<sphereGeometry args={[0.055, 12, 8]} />
				<meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.35} />
			</mesh>
			{/* mug + notebook + desk plant */}
			<mesh position={[0.78, 0.9, -0.24]} castShadow>
				<cylinderGeometry args={[0.075, 0.065, 0.13, 12]} />
				<meshStandardMaterial color={theme.chairBack} roughness={0.6} />
			</mesh>
			<Box position={[-0.74, 0.83, 0.18]} args={[0.3, 0.025, 0.22]} color={theme.cushion} roughness={0.8} rotation={[0, -0.08, 0]} />
			<mesh position={[-0.88, 0.92, -0.25]} castShadow>
				<cylinderGeometry args={[0.075, 0.06, 0.1, 10]} />
				<meshStandardMaterial color={theme.plantPot} roughness={0.7} />
			</mesh>
			<mesh position={[-0.88, 1.02, -0.25]} castShadow>
				<sphereGeometry args={[0.1, 10, 8]} />
				<meshStandardMaterial color={theme.plant} roughness={0.75} />
			</mesh>
			{/* chair: seat, back, stem, five-star base */}
			<group position={[0, 0, 0.95]}>
				<mesh position={[0, 0.44, 0]} castShadow>
					<cylinderGeometry args={[0.34, 0.38, 0.09, 20]} />
					<meshStandardMaterial color={theme.chairSeat} roughness={0.65} />
				</mesh>
				<Box position={[0, 0.78, 0.26]} args={[0.52, 0.6, 0.09]} color={theme.chairBack} roughness={0.6} />
				<mesh position={[0, 0.22, 0]}>
					<cylinderGeometry args={[0.045, 0.045, 0.42, 10]} />
					<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.55} />
				</mesh>
				<mesh position={[0, 0.05, 0]}>
					<cylinderGeometry args={[0.3, 0.32, 0.05, 20]} />
					<meshStandardMaterial color={theme.chair} roughness={0.5} metalness={0.3} />
				</mesh>
			</group>
		</group>
	);
}

function MeetingTable3D({
	index,
	theme,
	active,
	onOpen,
}: {
	index: number;
	theme: Palette;
	active: boolean;
	onOpen?: () => void;
}) {
	const table = MEETING_TABLES[index];
	if (!table) return null;
	const [wx, , wz] = to3d(table.x, table.y);
	return (
		<group
			position={[wx, 0, wz]}
			onClick={
				active && onOpen
					? (event) => {
							event.stopPropagation();
							onOpen();
						}
					: undefined
			}
			onPointerOver={active && onOpen ? () => { document.body.style.cursor = "pointer"; } : undefined}
			onPointerOut={active && onOpen ? () => { document.body.style.cursor = "default"; } : undefined}
		>
			{active && <pointLight position={[0, 2.3, 0]} color={theme.lightPool} intensity={7} distance={7} decay={2} />}
			{active && (
				<mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
					<ringGeometry args={[2, 2.18, 48]} />
					<meshBasicMaterial color={theme.accent} transparent opacity={0.5} />
				</mesh>
			)}
			{/* rug disc */}
			<mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<circleGeometry args={[2.05, 40]} />
				<meshStandardMaterial color={theme.rug} roughness={0.9} />
			</mesh>
			<mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<ringGeometry args={[1.72, 1.86, 40]} />
				<meshBasicMaterial color={theme.rugRing} transparent opacity={0.65} />
			</mesh>
			{/* pedestal + top */}
			<mesh position={[0, 0.4, 0]} castShadow>
				<cylinderGeometry args={[0.16, 0.3, 0.8, 16]} />
				<meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.45} />
			</mesh>
			<mesh position={[0, 0.82, 0]} castShadow receiveShadow>
				<cylinderGeometry args={[1.38, 1.42, 0.11, 36]} />
				<meshStandardMaterial color={theme.tableTop} roughness={0.55} />
			</mesh>
			<mesh position={[0, 0.75, 0]}>
				<cylinderGeometry args={[1.42, 1.42, 0.05, 36]} />
				<meshStandardMaterial color={theme.table} roughness={0.65} />
			</mesh>
			{/* laptops while in session */}
			{active &&
				[-90, 30, 150].map((deg) => {
					const rad = (deg * Math.PI) / 180;
					return (
						<group
							key={deg}
							position={[Math.cos(rad) * 0.86, 0.9, Math.sin(rad) * 0.86]}
							rotation={[0, -((deg + 90) * Math.PI) / 180, 0]}
						>
							<Box position={[0, 0.03, 0]} args={[0.42, 0.02, 0.3]} color={theme.monitorBezel} />
							<Box position={[0, 0.14, -0.14]} args={[0.42, 0.26, 0.02]} color={theme.monitorBezel} />
							<mesh position={[0, 0.15, -0.125]} rotation={[-0.12, 0, 0]}>
								<planeGeometry args={[0.36, 0.2]} />
								<meshStandardMaterial color={theme.screenGlow} emissive={theme.screenGlow} emissiveIntensity={0.85} />
							</mesh>
						</group>
					);
				})}
			{/* chairs around */}
			{[0, 1, 2].map((seat) => {
				const seatPos = meetingSeat(index, seat);
				const px = seatPos.x - table.x;
				const pz = seatPos.y - table.y;
				const angle = Math.atan2(px, pz);
				return (
					<group key={seat} position={[px * SCALE, 0, pz * SCALE]} rotation={[0, angle, 0]}>
						<mesh position={[0, 0.42, 0]} castShadow>
							<cylinderGeometry args={[0.27, 0.3, 0.08, 18]} />
							<meshStandardMaterial color={theme.chairSeat} roughness={0.65} />
						</mesh>
						<Box position={[0, 0.72, 0.22]} args={[0.44, 0.52, 0.08]} color={theme.chairBack} roughness={0.6} />
						<mesh position={[0, 0.21, 0]}>
							<cylinderGeometry args={[0.04, 0.04, 0.38, 8]} />
							<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.55} />
						</mesh>
						<mesh position={[0, 0.04, 0]}>
							<cylinderGeometry args={[0.24, 0.26, 0.04, 18]} />
							<meshStandardMaterial color={theme.chair} roughness={0.5} metalness={0.3} />
						</mesh>
					</group>
				);
			})}
			{/* hanging pendant */}
			<group position={[0, 0, 0]}>
				<mesh position={[0, (WALL_H + 2.16) / 2, 0]}>
					<cylinderGeometry args={[0.015, 0.015, WALL_H - 2.16, 6]} />
					<meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.5} />
				</mesh>
				<mesh position={[0, 2.16, 0]}>
					<cylinderGeometry args={[0.24, 0.42, 0.26, 20, 1, true]} />
					<meshStandardMaterial color={theme.chair} roughness={0.6} side={THREE.DoubleSide} />
				</mesh>
				<mesh position={[0, 2.02, 0]}>
					<sphereGeometry args={[0.12, 12, 8]} />
					<meshStandardMaterial
						color={theme.lampGlow}
						emissive={theme.lampGlow}
						emissiveIntensity={active ? 1.4 : 0.5}
					/>
				</mesh>
			</group>
		</group>
	);
}

function Sofa3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(126, 85.4);
	return (
		<group position={[wx, 0, wz]}>
			<Box position={[0, 0.24, 0]} args={[3.5, 0.42, 1.25]} color={theme.sofa} roughness={0.75} />
			<Box position={[0, 0.62, -0.5]} args={[3.5, 0.62, 0.3]} color={theme.chairBack} roughness={0.75} />
			<Box position={[-1.82, 0.52, 0]} args={[0.26, 0.62, 1.25]} color={theme.chair} roughness={0.75} />
			<Box position={[1.82, 0.52, 0]} args={[0.26, 0.62, 1.25]} color={theme.chair} roughness={0.75} />
			{/* cushions */}
			<Box position={[-0.88, 0.5, 0.05]} args={[1.5, 0.14, 1]} color={theme.chairSeat} roughness={0.8} />
			<Box position={[0.88, 0.5, 0.05]} args={[1.5, 0.14, 1]} color={theme.chairSeat} roughness={0.8} />
			<Box position={[-1.2, 0.72, -0.28]} args={[0.5, 0.4, 0.16]} color={theme.cushion} roughness={0.85} />
			<Box position={[1.2, 0.72, -0.28]} args={[0.5, 0.4, 0.16]} color={theme.chairBack} roughness={0.85} />
			{/* wooden feet */}
			<Box position={[-1.6, 0.05, 0.45]} args={[0.12, 0.12, 0.12]} color={theme.wood} />
			<Box position={[1.6, 0.05, 0.45]} args={[0.12, 0.12, 0.12]} color={theme.wood} />
		</group>
	);
}

function CoffeeTable3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(124, 92.6);
	return (
		<group position={[wx, 0, wz]}>
			<mesh position={[0, 0.34, 0]} castShadow receiveShadow>
				<cylinderGeometry args={[0.72, 0.78, 0.07, 28]} />
				<meshStandardMaterial color={theme.tableTop} roughness={0.55} />
			</mesh>
			<mesh position={[0, 0.16, 0]}>
				<cylinderGeometry args={[0.5, 0.6, 0.3, 20]} />
				<meshStandardMaterial color={theme.table} roughness={0.65} />
			</mesh>
			{/* mug + book */}
			<mesh position={[-0.3, 0.44, -0.1]} castShadow>
				<cylinderGeometry args={[0.09, 0.08, 0.14, 12]} />
				<meshStandardMaterial color={theme.chairBack} roughness={0.6} />
			</mesh>
			<Box position={[0.3, 0.42, 0.16]} args={[0.42, 0.05, 0.3]} color={theme.cushion} roughness={0.8} />
		</group>
	);
}

function Rug3D({ x, y, theme, r = 2.1 }: { x: number; y: number; theme: Palette; r?: number }) {
	const [wx, , wz] = to3d(x, y);
	return (
		<group position={[wx, 0, wz]}>
			<mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<circleGeometry args={[r, 40]} />
				<meshStandardMaterial color={theme.rug} roughness={0.95} />
			</mesh>
			<mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<ringGeometry args={[r - 0.3, r - 0.18, 40]} />
				<meshBasicMaterial color={theme.rugRing} transparent opacity={0.6} />
			</mesh>
		</group>
	);
}

function FloorLamp3D({ x, y, theme }: { x: number; y: number; theme: Palette }) {
	const [wx, , wz] = to3d(x, y);
	return (
		<group position={[wx, 0, wz]}>
			<pointLight position={[0, 1.9, 0]} color={theme.lampGlow} intensity={2.6} distance={6.5} decay={2} />
			<mesh position={[0, 0.04, 0]}>
				<cylinderGeometry args={[0.22, 0.26, 0.05, 16]} />
				<meshStandardMaterial color={theme.chair} roughness={0.5} metalness={0.3} />
			</mesh>
			<mesh position={[0, 1, 0]}>
				<cylinderGeometry args={[0.03, 0.03, 1.9, 8]} />
				<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.55} />
			</mesh>
			<mesh position={[0, 2.05, 0]}>
				<cylinderGeometry args={[0.28, 0.4, 0.32, 20, 1, true]} />
				<meshStandardMaterial color={theme.screenGlow} roughness={0.6} side={THREE.DoubleSide} emissive={theme.lampGlow} emissiveIntensity={0.35} />
			</mesh>
			<mesh position={[0, 1.9, 0]}>
				<sphereGeometry args={[0.12, 12, 8]} />
				<meshStandardMaterial color={theme.lampGlow} emissive={theme.lampGlow} emissiveIntensity={1.2} />
			</mesh>
		</group>
	);
}

function Plant3D({ x, y, theme, size = 1 }: { x: number; y: number; theme: Palette; size?: number }) {
	const [wx, , wz] = to3d(x, y);
	return (
		<group position={[wx, 0, wz]} scale={size}>
			<mesh position={[0, 0.22, 0]} castShadow>
				<cylinderGeometry args={[0.24, 0.3, 0.44, 14]} />
				<meshStandardMaterial color={theme.plantPot} roughness={0.7} />
			</mesh>
			<mesh position={[0, 0.46, 0]}>
				<cylinderGeometry args={[0.26, 0.26, 0.05, 14]} />
				<meshStandardMaterial color={theme.plantDark} roughness={0.8} />
			</mesh>
			<mesh position={[0, 0.75, 0]} castShadow>
				<sphereGeometry args={[0.34, 16, 12]} />
				<meshStandardMaterial color={theme.plant} roughness={0.75} />
			</mesh>
			<mesh position={[0.16, 0.98, 0.08]} castShadow>
				<sphereGeometry args={[0.22, 16, 12]} />
				<meshStandardMaterial color={theme.plantDark} roughness={0.75} />
			</mesh>
			<mesh position={[-0.18, 0.92, -0.1]} castShadow>
				<sphereGeometry args={[0.19, 16, 12]} />
				<meshStandardMaterial color={theme.plant} roughness={0.75} />
			</mesh>
			<mesh position={[0, 1.16, 0]}>
				<sphereGeometry args={[0.14, 12, 10]} />
				<meshStandardMaterial color={theme.plant} roughness={0.75} />
			</mesh>
		</group>
	);
}

function CoffeeBar3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(68, 82);
	return (
		<group position={[wx, 0, wz]}>
			<Box position={[0, 0.42, 0]} args={[2.6, 0.16, 1.1]} color={theme.woodTop} roughness={0.55} />
			<Box position={[0, 0.2, 0]} args={[2.5, 0.68, 1]} color={theme.wood} roughness={0.7} />
			{/* machine */}
			<Box position={[-0.6, 0.72, -0.16]} args={[0.85, 0.5, 0.6]} color={theme.metal} roughness={0.35} metalness={0.45} />
			<Box position={[-0.6, 0.56, 0.16]} args={[0.6, 0.16, 0.06]} color={theme.monitor} roughness={0.4} />
			<mesh position={[-0.6, 0.45, 0.16]}>
				<planeGeometry args={[0.14, 0.08]} />
				<meshStandardMaterial color={theme.screenGlow} emissive={theme.screenGlow} emissiveIntensity={1} />
			</mesh>
			{/* cups */}
			<mesh position={[0.5, 0.55, 0.1]} castShadow>
				<cylinderGeometry args={[0.1, 0.09, 0.09, 12]} />
				<meshStandardMaterial color={theme.chairSeat} roughness={0.7} />
			</mesh>
			<mesh position={[0.78, 0.54, 0.05]} castShadow>
				<cylinderGeometry args={[0.08, 0.07, 0.07, 12]} />
				<meshStandardMaterial color={theme.chairSeat} roughness={0.7} />
			</mesh>
		</group>
	);
}

function Whiteboard3D({ theme }: { theme: Palette }) {
	const halfD = 50 * SCALE;
	const face = useMemo(() => whiteboardTexture(theme), [theme]);
	useEffect(() => () => face.dispose(), [face]);
	return (
		<group position={[3.1, 1.75, -halfD + 0.1]}>
			<Box position={[0, 0, 0.04]} args={[2.5, 1.5, 0.08]} color={theme.metal} roughness={0.4} metalness={0.3} />
			<mesh position={[0, 0, 0.09]}>
				<planeGeometry args={[2.3, 1.32]} />
				<meshStandardMaterial map={face} roughness={0.5} />
			</mesh>
			<Box position={[0, -0.82, 0.12]} args={[1.7, 0.06, 0.14]} color={theme.metal} roughness={0.4} metalness={0.3} />
		</group>
	);
}

function Bookshelf3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(150, 42);
	const spineColors: string[] = [theme.cushion, theme.plant, theme.accent, theme.cushion, theme.chairBack];
	return (
		<group position={[wx, 0, wz]} rotation={[0, -Math.PI / 2, 0]}>
			<Box position={[0, 1.5, 0]} args={[1.4, 3, 0.5]} color={theme.wood} roughness={0.7} />
			{[0.6, 1.55, 2.5].map((shelfY) => (
				<Box key={shelfY} position={[0, shelfY, 0.08]} args={[1.24, 0.06, 0.42]} color={theme.woodTop} roughness={0.6} />
			))}
			{[0.6, 1.55].map((shelfY, row) =>
				[-0.45, -0.25, -0.05, 0.18, 0.38].map((dx, i) => {
					const h = 0.55 + ((i + row) % 3) * 0.12;
					return (
						<Box
							key={`${shelfY}-${dx}`}
							position={[dx, shelfY + 0.03 + h / 2, 0.05]}
							args={[0.14, h, 0.3]}
							color={spineColors[(i + row) % spineColors.length] ?? theme.cushion}
							roughness={0.75}
						/>
					);
				}),
			)}
			{/* trailing plant on top */}
			<mesh position={[-0.35, 3.16, 0]} castShadow>
				<sphereGeometry args={[0.17, 12, 10]} />
				<meshStandardMaterial color={theme.plant} roughness={0.75} />
			</mesh>
		</group>
	);
}


// ── architecture ─────────────────────────────────────────────────────────────

/** A framed glass partition between two floor points. */
function GlassWall3D({
	x1,
	y1,
	x2,
	y2,
	theme,
	height = 2.7,
}: {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	theme: Palette;
	height?: number;
}) {
	const [ax, , az] = to3d(x1, y1);
	const [bx, , bz] = to3d(x2, y2);
	const dx = bx - ax;
	const dz = bz - az;
	const length = Math.hypot(dx, dz);
	const angle = Math.atan2(-dz, dx);
	const mullions = Math.max(1, Math.round(length / 2.6));
	return (
		<group position={[(ax + bx) / 2, 0, (az + bz) / 2]} rotation={[0, angle, 0]}>
			<Box position={[0, 0.45, 0]} args={[length, 0.9, 0.075]} color={theme.partition} roughness={0.88} />
			<mesh position={[0, 0.9 + (height - 0.9) / 2, 0]}>
				<boxGeometry args={[length, height - 0.9, 0.035]} />
				<meshPhysicalMaterial
					color={theme.windowGlass}
					transparent
					opacity={0.2}
					roughness={0.08}
					metalness={0.02}
					side={THREE.DoubleSide}
					depthWrite={false}
				/>
			</mesh>
			<Box position={[0, 0.92, 0]} args={[length, 0.035, 0.07]} color={theme.partitionFrame} roughness={0.4} metalness={0.3} />
			<Box position={[0, 0.08, 0]} args={[length, 0.12, 0.09]} color={theme.partitionFrame} roughness={0.45} metalness={0.25} />
			<Box position={[0, height - 0.04, 0]} args={[length, 0.08, 0.09]} color={theme.partitionFrame} roughness={0.45} metalness={0.25} />
			{Array.from({ length: mullions + 1 }, (_, i) => {
				const t = i / mullions - 0.5;
				return (
					<Box
						key={i}
						position={[length * t, height / 2, 0]}
						args={[0.035, height, 0.065]}
						color={theme.partitionFrame}
						roughness={0.4}
						metalness={0.35}
					/>
				);
			})}
		</group>
	);
}

/** Two bookable glass meeting rooms, matching the 2D plan. */
function MeetingRooms3D({ theme }: { theme: Palette }) {
	return (
		<group>
			{/* room 01 */}
			<GlassWall3D x1={88} y1={5} x2={154} y2={5} theme={theme} />
			<GlassWall3D x1={154} y1={5} x2={154} y2={32.5} theme={theme} />
			<GlassWall3D x1={88} y1={32.5} x2={154} y2={32.5} theme={theme} />
			<GlassWall3D x1={88} y1={5} x2={88} y2={23} theme={theme} />
			<GlassWall3D x1={88} y1={30} x2={88} y2={32.5} theme={theme} />
			{/* room 02 */}
			<GlassWall3D x1={154} y1={32.5} x2={154} y2={64.5} theme={theme} />
			<GlassWall3D x1={88} y1={64.5} x2={154} y2={64.5} theme={theme} />
			<GlassWall3D x1={88} y1={32.5} x2={88} y2={52} theme={theme} />
			<GlassWall3D x1={88} y1={58} x2={88} y2={64.5} theme={theme} />
			{/* ajar leaves */}
			<GlassWall3D x1={88} y1={23} x2={94.8} y2={25.6} theme={theme} height={2.35} />
			<GlassWall3D x1={88} y1={52} x2={94.8} y2={49.4} theme={theme} height={2.35} />
		</group>
	);
}

/** Galley kitchen along the right wall: counter, sink, cooktop, fridge, stools. */
function Kitchen3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(150, 80);
	return (
		<group position={[wx, 0, wz]}>
			<Box position={[0, 0.88, 0]} args={[1.45, 0.09, 3.9]} color={theme.counterTop} roughness={0.5} />
			<Box position={[0, 0.43, 0]} args={[1.3, 0.84, 3.72]} color={theme.counter} roughness={0.7} />
			<Box position={[0, 0.07, 0]} args={[1.18, 0.14, 3.55]} color={theme.partition} roughness={0.7} />
			<Box position={[0.1, 2.1, 0]} args={[0.5, 0.9, 2.55]} color={theme.counterTop} roughness={0.65} />
			<Box position={[0.1, 1.62, 0]} args={[0.56, 0.06, 2.5]} color={theme.wood} roughness={0.6} />
			{/* fridge */}
			<Box position={[0.02, 1.04, -1.82]} args={[1.28, 2.08, 0.72]} color={theme.appliance} roughness={0.4} metalness={0.35} />
			<Box position={[-0.48, 0.95, -1.45]} args={[0.035, 0.34, 0.05]} color={theme.metal} roughness={0.3} metalness={0.55} />
			<Box position={[-0.48, 1.38, -1.45]} args={[0.035, 0.2, 0.05]} color={theme.metal} roughness={0.3} metalness={0.55} />
			{/* sink + cooktop */}
			<Box position={[-0.12, 0.925, 0.4]} args={[0.68, 0.03, 0.62]} color={theme.appliance} roughness={0.35} />
			<mesh position={[-0.12, 0.9, 0.4]}>
				<boxGeometry args={[0.48, 0.02, 0.42]} />
				<meshStandardMaterial color={theme.monitor} roughness={0.35} metalness={0.3} />
			</mesh>
			<Box position={[-0.02, 0.94, 1.42]} args={[0.7, 0.035, 0.66]} color={theme.monitor} roughness={0.4} />
			{[0, 1, 2, 3].map((i) => (
				<mesh key={i} position={[-0.18 + (i % 2) * 0.3, 0.965, 1.28 + Math.floor(i / 2) * 0.28]}>
					<cylinderGeometry args={[0.07, 0.07, 0.012, 14]} />
					<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.45} />
				</mesh>
			))}
			{/* kettle + jars */}
			<mesh position={[0.15, 1.02, 2.05]} castShadow>
				<cylinderGeometry args={[0.1, 0.12, 0.2, 14]} />
				<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.45} />
			</mesh>
			<Box position={[0.12, 1.02, 2.38]} args={[0.14, 0.2, 0.14]} color={theme.cushion} roughness={0.65} />
			{/* stools */}
			{[-0.7, 0.85].map((z) => (
				<group key={z} position={[-1.1, 0, z]}>
					<mesh position={[0, 0.52, 0]} castShadow>
						<cylinderGeometry args={[0.2, 0.22, 0.08, 16]} />
						<meshStandardMaterial color={theme.chairSeat} roughness={0.65} />
					</mesh>
					<mesh position={[0, 0.26, 0]}>
						<cylinderGeometry args={[0.035, 0.035, 0.48, 8]} />
						<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.55} />
					</mesh>
					<mesh position={[0, 0.04, 0]}>
						<cylinderGeometry args={[0.16, 0.18, 0.04, 14]} />
						<meshStandardMaterial color={theme.chair} roughness={0.5} metalness={0.3} />
					</mesh>
				</group>
			))}
		</group>
	);
}

/** Reception desk by the front door. */
function Reception3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(32, 89.5);
	return (
		<group position={[wx, 0, wz]}>
			<Box position={[0, 0.52, 0]} args={[3.1, 0.09, 1.02]} color={theme.counterTop} roughness={0.5} />
			<Box position={[0, 0.96, -0.08]} args={[3.35, 0.07, 0.95]} color={theme.woodTop} roughness={0.55} />
			<Box position={[0, 0.46, 0.42]} args={[2.92, 0.86, 0.22]} color={theme.reception} roughness={0.75} />
			<Box position={[-0.58, 1.18, -0.1]} args={[0.76, 0.42, 0.055]} color={theme.monitorBezel} roughness={0.4} />
			<mesh position={[-0.58, 1.18, -0.07]}>
				<planeGeometry args={[0.62, 0.3]} />
				<meshStandardMaterial color={theme.monitorOn} emissive={theme.accent} emissiveIntensity={0.25} roughness={0.35} />
			</mesh>
			<mesh position={[0.7, 1.06, 0.08]} castShadow>
				<cylinderGeometry args={[0.08, 0.07, 0.14, 12]} />
				<meshStandardMaterial color={theme.chairBack} roughness={0.6} />
			</mesh>
			<mesh position={[0, 0.08, 1.05]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<planeGeometry args={[2.6, 0.9]} />
				<meshStandardMaterial color={theme.rug} roughness={0.95} />
			</mesh>
			<group position={[0.9, 0, -0.72]}>
				<mesh position={[0, 0.46, 0]} castShadow>
					<cylinderGeometry args={[0.24, 0.27, 0.08, 16]} />
					<meshStandardMaterial color={theme.chairSeat} roughness={0.65} />
				</mesh>
				<Box position={[0, 0.78, -0.2]} args={[0.42, 0.5, 0.07]} color={theme.chairBack} roughness={0.6} />
			</group>
			{/* logo planter wall */}
			<Box position={[-2.0, 0.44, -0.2]} args={[0.55, 0.88, 0.55]} color={theme.plantPot} roughness={0.7} />
			<mesh position={[-2.0, 1.12, -0.2]} castShadow>
				<sphereGeometry args={[0.38, 14, 10]} />
				<meshStandardMaterial color={theme.plant} roughness={0.75} />
			</mesh>
		</group>
	);
}

/** Staff lockers on the left wall. */
function Lockers3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(4.8, 52);
	return (
		<group position={[wx, 0, wz]}>
			<Box position={[0, 1.05, 0]} args={[0.62, 2.1, 3.35]} color={theme.reception} roughness={0.7} />
			{[-1.24, -0.41, 0.42, 1.25].map((z) => (
				<group key={z}>
					<Box position={[0.33, 1.04, z]} args={[0.035, 1.9, 0.76]} color={theme.partition} roughness={0.7} />
					<Box position={[0.36, 1.45, z]} args={[0.025, 0.04, 0.28]} color={theme.metal} roughness={0.35} metalness={0.5} />
					<Box position={[0.36, 0.58, z]} args={[0.025, 0.03, 0.3]} color={theme.metal} roughness={0.35} metalness={0.5} />
				</group>
			))}
		</group>
	);
}

/** Printer / supply station. */
function Printer3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(82, 71);
	return (
		<group position={[wx, 0, wz]}>
			<Box position={[0, 0.42, 0]} args={[1.45, 0.08, 0.9]} color={theme.woodTop} roughness={0.55} />
			<Box position={[0, 0.2, 0]} args={[1.35, 0.38, 0.8]} color={theme.wood} roughness={0.65} />
			<Box position={[0, 0.65, -0.12]} args={[0.72, 0.4, 0.5]} color={theme.appliance} roughness={0.4} />
			<Box position={[0, 0.72, 0.14]} args={[0.48, 0.05, 0.22]} color={theme.monitorBezel} roughness={0.4} />
			<Box position={[0.32, 0.5, 0.18]} args={[0.3, 0.12, 0.25]} color={theme.chairSeat} roughness={0.7} />
		</group>
	);
}

/** Perimeter beams + recessed light panels, kept open in the middle so the
 *  camera still reads the whole floor. */
function CeilingRig3D({ theme }: { theme: Palette }) {
	const halfW = 80 * SCALE;
	const halfD = 50 * SCALE;
	return (
		<group>
			<Box position={[0, WALL_H - 0.08, -halfD + 0.13]} args={[halfW * 2, 0.16, 0.26]} color={theme.ceilingBeam} roughness={0.8} />
			<Box position={[-halfW + 0.13, WALL_H - 0.08, 0]} args={[0.26, 0.16, halfD * 2]} color={theme.ceilingBeam} roughness={0.8} />
			<Box position={[halfW - 0.13, WALL_H - 0.08, 0]} args={[0.26, 0.16, halfD * 2]} color={theme.ceilingBeam} roughness={0.8} />
			{[32.5, 64.5].map((floorY) => {
				const z = (floorY - 50) * SCALE;
				return (
					<Box key={floorY} position={[0, WALL_H - 0.09, z]} args={[halfW * 2, 0.1, 0.14]} color={theme.ceilingBeam} roughness={0.8} />
				);
			})}
			{([
				[-6.2, -2.2, 2.4],
				[6.2, -2.8, 2.2],
				[5.8, 5.4, 2.4],
			] as Array<[number, number, number]>).map(([x, z, w]) => (
				<group key={`${x}-${z}`} position={[x, WALL_H - 0.13, z]}>
					<Box position={[0, 0, 0]} args={[w, 0.035, 0.34]} color={theme.ceilingLight} emissive={theme.ceilingLight} emissiveIntensity={1.35} />
					<mesh position={[0, -0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
						<planeGeometry args={[w + 0.2, 0.48]} />
						<meshBasicMaterial color={theme.ceilingLight} transparent opacity={0.1} depthWrite={false} />
					</mesh>
				</group>
			))}
		</group>
	);
}

/** Soft light pool on the floor, used beneath the skylights/windows. */
function LightPool3D({ x, y, r, color, opacity = 0.075 }: { x: number; y: number; r: number; color: string; opacity?: number }) {
	const [wx, , wz] = to3d(x, y);
	return (
		<mesh position={[wx, 0.045, wz]} rotation={[-Math.PI / 2, 0, 0]}>
			<circleGeometry args={[r, 28]} />
			<meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
		</mesh>
	);
}



/** Flat woven runner on the work-zone aisle. */
function RectRug3D({ x, y, w, h, theme }: { x: number; y: number; w: number; h: number; theme: Palette }) {
	const [wx, , wz] = to3d(x, y);
	return (
		<group position={[wx, 0, wz]}>
			<mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<planeGeometry args={[w * SCALE, h * SCALE]} />
				<meshStandardMaterial color={theme.rug} roughness={0.95} />
			</mesh>
			<mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<planeGeometry args={[(w - 2) * SCALE, (h - 2) * SCALE]} />
				<meshBasicMaterial color={theme.rugRing} transparent opacity={0.45} />
			</mesh>
		</group>
	);
}

/** Standing-height collaboration table on the work-zone runner. */
function CollabTable3D({ theme }: { theme: Palette }) {
	const [wx, , wz] = to3d(44, 55);
	return (
		<group position={[wx, 0, wz]}>
			<mesh position={[0, 0.98, 0]} castShadow receiveShadow>
				<cylinderGeometry args={[0.82, 0.86, 0.08, 28]} />
				<meshStandardMaterial color={theme.tableTop} roughness={0.55} />
			</mesh>
			<mesh position={[0, 0.55, 0]}>
				<cylinderGeometry args={[0.09, 0.12, 0.82, 12]} />
				<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.5} />
			</mesh>
			<mesh position={[0, 0.06, 0]}>
				<cylinderGeometry args={[0.38, 0.44, 0.06, 20]} />
				<meshStandardMaterial color={theme.chair} roughness={0.5} metalness={0.3} />
			</mesh>
			<Box position={[-0.18, 1.04, -0.18]} args={[0.46, 0.02, 0.3]} color={theme.monitorBezel} roughness={0.4} />
			<Box position={[-0.18, 1.16, -0.3]} args={[0.46, 0.26, 0.02]} color={theme.monitorBezel} roughness={0.4} />
			<mesh position={[-0.18, 1.17, -0.285]} rotation={[-0.12, 0, 0]}>
				<planeGeometry args={[0.39, 0.2]} />
				<meshStandardMaterial color={theme.screenGlow} emissive={theme.screenGlow} emissiveIntensity={0.85} />
			</mesh>
			<Box position={[0.25, 1.04, 0.2]} args={[0.3, 0.035, 0.22]} color={theme.cushion} roughness={0.8} />
			{/* stools */}
			{[0, 1, 2, 3].map((i) => {
				const rad = (i * Math.PI) / 2;
				const x = Math.cos(rad) * 1.15;
				const z = Math.sin(rad) * 1.15;
				return (
					<group key={i} position={[x, 0, z]}>
						<mesh position={[0, 0.5, 0]} castShadow>
							<cylinderGeometry args={[0.19, 0.21, 0.07, 14]} />
							<meshStandardMaterial color={theme.chairSeat} roughness={0.65} />
						</mesh>
						<mesh position={[0, 0.25, 0]}>
							<cylinderGeometry args={[0.03, 0.03, 0.46, 8]} />
							<meshStandardMaterial color={theme.metal} roughness={0.35} metalness={0.55} />
						</mesh>
					</group>
				);
			})}
			<pointLight position={[0, 2.35, 0]} intensity={1.8} distance={5} decay={2} color={theme.lampGlow} />
			<group position={[0, 2.8, 0]}>
				<mesh position={[0, 0.3, 0]}>
					<cylinderGeometry args={[0.012, 0.012, 0.6, 6]} />
					<meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.5} />
				</mesh>
				<mesh position={[0, 0, 0]}>
					<cylinderGeometry args={[0.34, 0.52, 0.16, 20, 1, true]} />
					<meshStandardMaterial color={theme.partitionFrame} roughness={0.55} side={THREE.DoubleSide} />
				</mesh>
				<mesh position={[0, -0.08, 0]}>
					<sphereGeometry args={[0.1, 12, 8]} />
					<meshStandardMaterial color={theme.lampGlow} emissive={theme.lampGlow} emissiveIntensity={1.2} />
				</mesh>
			</group>
		</group>
	);
}

/** Subtle vertical wall panelling + a chair rail on the window wall. */
function WallPanels3D({ theme }: { theme: Palette }) {
	const halfD = 50 * SCALE;
	return (
		<group>
			{Array.from({ length: 14 }, (_, i) => (
				<Box
					key={i}
					position={[-13.2 + i * 2.05, 1.75, -halfD + 0.035]}
					args={[0.035, 2.55, 0.035]}
					color={theme.wallEdge}
					roughness={0.75}
				/>
			))}
			<Box position={[0, 0.98, -halfD + 0.04]} args={[29.2, 0.05, 0.06]} color={theme.ceilingBeam} roughness={0.7} />
			<Box position={[0, 2.7, -halfD + 0.04]} args={[29.2, 0.06, 0.06]} color={theme.ceilingBeam} roughness={0.7} />
		</group>
	);
}

/** Linear fixtures floating above the work tables and reception. */
function LinearPendants3D({ theme }: { theme: Palette }) {
	const rows: Array<[number, number, number]> = [
		[-6.4, -2.4, 3.1],
		[6.4, -2.4, 3.1],
		[0.1, 0.55, 2.4],
		[8.0, 5.0, 2.2],
	];
	return (
		<group>
			{rows.map(([x, z, w]) => (
				<group key={`${x}-${z}`} position={[x, 2.88, z]}>
					<Box position={[0, 0, 0]} args={[w, 0.055, 0.14]} color={theme.partitionFrame} roughness={0.45} metalness={0.35} />
					<Box position={[0, -0.04, 0]} args={[w - 0.1, 0.02, 0.1]} color={theme.ceilingLight} emissive={theme.ceilingLight} emissiveIntensity={1.25} />
					{[-w / 2 + 0.35, w / 2 - 0.35].map((cx) => (
						<mesh key={cx} position={[cx, 0.3, 0]}>
							<cylinderGeometry args={[0.008, 0.008, 0.58, 6]} />
							<meshStandardMaterial color={theme.metal} roughness={0.4} metalness={0.5} />
						</mesh>
					))}
				</group>
			))}
		</group>
	);
}

// ── characters ──────────────────────────────────────────────────────────────

function Character({
	visual,
	store,
	theme,
	bubbleVisible,
	onCoworkerClick,
}: {
	visual: CoworkerVisual;
	store: FloorStore;
	theme: Palette;
	bubbleVisible: boolean;
	onCoworkerClick?: (coworkerId: string) => void;
}) {
	const group = useRef<THREE.Group>(null);
	const bodyRef = useRef<THREE.Group>(null);
	const headRef = useRef<THREE.Group>(null);
	const leftEye = useRef<THREE.Mesh>(null);
	const rightEye = useRef<THREE.Mesh>(null);
	const leftFoot = useRef<THREE.Mesh>(null);
	const rightFoot = useRef<THREE.Mesh>(null);
	const aura = useRef<THREE.Mesh>(null);
	const bubbleSprite = useRef<THREE.Sprite>(null);
	const labelTex = useMemo(
		() => labelTexture(visual.name, visual.title, theme),
		[visual.name, visual.title, theme],
	);
	const [faceTexture, setFaceTexture] = useState<THREE.Texture | null>(null);

	useEffect(() => {
		if (!visual.image) {
			setFaceTexture(null);
			return;
		}
		let disposed = false;
		const texture = new THREE.TextureLoader().load(visual.image, (loaded) => {
			loaded.colorSpace = THREE.SRGBColorSpace;
			loaded.anisotropy = 8;
			if (!disposed) setFaceTexture(loaded);
		});
		return () => {
			disposed = true;
			texture.dispose();
		};
	}, [visual.image]);
	const [worldX, , worldZ] = to3d(visual.pos.x, visual.pos.y);

	useEffect(() => () => labelTex.dispose(), [labelTex]);
	useEffect(() => () => {
		document.body.style.cursor = "default";
	}, []);

	const bubble = visual.bubble && Date.now() < visual.bubble.until ? visual.bubble : null;
	const bubbleTex = useMemo(
		() => (bubble ? bubbleTexture(bubble.text, visual.color, theme) : null),
		[bubble, visual.color, theme],
	);
	useEffect(() => () => bubbleTex?.dispose(), [bubbleTex]);

	useFrame((state, delta) => {
		const live = store.getState().coworkers.find((c) => c.id === visual.id);
		if (!live || !group.current) return;
		// Bubbles expire on wall-clock time; the sprite is hidden here so a
		// quiet floor does not need a React update to clear it.
		const liveBubble = live.bubble && Date.now() < live.bubble.until ? live.bubble : null;
		if (bubbleSprite.current) bubbleSprite.current.visible = Boolean(liveBubble) && bubbleVisible;
		const [tx, , tz] = to3d(live.pos.x, live.pos.y);
		const lerp = 1 - Math.pow(0.02, delta);
		const pos = group.current.position;
		pos.x += (tx - pos.x) * lerp;
		pos.z += (tz - pos.z) * lerp;
		const t = state.clock.elapsedTime;
		if (bodyRef.current) {
			if (live.walkT !== null) {
				bodyRef.current.position.y = Math.abs(Math.sin(t * 9)) * 0.06;
			} else if (liveBubble) {
				bodyRef.current.position.y = Math.abs(Math.sin(t * 5)) * 0.04;
			} else if (live.status === "tool_calling") {
				bodyRef.current.position.y = Math.abs(Math.sin(t * 12)) * 0.025;
			} else {
				bodyRef.current.position.y = Math.sin(t * 1.8 + pos.x) * 0.015;
			}
		}
		// Blink: a quick pinch every few seconds, offset per character.
		const blinkPhase = (t + pos.x * 3.1) % 4.2;
		const blink = blinkPhase > 3.9 ? Math.max(0.08, Math.abs(Math.sin((blinkPhase - 3.9) * 15))) : 1;
		if (leftEye.current) leftEye.current.scale.y = blink;
		if (rightEye.current) rightEye.current.scale.y = blink;
		// Feet scissor while walking.
		const stride = live.walkT !== null ? Math.sin(t * 14) * 0.16 : 0;
		if (leftFoot.current) leftFoot.current.position.z = 0.02 + stride;
		if (rightFoot.current) rightFoot.current.position.z = 0.02 - stride;
		// Talking: the head gives a little bounce.
		if (headRef.current) {
			headRef.current.scale.y = liveBubble ? 1 + Math.sin(t * 7) * 0.05 : 1;
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
	const seatedScale = visual.inMeeting ? 0.88 : 1;

	return (
		<group
			ref={group}
			position={[worldX, 0, worldZ]}
			scale={seatedScale}
			onClick={
				onCoworkerClick
					? (event) => {
							event.stopPropagation();
							onCoworkerClick(visual.id);
						}
					: undefined
			}
			onPointerOver={
				onCoworkerClick
					? () => {
							document.body.style.cursor = "pointer";
						}
					: undefined
			}
			onPointerOut={
				onCoworkerClick
					? () => {
							document.body.style.cursor = "default";
						}
					: undefined
			}
		>
			{/* contact shadow */}
			<mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<circleGeometry args={[0.42, 24]} />
				<meshBasicMaterial color="#000000" transparent opacity={0.25} />
			</mesh>
			<group ref={bodyRef}>
				{/* feet */}
				<mesh ref={leftFoot} position={[-0.14, 0.1, 0.02]} castShadow>
					<sphereGeometry args={[0.09, 10, 8]} />
					<meshStandardMaterial color={theme.chairBack} roughness={0.7} />
				</mesh>
				<mesh ref={rightFoot} position={[0.14, 0.1, 0.02]} castShadow>
					<sphereGeometry args={[0.09, 10, 8]} />
					<meshStandardMaterial color={theme.chairBack} roughness={0.7} />
				</mesh>
				{/* body capsule with a lighter face patch */}
				<mesh position={[0, 0.62, 0]} castShadow>
					<capsuleGeometry args={[0.3, 0.45, 8, 16]} />
					<meshStandardMaterial color={visual.color} roughness={0.45} />
				</mesh>
				{/* base trim */}
				<mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
					<ringGeometry args={[0.24, 0.3, 24]} />
					<meshBasicMaterial color={visual.color} transparent opacity={0.55} />
				</mesh>
				<group ref={headRef} position={[0, 1.26, 0]}>
					<mesh castShadow>
						<sphereGeometry args={[0.33, 24, 16]} />
						<meshStandardMaterial color={visual.color} roughness={0.4} />
					</mesh>
					{faceTexture ? (
						<mesh position={[0, 0, 0.335]}>
							<circleGeometry args={[0.27, 32]} />
							<meshBasicMaterial map={faceTexture} transparent />
						</mesh>
					) : (
						<>
							{/* eyes with the blink rig */}
							<mesh ref={leftEye} position={[-0.12, 0.05, 0.29]}>
								<sphereGeometry args={[0.05, 10, 8]} />
								<meshBasicMaterial color="#ffffff" />
							</mesh>
							<mesh ref={rightEye} position={[0.12, 0.05, 0.29]}>
								<sphereGeometry args={[0.05, 10, 8]} />
								<meshBasicMaterial color="#ffffff" />
							</mesh>
						</>
					)}
				</group>
				{/* status aura ring */}
				<mesh ref={aura} position={[0, 1.85, 0]} rotation={[Math.PI / 2.6, 0, 0]}>
					<torusGeometry args={[0.42, 0.025, 8, 40]} />
					<meshBasicMaterial color={auraColor} transparent opacity={0.85} />
				</mesh>
			</group>
			{/* name label */}
			<sprite position={[0, 2.5, 0]} scale={[2.35, 0.66, 1]}>
				<spriteMaterial map={labelTex} transparent depthTest={false} />
			</sprite>
			{bubbleTex && (
				<sprite ref={bubbleSprite} position={[0, 3.15, 0]} scale={[2.6, 0.82, 1]}>
					<spriteMaterial map={bubbleTex} transparent depthTest={false} />
				</sprite>
			)}
		</group>
	);
}


/** Wall clock on the left wall, keeping the office in real time. */
function Clock3D({ theme }: { theme: Palette }) {
	const halfW = 80 * SCALE;
	const now = new Date();
	const hour = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5;
	const minute = now.getMinutes() * 6;
	return (
		<group position={[-halfW + 0.075, 2.18, -1.3]} rotation={[0, Math.PI / 2, 0]}>
			<mesh>
				<circleGeometry args={[0.28, 36]} />
				<meshStandardMaterial color={theme.whiteboard} roughness={0.5} />
			</mesh>
			<mesh position={[0, 0, 0.01]}>
				<ringGeometry args={[0.25, 0.29, 36]} />
				<meshBasicMaterial color={theme.partitionFrame} />
			</mesh>
			{Array.from({ length: 12 }, (_, i) => {
				const angle = (i / 12) * Math.PI * 2;
				return (
					<mesh key={i} position={[Math.sin(angle) * 0.22, Math.cos(angle) * 0.22, 0.02]}>
						<circleGeometry args={[i % 3 === 0 ? 0.012 : 0.006, 8]} />
						<meshBasicMaterial color={theme.labelMuted} />
					</mesh>
				);
			})}
			<mesh position={[0, 0.075, 0.025]} rotation={[0, 0, -((hour * Math.PI) / 180)]}>
				<boxGeometry args={[0.012, 0.16, 0.008]} />
				<meshBasicMaterial color={theme.label} />
			</mesh>
			<mesh position={[0, 0.11, 0.03]} rotation={[0, 0, -((minute * Math.PI) / 180)]}>
				<boxGeometry args={[0.007, 0.23, 0.008]} />
				<meshBasicMaterial color={theme.label} />
			</mesh>
			<mesh position={[0, 0, 0.035]}>
				<circleGeometry args={[0.018, 12]} />
				<meshBasicMaterial color={theme.accent} />
			</mesh>
		</group>
	);
}

// ── camera rig ──────────────────────────────────────────────────────────────

const CAMERA_DEFAULTS = { azimuth: 0.42, polar: 0.92, radius: 26 };

function CameraRig({ target = [0, 0, 0] as [number, number, number], idleOrbit = true }: { target?: [number, number, number]; idleOrbit?: boolean }) {
	const { camera, size } = useThree();
	// The office is wide (about 1.6:1). In a tall sidebar, pulling the camera
	// back keeps the room readable instead of filling the panel with the middle
	// two desks; the scene background covers the remaining margin.
	const fitRadius = useMemo(() => {
		const aspect = size.width / Math.max(1, size.height);
		const fov = (camera as THREE.PerspectiveCamera).fov ?? 38;
		const vFov = (fov * Math.PI) / 180;
		const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
		const widthFit = 29 / (2 * Math.tan(hFov / 2));
		const depthFit = 18 / (2 * Math.tan(vFov / 2));
		return Math.min(48, Math.max(22, Math.max(widthFit, depthFit) * 1.15));
	}, [camera, size.width, size.height]);
	const fitRadiusRef = useRef(fitRadius);
	fitRadiusRef.current = fitRadius;
	const state = useRef({ ...CAMERA_DEFAULTS, radius: fitRadius, dragging: false, lx: 0, ly: 0, lastInteraction: 0 });
	const manualZoom = useRef(false);

	useEffect(() => {
		if (!manualZoom.current) state.current.radius = fitRadius;
	}, [fitRadius]);

	useEffect(() => {
		const onControl = (event: Event) => {
			const action = (event as CustomEvent<{ action?: string }>).detail?.action;
			if (action === "reset") {
				state.current = {
					...CAMERA_DEFAULTS,
					radius: fitRadiusRef.current,
					dragging: false,
					lx: 0,
					ly: 0,
					lastInteraction: performance.now(),
				};
				manualZoom.current = false;
			}
			if (action === "zoom-in" || action === "zoom-out") state.current.lastInteraction = performance.now();
			if (action === "zoom-in") {
				manualZoom.current = true;
				state.current.radius = Math.max(8, state.current.radius - 2);
			}
			if (action === "zoom-out") {
				manualZoom.current = true;
				state.current.radius = Math.min(80, state.current.radius + 2);
			}
		};
		window.addEventListener("a-coder:office-camera", onControl);
		return () => window.removeEventListener("a-coder:office-camera", onControl);
	}, []);

	useEffect(() => {
		const el = camera instanceof THREE.Camera ? (camera as THREE.PerspectiveCamera) : null;
		const dom = document.querySelector("canvas");
		if (!dom || !el) return;
		const down = (e: PointerEvent) => {
			state.current.dragging = true;
			state.current.lastInteraction = performance.now();
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
			state.current.lastInteraction = performance.now();
			manualZoom.current = true;
			state.current.radius = Math.min(80, Math.max(8, state.current.radius + e.deltaY * 0.012));
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

	useFrame(() => {
		const s = state.current;
		// A tiny breathing sway, and only until the viewer first takes control.
		// Continuous drift eventually put the camera outside a wall.
		if (!s.dragging && idleOrbit && s.lastInteraction === 0) {
			s.azimuth = CAMERA_DEFAULTS.azimuth + Math.sin(performance.now() / 16_000) * 0.025;
		}
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

function Window3D({ x, w = 3.6, theme, dark }: { x: number; w?: number; theme: Palette; dark: boolean }) {
	return (
		<group position={[x, 1.95, 0]}>
			<mesh>
				<planeGeometry args={[w, 1.55]} />
				<meshStandardMaterial
					color={theme.windowGlass}
					emissive={theme.windowGlass}
					emissiveIntensity={dark ? 0.85 : 0.55}
					roughness={0.15}
				/>
			</mesh>
			{/* frame + mullions */}
			<Box position={[0, 0.83, 0.02]} args={[w + 0.14, 0.09, 0.06]} color={theme.windowFrame} roughness={0.5} />
			<Box position={[0, -0.83, 0.02]} args={[w + 0.14, 0.09, 0.06]} color={theme.windowFrame} roughness={0.5} />
			<Box position={[-w / 2 - 0.02, 0, 0.02]} args={[0.09, 1.7, 0.06]} color={theme.windowFrame} roughness={0.5} />
			<Box position={[w / 2 + 0.02, 0, 0.02]} args={[0.09, 1.55, 0.06]} color={theme.windowFrame} roughness={0.5} />
			<Box position={[0, 0, 0.02]} args={[0.06, 1.55, 0.05]} color={theme.windowFrame} roughness={0.5} />
			<Box position={[0, 0, 0.02]} args={[w, 0.06, 0.05]} color={theme.windowFrame} roughness={0.5} />
		</group>
	);
}

/** Small framed prints on the back wall (mirrors the 2D wall art). */
function WallArt3D({ x, theme, variant = 0 }: { x: number; theme: Palette; variant?: 0 | 1 }) {
	const halfD = 50 * SCALE;
	return (
		<group position={[x, 1.95, -halfD + 0.1]}>
			<Box position={[0, 0, 0.02]} args={[1.1, 1.35, 0.06]} color={theme.wood} roughness={0.6} />
			<mesh position={[0, 0, 0.07]}>
				<planeGeometry args={[0.96, 1.2]} />
				<meshStandardMaterial color={theme.whiteboard} roughness={0.6} />
			</mesh>
			{variant === 0 ? (
				<group position={[0, 0, 0.09]}>
					<mesh position={[-0.12, 0.18, 0]}>
						<circleGeometry args={[0.22, 20]} />
						<meshBasicMaterial color={theme.accent} transparent opacity={0.7} />
					</mesh>
					<mesh position={[0.1, -0.22, 0]} rotation={[0, 0, Math.PI]}>
						<circleGeometry args={[0.24, 3]} />
						<meshBasicMaterial color={theme.cushion} transparent opacity={0.8} />
					</mesh>
				</group>
			) : (
				<group>
					<Box position={[-0.3, 0, 0.03]} args={[0.14, 0.8, 0.02]} color={theme.plant} roughness={0.7} />
					<Box position={[0, -0.05, 0.03]} args={[0.14, 0.65, 0.02]} color={theme.accent} roughness={0.7} />
					<Box position={[0.3, 0.12, 0.03]} args={[0.14, 0.9, 0.02]} color={theme.cushion} roughness={0.7} />
				</group>
			)}
		</group>
	);
}

function Environment3D({ theme, dark }: { theme: Palette; dark: boolean }) {
	const halfW = 80 * SCALE;
	const halfD = 50 * SCALE;
	// Zone texture tiles — recreated per theme, disposed with the scene.
	const textures = useMemo(
		() => ({
			planks: zoneTexture("planks", theme),
			carpet: zoneTexture("carpet", theme),
			weave: zoneTexture("weave", theme),
			tiles: zoneTexture("tiles", theme),
		}),
		[theme],
	);
	useEffect(
		() => () => {
			textures.planks.dispose();
			textures.carpet.dispose();
			textures.weave.dispose();
			textures.tiles.dispose();
		},
		[textures],
	);

	for (const texture of Object.values(textures)) {
		texture.anisotropy = 4;
	}

	const baseFloor = theme.floor;

	return (
		<group>
			{/* base floor */}
			<mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
				<planeGeometry args={[halfW * 2, halfD * 2]} />
				<meshStandardMaterial color={baseFloor} roughness={0.9} />
			</mesh>
			{/* zone floors (2D rects → world planes) */}
			{(
				[
					[45, 42, 72, 68, textures.planks],
					[121, 35, 66, 58, textures.carpet],
					[121, 80, 66, 28, textures.weave],
					[80, 88, 156, 20, textures.tiles],
				] as Array<[number, number, number, number, THREE.Texture]>
			).map(([cx, cy, w, h, tex], i) => {
				// One texture tile ~ 12 floor units, matching the 2D pattern scale.
				tex.repeat.set(Math.max(2, Math.round(w / 12)), Math.max(1.5, h / 12));
				return (
					<mesh
						key={i}
						position={[(cx - 80) * SCALE, 0.012, (cy - 50) * SCALE]}
						rotation={[-Math.PI / 2, 0, 0]}
						receiveShadow
					>
						<planeGeometry args={[w * SCALE, h * SCALE]} />
						<meshStandardMaterial map={tex} roughness={0.85} />
					</mesh>
				);
			})}
			{/* baseboard skirting on the back + side walls */}
			<Box position={[0, 0.09, -halfD + 0.02]} args={[halfW * 2, 0.18, 0.1]} color={theme.baseboard} roughness={0.6} />
			<Box position={[-halfW + 0.02, 0.09, 0]} args={[0.1, 0.18, halfD * 2]} color={theme.baseboard} roughness={0.6} />
			<Box position={[halfW - 0.02, 0.09, 0]} args={[0.1, 0.18, halfD * 2]} color={theme.baseboard} roughness={0.6} />
			{/* walls: back, left, right (front open for the camera) */}
			<Box position={[0, WALL_H / 2, -halfD - 0.15]} args={[halfW * 2 + 0.6, WALL_H, 0.3]} color={theme.wall} roughness={0.8} />
			<Box position={[-halfW - 0.15, WALL_H / 2, 0]} args={[0.3, WALL_H, halfD * 2]} color={theme.wall} roughness={0.8} />
			<Box position={[halfW + 0.15, WALL_H / 2, 0]} args={[0.3, WALL_H, halfD * 2]} color={theme.wall} roughness={0.8} />
			{/* framed windows on the back wall */}
			<group position={[0, 0, -halfD + 0.04]}>
				<Window3D x={-9.1} w={2.4} theme={theme} dark={dark} />
				<Window3D x={-0.7} w={2.4} theme={theme} dark={dark} />
				<Window3D x={4.7} w={1.8} theme={theme} dark={dark} />
			</group>
			{/* whiteboard mounted in the window gap */}
			<Whiteboard3D theme={theme} />
			{/* framed prints right of the windows */}
			<WallArt3D x={10.9} theme={theme} variant={0} />
			<WallArt3D x={12.7} theme={theme} variant={1} />
			{/* entrance: door frame + welcome mat in the front-left corridor */}
			<group position={[to3d(17, 86)[0], 0, to3d(17, 86)[2]]}>
				<Box position={[-0.9, 1.1, 0]} args={[0.12, 2.2, 0.18]} color={theme.baseboard} roughness={0.6} />
				<Box position={[0.9, 1.1, 0]} args={[0.12, 2.2, 0.18]} color={theme.baseboard} roughness={0.6} />
				<Box position={[0, 2.25, 0]} args={[1.9, 0.12, 0.18]} color={theme.baseboard} roughness={0.6} />
				<mesh position={[0, 0.02, 0.7]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
					<planeGeometry args={[1.7, 0.8]} />
					<meshStandardMaterial color={theme.rugRing} roughness={0.95} />
				</mesh>
			</group>
		</group>
	);
}

// ── scene ───────────────────────────────────────────────────────────────────

function Scene({
	store,
	theme,
	themeName,
	activeTables,
	idleOrbit,
	onCoworkerClick,
	onOpenRoom,
}: {
	store: FloorStore;
	theme: Palette;
	themeName: "dark" | "light";
	activeTables: number[];
	idleOrbit: boolean;
	onCoworkerClick?: (coworkerId: string) => void;
	onOpenRoom?: () => void;
}) {
	// Re-render on feed changes only. Walk ticks update positions in the store
	// every frame, and Character reads them in its own useFrame — subscribing
	// to the whole state here would reconcile the entire scene at 60fps.
	const visualVersion = useFloorSelector(store, (state) => state.visualVersion);
	const coworkers = useMemo(() => store.getState().coworkers, [store, visualVersion]);
	const dark = themeName === "dark";
	const bg = dark ? "#0a1020" : "#dfe7f0";
	return (
		<>
			<color attach="background" args={[bg]} />
			<fog attach="fog" args={[bg, 38, 100]} />
			<ambientLight intensity={dark ? 0.95 : 0.6} />
			<hemisphereLight intensity={dark ? 0.68 : 0.38} color={dark ? "#d8e4f5" : "#ffffff"} groundColor={theme.floor} />
			<directionalLight
				position={[10, 15, 8]}
				intensity={dark ? 2.0 : 1.2}
				color={dark ? "#e8f0ff" : "#fff6e6"}
				castShadow
				shadow-mapSize-width={2048}
				shadow-mapSize-height={2048}
				shadow-bias={-0.0004}
				shadow-normalBias={0.02}
				shadow-camera-left={-18}
				shadow-camera-right={18}
				shadow-camera-top={14}
				shadow-camera-bottom={-14}
			/>
			{/* warm ceiling wash over the zones */}
			<pointLight position={[-7, 4.6, -3.4]} intensity={dark ? 5 : 3} distance={14} decay={2} color={dark ? "#ffdcae" : "#fff2d8"} />
			<pointLight position={[7.4, 4.6, -2.8]} intensity={dark ? 5 : 3} distance={14} decay={2} color={dark ? "#ffdcae" : "#fff2d8"} />
			<pointLight position={[0.5, 4.2, 3.2]} intensity={dark ? 3.5 : 2} distance={11} decay={2} color={dark ? "#ffdcae" : "#fff2d8"} />
			<CameraRig target={[0, 0.2, 1.0]} idleOrbit={idleOrbit} />
			<Environment3D theme={theme} dark={dark} />
			<CeilingRig3D theme={theme} />
			<WallPanels3D theme={theme} />
			<LinearPendants3D theme={theme} />
			<MeetingRooms3D theme={theme} />
			<RectRug3D x={44} y={42} w={9} h={62} theme={theme} />
			<CollabTable3D theme={theme} />
			<LightPool3D x={44} y={24} r={7} color={theme.lightPool} opacity={0.05} />
			<LightPool3D x={122} y={18} r={6} color={theme.lightPool} opacity={0.06} />
			<LightPool3D x={122} y={46} r={6} color={theme.lightPool} opacity={0.06} />
			<LightPool3D x={122} y={82} r={5} color={theme.lightPool} opacity={0.07} />
			{DESK_SLOTS.map((slot, i) => {
				const owner = coworkers.find((c) => c.deskIndex === i);
				const on = owner?.status === "tool_calling" || owner?.status === "thinking";
				const flip = slot.x > 53;
				return <Desk3D key={`d${i}`} x={slot.x} y={slot.y} theme={theme} on={on} flip={flip} />;
			})}
			{MEETING_TABLES.map((_, i) => (
				<MeetingTable3D
				key={`m${i}`}
				index={i}
				theme={theme}
				active={activeTables.includes(i)}
				onOpen={activeTables.includes(i) ? onOpenRoom : undefined}
			/>
			))}
			<Rug3D x={122} y={83.4} theme={theme} r={2.15} />
			<FloorLamp3D x={108.4} y={78.6} theme={theme} />
			<Sofa3D theme={theme} />
			<CoffeeTable3D theme={theme} />
			<Plant3D x={101} y={92} theme={theme} size={1.1} />
			<Plant3D x={99} y={88} theme={theme} size={1.2} />
			<Plant3D x={10.6} y={13.4} theme={theme} />
			<Plant3D x={78} y={12.5} theme={theme} size={0.8} />
			<Plant3D x={82} y={32} theme={theme} size={0.85} />
			<Plant3D x={82} y={56} theme={theme} size={0.9} />
			<Plant3D x={88} y={60} theme={theme} />
			<Plant3D x={152} y={10.6} theme={theme} size={0.9} />
			<CoffeeBar3D theme={theme} />
			<Kitchen3D theme={theme} />
			<Reception3D theme={theme} />
			<Lockers3D theme={theme} />
			<Printer3D theme={theme} />
			<Clock3D theme={theme} />
			<Bookshelf3D theme={theme} />
			{coworkers.map((visual) => (
				<Character
					key={visual.id}
					visual={visual}
					store={store}
					theme={theme}
					bubbleVisible={visual.bubbleVisible}
					onCoworkerClick={onCoworkerClick}
				/>
			))}
		</>
	);
}

export function Office3D({
	feed,
	theme: themeName = "dark",
	className,
	style,
	store: sharedStore,
	onCoworkerClick,
	onHuddleClick,
}: VirtualOfficeProps) {
	const ownedStore = useRef<FloorStore | null>(null);
	if (!sharedStore && ownedStore.current === null) {
		ownedStore.current = createFloorStore();
	}
	const store = sharedStore ?? (ownedStore.current as FloorStore);
	const visible = useDocumentVisible();
	const reducedMotion = usePrefersReducedMotion();

	useEffect(() => {
		if (sharedStore) return;
		const owned = ownedStore.current;
		return () => owned?.dispose();
	}, [sharedStore]);

	useEffect(() => {
		store.getState().applyFeed(feed);
	}, [feed, store]);

	const theme = THEMES[themeName];
	return (
		<div className={className} style={{ width: "100%", height: "100%", ...style }}>
			<Canvas
				style={{ width: "100%", height: "100%" }}
				shadows="percentage"
				frameloop={visible ? "always" : "never"}
				gl={{ antialias: true, alpha: false }}
				camera={{ fov: 38, position: [16, 15, 16], near: 0.1, far: 140 }}
				dpr={[1, 1.5]}
			>
				<Scene
					store={store}
					theme={theme}
					themeName={themeName}
					activeTables={
						feed.roomRunning
							? [...new Set(feed.roomMembers.map((_, index) => Math.floor(index / SEATS_PER_TABLE)))].filter(
									(index) => index < MEETING_TABLES.length,
								)
							: []
					}
					idleOrbit={!reducedMotion}
					onCoworkerClick={onCoworkerClick}
					onOpenRoom={feed.roomRunning && feed.roomId && onHuddleClick ? () => onHuddleClick(feed.roomId as string) : undefined}
				/>
			</Canvas>
		</div>
	);
}