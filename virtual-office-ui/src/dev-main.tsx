/** Standalone dev entry — A-Coder Virtual Office against the mock scenario. */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { startMockLoop } from "./mock.ts";
import { OfficeView, type OfficeViewMode } from "./OfficeView.tsx";
import type { FloorTheme, VirtualOfficeFeed } from "./types.ts";

const BRAND: React.CSSProperties = {
	fontFamily: "system-ui, sans-serif",
	color: "#e2e8f0",
};

const controlButton: React.CSSProperties = {
	padding: "4px 12px",
	borderRadius: 6,
	border: "1px solid #334155",
	background: "transparent",
	color: "#94a3b8",
	fontFamily: "system-ui, sans-serif",
	fontSize: 12,
	cursor: "pointer",
};

function DevApp() {
	const [feed, setFeed] = useState<VirtualOfficeFeed | null>(null);
	const [theme, setTheme] = useState<FloorTheme>("dark");
	const [view, setView] = useState<OfficeViewMode>("2d");
	useEffect(() => startMockLoop(setFeed), []);
	return (
		<div
			style={{
				width: "100vw",
				height: "100vh",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				background: "#0b1220",
			}}
		>
			<div style={{ width: "min(96vw, 1100px)" }}>
				<header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
					<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
						<h1 style={{ ...BRAND, fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: 0.4 }}>
							A-Coder Virtual Office
						</h1>
						<span style={{ ...BRAND, fontSize: 12, color: "#64748b" }}>mock floor · demo loop</span>
					</div>
					<button
						type="button"
						onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
						style={controlButton}
					>
						{theme === "dark" ? "light mode" : "dark mode"}
					</button>
				</header>
			</div>
			{feed ? (
				<div
					style={{
						position: "relative",
						width: "min(96vw, 1100px)",
						height: "min(72vh, 600px)",
						borderRadius: 12,
						overflow: "hidden",
						border: "1px solid #1c2740",
					}}
				>
					<OfficeView feed={feed} theme={theme} view={view} onViewChange={setView} />
				</div>
			) : (
				<div style={{ ...BRAND, color: "#64748b", fontSize: 13 }}>warming up the office…</div>
			)}
		</div>
	);
}

createRoot(document.getElementById("root") ?? document.body).render(<DevApp />);