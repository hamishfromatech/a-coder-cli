/**
 * OfficeView — the 2D/3D switcher the desktop embeds.
 *
 * Renders the 2D floor by default; the 3D scene is lazy-loaded so the three.js
 * bundle only lands when the user switches views. One floor store is shared by
 * both renderers, so switching view keeps every coworker where they were
 * instead of replaying the walk-in. The toggle is a small floating segmented
 * control in the corner, tinted to match the active theme; the chosen view is
 * remembered per client.
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { STATUS_COLORS } from "./palette.ts";
import { createFloorStore, type FloorStore } from "./store.ts";
import { VirtualOffice } from "./VirtualOffice.tsx";
import type { VirtualOfficeProps } from "./types.ts";

const Office3D = lazy(() => import("./office3d.tsx").then((m) => ({ default: m.Office3D })));

export type OfficeViewMode = "2d" | "3d";

const VIEW_STORAGE_KEY = "a-coder.office.view";

interface OfficeViewProps extends VirtualOfficeProps {
	/** Controlled view mode; omit for internal state. */
	view?: OfficeViewMode;
	onViewChange?: (view: OfficeViewMode) => void;
}

function readStoredView(): OfficeViewMode {
	if (typeof window === "undefined") return "2d";
	try {
		return window.localStorage.getItem(VIEW_STORAGE_KEY) === "3d" ? "3d" : "2d";
	} catch {
		return "2d";
	}
}

function storeView(view: OfficeViewMode): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(VIEW_STORAGE_KEY, view);
	} catch {
		// Storage can be disabled; the in-memory view still works.
	}
}

function Toggle({
	view,
	onChange,
	theme,
}: {
	view: OfficeViewMode;
	onChange: (view: OfficeViewMode) => void;
	theme: "dark" | "light";
}) {
	const dark = theme === "dark";
	const base: React.CSSProperties = {
		padding: "3px 10px",
		fontSize: 11,
		fontFamily: "system-ui, sans-serif",
		border: "none",
		cursor: "pointer",
		borderRadius: 5,
		background: "transparent",
		color: "inherit",
		opacity: 0.72,
	};
	const active: React.CSSProperties = {
		...base,
		opacity: 1,
		fontWeight: 600,
		background: dark ? "rgba(56, 189, 248, 0.16)" : "rgba(2, 132, 199, 0.1)",
	};
	return (
		<div
			role="group"
			aria-label="Office view mode"
			style={{
				position: "absolute",
				top: 8,
				right: 8,
				display: "flex",
				gap: 2,
				padding: 2,
				borderRadius: 7,
				background: dark ? "rgba(10, 16, 28, 0.72)" : "rgba(255, 255, 255, 0.82)",
				backdropFilter: "blur(6px)",
				border: `1px solid ${dark ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.28)"}`,
				color: dark ? "#dbe4f0" : "#26324a",
				zIndex: 10,
			}}
		>
			<button type="button" style={view === "2d" ? active : base} onClick={() => onChange("2d")}>
				2D
			</button>
			<button type="button" style={view === "3d" ? active : base} onClick={() => onChange("3d")}>
				3D
			</button>
		</div>
	);
}

const LEGEND: Array<{ label: string; color: string }> = [
	{ label: "idle", color: STATUS_COLORS.idle },
	{ label: "thinking", color: STATUS_COLORS.thinking },
	{ label: "tool", color: STATUS_COLORS.tool_calling },
	{ label: "speaking", color: STATUS_COLORS.speaking },
	{ label: "error", color: STATUS_COLORS.error },
];

function Legend({ theme, interactive }: { theme: "dark" | "light"; interactive: boolean }) {
	const dark = theme === "dark";
	return (
		<div
			aria-hidden="true"
			style={{
				position: "absolute",
				left: 8,
				bottom: 8,
				display: "flex",
				alignItems: "center",
				flexWrap: "wrap",
				rowGap: 2,
				maxWidth: "calc(100% - 16px)",
				gap: 8,
				padding: "3px 8px",
				borderRadius: 6,
				background: dark ? "rgba(10, 16, 28, 0.66)" : "rgba(255, 255, 255, 0.78)",
				border: `1px solid ${dark ? "rgba(148, 163, 184, 0.2)" : "rgba(100, 116, 139, 0.22)"}`,
				color: dark ? "#94a3b8" : "#475569",
				fontFamily: "system-ui, sans-serif",
				fontSize: 9,
				lineHeight: 1,
				pointerEvents: "none",
				zIndex: 10,
			}}
		>
			{LEGEND.map((item) => (
				<span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
					<span
						style={{
							width: 5,
							height: 5,
							borderRadius: 999,
							background: item.color,
							boxShadow: `0 0 4px ${item.color}`,
						}}
					/>
					{item.label}
				</span>
			))}
			{interactive && <span style={{ opacity: 0.7 }}>· click a face to message</span>}
		</div>
	);
}

export function OfficeView({ view: controlled, onViewChange, theme = "dark", ...props }: OfficeViewProps) {
	const [internal, setInternal] = useState<OfficeViewMode>(readStoredView);
	const view = controlled ?? internal;
	const storeRef = useRef<FloorStore | null>(null);
	if (storeRef.current === null) {
		storeRef.current = createFloorStore();
	}
	useEffect(() => {
		const store = storeRef.current;
		return () => store?.dispose();
	}, []);

	const setView = (next: OfficeViewMode) => {
		setInternal(next);
		storeView(next);
		onViewChange?.(next);
	};

	const store = storeRef.current as FloorStore;
	return (
		<div style={{ position: "relative", width: "100%", height: "100%", display: "flex" }}>
			<Toggle view={view} onChange={setView} theme={theme} />
			{view === "2d" ? (
				<VirtualOffice {...props} store={store} theme={theme} />
			) : (
				<Suspense
					fallback={
						<div
							style={{
								flex: 1,
								display: "grid",
								placeItems: "center",
								color: theme === "dark" ? "#64748b" : "#94a3b8",
								fontFamily: "system-ui, sans-serif",
								fontSize: 13,
							}}
						>
							building the 3D office…
						</div>
					}
				>
					<Office3D {...props} store={store} theme={theme} style={{ flex: 1 }} />
				</Suspense>
			)}
			<Legend theme={theme} interactive={Boolean(props.onCoworkerClick)} />
		</div>
	);
}
