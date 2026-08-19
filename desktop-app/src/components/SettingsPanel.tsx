import {
	ChevronDown,
	ChevronRight,
	FileText,
	Image as ImageIcon,
	Keyboard,
	Monitor,
	Power,
	RotateCcw,
	Search,
	Server,
	Settings as SettingsIcon,
	Shield,
	Sliders,
	Sparkles,
	User,
	Brain,
	Puzzle,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { triggerHaptic } from "../lib/haptics";
import {
	loadCliSettings,
	persistCliSettings,
	setByPath,
	useSettingsStore,
} from "../stores/settings-store";
import type { CliSettings, ThinkingLevel } from "../lib/settings.types";
import {
	applyRuntimeSync,
	findSection,
	listNavItems,
	readPath,
	type CliSettingsFieldSpec,
	type FieldOption,
	type SettingsCard,
	type SettingsSection,
	writePath,
} from "../lib/settings-schema";
import * as rpc from "../lib/rpc";
import { ThemePicker } from "./panels/widgets/ThemePicker";
import { ThinkingPresetPicker } from "./panels/widgets/ThinkingPresetPicker";
import { ModelsPicker } from "./panels/widgets/ModelsPicker";
import { DefaultModelPicker } from "./panels/widgets/DefaultModelPicker";
import { AccountSection } from "./panels/widgets/AccountSection";
import { CustomProvidersSection } from "./panels/widgets/CustomProvidersSection";
import { KeybindingsSection } from "./panels/widgets/KeybindingsSection";
import { McpServersEditor } from "./panels/widgets/McpServersEditor";
import { PackagesEditor } from "./panels/widgets/PackagesEditor";
import { PathListInput } from "./panels/widgets/PathListInput";
import { PermissionPoliciesEditor } from "./panels/widgets/PermissionPoliciesEditor";
import { ResourcesSection } from "./panels/widgets/ResourcesSection";
import { VoiceSection } from "./panels/widgets/VoiceSection";
import { CompletionSoundPicker } from "./panels/widgets/CompletionSoundPicker";
import { Switch } from "./ui/Switch";
import { Button, IconButton } from "./ui/Button";
import { Input, Textarea, Select } from "./ui/Input";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

// ============================================================================
// Nav configuration
// ============================================================================

type Scope = "global" | "project";

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
	general: Monitor,
	account: User,
	"ai-model": Sparkles,
	"custom-providers": Server,
	"look-and-feel": ImageIcon,
	"chat-behaviour": Power,
	privacy: Shield,
	"tools-and-permissions": Sliders,
	"external-tools": Puzzle,
	resources: Brain,
	keybindings: Keyboard,
	advanced: Server,
};

const FIRST_LAUNCH_KEY = "a-coder-first-launch-dismissed";

// ============================================================================
// Reusable form widgets — upgraded with hover/active states and smooth transitions
// ============================================================================

function SelectInput({
	value,
	options,
	onChange,
	disabled,
}: {
	value: string;
	options: FieldOption[];
	onChange: (v: string) => void;
	disabled?: boolean;
}) {
	return (
		<Select
			value={value}
			onChange={(e) => {
				triggerHaptic("selection");
				onChange(e.target.value);
			}}
			disabled={disabled}
			className={disabled ? "opacity-50" : ""}
		>
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{o.label}
				</option>
			))}
		</Select>
	);
}

function NumberInput({
	value,
	onChange,
	min,
	max,
	step,
	disabled,
}: {
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
}) {
	return (
		<Input
			type="number"
			value={Number.isFinite(value) ? value : ""}
			min={min}
			max={max}
			step={step}
			disabled={disabled}
			onChange={(e) => {
				const next = Number(e.target.value);
				onChange(Number.isFinite(next) ? next : 0);
			}}
			className="w-28 text-right"
		/>
	);
}

function TextInput({
	value,
	onChange,
	placeholder,
	disabled,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	disabled?: boolean;
}) {
	return (
		<Input
			type="text"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			disabled={disabled}
			className="w-72 max-w-full"
		/>
	);
}

