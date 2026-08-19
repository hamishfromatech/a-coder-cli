import {
	BookOpen,
	Brain,
	ChevronDown,
	Palette,
	Plus,
	RefreshCw,
	Trash2,
	Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as rpc from "../../../lib/rpc";
import type { PathMetadata, ResolvedResource } from "../../../lib/rpc";
import { loadCliSettings, useSettingsStore } from "../../../stores/settings-store";
import { useSessionStore } from "../../../stores/session-store";
import { Switch } from "../../ui/Switch";

// ============================================================================
// Types
// ============================================================================

type ResourceType = "extensions" | "skills" | "prompts" | "themes";

const RESOURCE_FRIENDLY_LABELS: Record<ResourceType, string> = {
	extensions: "Tools",
	skills: "Skills",
	prompts: "Prompt styles",
	themes: "Themes",
};

const KIND_ICONS: Record<ResourceType, React.ComponentType<{ className?: string }>> = {
	extensions: Wand2,
	skills: Brain,
	prompts: BookOpen,
	themes: Palette,
};

interface ResourceItem {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
	resourceType: ResourceType;
	displayName: string;
}

interface ResourceSubgroup {
	type: ResourceType;
	label: string;
	items: ResourceItem[];
}

interface ResourceGroup {
	label: string;
	scope: PathMetadata["scope"];
	origin: PathMetadata["origin"];
	source: string;
	subgroups: ResourceSubgroup[];
}

// ============================================================================
// Friendly grouping helpers
// ============================================================================

function getGroupLabel(metadata: PathMetadata): string {
	if (metadata.origin === "package") {
		// Strip the technical prefix for a cleaner package name.
		return packageDisplayName(metadata.source);
	}
	if (metadata.source === "auto") {
		return metadata.scope === "user" ? "Built-in skills" : "Skills from this project";
	}
	return metadata.scope === "user" ? "Your skills" : "Project skills";
}

function packageDisplayName(source: string): string {
	if (source.startsWith("npm:")) return source.slice(4);
	if (source.startsWith("git:")) return source.slice(4);
	if (source.startsWith("https://")) {
		try {
			const url = new URL(source);
			return url.pathname.replace(/^\//, "").replace(/\.git$/, "") || source;
		} catch {
			return source;
		}
	}
	return source;
}

function getDisplayName(resourceType: ResourceType, path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const fileName = normalized.split("/").pop() ?? normalized;
	const parentFolder = normalized.split("/").slice(-2, -1)[0] ?? "";
	if (resourceType === "skills" && fileName === "SKILL.md") {
		return parentFolder;
	}
	if (resourceType === "extensions" && parentFolder && parentFolder !== "extensions") {
		return `${parentFolder}/${fileName}`;
	}
	return fileName;
}

function buildGroups(resolved: rpc.ResolvedPaths): ResourceGroup[] {
	const groupMap = new Map<string, ResourceGroup>();
	const add = (resources: ResolvedResource[], resourceType: ResourceType) => {
		for (const res of resources) {
			const key = `${res.metadata.origin}:${res.metadata.scope}:${res.metadata.source}:${res.metadata.baseDir ?? ""}`;
			if (!groupMap.has(key)) {
				groupMap.set(key, {
					label: getGroupLabel(res.metadata),
					scope: res.metadata.scope,
					origin: res.metadata.origin,
					source: res.metadata.source,
					subgroups: [],
				});
			}
			const group = groupMap.get(key)!;
			let subgroup = group.subgroups.find((sg) => sg.type === resourceType);
			if (!subgroup) {
				subgroup = { type: resourceType, label: RESOURCE_FRIENDLY_LABELS[resourceType], items: [] };
				group.subgroups.push(subgroup);
			}
			subgroup.items.push({
				path: res.path,
				enabled: res.enabled,
				metadata: res.metadata,
				resourceType,
				displayName: getDisplayName(resourceType, res.path),
			});
		}
	};

	add(resolved.extensions, "extensions");
	add(resolved.skills, "skills");
	add(resolved.prompts, "prompts");
	add(resolved.themes, "themes");

	const groups = Array.from(groupMap.values());
	groups.sort((a, b) => {
		if (a.origin !== b.origin) return a.origin === "package" ? 1 : -1; // built-in first
		if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1; // project next to user
		return a.label.localeCompare(b.label);
	});

	const typeOrder: Record<ResourceType, number> = { skills: 0, extensions: 1, prompts: 2, themes: 3 };
	for (const group of groups) {
		group.subgroups.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
		for (const subgroup of group.subgroups) {
			subgroup.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
		}
	}

	return groups;
}

// ============================================================================
// UI
// ============================================================================

export function ResourcesSection() {
	const cwd = useSessionStore((s) => s.cwd);
	const [groups, setGroups] = useState<ResourceGroup[]>([]);
	const [packages, setPackages] = useState<rpc.ConfiguredPackage[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [newSource, setNewSource] = useState("");
	const [newLocal, setNewLocal] = useState(false);
	const [working, setWorking] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [resolved, configured] = await Promise.all([
				rpc.resolveResources(cwd ?? undefined),
				rpc.listPackages(cwd ?? undefined),
			]);
			setGroups(buildGroups(resolved));
			setPackages(configured);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	const refreshSettings = useCallback(async () => {
		try {
			const { global, project } = await loadCliSettings(cwd ?? undefined);
			useSettingsStore.getState().setCliSettings(global, project);
		} catch {
			// ignore — settings file may not exist yet
		}
	}, [cwd]);

	const handleToggle = async (item: ResourceItem) => {
		setWorking(item.path);
		try {
			await rpc.toggleResource({
				resourceType: item.resourceType,
				path: item.path,
				enabled: !item.enabled,
				scope: item.metadata.scope === "temporary" ? "user" : item.metadata.scope,
				origin: item.metadata.origin,
				source: item.metadata.origin === "package" ? item.metadata.source : undefined,
				baseDir: item.metadata.baseDir,
				cwd: cwd ?? undefined,
			});
			await Promise.all([load(), refreshSettings()]);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setWorking(null);
		}
	};

	const handleInstall = async () => {
		if (!newSource.trim()) return;
		setWorking(`install:${newSource}`);
		try {
			await rpc.installPackage(newSource.trim(), newLocal, cwd ?? undefined);
			setNewSource("");
			setNewLocal(false);
			await Promise.all([load(), refreshSettings()]);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setWorking(null);
		}
	};

	const handleRemove = async (source: string, local: boolean) => {
		setWorking(`remove:${source}`);
		try {
			await rpc.removePackage(source, local, cwd ?? undefined);
			await Promise.all([load(), refreshSettings()]);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setWorking(null);
		}
	};

	const handleUpdate = async (source?: string) => {
		setWorking(`update:${source ?? "all"}`);
		try {
			await rpc.updatePackage(source, cwd ?? undefined);
			await Promise.all([load(), refreshSettings()]);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setWorking(null);
		}
	};

	const totalSkills = useMemo(
		() =>
			groups.reduce(
				(sum, g) => sum + g.subgroups.filter((sg) => sg.type === "skills").reduce((s, sg) => s + sg.items.length, 0),
				0,
			),
		[groups],
	);

	const allSkills = useMemo(
		() =>
			groups.flatMap((g) =>
				g.subgroups
					.filter((sg) => sg.type === "skills")
					.flatMap((sg) => sg.items.map((item) => ({ ...item, groupLabel: g.label }))),
			),
		[groups],
	);

	const builtInGroups = groups.filter((g) => g.origin !== "package");
	const packGroups = groups.filter((g) => g.origin === "package");

	return (
		<div className="space-y-6">
			{error && (
				<div className="rounded-md bg-pi-error/10 px-3 py-2 text-2xs text-pi-error">
					{error}
				</div>
			)}

			{/* ---- Skills gallery ----------------------------------------------- */}
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="text-xs font-semibold text-pi-text">
						Skills
						{totalSkills > 0 && (
							<span className="ml-1 text-3xs font-normal text-pi-text-muted">{totalSkills}</span>
						)}
					</h3>
					<button
						type="button"
						onClick={() => void load()}
						disabled={loading}
						className="inline-flex h-6 items-center gap-1 rounded-md bg-pi-surface-overlay px-2 text-3xs font-medium text-pi-text transition-hover active-press hover:bg-pi-surface-raised disabled:opacity-50"
					>
						<RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
						Refresh
					</button>
				</div>

				{allSkills.length === 0 && !loading && (
					<div className="rounded-lg bg-pi-surface-raised px-4 py-6 text-center shadow-ring">
						<div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-pi-accent-soft text-pi-accent">
							<Brain className="h-5 w-5" />
						</div>
						<h4 className="text-xs font-medium text-pi-text">No skills yet</h4>
						<p className="mx-auto mt-1 max-w-xs text-2xs leading-relaxed text-pi-text-muted">
							Skills teach the assistant how to help with specific tasks. Add a skill pack below, or ask the assistant to make one for you.
						</p>
					</div>
				)}

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{allSkills.map((item) => (
						<SkillCard
							key={item.path}
							item={item}
							disabled={working === item.path}
							onToggle={() => void handleToggle(item)}
						/>
					))}
				</div>
			</section>

			{/* ---- Add a skill pack --------------------------------------------- */}
			<section className="rounded-lg bg-pi-surface-raised p-4 shadow-ring">
				<h3 className="mb-1 text-xs font-semibold text-pi-text">Add a skill pack</h3>
				<p className="mb-3 text-2xs leading-relaxed text-pi-text-muted">
					Skill packs are bundles of skills shared by the community. Paste a link or package name to install one.
				</p>

				{packages.length > 0 && (
					<div className="mb-3 space-y-2">
						{packages.map((pkg) => (
							<div
								key={`${pkg.scope}:${pkg.source}`}
								className="flex items-center justify-between rounded-md bg-pi-bg px-3 py-2"
							>
								<div className="min-w-0">
									<div className="truncate text-xs font-medium text-pi-text">
										{packageDisplayName(pkg.source)}
									</div>
									<div className="text-3xs text-pi-text-muted">
										{pkg.scope === "project" ? "Only for this project" : "Available in all projects"}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onClick={() => void handleUpdate(pkg.source)}
										disabled={working === `update:${pkg.source}`}
										className="rounded p-1.5 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text disabled:opacity-50"
										title="Update" aria-label="Update"
									>
											<RefreshCw className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={() => void handleRemove(pkg.source, pkg.scope === "project")}
											disabled={working === `remove:${pkg.source}`}
											className="rounded p-1.5 text-pi-text-muted transition-hover active-press hover:bg-pi-error-soft hover:text-pi-error disabled:opacity-50"
											title="Remove" aria-label="Remove"
										>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</div>
									</div>
								))}
							</div>
						)}

					<div className="flex flex-wrap items-center gap-2">
						<input
							type="text"
							value={newSource}
							onChange={(e) => setNewSource(e.target.value)}
							placeholder="e.g. github.com/earendil-works/pi-skills"
							className="min-w-[16rem] flex-1 rounded-md bg-pi-bg px-3 py-1.5 text-2xs text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none"
						/>
						<label className="flex items-center gap-1.5 text-2xs text-pi-text-muted">
							<input
								type="checkbox"
								checked={newLocal}
								onChange={(e) => setNewLocal(e.target.checked)}
								className="accent-pi-accent"
							/>
							Only this project
						</label>
						<button
							type="button"
							onClick={() => void handleInstall()}
							disabled={working?.startsWith("install") || !newSource.trim()}
							className="inline-flex h-7 items-center gap-1 rounded-md bg-pi-accent px-2.5 text-2xs font-medium text-white transition-hover active-press hover:bg-pi-accent-hover disabled:opacity-50"
						>
							<Plus className="h-3 w-3" />
							Add
						</button>
					</div>
				</section>

			{/* ---- Advanced resources ------------------------------------------- */}
			<section className="space-y-3">
				<button
					type="button"
					onClick={() => setShowAdvanced((v) => !v)}
					className="flex w-full items-center gap-1.5 text-2xs font-medium text-pi-text-muted transition-hover active-press hover:text-pi-text"
				>
					<ChevronDown
						className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
					/>
					{showAdvanced ? "Hide advanced resources" : "Show advanced resources"}
				</button>

				{showAdvanced && (
					<div className="space-y-3">
						{builtInGroups.length === 0 && packGroups.length === 0 && !loading && (
							<p className="text-2xs text-pi-text-muted">
								No extensions, prompt styles, or themes found.
							</p>
						)}

						{[...builtInGroups, ...packGroups].map((group) => (
							<div
								key={`${group.origin}:${group.scope}:${group.source}`}
								className="overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring"
							>
								<button
									type="button"
									onClick={() =>
										setExpandedGroups((prev) => {
											const next = new Set(prev);
											if (next.has(group.label)) next.delete(group.label);
											else next.add(group.label);
											return next;
										})
									}
									className="flex w-full items-center justify-between px-3 py-2 text-left transition-hover hover:bg-pi-surface-overlay"
								>
									<span className="text-xs font-medium text-pi-text">{group.label}</span>
									<span className="text-3xs text-pi-text-faint">
										{expandedGroups.has(group.label) ? "Hide" : "Show"}
									</span>
								</button>

								{expandedGroups.has(group.label) && (
									<div className="divide-y divide-pi-border border-t border-pi-border px-3 py-2">
										{group.subgroups.map((subgroup) => {
											const Icon = KIND_ICONS[subgroup.type];
											return (
												<div key={subgroup.type} className="py-2 first:pt-0 last:pb-0">
													<div className="mb-1.5 flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
														<Icon className="h-3 w-3" />
														{subgroup.label}
													</div>
													<div className="space-y-1">
														{subgroup.items.map((item) => (
															<ResourceRow
																key={item.path}
																item={item}
																disabled={working === item.path}
																onToggle={() => void handleToggle(item)}
															/>
														))}
													</div>
												</div>
											);
											})}
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		);
	}

function SkillCard({
	item,
	disabled,
	onToggle,
}: {
	item: ResourceItem & { groupLabel: string };
	disabled: boolean;
	onToggle: () => void;
}) {
	return (
		<div
			className={`flex flex-col justify-between gap-3 rounded-lg bg-pi-surface-raised p-3 shadow-ring transition-hover ${disabled ? "opacity-60" : "hover:shadow-card-hover"}`}
		>
			<div className="min-w-0">
				<div className="flex items-start justify-between gap-2">
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent">
						<Brain className="h-4 w-4" />
					</div>
					<Switch
						size="sm"
						checked={item.enabled}
						onChange={onToggle}
						disabled={disabled}
						ariaLabel={`Toggle ${item.displayName}`}
					/>
				</div>
				<div className="mt-1.5 truncate text-xs font-medium text-pi-text">{item.displayName}</div>
				<div className="text-3xs text-pi-text-muted">{item.groupLabel}</div>
			</div>
			<div className="flex items-center gap-1.5 text-3xs text-pi-text-muted">
				{item.enabled ? (
					<>
						<span className="h-1.5 w-1.5 rounded-full bg-pi-accent" />
						Enabled
					</>
				) : (
					<>
						<span className="h-1.5 w-1.5 rounded-full bg-pi-text-faint" />
						Disabled
					</>
				)}
			</div>
		</div>
	);
}

function ResourceRow({
	item,
	disabled,
	onToggle,
}: {
	item: ResourceItem;
	disabled: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-hover hover:bg-pi-bg">
			<div className="min-w-0">
				<div className="truncate text-2xs font-medium text-pi-text">{item.displayName}</div>
			</div>
			<Switch
				size="sm"
				checked={item.enabled}
				onChange={onToggle}
				disabled={disabled}
				ariaLabel={`Toggle ${item.displayName}`}
			/>
		</div>
	);
}
