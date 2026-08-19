import { useMemo, useRef } from "react";
import { X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import changelogRaw from "../CHANGELOG.md?raw";

export interface ChangelogModalProps {
	open: boolean;
	onClose: () => void;
}

interface ReleaseSection {
	version: string;
	date?: string;
	groups: { heading: string; items: string[] }[];
}

const GROUP_HEADINGS = new Set([
	"added",
	"new features",
	"changed",
	"fixed",
	"removed",
	"deprecated",
	"security",
	"performance",
]);

/** Parse the Keep-a-Changelog markdown into structured release sections. */
function parseChangelog(markdown: string): ReleaseSection[] {
	const lines = markdown.split("\n");
	const releases: ReleaseSection[] = [];
	let current: ReleaseSection | null = null;
	let group: { heading: string; items: string[] } | null = null;

	for (const raw of lines) {
		const line = raw.trimEnd();
		if (!line.trim()) continue;

		// Version header: ## [x.y.z] - YYYY-MM-DD  or  ## [Unreleased]
		const releaseMatch = line.match(/^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?$/);
		if (releaseMatch) {
			current = { version: releaseMatch[1], date: releaseMatch[2]?.trim(), groups: [] };
			releases.push(current);
			group = null;
			continue;
		}

		if (!current) continue;

		// Group header: ### Added, ### Fixed, etc.
		const groupMatch = line.match(/^###\s+(.+)$/);
		if (groupMatch) {
			const heading = groupMatch[1].trim();
			if (GROUP_HEADINGS.has(heading.toLowerCase())) {
				group = { heading, items: [] };
				current.groups.push(group);
			} else {
				group = null;
			}
			continue;
		}

		// Bullet item.
		if (group && line.startsWith("- ")) {
			group.items.push(line.slice(2).trim());
		}
	}

	return releases;
}

const GROUP_TONE: Record<string, string> = {
	Added: "text-pi-success",
	"New Features": "text-pi-success",
	Fixed: "text-pi-accent",
	Changed: "text-pi-text-secondary",
	Removed: "text-pi-error",
	Deprecated: "text-pi-warning",
	Security: "text-pi-warning",
	Performance: "text-pi-accent",
};

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	useModalA11y(modalRef, open, onClose);

	const releases = useMemo(() => parseChangelog(changelogRaw), []);

	if (!open) return null;

	return (
		<div
			ref={modalRef}
			role="dialog"
			aria-modal="true"
			aria-label="Changelog"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="flex w-full max-w-2xl max-h-overlay flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">Changelog</h2>
					<button
						onClick={onClose}
						className="rounded p-1 text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="flex-1 overflow-auto px-5 py-4">
					{releases.length === 0 ? (
						<p className="py-8 text-center text-xs text-pi-text-muted">
							No changelog entries found.
						</p>
					) : (
						<div className="space-y-6">
							{releases.map((release) => (
								<section key={release.version + (release.date ?? "")}>
									<div className="flex items-baseline gap-2">
										<h3 className="text-sm font-semibold text-pi-text">
											{release.version === "Unreleased"
												? "In progress"
												: release.version}
										</h3>
										{release.date && (
											<span className="text-2xs text-pi-text-faint">{release.date}</span>
										)}
									</div>

									{release.groups.length === 0 ? (
										<p className="mt-1.5 text-2xs text-pi-text-muted">No notable changes.</p>
									) : (
										<div className="mt-2 space-y-3">
											{release.groups.map((group) => (
												<div key={group.heading}>
													<div
														className={`text-2xs font-semibold uppercase tracking-wider ${
															GROUP_TONE[group.heading] ?? "text-pi-text-secondary"
														}`}
													>
														{group.heading}
													</div>
													<ul className="mt-1 space-y-1">
														{group.items.map((item, idx) => (
															<li
																key={idx}
																className="flex gap-2 text-xs leading-relaxed text-pi-text-secondary"
															>
																<span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-pi-text-faint" />
																<span>{item}</span>
															</li>
														))}
													</ul>
												</div>
											))}
										</div>
									)}
								</section>
							))}
						</div>
					)}
				</div>

				<div className="flex shrink-0 items-center justify-end border-t border-pi-border px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md px-3 py-1.5 text-xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