function TextareaInput({
	value,
	onChange,
	placeholder,
	disabled,
	rows = 3,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	disabled?: boolean;
	rows?: number;
}) {
	return (
		<Textarea
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			disabled={disabled}
			rows={rows}
			mono
		/>
	);
}

function ListInput({
	value,
	onChange,
	disabled,
	placeholder,
}: {
	value: string[];
	onChange: (v: string[]) => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	return (
		<TextareaInput
			value={value.join("\n")}
			onChange={(text) =>
				onChange(
					text
						.split("\n")
						.map((s) => s.trim())
						.filter((s) => s.length > 0),
				)
			}
			placeholder={placeholder ?? "One entry per line"}
			disabled={disabled}
			rows={Math.max(2, Math.min(value.length + 1, 8))}
		/>
	);
}
function JsonInput({
	value,
	onChange,
	disabled,
}: {
	value: unknown;
	onChange: (v: unknown) => void;
		disabled?: boolean;
}) {
	const [text, setText] = useState(() => safeStringify(value));
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setText(safeStringify(value));
		setError(null);
	}, [value]);

	const commit = useCallback(
		(next: string) => {
			setText(next);
			try {
				const parsed = next.trim() === "" ? undefined : JSON.parse(next);
				setError(null);
				onChange(parsed);
			} catch (e) {
				setError((e as Error).message);
			}
		},
		[onChange],
	);

	return (
		<div className="w-full space-y-1">
			<textarea
				value={text}
				onChange={(e) => commit(e.target.value)}
				onBlur={() => commit(text)}
				disabled={disabled}
				rows={4}
				className={`w-full rounded-md bg-pi-bg p-2 font-mono text-2xs text-pi-text transition-smooth focus:outline-none ${
					error ? "shadow-ring-error" : "shadow-ring"
				}`}
				spellCheck={false}
			/>
			{error && (
				<p className="text-3xs text-pi-error">Invalid JSON: {error}</p>
			)}
		</div>
	);
}

function safeStringify(value: unknown): string {
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "";
	}
}

// ============================================================================
// Field row — friendly copy, no mono path text.
// ============================================================================

