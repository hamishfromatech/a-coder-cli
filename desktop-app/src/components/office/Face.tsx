/**
 * Coworker faces — procedural SVG avatars. The palette + seed math mirrors the
 * engine's `core/office/avatar.ts` (kept in sync by comment; ~20 lines, not
 * worth a cross-package import) so a handle renders the same face everywhere.
 */

import { cn } from "../../lib/cn";
import type { OfficeFace } from "../../lib/rpc";

const SHAPES = ["circle", "hexagon", "squircle", "triangle", "drop", "cloud"] as const;
export type FaceShapeName = (typeof SHAPES)[number];

export const FACE_PALETTE = [
	"#2563eb",
	"#7c3aed",
	"#0891b2",
	"#059669",
	"#d97706",
	"#dc2626",
	"#db2777",
	"#4f46e5",
	"#65a30d",
	"#0d9488",
];

/** FNV-1a — same seed math as the engine so handles render identically. */
export function faceSeed(handle: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < handle.length; i++) {
		hash ^= handle.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function faceColorFor(handle: string): string {
	return FACE_PALETTE[faceSeed(handle) % FACE_PALETTE.length];
}

export function faceShapeFor(handle: string): FaceShapeName {
	return SHAPES[faceSeed(`${handle}:shape`) % SHAPES.length];
}

function isDarkColor(hex: string): boolean {
	const normalized = hex.replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return false;
	const num = Number.parseInt(normalized, 16);
	const r = (num >> 16) & 0xff;
	const g = (num >> 8) & 0xff;
	const b = num & 0xff;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

function shadeHex(hex: string, amount: number): string {
	const normalized = hex.replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
	const num = Number.parseInt(normalized, 16);
	const channel = (value: number): number => {
		const next = amount >= 0 ? value + (255 - value) * amount : value * (1 + amount);
		return Math.max(0, Math.min(255, Math.round(next)));
	};
	const r = channel((num >> 16) & 0xff);
	const g = channel((num >> 8) & 0xff);
	const b = channel(num & 0xff);
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Shape geometry, viewBox 0..40. */
function shapeElement(shape: FaceShapeName): React.ReactNode {
	switch (shape) {
		case "hexagon":
			return <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" />;
		case "squircle":
			return <rect x="2" y="2" width="36" height="36" rx="11" />;
		case "triangle":
			return <polygon points="20,3 37,35 3,35" />;
		case "drop":
			return <path d="M20 2 C27 12 34 18 34 25 A14 14 0 1 1 6 25 C6 18 13 12 20 2 Z" />;
		case "cloud":
			return <path d="M11 30 A8 8 0 0 1 11 14 A9 9 0 0 1 28 12 A8 8 0 0 1 29 30 Z" />;
		case "circle":
		default:
			return <circle cx="20" cy="20" r="18" />;
	}
}

interface FaceProps {
	handle: string;
	name: string;
	face?: OfficeFace | undefined;
	/** Pixel diameter. */
	size?: number;
	/** Pulse ring while the coworker's turn is in flight. */
	working?: boolean;
	/** Amber ring while a supervised prompt is pending. */
	needsInput?: boolean;
	className?: string;
}

export function Face({ handle, name, face, size = 30, working, needsInput, className }: FaceProps) {
	const color = face?.color ?? faceColorFor(handle);
	const shape = face?.shape ?? faceShapeFor(handle);
	const image = face?.image;
	const initial = (name || handle || "?").trim().charAt(0).toUpperCase();
	const slug = (handle || name || "face").replace(/[^a-z0-9]/gi, "");
	const gradientId = `face-g-${slug}-${size}`;
	const clipId = `face-c-${slug}-${size}`;
	const lightText = isDarkColor(color);

	return (
		<span
			className={cn("relative inline-flex shrink-0", className)}
			style={{ width: size, height: size }}
		>
			{working && (
				<span
					className="absolute -inset-0.5 rounded-full animate-pulse"
					style={{ boxShadow: `0 0 0 2px ${shadeHex(color, 0.25)}` }}
				/>
			)}
			{needsInput && (
				<span
					className="absolute -inset-0.5 rounded-full"
					style={{ boxShadow: "0 0 0 2px var(--pi-warning)" }}
				/>
			)}
			<svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={name || handle}>
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={shadeHex(color, 0.18)} />
						<stop offset="100%" stopColor={color} />
					</linearGradient>
					<clipPath id={clipId}>{shapeElement(shape)}</clipPath>
				</defs>
				<g clipPath={`url(#${clipId})`}>
					<rect width="40" height="40" fill={`url(#${gradientId})`} />
					{image ? (
						<image href={image} width="40" height="40" preserveAspectRatio="xMidYMid slice" />
					) : (
						<text
							x="20"
							y="20"
							textAnchor="middle"
							dominantBaseline="central"
							fontSize={size >= 30 ? 17 : 14}
							fontWeight={650}
							fontFamily="var(--font-sans)"
							fill={lightText ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.62)"}
						>
							{initial}
						</text>
					)}
				</g>
			</svg>
		</span>
	);
}