// The agent's standing permission for web pages, as a compact pill. Ask makes
// the gate park every new host until the user decides; Auto lets ordinary hosts
// through and still asks on sensitive ones (mail, banks, payments). The popover
// explains both, so the choice never needs a settings detour.

import { useState } from "react";
import { Check, ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tip } from "../ui/Tip";
import { BrowserPopover } from "./BrowserPopover";

export type AgentPermissionMode = "ask" | "auto";

const OPTIONS: Array<{ value: AgentPermissionMode; label: string; description: string }> = [
	{
		value: "ask",
		label: "Ask on a new site",
		description: "The agent checks before it reads, clicks or types on a host you have not approved.",
	},
	{
		value: "auto",
		label: "Act on ordinary sites",
		description: "No prompts for regular sites. Banks, mail and payment pages still ask every time.",
	},
];

export function AgentPermissionPill({
	mode,
	onChange,
}: {
	mode: AgentPermissionMode;
	onChange: (mode: AgentPermissionMode) => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<div className="relative">
			<Tip
				placement="toolbar"
				content={
					mode === "ask"
						? "The agent asks before acting on a new site"
						: "The agent acts on ordinary sites; sensitive ones still ask"
				}
			>
				<button
					type="button"
					data-browser-input
					aria-haspopup="menu"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
					className={cn(
						"flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-3xs font-medium transition-hover focus-visible:shadow-focus focus-visible:outline-none",
						mode === "auto"
							? "border-pi-warning/40 bg-pi-warning/10 text-pi-text"
							: "border-pi-border bg-pi-surface-raised text-pi-text-secondary hover:text-pi-text",
					)}
				>
					{mode === "auto" ? (
						<ShieldAlert className="h-3 w-3 shrink-0 text-pi-warning" />
					) : (
						<ShieldCheck className="h-3 w-3 shrink-0" />
					)}
					{mode === "auto" ? "Auto" : "Ask"}
					<ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-60" />
				</button>
			</Tip>
			<BrowserPopover open={open} onClose={() => setOpen(false)} label="AI tool permissions" className="w-64">
				<p className="px-2 pb-1 pt-1 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
					Agent on web pages
				</p>
				{OPTIONS.map((option) => {
					const active = option.value === mode;
					return (
						<button
							key={option.value}
							type="button"
							role="menuitemradio"
							aria-checked={active}
							onClick={() => {
								onChange(option.value);
								setOpen(false);
							}}
							className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-hover hover:bg-pi-surface-raised focus-visible:shadow-focus focus-visible:outline-none"
						>
							<span className="flex items-center gap-1.5">
								<span className="text-xs font-medium text-pi-text">{option.label}</span>
								{active && <Check className="h-3 w-3 text-pi-accent" />}
							</span>
							<span className="mt-0.5 block text-3xs leading-snug text-pi-text-muted">
								{option.description}
							</span>
						</button>
					);
				})}
				<p className="mt-1 border-t border-pi-border px-2 pb-1 pt-2 text-3xs leading-snug text-pi-text-muted">
					Remembered sites can be revoked in Settings → Browser.
				</p>
			</BrowserPopover>
		</div>
	);
}