function FieldRow({
	spec,
	value,
	onChange,
	disabled,
	settings,
	onUpdateField,
}: {
	spec: CliSettingsFieldSpec;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled?: boolean;
	settings: CliSettings;
	onUpdateField: (path: string, value: unknown) => void;
}) {
	const widget = (() => {
		switch (spec.kind) {
			case "toggle":
				return (
					<Switch
						checked={Boolean(value)}
						onChange={() => onChange(!Boolean(value))}
						disabled={disabled}
					/>
				);
			case "select":
				return (
					<SelectInput
						value={(value as string | undefined) ?? ""}
						options={spec.options ?? []}
						onChange={(v) => onChange(v)}
						disabled={disabled}
					/>
				);
			case "number":
				return (
					<NumberInput
						value={(value as number | undefined) ?? 0}
						onChange={onChange}
						min={spec.min}
						max={spec.max}
						step={spec.step}
						disabled={disabled}
					/>
				);
			case "text":
				return (
					<TextInput
						value={(value as string | undefined) ?? ""}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "textarea":
				return (
					<TextareaInput
						value={(value as string | undefined) ?? ""}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "list":
				return (
					<ListInput
						value={(value as string[] | undefined) ?? []}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "path-list":
				return (
					<PathListInput
						value={(value as string[] | undefined) ?? []}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "object":
				return <JsonInput value={value} onChange={onChange} disabled={disabled} />;
			case "custom":
				return renderCustom(spec, value, onChange, settings, onUpdateField);
			default:
				return null;
		}
	})();

	// Custom widgets (theme picker, models editor, etc.) need full width below the label.
	if (spec.kind === "custom") {
		return (
			<div className="py-2.5 transition-smooth">
				<div className="mb-2">
					<label className="text-xs font-medium text-pi-text">
						{spec.label}
					</label>
					{spec.hint && (
						<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
							{spec.hint}
						</p>
					)}
				</div>
				<div className="min-w-0">{widget}</div>
			</div>
		);
	}

	return (
		<div className="flex items-start justify-between gap-4 py-2.5 transition-smooth">
			<div className="min-w-0 flex-1">
				<label className="text-xs font-medium text-pi-text">
					{spec.label}
				</label>
				{spec.hint && (
					<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
						{spec.hint}
					</p>
				)}
			</div>
			<div className="shrink-0 pt-0.5">{widget}</div>
		</div>
	);
}

function renderCustom(
	spec: CliSettingsFieldSpec,
	value: unknown,
	onChange: (v: unknown) => void,
	settings: CliSettings,
	onUpdateField: (path: string, value: unknown) => void,
): React.ReactNode {
	switch (spec.widget) {
		case "theme":
			return <ThemePicker />;
		case "thinking":
			return (
				<ThinkingPresetPicker
					value={value as ThinkingLevel | undefined}
					onChange={(v) => onChange(v)}
				/>
			);
		case "models":
			return (
				<ModelsPicker
					enabled={(value as string[] | undefined) ?? []}
					onChange={(v) => onChange(v)}
				/>
			);
		case "defaultModel":
			return (
				<DefaultModelPicker
					provider={readPath(settings, "defaultProvider") as string | undefined}
					modelId={readPath(settings, "defaultModel") as string | undefined}
					onUpdateField={onUpdateField}
				/>
			);
		case "mcpServers":
			return (
				<McpServersEditor
					value={value as Record<string, unknown>[] | undefined}
					onChange={(v) => onChange(v)}
				/>
			);
		case "permissionPolicies":
			return (
				<PermissionPoliciesEditor
					value={value as Record<string, string[]> | undefined}
					onChange={(v) => onChange(v)}
				/>
			);
		case "packages":
			return (
				<PackagesEditor
					value={(value ?? []) as import("./panels/widgets/PackagesEditor").PackageSource[]}
					onChange={(v) => onChange(v as unknown)}
				/>
			);
		case "resources":
			return <ResourcesSection />;
		case "completionSound":
			return <CompletionSoundPicker />;
		default:
			return null;
	}
}

// ============================================================================
// Card — group related fields, optional "Show advanced" disclosure.
// ============================================================================

function CardView({
	card,
	settings,
	disabled,
	onUpdate,
	search,
}: {
	card: SettingsCard;
	settings: CliSettings;
	disabled?: boolean;
	onUpdate: (path: string, value: unknown) => void;
	search: string;
}) {
	// Filter fields against search (label + hint).
	const matches = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return card.fields;
		return card.fields.filter((f) => {
			return (
				f.label.toLowerCase().includes(q) ||
				(f.hint ?? "").toLowerCase().includes(q)
			);
		});
	}, [card.fields, search]);

	const advanced = useMemo(
		() => matches.filter((f) => f.advanced),
		[matches],
	);
	const simple = useMemo(
		() => matches.filter((f) => !f.advanced),
		[matches],
	);

	const [showAdvanced, setShowAdvanced] = useState(false);

	if (matches.length === 0) return null;

	const needsToggle = advanced.length > 0;

	return (
		<section className="overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring transition-smooth hover:shadow-card-hover">
			<div className="border-b border-pi-border px-4 py-3">
				<h3 className="text-xs font-semibold text-pi-text">{card.title}</h3>
				{card.description && (
					<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
						{card.description}
					</p>
				)}
			</div>
			<div className="divide-y divide-pi-border px-4">
				{simple.map((spec) => (
					<FieldRow
						key={spec.path}
						spec={spec}
						value={readPath(settings, spec.path)}
						onChange={(v) => onUpdate(spec.path, v)}
						disabled={disabled}
						settings={settings}
						onUpdateField={onUpdate}
					/>
				))}
			</div>
			{needsToggle && (
				<>
					{showAdvanced && (
						<div className="divide-y divide-pi-border border-t border-pi-border px-4">
							{advanced.map((spec) => (
								<FieldRow
									key={spec.path}
									spec={spec}
									value={readPath(settings, spec.path)}
									onChange={(v) => onUpdate(spec.path, v)}
									disabled={disabled}
									settings={settings}
									onUpdateField={onUpdate}
								/>
							))}
						</div>
					)}
					<button
						type="button"
						onClick={() => setShowAdvanced((v) => !v)}
						className={`flex w-full items-center gap-1.5 border-t border-pi-border px-4 py-2 text-left text-2xs font-medium text-pi-text-muted transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text`}
					>
						<ChevronDown
							className={`h-3 w-3 transition-transform ${
								showAdvanced ? "rotate-180" : ""
							}`}
						/>
						{showAdvanced ? "Hide advanced" : "Show advanced"}
						<span className="ml-1 text-3xs text-pi-text-faint">
							{advanced.length} setting{advanced.length === 1 ? "" : "s"}
						</span>
					</button>
				</>
			)}
		</section>
	);
}

// ============================================================================
// Flat section view (sections without cards)
// ============================================================================

function SectionView({
	section,
	settings,
	disabled,
	onUpdate,
	search,
}: {
	section: SettingsSection;
	settings: CliSettings;
	disabled?: boolean;
	onUpdate: (path: string, value: unknown) => void;
	search: string;
}) {
	const allFields = section.fields ?? [];

	// Apply search filter.
	const matches = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return allFields;
		return allFields.filter((f) => {
			return (
				f.label.toLowerCase().includes(q) ||
				(f.hint ?? "").toLowerCase().includes(q)
			);
		});
	}, [allFields, search]);

	const advanced = useMemo(() => matches.filter((f) => f.advanced), [matches]);
	const simple = useMemo(() => matches.filter((f) => !f.advanced), [matches]);

	const [showAdvanced, setShowAdvanced] = useState(false);

	if (matches.length === 0) return null;

	const needsToggle = advanced.length > 0;

	return (
		<section className="space-y-2">
			<div className={`divide-y divide-pi-border rounded-lg bg-pi-surface-raised px-4 shadow-ring transition-smooth hover:shadow-card-hover`}>
				{simple.map((spec) => (
					<FieldRow
						key={spec.path}
						spec={spec}
						value={readPath(settings, spec.path)}
						onChange={(v) => onUpdate(spec.path, v)}
						disabled={disabled}
						settings={settings}
						onUpdateField={onUpdate}
					/>
				))}
			</div>
			{needsToggle && (
				<>
					{showAdvanced && (
						<div className={`divide-y divide-pi-border rounded-lg bg-pi-surface-raised px-4 shadow-ring transition-smooth hover:shadow-card-hover`}>
							{advanced.map((spec) => (
								<FieldRow
									key={spec.path}
									spec={spec}
									value={readPath(settings, spec.path)}
									onChange={(v) => onUpdate(spec.path, v)}
									disabled={disabled}
									settings={settings}
									onUpdateField={onUpdate}
								/>
							))}
						</div>
					)}
					<button
						type="button"
						onClick={() => setShowAdvanced((v) => !v)}
						className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text`}
					>
						<ChevronDown
							className={`h-3 w-3 transition-transform ${
								showAdvanced ? "rotate-180" : ""
							}`}
						/>
						{showAdvanced ? "Hide advanced" : "Show advanced"}
						<span className="ml-1 text-3xs text-pi-text-faint">
							{advanced.length} setting{advanced.length === 1 ? "" : "s"}
						</span>
					</button>
				</>
			)}
		</section>
	);
}

// ============================================================================
// Advanced — raw JSON escape hatch
// ============================================================================

function AdvancedJsonEditor({
	scope,
	onSaved,
}: {
	scope: Scope;
	onSaved: () => void;
}) {
	const [text, setText] = useState("{}");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		rpc
			.readSettingsFile({ scope })
			.then((data) => setText(JSON.stringify(data ?? {}, null, 2)))
			.catch(() => setText("{}"));
	}, [scope]);

	const validate = useCallback((next: string) => {
		try {
			JSON.parse(next);
			setError(null);
		} catch (e) {
			setError((e as Error).message);
		}
	}, []);

	const save = useCallback(async () => {
		try {
			const parsed = JSON.parse(text);
			await persistCliSettings(scope, parsed as CliSettings);
			setError(null);
			onSaved();
		} catch (e) {
			setError((e as Error).message);
		}
	}, [text, scope, onSaved]);

	return (
		<div className="space-y-3">
			<div
				className={`rounded-lg border bg-pi-bg transition-smooth ${
					error ? "border-pi-error" : "border-pi-border-strong"
				}`}
			>
				<textarea
					value={text}
					onChange={(e) => {
						setText(e.target.value);
						validate(e.target.value);
					}}
					onBlur={() => validate(text)}
					className="h-64 w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-pi-text focus:outline-none"
					spellCheck={false}
				/>
			</div>

			{error && (
				<div className="rounded-md bg-pi-error/10 px-3 py-1.5 text-2xs font-medium text-pi-error">
					Invalid JSON: {error}
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				<Button
					variant="primary"
					size="sm"
					icon={ChevronRight}
					onClick={() => void save()}
				>
					Save raw JSON
				</Button>

				<Button
					variant="secondary"
					size="sm"
					icon={RotateCcw}
					onClick={() => void persistCliSettings(scope, {}).then(onSaved)}
				>
					Reset to defaults
				</Button>

				<Button
					variant="secondary"
					size="sm"
					icon={FileText}
					onClick={() =>
						rpc
							.openInEditor(
								scope === "global"
									? "~/.a-coder-cli/agent/settings.json"
									: "./.a-coder-cli/settings.json",
							)
							.catch(() => {})
					}
				>
					Open in editor
				</Button>

				<Button
					variant="secondary"
					size="sm"
					onClick={() =>
						rpc
							.revealInFileManager(
								scope === "global"
									? "~/.a-coder-cli/agent/settings.json"
									: "./.a-coder-cli/settings.json",
							)
							.catch(() => {})
					}
				>
					Reveal in Finder
				</Button>
			</div>
		</div>
	);
}

// ============================================================================
// First-launch banner
// ============================================================================

function FirstLaunchBanner({ onDismiss, onGoToAccount }: { onDismiss: () => void; onGoToAccount: () => void }) {
	return (
		<div className="mb-4 flex items-start gap-3 rounded-lg border border-pi-accent/30 bg-pi-accent-soft px-4 py-3 transition-smooth hover:bg-pi-accent-soft">
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pi-accent text-white active-press">
				<Sparkles className="h-3.5 w-3.5" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="text-xs font-semibold text-pi-text">
					Welcome to A-Coder
				</div>
				<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-secondary">
					Sign in to an AI provider to start chatting. You can do that any time
					from the Account section.
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<Button
					variant="primary"
					size="sm"
					onClick={onGoToAccount}
				>
					Sign in
				</Button>
				<IconButton
					variant="ghost"
					size="sm"
					icon={X}
					onClick={onDismiss}
					aria-label="Dismiss"
				/>
			</div>
		</div>
	);
}

// ============================================================================
// Main panel — upgraded with better transitions, hover states, and layout polish
// ============================================================================

export function SettingsPanel({ onClose }: { onClose: () => void }) {
	const [scope, setScope] = useState<Scope>("global");
	const [activeNavId, setActiveNavId] = useState<string>(() => {
		if (typeof window !== "undefined" && window.location.hash) {
			const h = window.location.hash.replace(/^#/, "");
			if (h) return h;
		}
		return "general";
	});
	const [search, setSearch] = useState("");
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [showFirstLaunch, setShowFirstLaunch] = useState(() => {
		try {
			return localStorage.getItem(FIRST_LAUNCH_KEY) !== "1";
		} catch {
			return true;
		}
	});
	const [authEmpty, setAuthEmpty] = useState<boolean | null>(null);
	const modalRef = useRef<HTMLDivElement>(null);
	useModalA11y(modalRef, true, onClose);

	// Mirror section id into the URL hash so other components can deep-link.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const next = `#${activeNavId}`;
		if (window.location.hash !== next) {
			window.history.replaceState(null, "", next);
		}
	}, [activeNavId]);

	const cliGlobalSettings = useSettingsStore((s) => s.cliGlobalSettings);
	const cliProjectSettings = useSettingsStore((s) => s.cliProjectSettings);
	const cliSettingsLoaded = useSettingsStore((s) => s.cliSettingsLoaded);

	const activeSettings: CliSettings = scope === "global" ? cliGlobalSettings : cliProjectSettings;

	const navItems = useMemo(() => listNavItems(), []);
	const section = findSection(activeNavId);

	// Load cli's settings.json once on mount.
	useEffect(() => {
		if (cliSettingsLoaded) return;
		loadCliSettings()
			.then(({ global, project }) => {
				useSettingsStore.getState().setCliSettings(global, project);
			})
			.catch(() => {
				useSettingsStore.getState().setCliSettings({}, {});
			});
	}, [cliSettingsLoaded]);

	// Check auth.json to drive the first-launch banner.
	useEffect(() => {
		rpc
			.readAuthFile()
			.then((data) => {
				const keys = Object.keys((data as Record<string, unknown>) ?? {});
				setAuthEmpty(keys.length === 0);
			})
			.catch(() => setAuthEmpty(null));
	}, []);

	const dismissFirstLaunch = useCallback(() => {
		setShowFirstLaunch(false);
		try {
			localStorage.setItem(FIRST_LAUNCH_KEY, "1");
		} catch {
			// ignore
		}
	}, []);

	const updateField = useCallback(
		(path: string, value: unknown) => {
			const store = useSettingsStore.getState();
			const current =
				scope === "global" ? store.cliGlobalSettings : store.cliProjectSettings;
			const next = writePath(current, path, value);

			useSettingsStore.setState(
				scope === "global"
					? { cliGlobalSettings: next }
					: { cliProjectSettings: next },
			);

			// Push runtime fields straight to the engine.
			const allFields = section?.fields ?? section?.cards?.flatMap((c) => c.fields) ?? [];
			const spec = allFields.find((f) => f.path === path);
			if (spec?.runtimeSync) {
				applyRuntimeSync(path, value);
			}

			// Debounced persist to settings.json.
			if (saveTimer.current) clearTimeout(saveTimer.current);
			setSavedAt(Date.now());
			saveTimer.current = setTimeout(() => {
				void persistCliSettings(scope, next);
			}, 400);
		},
		[scope, section],
	);

	useEffect(
		() => () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		},
		[],
	);

	const handleSaved = useCallback(() => {
		setSavedAt(Date.now());
		void loadCliSettings().then(({ global, project }) => {
			useSettingsStore.getState().setCliSettings(global, project);
		});
	}, []);

	const isAdvanced = activeNavId === "advanced";
	const isAccount = activeNavId === "account";
	const isCustomProviders = activeNavId === "custom-providers";
	const isKeybindings = activeNavId === "keybindings";
	const isResources = activeNavId === "resources";
	const isVoice = activeNavId === "voice";
	const showBanner = showFirstLaunch && authEmpty === true && !search.trim();

	return (
		<ModalBackdrop
			ref={modalRef}
			aria-label="Settings"
			onClick={onClose}
		>
			<ModalPanel
				className="max-w-4xl bg-pi-surface"
				onClick={(e) => e.stopPropagation()}
			>
				{/* =================== Left nav =================== */}
				<nav className="w-56 shrink-0 overflow-y-auto border-r border-pi-border px-3 py-5">
					<div className="mb-4 px-1 text-2xs font-semibold uppercase tracking-wider text-pi-text-faint">
						Settings
					</div>

					{/* Scope toggle */}
					<div className="mb-3 flex gap-0.5 rounded-md bg-pi-surface-raised p-0.5 shadow-ring transition-smooth hover:shadow-card-hover">
						{(["global", "project"] as const).map((s) => (
							<button
								key={s}
								type="button"
								onClick={() => setScope(s)}
								className={`flex h-6 flex-1 items-center justify-center rounded text-3xs font-semibold uppercase tracking-wider transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
									scope === s
										? "bg-pi-accent text-white shadow-sm hover:bg-pi-accent-hover"
										: "text-pi-text-muted hover:bg-pi-surface-overlay hover:text-pi-text"
								}`}
							>
								{s === "global" ? "Global" : "Project"}
							</button>
						))}
					</div>

					{/* Nav items */}
					<div className="space-y-0.5">
						{navItems.map(({ id, label }) => {
							const Icon = NAV_ICONS[id] ?? SettingsIcon;
							const active = activeNavId === id;
							return (
								<button
									key={id}
									type="button"
									onClick={() => setActiveNavId(id)}
									aria-current={active ? "page" : undefined}
									className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
										active
											? "bg-pi-surface-raised text-pi-text hover:bg-pi-surface-overlay"
											: "text-pi-text-muted hover:bg-pi-surface-raised hover:text-pi-text"
									}`}
								>
									<Icon
										className={`h-4 w-4 shrink-0 transition-smooth ${
											active ? "text-pi-accent" : "text-pi-text-muted"
										}`}
									/>
									<div className="text-xs font-medium">{label}</div>
								</button>
							);
						})}
					</div>

					{savedAt && (
						<div className="mt-4 px-1 text-2xs font-medium text-pi-text-faint">
							Saved
						</div>
					)}
				</nav>

				{/* =================== Right panel =================== */}
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					{/* Header */}
					<div className="flex shrink-0 items-center justify-between gap-4 border-b border-pi-border px-6 py-4 transition-smooth hover:bg-pi-surface-raised/30">
						<div className="min-w-0">
							<h2 className="text-[15px] font-semibold tracking-tight">
								{section?.label ?? "Settings"}
							</h2>
							{section?.description && (
								<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
									{section.description}
								</p>
							)}
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<div className="relative">
								<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pi-text-faint transition-smooth" />
								<input
									type="text"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Escape") setSearch("");
									}}
									placeholder="Search…"
									className={`w-44 rounded-md bg-pi-surface-raised py-1.5 pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-text-faint shadow-ring transition-smooth focus:shadow-focus focus:outline-none`}
								/>
							</div>
							<IconButton
								variant="ghost"
								size="md"
								icon={X}
								onClick={onClose}
								aria-label="Close"
							/>
						</div>
					</div>

					{/* Body */}
					<div className="flex-1 space-y-6 overflow-auto p-6">
						{!cliSettingsLoaded ? (
							<div className="flex h-full items-center justify-center text-xs text-pi-text-muted">
								Loading settings…
							</div>
						) : (
							<>
								{showBanner && (
									<FirstLaunchBanner
										onDismiss={dismissFirstLaunch}
										onGoToAccount={() => setActiveNavId("account")}
									/>
								)}
								{isAccount ? (
									<AccountSection />
								) : isCustomProviders ? (
									<CustomProvidersSection />
								) : isKeybindings ? (
									<KeybindingsSection />
								) : isResources ? (
									<ResourcesSection />
								) : isVoice ? (
									<VoiceSection />
								) : isAdvanced ? (
									<section className="space-y-4">
										<header>
											<h2 className="text-[15px] font-semibold tracking-tight">
												Advanced
											</h2>
											<p className="mt-0.5 text-2xs text-pi-text-muted">
												Edit settings.json directly. Most people won't need to touch this.
											</p>
										</header>
										<AdvancedJsonEditor scope={scope} onSaved={handleSaved} />
									</section>
								) : section?.cards ? (
									<div className="space-y-3">
										{section.cards.map((card) => (
											<CardView
												key={card.title}
												card={card}
												settings={activeSettings}
												onUpdate={updateField}
												search={search}
											/>
										))}
									</div>
								) : section ? (
									<SectionView
										section={section}
										settings={activeSettings}
										onUpdate={updateField}
										search={search}
									/>
								) : null}
							</>
						)}
					</div>

					{/* Footer */}
					<div className="flex shrink-0 items-center justify-between gap-2 border-t border-pi-border bg-pi-surface/40 px-5 py-3">
						<span className="text-2xs text-pi-text-faint">
							Changes save automatically.
						</span>
						<Button variant="ghost" size="md" onClick={onClose}>
							Close
						</Button>
					</div>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

// Re-export `setByPath` so callers outside this file (e.g. tests) can use it.
export { setByPath };

export default SettingsPanel;
