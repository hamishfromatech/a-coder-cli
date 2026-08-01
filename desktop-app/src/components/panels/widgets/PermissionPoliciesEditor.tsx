import { Ban, HelpCircle, Plus, ShieldCheck, X } from "lucide-react";
import { useCallback, useState } from "react";

interface PermissionPolicyConfig {
	allow?: string[];
	softDeny?: string[];
	hardDeny?: string[];
}

interface Props {
	value: PermissionPolicyConfig | undefined;
	onChange: (next: PermissionPolicyConfig | undefined) => void;
}

const RULE_HINT = (
	<>Exact tool names, <code className="font-mono text-pi-text">namespace:*</code> globs, or <code className="font-mono text-pi-text">$defaults</code>.</>
);

export function PermissionPoliciesEditor({ value, onChange }: Props) {
	const config = value ?? {};

	const updateList = useCallback(
		(key: keyof PermissionPolicyConfig, nextList: string[]) => {
			const next: PermissionPolicyConfig = { ...config, [key]: nextList };
			if (nextList.length === 0 && key !== "hardDeny") {
				delete next[key];
			}
			// Remove the whole object if every list is empty.
			if (!next.allow?.length && !next.softDeny?.length && !next.hardDeny?.length) {
				onChange(undefined);
				return;
			}
			onChange(next);
		},
		[config, onChange],
	);

	return (
		<div className="w-full space-y-3">
			<RuleListEditor
				icon={<ShieldCheck className="h-3.5 w-3.5 text-pi-success" />}
				title="Always allow" aria-label="Always allow"
				hint="Tools matched here are approved automatically."
				placeholder="e.g. bash:ls file:read"
				values={config.allow ?? []}
				onChange={(v) => updateList("allow", v)}
			/>
			<RuleListEditor
				icon={<HelpCircle className="h-3.5 w-3.5 text-pi-warning" />}
				title="Ask first" aria-label="Ask first"
				hint="Tools matched here prompt in interactive mode, and are denied otherwise."
				placeholder="e.g. bash:*"
				values={config.softDeny ?? []}
				onChange={(v) => updateList("softDeny", v)}
			/>
			<RuleListEditor
				icon={<Ban className="h-3.5 w-3.5 text-pi-error" />}
				title="Always deny" aria-label="Always deny"
				hint="Tools matched here are always blocked."
				placeholder="e.g. bash:rm file:delete"
				values={config.hardDeny ?? []}
				onChange={(v) => updateList("hardDeny", v)}
			/>

			<div className="rounded-md bg-pi-surface-raised px-3 py-2 text-[11px] text-pi-text-muted shadow-[0_0_0_1px_var(--pi-border)]">
				{RULE_HINT} These rules only apply when{" "}
				<span className="text-pi-text">Permission mode</span> is set to{" "}
				<span className="font-mono text-pi-text">auto</span>.
			</div>
		</div>
	);
}

function RuleListEditor({
	icon,
	title,
	hint,
	placeholder,
	values,
	onChange,
}: {
	icon: React.ReactNode;
	title: string;
	hint: string;
	placeholder?: string;
	values: string[];
	onChange: (next: string[]) => void;
}) {
	const [draft, setDraft] = useState("");

	const addRule = useCallback(
		(raw: string) => {
			const rules = raw
				.split(/[,\n]/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			if (rules.length === 0) return;
			const next = Array.from(new Set([...values, ...rules]));
			onChange(next);
			setDraft("");
		},
		[values, onChange],
	);

	const removeRule = useCallback(
		(idx: number) => {
			onChange(values.filter((_, i) => i !== idx));
		},
		[values, onChange],
	);

	return (
		<div className="rounded-lg bg-pi-surface-raised shadow-[0_0_0_1px_var(--pi-border)]">
			<div className="flex items-center gap-2 border-b border-pi-border px-3 py-2">
				{icon}
				<div>
					<h4 className="text-[12px] font-medium text-pi-text">{title}</h4>
					<p className="text-[10.5px] text-pi-text-muted">{hint}</p>
				</div>
			</div>

			<div className="space-y-2 px-3 py-2.5">
				{values.length === 0 && (
					<p className="text-[11px] text-pi-text-faint">No rules yet.</p>
				)}
				{values.map((rule, idx) => (
					<div
						key={`${rule}-${idx}`}
						className="flex items-center justify-between gap-2 rounded-md bg-pi-bg px-2 py-1 shadow-[0_0_0_1px_var(--pi-border)]"
					>
						<code className="truncate text-[11.5px] text-pi-text">{rule}</code>
						<button
							type="button"
							onClick={() => removeRule(idx)}
							className="rounded p-0.5 text-pi-text-muted transition-hover hover:bg-pi-error-soft hover:text-pi-error"
						>
							<X className="h-3 w-3" />
						</button>
					</div>
				))}

				<form
					onSubmit={(e) => {
						e.preventDefault();
						addRule(draft);
					}}
					className="flex gap-2"
				>
					<input
						type="text"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder={placeholder ?? "Add rule"}
						spellCheck={false}
						className="min-w-0 flex-1 rounded-md bg-pi-bg px-2.5 py-1.5 text-[11.5px] text-pi-text placeholder:text-pi-text-faint shadow-[0_0_0_1px_var(--pi-border)] focus:shadow-focus focus:outline-none"
					/>
					<button
						type="submit"
						disabled={!draft.trim()}
						className="inline-flex h-7 items-center gap-1 rounded-md bg-pi-surface-overlay px-2 text-[11.5px] font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised disabled:opacity-50"
					>
						<Plus className="h-3 w-3" />
						Add
					</button>
				</form>
			</div>
		</div>
	);
}
