/**
 * Office settings — desktop-only preferences for the virtual office.
 *
 * The engine hard cap is 24 seats. This section lets the desktop lower the
 * seating guard without changing what the engine accepts, and sets the
 * autonomy preselected when hiring a new coworker. Both persist in the local
 * UI store, so they survive engine restarts.
 */

import { Building2, Users } from "lucide-react";
import { useSettingsStore } from "../../../stores/settings-store";
import { Card, CardBody, CardHeader } from "../../ui/Card";

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader className="flex items-center gap-2 py-2.5">
				{icon}
				<h3 className="text-xs font-semibold text-pi-text">{title}</h3>
			</CardHeader>
			<CardBody className="space-y-3 py-3">{children}</CardBody>
		</Card>
	);
}

export function OfficeSection() {
	const maxMembers = useSettingsStore((s) => s.officeMaxHuddleMembers);
	const setMaxMembers = useSettingsStore((s) => s.setOfficeMaxHuddleMembers);
	const defaultAutonomy = useSettingsStore((s) => s.officeDefaultAutonomy);
	const setDefaultAutonomy = useSettingsStore((s) => s.setOfficeDefaultAutonomy);

	return (
		<div className="space-y-3">
			<SectionCard title="Huddles" icon={<Users className="h-3.5 w-3.5 text-pi-text-muted" />}>
				<label className="block space-y-2">
					<span className="flex items-center justify-between gap-2">
						<span className="text-xs font-medium text-pi-text">Maximum coworkers in a huddle</span>
						<span className="text-xs tabular-nums text-pi-text-muted">{maxMembers}</span>
					</span>
					<input
						type="range"
						min={6}
						max={24}
						step={1}
						value={maxMembers}
						onChange={(event) => setMaxMembers(Number(event.target.value))}
						className="w-full accent-pi-accent"
						aria-label="Maximum coworkers in a huddle"
					/>
					<span className="block text-2xs leading-relaxed text-pi-text-muted">
						Six sit at the meeting tables; everyone beyond that stands in the room. The engine accepts up to 24.
					</span>
				</label>
				<p className="text-2xs leading-relaxed text-pi-text-muted">
					Large rooms spend at most 18 coworker turns per message, then continue from where they stopped on the
					next message. <span className="text-pi-text">@mention</span> someone to pull them in immediately.
				</p>
			</SectionCard>

			<SectionCard title="New coworkers" icon={<Building2 className="h-3.5 w-3.5 text-pi-text-muted" />}>
				<label className="block space-y-1">
					<span className="text-xs font-medium text-pi-text">Default autonomy</span>
					<select
						value={defaultAutonomy}
						onChange={(event) => setDefaultAutonomy(event.target.value === "auto" ? "auto" : "supervised")}
						className="w-full cursor-pointer rounded-md border border-pi-border bg-pi-surface px-2 py-1.5 text-xs text-pi-text"
					>
						<option value="supervised">Supervised — ask before risky actions</option>
						<option value="auto">Automatic — run without prompts</option>
					</select>
					<span className="block text-2xs leading-relaxed text-pi-text-muted">
						Preselected when you hire a coworker; each coworker can still be changed afterwards.
					</span>
				</label>
			</SectionCard>
		</div>
	);
}
