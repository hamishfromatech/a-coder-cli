/**
 * OfficeView — the 2D/3D switcher the desktop embeds.
 *
 * Renders the 2D floor by default; the 3D scene is lazy-loaded so the three.js
 * bundle only lands when the user switches views. The toggle is a small
 * floating segmented control in the corner.
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
}: {
	view: OfficeViewMode;
	onChange: (view: OfficeViewMode) => void;
}) {
	const base: React.CSSProperties = {
		padding: "3px 10px",
		fontSize: 11,
		fontFamily: "system-ui, sans-serif",
		border: "none",
		cursor: "pointer",
		borderRadius: 5,
		background: "transparent",
		color: "inherit",
		opacity: 0.75,
	};
	const active: React.CSSProperties = { ...base, opacity: 1, fontWeight: 600 };
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
				background: "rgba(10, 16, 28, 0.72)",
				backdropFilter: "blur(6px)",
				border: "1px solid rgba(148, 163, 184, 0.25)",
				color: "#dbe4f0",
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

export function OfficeView({ view: controlled, onViewChange, ...props }: OfficeViewProps) {
	const [internal, setInternal] = useState<OfficeViewMode>("2d");
	const view = controlled ?? internal;
	const setView = (next: OfficeViewMode) => {
		setInternal(next);
		onViewChange?.(next);
	};
	return (
		<div style={{ position: "relative", width: "100%", height: "100%", display: "flex" }}>
			<Toggle view={view} onChange={setView} />
			{view === "2d" ? (
				<VirtualOffice {...props} />
			) : (
				<Suspense fallback={<div style={{ flex: 1, display: "grid", placeItems: "center", color: "#64748b", fontFamily: "system-ui, sans-serif", fontSize: 13 }}>building the 3D office…</div>}>
					<Office3D {...props} style={{ flex: 1 }} />
				</Suspense>
			)}
		</div>
	);
}