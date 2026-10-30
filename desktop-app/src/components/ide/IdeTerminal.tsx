/**
 * Integrated terminal: xterm.js over a real host PTY (portable-pty on the
 * Tauri side). One session per workspace panel for the spike; the output
 * stream is id-keyed so multiple panes can coexist later without changes.
 *
 * Per generation (mount / restart click): attach event listeners first, then
 * create the xterm surface and spawn the PTY, so early output is never lost.
 */

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw, X } from "lucide-react";

import { onPtyExit, onPtyOutput, ptyKill, ptyResize, ptySpawn, ptyWrite, tokenColor } from "../../lib/ide";
import { useIdeStore } from "../../stores/ide-store";

function resolvedXtermTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
	return {
		background: tokenColor("--pi-bg", "#16181d"),
		foreground: tokenColor("--pi-text", "#d6dbe4"),
		cursor: tokenColor("--pi-accent", "#4f7dd9"),
		selectionBackground: "#4f7dd955",
	};
}

interface IdeTerminalProps {
	cwd: string;
}

export function IdeTerminal({ cwd }: IdeTerminalProps) {
	const setTerminalOpen = useIdeStore((s) => s.setTerminalOpen);
	const containerRef = useRef<HTMLDivElement>(null);
	/** Owns the lifecycle; null while (re)spawning. */
	const xtermRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const ptyIdRef = useRef<number | null>(null);
	const [generation, setGeneration] = useState(1);

	// Lifecycle: listeners first, then terminal surface, then PTY spawn.
	useEffect(() => {
		let disposed = false;
		const unlisteners: Array<() => void> = [];

		const offOut = onPtyOutput(({ id, chunk }) => {
			if (id === ptyIdRef.current) xtermRef.current?.write(chunk);
		}).then((off) => {
			if (disposed) off();
			else unlisteners.push(off);
		});
		const offExit = onPtyExit(({ id, code }) => {
			// Even a superseded id may still be visible until restart; only the
			// CURRENT one prints the exit banner.
			if (id !== ptyIdRef.current) return;
			ptyIdRef.current = null;
			xtermRef.current?.write(
				`\r\n\x1b[2m[process exited${typeof code === "number" ? ` (${code})` : ""} — ↻ restarts]\x1b[0m\r\n`,
			);
		}).then((off) => {
			if (disposed) off();
			else unlisteners.push(off);
		});

		void Promise.all([offOut, offExit]).then(async () => {
			if (disposed || !containerRef.current) return;
			if (!xtermRef.current) {
				const term = new Terminal({
					fontSize: 12.5,
					fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
					cursorBlink: true,
					scrollback: 5000,
					theme: resolvedXtermTheme(),
				});
				const fit = new FitAddon();
				term.loadAddon(fit);
				term.loadAddon(new WebLinksAddon());
				term.onData((data) => {
					const id = ptyIdRef.current;
					if (id !== null) void ptyWrite(id, data);
				});
				term.open(containerRef.current);
				xtermRef.current = term;
				fitRef.current = fit;
			} else {
				xtermRef.current.reset();
			}
			try {
				const id = await ptySpawn(cwd);
				if (disposed) {
					void ptyKill(id);
					return;
				}
				ptyIdRef.current = id;
				const fit = fitRef.current;
				const dims = fit?.proposeDimensions();
				void ptyResize(id, dims?.cols ?? 80, dims?.rows ?? 24);
			} catch (e) {
				xtermRef.current?.write(`\r\n\x1b[31mterminal: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
			}
		});

		return () => {
			disposed = true;
			for (const off of unlisteners) off();
			const id = ptyIdRef.current;
			ptyIdRef.current = null;
			if (id !== null) void ptyKill(id);
			xtermRef.current?.dispose();
			xtermRef.current = null;
			fitRef.current = null;
		};
	}, [generation, cwd]);

	// Fit on mount and on container resizes; keep the PTY sized to match.
	const fitAndReport = () => {
		const fit = fitRef.current;
		if (!fit) return;
		try {
			fit.fit();
			const id = ptyIdRef.current;
			const dims = fit.proposeDimensions();
			if (id !== null && dims) void ptyResize(id, dims.cols, dims.rows);
		} catch {
			// Terminal may be disposed during resize; ignore.
		}
	};

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const observer = new ResizeObserver(fitAndReport);
		observer.observe(container);
		return () => observer.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div className="flex h-64 shrink-0 flex-col border-t border-pi-border bg-pi-bg">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-pi-border bg-pi-surface px-3">
				<span className="text-2xs font-semibold uppercase tracking-widest text-pi-text-muted">
					Terminal
				</span>
				<span className="truncate font-mono text-2xs text-pi-text-faint">{cwd}</span>
				<div className="ml-auto flex items-center gap-1">
					<button
						onClick={() => setGeneration((g) => g + 1)}
						className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:text-pi-text"
						aria-label="Restart terminal"
					>
						<RotateCcw className="size-3" />
					</button>
					<button
						onClick={() => setTerminalOpen(false)}
						className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-smooth hover:text-pi-text"
						aria-label="Hide terminal"
					>
						<X className="size-3" />
					</button>
				</div>
			</div>
			<div ref={containerRef} className="min-h-0 flex-1 px-2 py-1" />
		</div>
	);
}