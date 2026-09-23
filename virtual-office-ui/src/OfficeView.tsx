/**
 * OfficeView — the 2D/3D switcher the desktop embeds.
 *
 * Renders the 2D floor by default; the 3D scene is lazy-loaded so the three.js
 * bundle only lands when the user switches views. The toggle is a small
 * floating segmented control in the corner, tinted to match the active theme.
 */

import { lazy, Suspense, useState } from "react";
import { VirtualOffice } from "./VirtualOffice.tsx";
import type { VirtualOfficeProps } from "./types.ts";

const Office3D = lazy(() => import("./office3d.tsx").then((m) => ({ default: m.Office3D })));

export type OfficeViewMode = "2d" | "3d";

interface OfficeViewProps extends VirtualOfficeProps {
	/** Controlled view mode; omit for internal state. */
	view?: OfficeViewMode;
	onViewChange?: (view: OfficeViewMode) => void;
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

export function OfficeView({ view: controlled, onViewChange, theme = "dark", ...props }: OfficeViewProps) {
	const [internal, setInternal] = useState<OfficeViewMode>("2d");
	const view = controlled ?? internal;
	const setView = (next: OfficeViewMode) => {
		setInternal(next);
		onViewChange?.(next);
	};
	return (
		<div style={{ position: "relative", width: "100%", height: "100%", display: "flex" }}>
			<Toggle view={view} onChange={setView} theme={theme} />
			{view === "2d" ? (
				<VirtualOffice {...props} theme={theme} />
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
					<Office3D {...props} theme={theme} style={{ flex: 1 }} />
				</Suspense>
			)}
		</div>
	);
}