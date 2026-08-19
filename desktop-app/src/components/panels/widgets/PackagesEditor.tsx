import { Box, GitBranch, Layers, Palette, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Card } from "../../ui/Card";

export type PackageSource =
	| string
	| {
			source: string;
			extensions?: string[];
			skills?: string[];
			prompts?: string[];
			themes?: string[];
			[key: string]: unknown;
	  };

interface Props {
	value: PackageSource[] | undefined;
	onChange: (next: unknown[] | undefined) => void;
}

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
	extensions: Sparkles,
	skills: Layers,
	prompts: Box,
	themes: Palette,
};

export function PackagesEditor({ value, onChange }: Props) {
	const packages = value ?? [];
	const [expanded, setExpanded] = useState<number | null>(packages.length > 0 ? 0 : null);

	const addPackage = useCallback(
		(source: PackageSource = "") => {
			const next: PackageSource[] = [...packages, source];
			onChange(next);
			setExpanded(next.length - 1);
		},
		[packages, onChange],
	);

	const removePackage = useCallback(
		(idx: number) => {
			const next = packages.filter((_, i) => i !== idx);
			onChange(next.length ? next : undefined);
			setExpanded((cur) => {
				if (cur === null) return null;
				if (cur === idx) return next.length > 0 ? Math.max(0, idx - 1) : null;
				return cur > idx ? cur - 1 : cur;
			});
		},
		[packages, onChange],
	);

	const updatePackage = useCallback(
		(idx: number, next: PackageSource) => {
			const list = packages.map((p, i) => (i === idx ? next : p));
			onChange(list);
		},
		[packages, onChange],
	);

	return (
		<div className="w-full space-y-3">
			{packages.length === 0 && (
				<p className="text-2xs text-pi-text-muted">
					No resource packages. Add npm or git sources that ship extensions,
					skills, prompts, or themes.
				</p>
			)}

			{packages.map((pkg, idx) => (
				<PackageCard
					key={idx}
					pkg={pkg}
					expanded={expanded === idx}
					onToggle={() => setExpanded((cur) => (cur === idx ? null : idx))}
					onUpdate={(next) => updatePackage(idx, next)}
					onRemove={() => removePackage(idx)}
				/>
			))}

			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => addPackage("")}
					className="inline-flex h-7 items-center gap-1.5 rounded-md bg-pi-surface-overlay px-2.5 text-2xs font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
				>
					<Plus className="h-3 w-3" />
					Add package source
				</button>
				<button
					type="button"
					onClick={() => addPackage({ source: "", extensions: [], skills: [], prompts: [], themes: [] })}
					className="inline-flex h-7 items-center gap-1.5 rounded-md bg-pi-surface-overlay px-2.5 text-2xs font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised"
				>
					<Layers className="h-3 w-3" />
					Add filtered package
				</button>
			</div>
		</div>
	);
}

function PackageCard({
	pkg,
	expanded,
	onToggle,
	onUpdate,
	onRemove,
}: {
	pkg: PackageSource;
	expanded: boolean;
	onToggle: () => void;
	onUpdate: (next: PackageSource) => void;
	onRemove: () => void;
}) {
	const isSimple = typeof pkg === "string";
	const display = isSimple ? pkg : pkg.source || "(unnamed source)";

	return (
		<Card>
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-3 px-3 py-2 text-left transition-hover hover:bg-pi-surface-overlay"
			>
				<GitBranch className="h-3.5 w-3.5 text-pi-accent" />
				<span className="min-w-0 flex-1 truncate text-xs font-medium text-pi-text">
					{display}
				</span>
				{!isSimple && (
					<span className="text-3xs text-pi-text-faint">
						filtered
					</span>
				)}
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-error-soft hover:text-pi-error focus-visible:shadow-focus focus-visible:outline-none"
					title="Remove package" aria-label="Remove package"
				>
					<Trash2 className="h-3 w-3" />
				</button>
			</button>

			{expanded && (
				<div className="space-y-3 border-t border-pi-border px-3 py-3">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => {
								if (isSimple) {
									onUpdate({ source: pkg, extensions: [], skills: [], prompts: [], themes: [] });
								} else {
									onUpdate(pkg.source);
								}
							}}
							className={`h-5 rounded px-2 text-3xs font-medium transition-colors ${isSimple ? "bg-pi-accent text-white" : "bg-pi-surface-overlay text-pi-text-muted"}`}
						>
							Simple
						</button>
						<button
							type="button"
							onClick={() => {
								if (isSimple) {
									onUpdate({ source: pkg, extensions: [], skills: [], prompts: [], themes: [] });
								}
							}}
							className={`h-5 rounded px-2 text-3xs font-medium transition-colors ${!isSimple ? "bg-pi-accent text-white" : "bg-pi-surface-overlay text-pi-text-muted"}`}
						>
							Filtered
						</button>
					</div>

					<LabeledInput
						label={isSimple ? "npm/git source" : "Source"}
						value={display}
						placeholder="npm:@scope/package or git:github.com/user/repo"
						onChange={(v) => {
							if (isSimple) {
								onUpdate(v);
							} else {
								onUpdate({ ...pkg, source: v });
							}
						}}
					/>

					{!isSimple && (
						<div className="grid grid-cols-2 gap-3">
							{(["extensions", "skills", "prompts", "themes"] as const).map((kind) => (
								<ResourceFilterEditor
									key={kind}
									kind={kind}
									values={((pkg as Record<string, unknown>)[kind] as string[] | undefined) ?? []}
									onChange={(next) => onUpdate({ ...pkg, [kind]: next })}
								/>
							))}
						</div>
					)}
				</div>
			)}
		</Card>
	);
}

function ResourceFilterEditor({
	kind,
	values,
	onChange,
}: {
	kind: "extensions" | "skills" | "prompts" | "themes";
	values: string[];
	onChange: (next: string[]) => void;
}) {
	const Icon = KIND_ICONS[kind];
	const [text, setText] = useState(() => values.join("\n"));
	const commit = useCallback(
		(raw: string) => {
			setText(raw);
			onChange(
				raw
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		},
		[onChange],
	);

	return (
		<div className="space-y-1">
			<label className="flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				<Icon className="h-3 w-3" />
				{kind}
			</label>
			<textarea
				value={text}
				placeholder={`One ${kind.slice(0, -1)} id per line`}
				onChange={(e) => commit(e.target.value)}
				rows={Math.max(2, Math.min(values.length + 1, 4))}
				className="w-full rounded-md bg-pi-bg p-2 font-mono text-2xs text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none"
			/>
		</div>
	);
}

function LabeledInput({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className="space-y-1">
			<label className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
				{label}
			</label>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				spellCheck={false}
				autoComplete="off"
				className="w-full rounded-md bg-pi-bg px-2.5 py-1.5 text-2xs text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none"
			/>
		</div>
	);
}
