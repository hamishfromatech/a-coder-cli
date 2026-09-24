import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, SkipForward, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetPath } from "../lib/asset-path";
import { markOnboardingComplete } from "../lib/onboarding";
import { useModalA11y } from "../hooks/useModalA11y";
import { Button } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface OnboardingModalProps {
	onComplete: (selectedPath: string | null) => void;
	/** Replay from Settings: tour first, no folder requirement, "Done" closes. */
	replay?: boolean;
}

type Step = "tour" | "folder";

export function OnboardingModal({ onComplete, replay = false }: OnboardingModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const [step, setStep] = useState<Step>(replay ? "tour" : "tour");
	const [videoFailed, setVideoFailed] = useState(false);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useModalA11y(modalRef, true, () => {}); // No close on background click

	// If the bundled video is missing (odd install), fall straight to setup.
	useEffect(() => {
		const el = videoRef.current;
		if (!el) return;
		const fail = () => setVideoFailed(true);
		el.addEventListener("error", fail);
		return () => el.removeEventListener("error", fail);
	}, []);

	useEffect(() => {
		if (videoFailed && step === "tour") setStep("folder");
	}, [videoFailed, step]);

	const handlePickFolder = async () => {
		try {
			setError(null);
			const path = await open({ directory: true });
			if (typeof path === "string") {
				setSelectedPath(path);
			}
		} catch (e) {
			console.error("Failed to pick folder", e);
			setError("Could not open folder picker. Please try again.");
		}
	};

	const handleContinue = () => {
		markOnboardingComplete();
		onComplete(selectedPath);
	};

	const displayName = (path: string) => {
		const parts = path.split(/[/\\]/).filter(Boolean);
		return parts.at(-1) ?? path;
	};

	return (
		<ModalBackdrop
			ref={modalRef}
			aria-label="Welcome to A-Coder"
			className="bg-pi-bg"
		>
			<ModalPanel
				className="max-w-3xl"
				centered={false}
			>
				{step === "tour" ? (
					<>
						{/* Tour step */}
						<div className="flex flex-col items-center border-b border-pi-border px-6 pt-7 pb-5">
							<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-pi-accent to-pi-accent-hover text-white shadow-lg">
								<Sparkles className="h-6 w-6" />
							</div>
							<h2 className="mt-3 text-lg font-semibold tracking-tight text-pi-text">
								Welcome to A-Coder
							</h2>
							<p className="mt-1.5 text-center text-[13px] leading-relaxed text-pi-text-secondary">
								A quick two-minute tour — chat, sessions, your office of AI coworkers, automation, and where approvals land.
							</p>
						</div>

						<div className="px-6 pt-5 pb-1">
							<div className="overflow-hidden rounded-lg border border-pi-border bg-black">
								{/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions are burned into the video */}
								<video
									ref={videoRef}
									className="aspect-video w-full"
									src={assetPath("onboarding-tour.mp4")}
									autoPlay
									muted
									playsInline
									controls
								/>
							</div>
						</div>

						<div className="flex items-center justify-between border-t border-pi-border px-5 py-4 mt-3">
							<Button variant="ghost" size="md" icon={SkipForward} onClick={() => setStep("folder")}>
								Skip tour
							</Button>
							<Button variant="primary" size="md" onClick={() => setStep("folder")}>
								Next: choose a folder
							</Button>
						</div>
					</>
				) : (
					<>
						{/* Folder step (existing first-run flow; replay keeps it skippable) */}
						<div className="flex flex-col items-center border-b border-pi-border px-6 py-8">
							<div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-pi-accent to-pi-accent-hover text-white shadow-lg">
								<Sparkles className="h-7 w-7" />
							</div>
							<h2 className="mt-4 text-lg font-semibold tracking-tight text-pi-text">
								{replay ? "Pick a project" : "Choose a project folder"}
							</h2>
							<p className="mt-2 text-center text-[13px] leading-relaxed text-pi-text-secondary">
								{replay
									? "The tour is always available here. Pick any folder where your project files live."
									: "Your AI assistant for getting things done. Choose a folder to start working on your project."}
							</p>
						</div>

						<div className="p-5">
							<Button
								variant="primary"
								size="lg"
								icon={FolderOpen}
								className="w-full"
								onClick={() => void handlePickFolder()}
							>
								Choose a folder
							</Button>

							{selectedPath && (
								<div className="mt-4 rounded-lg bg-pi-surface-raised p-3">
									<div className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
										Selected folder
									</div>
									<div className="mt-1 truncate text-[13px] font-medium text-pi-text">
										{displayName(selectedPath)}
									</div>
									<div
										className="truncate font-mono text-2xs text-pi-text-muted"
										title={selectedPath}
									>
										{selectedPath}
									</div>
								</div>
							)}

							{error && (
								<p className="mt-3 text-xs text-pi-error">
									{error}
								</p>
							)}

							<p className="mt-4 text-2xs leading-relaxed text-pi-text-faint">
								You can change this later from the sidebar. Pick any folder where your project files live.
							</p>
						</div>

						{/* Footer */}
						<div className="flex items-center justify-end border-t border-pi-border px-5 py-4">
							{replay ? (
								<Button variant="primary" size="md" onClick={handleContinue}>
									Done
								</Button>
							) : (
								<Button
									variant="primary"
									size="md"
									onClick={handleContinue}
									disabled={!selectedPath}
								>
									Get started
								</Button>
							)}
						</div>
					</>
				)}
			</ModalPanel>
		</ModalBackdrop>
	);
}