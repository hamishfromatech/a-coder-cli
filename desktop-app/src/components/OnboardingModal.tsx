/**
 * First-run onboarding: project folder pick + trust. The interactive guided
 * tour (GuidedTour) runs right after setup completes, so this flow stays
 * short — pick a folder, trust it, done.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { markOnboardingComplete } from "../lib/onboarding";
import * as rpc from "../lib/rpc";
import { useModalA11y } from "../hooks/useModalA11y";
import { Button } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface OnboardingModalProps {
	onComplete: (selectedPath: string | null) => void;
	/** Replay from Settings: no folder requirement, "Done" closes. */
	replay?: boolean;
}

type Step = "folder" | "trust";

export function OnboardingModal({ onComplete, replay = false }: OnboardingModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const [step, setStep] = useState<Step>("folder");
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [trustProject, setTrustProject] = useState(true);
	const [finishing, setFinishing] = useState(false);
	useModalA11y(modalRef, true, () => {}); // No close on background click

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

	const handleContinue = async () => {
		if (finishing) return;
		setFinishing(true);
		setError(null);
		if (!replay && selectedPath) {
			try {
				if (trustProject) await rpc.setProjectTrust(selectedPath, true);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
				setFinishing(false);
				return;
			}
		}
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
				{step === "folder" ? (
					<>
						{/* Folder step (replay keeps it skippable) */}
						<div className="flex flex-col items-center border-b border-pi-border px-6 py-8">
							<div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-pi-accent to-pi-accent-hover text-white shadow-lg">
								<Sparkles className="h-7 w-7" />
							</div>
							<h2 className="mt-4 text-lg font-semibold tracking-tight text-pi-text">
								{replay ? "Pick a project" : "Choose a project folder"}
							</h2>
							<p className="mt-2 text-center text-[13px] leading-relaxed text-pi-text-secondary">
								{replay
									? "Pick any folder where your project files live."
									: "Your AI assistant for getting things done. Choose a folder to start working on your project — a guided tour follows setup."}
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
									onClick={() => setStep("trust")}
									disabled={!selectedPath}
								>
									Next: trust this folder
								</Button>
							)}
						</div>
					</>
				) : (
					<>
						<div className="flex flex-col items-center border-b border-pi-border px-6 py-8">
							<div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-pi-accent to-pi-accent-hover text-white shadow-lg">
								<Sparkles className="h-7 w-7" />
							</div>
							<h2 className="mt-4 text-lg font-semibold tracking-tight text-pi-text">Trust this project?</h2>
							<p className="mt-2 text-center text-[13px] leading-relaxed text-pi-text-secondary">
								A-Coder can read and edit files here and run commands you approve. Trust this folder to skip the reminder on every switch.
							</p>
							</div>
						<div className="p-5">
							<div className="truncate rounded-lg bg-pi-surface-raised px-3 py-2 font-mono text-2xs text-pi-text-muted">
								{selectedPath}
							</div>
							<label className="mt-3 flex items-center gap-2 text-xs text-pi-text-secondary">
								<input type="checkbox" checked={trustProject} onChange={(e) => setTrustProject(e.target.checked)} />
								Trust this folder
							</label>
							{error && <p className="mt-3 text-xs text-pi-error">{error}</p>}
						</div>
						<div className="flex items-center justify-between border-t border-pi-border px-5 py-4">
							<Button variant="ghost" size="md" onClick={() => setStep("folder")}>
								Back
							</Button>
							<Button variant="primary" size="md" loading={finishing} onClick={() => void handleContinue()}>
								Get started
							</Button>
						</div>
					</>
				)}
			</ModalPanel>
		</ModalBackdrop>
	);
}