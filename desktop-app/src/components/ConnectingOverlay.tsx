import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "../stores/session-store";
import { triggerHaptic } from "../lib/haptics";
import { Button } from "./ui/Button";
import { ErrorState } from "./ui/ErrorState";
import { DecodeText } from "./DecodeText";

// Startup loading screen, ported from Hermes desktop's
// gateway-connecting-overlay.tsx. Full-screen "CONNECTING" scramble-decode
// text shown while the engine connects on cold boot, then an exit
// choreography (text fades down + out, hold, overlay fades) once connected.
// After a healthy boot it never resurrects — soft reconnects keep the shell.

const TEXT = "CONNECTING";

// Exit choreography (ms): text fades down + out, hold, then the overlay fades.
const TEXT_OUT_MS = 360;
const POST_TEXT_HOLD_MS = 300;
const OVERLAY_OUT_MS = 520;

type Phase = "live" | "text-out" | "overlay-out" | "gone";

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
	);
}

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export function ConnectingOverlay({ pickerOpen = false }: { pickerOpen?: boolean }) {
	const status = useSessionStore((s) => s.status);
	const error = useSessionStore((s) => s.error);
	const reduce = prefersReducedMotion();
	const [phase, setPhase] = useState<Phase>("live");
	// Once cold boot has completed once, never resurrect the overlay.
	const coldBootDoneRef = useRef(false);

	if (status === "connected" && !error) {
		coldBootDoneRef.current = true;
	}

	// The full-screen overlay is for initial boot only. After a healthy boot,
	// a dropped socket / reconnect must NOT cover the chat — users should still
	// be able to type drafts and recover instead of staring at a modal screen.
	const connecting =
		!coldBootDoneRef.current && status !== "connected" && !error;

	// Latch once we've actually shown the overlay, so the brief frame where
	// status flips to "connected" (connecting -> false) before the exit phase
	// kicks in doesn't unmount us and cause a flash.
	const shownRef = useRef(false);
	if (connecting) {
		shownRef.current = true;
	}

	// Kick off the exit when connected. Under reduced motion, skip the
	// multi-phase exit choreography and jump straight to gone so the overlay
	// unmounts the instant the engine opens.
	useEffect(() => {
		if (phase !== "live") return;
		if (status === "connected" && shownRef.current) {
			setPhase(reduce ? "gone" : "text-out");
			triggerHaptic("streamDone");
		}
	}, [phase, status, reduce]);

	// Advance the exit choreography: text-out -> overlay-out -> gone.
	useEffect(() => {
		if (phase === "text-out") {
			const id = window.setTimeout(() => setPhase("overlay-out"), TEXT_OUT_MS + POST_TEXT_HOLD_MS);
			return () => window.clearTimeout(id);
		}
		if (phase === "overlay-out") {
			const id = window.setTimeout(() => setPhase("gone"), OVERLAY_OUT_MS);
			return () => window.clearTimeout(id);
		}
		return;
	}, [phase]);

	// Boot failed — let the error card below own the screen, unless the user
	// has opened the project picker (e.g. via "Select another workspace"), in
	// which case step aside so the picker is interactive.
	if (error && !connecting && !pickerOpen) {
		return <BootFailureCard message={error} />;
	}
	if (error && pickerOpen) {
		return null;
	}

	// Real connect: once the fade finishes, get out of the way for good.
	if (phase === "gone") {
		return null;
	}

	// Never showed (e.g. engine already up on a warm reload) — stay out.
	if (!connecting && !shownRef.current) {
		return null;
	}

	const leaving = phase !== "live";
	const overlayHidden = phase === "overlay-out";

	return (
		<div
			className={cn(
				"fixed inset-0 z-[1200] grid place-items-center bg-pi-bg transition-opacity duration-500 ease-out",
				overlayHidden ? "pointer-events-none opacity-0" : "opacity-100",
			)}
		>
			<DecodeText
				active={phase === "live" && connecting}
				className={cn(
					"pl-[0.4em] text-pi-accent transition duration-300 ease-out",
					leaving
						? "translate-y-2 opacity-0 saturate-0"
						: "translate-y-0 opacity-100 saturate-100",
				)}
				cursor
				prefix={4}
				text={TEXT}
			/>
		</div>
	);
}

function BootFailureCard({ message }: { message: string }) {
	const [bootstrapping, setBootstrapping] = useState(false);
	const [bootstrapError, setBootstrapError] = useState<string | null>(null);
	const needsEngine = message.toLowerCase().includes("not found in path");

	const pickWorkspace = async () => {
		try {
			const path = await open({ directory: true });
			if (typeof path === "string" && path) {
				triggerHaptic("crisp");
				window.dispatchEvent(
					new CustomEvent("a-coder:switch-project", { detail: { path } }),
				);
			}
		} catch (e) {
			console.error("Failed to pick workspace", e);
		}
	};

	const installEngine = async () => {
		setBootstrapping(true);
		setBootstrapError(null);
		try {
			await invoke<string>("bootstrap_cli");
			triggerHaptic("crisp");
			window.location.reload();
		} catch (e) {
			console.error("CLI bootstrap failed", e);
			setBootstrapError(typeof e === "string" ? e : "Failed to install the CLI engine.");
			setBootstrapping(false);
		}
	};

	return (
		<div className="fixed inset-0 z-[1200] grid place-items-center bg-pi-bg p-6">
			<div className="pi-card-overlay w-full max-w-xl overflow-hidden p-6">
				<ErrorState
					title="Engine failed to start"
					description="The coding agent backend could not be reached."
				>
					<div className="rounded-xl border border-pi-error/30 bg-pi-error-soft px-4 py-3 text-xs text-pi-error font-mono break-all">
						{message}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="primary" size="sm" onClick={() => window.location.reload()}>
							Retry
						</Button>
						{needsEngine ? (
							<Button
								variant="primary"
								size="sm"
								disabled={bootstrapping}
								loading={bootstrapping}
								onClick={installEngine}
							>
								{bootstrapping ? "Installing engine…" : "Install the CLI engine"}
							</Button>
						) : null}
						<Button variant="outline" size="sm" onClick={pickWorkspace}>
							Select another workspace
						</Button>
					</div>
					{bootstrapError ? (
						<div className="w-full rounded-xl border border-pi-error/30 bg-pi-error-soft px-4 py-3 text-xs text-pi-error font-mono break-all">
							{bootstrapError}
						</div>
					) : null}
				</ErrorState>
			</div>
		</div>
	);
}