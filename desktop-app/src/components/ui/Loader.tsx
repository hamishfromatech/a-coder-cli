import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";

export type LoaderType = "lemniscate-bloom" | "rose-curve" | "rose-orbit";

interface Point {
	x: number;
	y: number;
}

interface LoaderCurve {
	durationMs: number;
	name: string;
	particleCount: number;
	point: (progress: number, detailScale: number) => Point;
	pulseDurationMs: number;
	rotate: boolean;
	rotationDurationMs: number;
	strokeWidth: number;
	trailSpan: number;
}

interface LoaderProps extends Omit<React.ComponentProps<"div">, "children"> {
	label?: string;
	pathSteps?: number;
	strokeScale?: number;
	type?: LoaderType;
}

const TWO_PI = Math.PI * 2;

function normalizeProgress(progress: number): number {
	return ((progress % 1) + 1) % 1;
}

function detailScaleFor(time: number, curve: LoaderCurve, phaseOffset: number): number {
	const pulseProgress =
		((time + phaseOffset * curve.pulseDurationMs) % curve.pulseDurationMs) /
		curve.pulseDurationMs;
	return 0.52 + ((Math.sin(pulseProgress * TWO_PI + 0.55) + 1) / 2) * 0.48;
}

function rotationFor(time: number, curve: LoaderCurve, phaseOffset: number): number {
	if (!curve.rotate) return 0;
	return (
		-(((time + phaseOffset * curve.rotationDurationMs) % curve.rotationDurationMs) /
			curve.rotationDurationMs) *
		360
	);
}

function buildPath(curve: LoaderCurve, detailScale: number, steps: number): string {
	return Array.from({ length: steps + 1 }, (_, index) => {
		const point = curve.point(index / steps, detailScale);
		return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
	}).join(" ");
}

function particleFor(
	curve: LoaderCurve,
	index: number,
	progress: number,
	detailScale: number,
	strokeScale: number,
) {
	const tailOffset = index / (curve.particleCount - 1);
	const point = curve.point(normalizeProgress(progress - tailOffset * curve.trailSpan), detailScale);
	const fade = (1 - tailOffset) ** 0.56;
	return {
		opacity: 0.04 + fade * 0.96,
		radius: (0.9 + fade * 2.7) * strokeScale,
		x: point.x,
		y: point.y,
	};
}

const LOADER_CURVES: Record<LoaderType, LoaderCurve> = {
	"lemniscate-bloom": {
		durationMs: 5600,
		name: "Lemniscate Bloom",
		particleCount: 64,
		point(progress, detailScale) {
			const t = progress * TWO_PI;
			const scale = 20 + detailScale * 7;
			const denom = 1 + Math.sin(t) ** 2;
			return {
				x: 50 + (scale * Math.cos(t)) / denom,
				y: 50 + (scale * Math.sin(t) * Math.cos(t)) / denom,
			};
		},
		pulseDurationMs: 5000,
		rotate: true,
		rotationDurationMs: 34000,
		strokeWidth: 4.8,
		trailSpan: 0.4,
	},
	"rose-curve": {
		durationMs: 5400,
		name: "Rose Curve",
		particleCount: 64,
		point(progress, detailScale) {
			const t = progress * TWO_PI;
			const a = 9.2 + detailScale * 0.6;
			const r = a * (0.72 + detailScale * 0.28) * Math.cos(5 * t);
			return {
				x: 50 + Math.cos(t) * r * 3.25,
				y: 50 + Math.sin(t) * r * 3.25,
			};
		},
		pulseDurationMs: 4600,
		rotate: true,
		rotationDurationMs: 28000,
		strokeWidth: 4.5,
		trailSpan: 0.32,
	},
	"rose-orbit": {
		durationMs: 5200,
		name: "Rose Orbit",
		particleCount: 64,
		point(progress, detailScale) {
			const t = progress * TWO_PI;
			const r = 7 - 2.7 * detailScale * Math.cos(7 * t);
			return {
				x: 50 + Math.cos(t) * r * 3.9,
				y: 50 + Math.sin(t) * r * 3.9,
			};
		},
		pulseDurationMs: 4600,
		rotate: true,
		rotationDurationMs: 28000,
		strokeWidth: 5.2,
		trailSpan: 0.42,
	},
};

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
	);
}

export function Loader({
	className,
	label = "Loading",
	pathSteps = 180,
	role = "status",
	strokeScale = 1,
	type = "lemniscate-bloom",
	...props
}: LoaderProps) {
	const curve = LOADER_CURVES[type];
	const groupRef = useRef<SVGGElement | null>(null);
	const particleRefs = useRef<Array<SVGCircleElement | null>>([]);
	const pathRef = useRef<SVGPathElement | null>(null);

	useEffect(() => {
		if (prefersReducedMotion()) return;
		let animationFrame = 0;
		const startedAt = performance.now();
		const phaseOffset = Math.random();
		particleRefs.current.length = curve.particleCount;

		const render = (now: number) => {
			const time = now - startedAt;
			const progress = ((time + phaseOffset * curve.durationMs) % curve.durationMs) / curve.durationMs;
			const detailScale = detailScaleFor(time, curve, phaseOffset);
			const rotation = rotationFor(time, curve, phaseOffset);

			groupRef.current?.setAttribute("transform", `rotate(${rotation} 50 50)`);
			pathRef.current?.setAttribute("d", buildPath(curve, detailScale, pathSteps));

			particleRefs.current.forEach((node, index) => {
				if (!node) return;
				const particle = particleFor(curve, index, progress, detailScale, strokeScale);
				node.setAttribute("cx", particle.x.toFixed(2));
				node.setAttribute("cy", particle.y.toFixed(2));
				node.setAttribute("r", particle.radius.toFixed(2));
				node.setAttribute("opacity", particle.opacity.toFixed(3));
			});

			animationFrame = window.requestAnimationFrame(render);
		};

		render(performance.now());
		return () => window.cancelAnimationFrame(animationFrame);
	}, [curve, pathSteps, strokeScale]);

	return (
		<div
			{...props}
			aria-label={props["aria-label"] ?? label}
			className={cn("inline-grid size-8 place-items-center text-pi-accent", className)}
			role={role}
		>
			<svg
				aria-hidden="true"
				className="size-full overflow-visible"
				fill="none"
				viewBox="0 0 100 100"
			>
				<g ref={groupRef}>
					<path
						opacity="0.12"
						ref={pathRef}
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={curve.strokeWidth * strokeScale}
					/>
					{Array.from({ length: curve.particleCount }, (_, index) => (
						<circle
							fill="currentColor"
							key={`${type}-${index}`}
							ref={(node) => {
								particleRefs.current[index] = node;
							}}
						/>
					))}
				</g>
			</svg>
		</div>
	);
}
