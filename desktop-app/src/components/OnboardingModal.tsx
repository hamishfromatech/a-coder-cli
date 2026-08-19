import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { Button } from "./ui/Button";

export interface OnboardingModalProps {
	onComplete: (selectedPath: string) => void;
}

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
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

	const handleContinue = () => {
		if (selectedPath) {
			localStorage.setItem("onboarding-complete", "true");
			onComplete(selectedPath);
		}
	};

	const displayName = (path: string) => {
		const parts = path.split(/[/\\]/).filter(Boolean);
		return parts.at(-1) ?? path;
	};

	return (
		<div
			ref={modalRef}
			role="dialog"
			aria-modal="true"
			aria-label="Welcome to A-Coder"
			className="fixed inset-0 z-50 flex items-center justify-center bg-pi-bg p-4"
		>
			<div
				className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
			>
				{/* Header with icon */}
				<div className="flex flex-col items-center border-b border-pi-border px-6 py-8">
					<div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-pi-accent to-pi-accent-hover text-white shadow-lg">
						<Sparkles className="h-7 w-7" />
					</div>
					<h2 className="mt-4 text-lg font-semibold tracking-tight text-pi-text">
						Welcome to A-Coder
					</h2>
					<p className="mt-2 text-center text-[13px] leading-relaxed text-pi-text-secondary">
						Your AI assistant for getting things done. Choose a folder to start working on your project.
					</p>
				</div>

				{/* Folder selection */}
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
					<Button
						variant="primary"
						size="md"
						onClick={handleContinue}
						disabled={!selectedPath}
					>
						Get started
					</Button>
				</div>
			</div>
		</div>
	);
}