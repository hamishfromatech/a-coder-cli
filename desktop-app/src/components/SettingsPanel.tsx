import {
	AlertCircle,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	FileText,
	FlaskConical,
	Globe,
	Keyboard,
	Loader2,
	MessagesSquare,
	Mic,
	Monitor,
	Palette,
	Puzzle,
	RefreshCw,
	RotateCcw,
	Search,
	SearchX,
	Settings as SettingsIcon,
	Shield,
	Sliders,
	Smartphone,
	Sparkles,
	User,
	Wrench,
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
import type { AutoContinueSettings, CliSettings, ThinkingLevel } from "../lib/settings.types";
import {
	applyRuntimeSync,
	listNavGroups,
	normalizeNavId,
	readPath,
	sectionsForNavId,
	type CliSettingsFieldSpec,
	type FieldOption,
	type SettingsCard,
	type SettingsSection,
	writePath,
} from "../lib/settings-schema";
import {
	countSettingsSearchHits,
	groupSettingsSearchHits,
	searchSettings,
	type SettingsSearchGroup,
	type SettingsSearchHit,
} from "../lib/settings-search";
import { confirm } from "../stores/confirm-store";
import * as rpc from "../lib/rpc";
import { ThemePicker } from "./panels/widgets/ThemePicker";
import { ChatTextSizeSection } from "./panels/widgets/ChatTextSizeSection";
import { InterfaceModeSection } from "./panels/widgets/InterfaceModeSection";
import { KeepAwakeSection } from "./panels/widgets/KeepAwakeSection";
import { AutoContinueSection } from "./panels/widgets/AutoContinueSection";
import { ThinkingPresetPicker } from "./panels/widgets/ThinkingPresetPicker";
import { ModelsPicker } from "./panels/widgets/ModelsPicker";
import { DefaultModelPicker } from "./panels/widgets/DefaultModelPicker";
import { CronModelPicker } from "./panels/widgets/CronModelPicker";
import { SubagentModelPicker } from "./panels/widgets/SubagentModelPicker";
import { AccountSection } from "./panels/widgets/AccountSection";
import { CustomProvidersSection } from "./panels/widgets/CustomProvidersSection";
import { LlamaCppSection } from "./panels/widgets/LlamaCppSection";
import { KeybindingsSection } from "./panels/widgets/KeybindingsSection";
import { McpServersEditor } from "./panels/widgets/McpServersEditor";
import { PackagesEditor } from "./panels/widgets/PackagesEditor";
import { ComputerUseWidget } from "./panels/widgets/ComputerUseWidget";
import { BrowserSettingsWidget } from "./panels/widgets/BrowserSettingsWidget";
import { PathListInput } from "./panels/widgets/PathListInput";
import { PermissionPoliciesEditor } from "./panels/widgets/PermissionPoliciesEditor";
import { ResourcesSection } from "./panels/widgets/ResourcesSection";
import { BenchRunnerSection } from "./panels/widgets/BenchRunnerSection";
import { VoiceSection } from "./panels/widgets/VoiceSection";
import { MobileAccessSection } from "./panels/widgets/MobileAccessSection";
import { UpdatesSection } from "./panels/widgets/UpdatesSection";
import { CompletionSoundPicker } from "./panels/widgets/CompletionSoundPicker";
import { replayOnboarding } from "../lib/onboarding";
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
	"look-and-feel": Palette,
	"chat-behaviour": MessagesSquare,
	browser: Globe,
	voice: Mic,
	mobile: Smartphone,
	privacy: Shield,
	"tools-and-permissions": Sliders,
	"external-tools": Puzzle,
	resources: Brain,
	keybindings: Keyboard,
	bench: FlaskConical,
	advanced: Wrench,
	updates: RefreshCw,
};

const FIRST_LAUNCH_KEY = "a-coder-first-launch-dismissed";
const HIGHLIGHT_MS = 2200;

function fieldDomId(path: string): string {
	return `settings-field-${path.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function sectionDomId(id: string): string {
	return `settings-section-${id}`;
}

function settingsFilePath(scope: Scope, cwd?: string): string {
	if (scope === "global") return "~/.a-coder/cli/agent/settings.json";
	if (!cwd) return "./.a-coder-cli/settings.json";
	return `${cwd.replace(/[\\/]+$/, "")}/.a-coder-cli/settings.json`;
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return (
		tag === "input" ||
		tag === "textarea" ||
		tag === "select" ||
		target.isContentEditable
	);
}

// ============================================================================
// Reusable form widgets — upgraded with hover/active states and smooth transitions
// ============================================================================

function SelectInput({
	id,
	value,
	options,
	onChange,
	disabled,
	ariaLabelledBy,
}: {
	id?: string;
	value: string;
	options: FieldOption[];
	onChange: (v: string) => void;
	disabled?: boolean;
	ariaLabelledBy?: string;
}) {
	return (
		<Select
			id={id}
			aria-labelledby={ariaLabelledBy}
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
	id,
	value,
	onChange,
	min,
	max,
	step,
	disabled,
	ariaLabelledBy,
}: {
	id?: string;
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	ariaLabelledBy?: string;
}) {
	return (
		<Input
			id={id}
			aria-labelledby={ariaLabelledBy}
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
	id,
	value,
	onChange,
	placeholder,
	disabled,
	ariaLabelledBy,
}: {
	id?: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	disabled?: boolean;
	ariaLabelledBy?: string;
}) {
	return (
		<Input
			id={id}
			aria-labelledby={ariaLabelledBy}
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
	id,
	value,
	onChange,
	placeholder,
	disabled,
	rows = 3,
	ariaLabelledBy,
}: {
	id?: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	disabled?: boolean;
	rows?: number;
	ariaLabelledBy?: string;
}) {
	return (
		<Textarea
			id={id}
			aria-labelledby={ariaLabelledBy}
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
	id,
	value,
	onChange,
	disabled,
	placeholder,
	ariaLabelledBy,
}: {
	id?: string;
	value: string[];
	onChange: (v: string[]) => void;
	disabled?: boolean;
	placeholder?: string;
	ariaLabelledBy?: string;
}) {
	return (
		<TextareaInput
			id={id}
			ariaLabelledBy={ariaLabelledBy}
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
	id,
	value,
	onChange,
	disabled,
	ariaLabelledBy,
}: {
	id?: string;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled?: boolean;
	ariaLabelledBy?: string;
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
				id={id}
				aria-labelledby={ariaLabelledBy}
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
	scope,
	highlighted,
}: {
	spec: CliSettingsFieldSpec;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled?: boolean;
	settings: CliSettings;
	onUpdateField: (path: string, value: unknown) => void;
	scope: Scope;
	highlighted?: boolean;
}) {
	const fieldId = fieldDomId(spec.path);
	const controlId = `${fieldId}-control`;
	const labelId = `${fieldId}-label`;
	const highlightClass = highlighted
		? "-mx-2 rounded-md bg-pi-accent-soft px-2 shadow-ring-accent"
		: "";
	const widget = (() => {
		switch (spec.kind) {
			case "toggle":
				return (
					<Switch
						id={controlId}
						checked={Boolean(value)}
						onChange={() => onChange(!Boolean(value))}
						disabled={disabled}
						ariaLabel={spec.label}
					/>
				);
			case "select":
				return (
					<SelectInput
						id={controlId}
						ariaLabelledBy={labelId}
						value={(value as string | undefined) ?? ""}
						options={spec.options ?? []}
						onChange={(v) => onChange(v)}
						disabled={disabled}
					/>
				);
			case "number":
				return (
					<NumberInput
						id={controlId}
						ariaLabelledBy={labelId}
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
						id={controlId}
						ariaLabelledBy={labelId}
						value={(value as string | undefined) ?? ""}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "textarea":
				return (
					<TextareaInput
						id={controlId}
						ariaLabelledBy={labelId}
						value={(value as string | undefined) ?? ""}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "list":
				return (
					<ListInput
						id={controlId}
						ariaLabelledBy={labelId}
						value={(value as string[] | undefined) ?? []}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "path-list":
				return (
					<PathListInput
						id={controlId}
						ariaLabelledBy={labelId}
						value={(value as string[] | undefined) ?? []}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "object":
				return (
					<JsonInput
						id={controlId}
						ariaLabelledBy={labelId}
						value={value}
						onChange={onChange}
						disabled={disabled}
					/>
				);
			case "custom":
				return renderCustom(spec, value, onChange, settings, onUpdateField, scope);
			default:
				return null;
		}
	})();

	// Custom widgets (theme picker, models editor, etc.) need full width below the label.
	if (spec.kind === "custom") {
		return (
			<div
				id={fieldId}
				className={`scroll-mt-24 py-2.5 transition-smooth ${highlightClass}`}
			>
				<div className="mb-2" id={labelId}>
					<div className="text-xs font-medium text-pi-text">
						{spec.label}
					</div>
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
		<div
			id={fieldId}
			className={`scroll-mt-24 flex items-start justify-between gap-4 py-2.5 transition-smooth ${highlightClass}`}
		>
			<div className="min-w-0 flex-1">
				<label
					id={labelId}
					htmlFor={controlId}
					className="text-xs font-medium text-pi-text"
				>
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
	scope: Scope = "global",
): React.ReactNode {
	switch (spec.widget) {
		case "theme":
			return <ThemePicker />;
		case "chatTextSize":
			return <ChatTextSizeSection />;
		case "interfaceMode":
			return <InterfaceModeSection />;
		case "keepAwake":
			return <KeepAwakeSection />;
		case "autoContinue":
			return (
				<AutoContinueSection value={value as AutoContinueSettings | undefined} />
			);
		case "llamaCpp":
			return <LlamaCppSection />;
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
		case "subagents":
			return (
				<SubagentModelPicker
					provider={settings.subagentProvider}
					modelId={settings.subagentModel}
					onUpdateField={onUpdateField}
				/>
			);
		case "cronModel":
			return (
				<CronModelPicker
					value={readPath(settings, "cron.model") as string | undefined}
					onUpdateField={onUpdateField}
				/>
			);
		case "mcpServers":
			return (
				<McpServersEditor
					value={value as Record<string, unknown>[] | undefined}
					onChange={(v) => onChange(v)}
					scope={scope}
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
		case "benchRunner":
			return <BenchRunnerSection />;
		case "completionSound":
			return <CompletionSoundPicker />;
		case "onboardingTour":
			return <Button variant="secondary" size="md" onClick={() => replayOnboarding()}>Watch the tour</Button>;
		case "computerUse":
			return <ComputerUseWidget value={value} onChange={onChange} />;
		case "browserSettings":
			return <BrowserSettingsWidget value={value} onChange={onChange} />;
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
	scope,
	highlightPath,
}: {
	card: SettingsCard;
	settings: CliSettings;
	disabled?: boolean;
	onUpdate: (path: string, value: unknown) => void;
	search: string;
	scope: Scope;
	highlightPath?: string | null;
}) {
	const q = search.trim().toLowerCase();
	const matches = useMemo(() => {
		if (!q) return card.fields;
		return card.fields.filter((field) => {
			return (
				field.label.toLowerCase().includes(q) ||
				(field.hint ?? "").toLowerCase().includes(q) ||
				field.path.toLowerCase().includes(q)
			);
		});
	}, [card.fields, q]);

	const advanced = useMemo(
		() => matches.filter((field) => field.advanced),
		[matches],
	);
	const simple = useMemo(
		() => matches.filter((field) => !field.advanced),
		[matches],
	);

	const [collapsed, setCollapsed] = useState(Boolean(card.defaultCollapsed));
	const [manualAdvanced, setManualAdvanced] = useState(false);

	if (matches.length === 0) return null;

	const cardHasHighlight = Boolean(
		highlightPath && card.fields.some((field) => field.path === highlightPath),
	);
	const advancedHasHighlight = Boolean(
		highlightPath && advanced.some((field) => field.path === highlightPath),
	);
	const isSearching = q.length > 0;
	const isCollapsed = collapsed && !isSearching && !cardHasHighlight;
	const showAdvanced = isSearching || manualAdvanced || advancedHasHighlight;
	const needsToggle = advanced.length > 0;

	return (
		<section className="overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring transition-smooth">
			<button
				type="button"
				onClick={() => {
					if (isSearching) return;
					setCollapsed((value) => !value);
				}}
				aria-expanded={!isCollapsed}
				disabled={isSearching}
				className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-hover hover:bg-pi-surface-overlay/30 disabled:cursor-default disabled:hover:bg-transparent focus-visible:shadow-focus focus-visible:outline-none"
			>
				<div className="min-w-0">
					<h3 className="text-xs font-semibold text-pi-text">
						{card.title}
					</h3>
					{card.description && !isCollapsed && (
						<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
							{card.description}
						</p>
					)}
				</div>
				{!isSearching && (
					<ChevronDown
						className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-text-muted transition-transform ${
							isCollapsed ? "-rotate-90" : ""
						}`}
					/>
				)}
			</button>
			{!isCollapsed && (
				<>
					{simple.length > 0 && (
						<div className="divide-y divide-pi-border border-t border-pi-border px-4">
							{simple.map((spec) => (
								<FieldRow
									key={spec.path}
									spec={spec}
									value={readPath(settings, spec.path)}
									onChange={(v) => onUpdate(spec.path, v)}
									disabled={disabled}
									settings={settings}
									onUpdateField={onUpdate}
									scope={scope}
									highlighted={highlightPath === spec.path}
								/>
							))}
						</div>
					)}
					{showAdvanced && advanced.length > 0 && (
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
									scope={scope}
									highlighted={highlightPath === spec.path}
								/>
							))}
						</div>
					)}
					{needsToggle && !isSearching && (
						<button
							type="button"
							onClick={() => setManualAdvanced((value) => !value)}
							className="flex w-full items-center gap-1.5 border-t border-pi-border px-4 py-2 text-left text-2xs font-medium text-pi-text-muted transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						>
							<ChevronDown
								className={`h-3 w-3 transition-transform ${
									showAdvanced ? "rotate-180" : ""
								}`}
							/>
							{showAdvanced ? "Hide advanced" : "Show advanced"}
							<span className="ml-1 text-3xs text-pi-text-faint">
								{advanced.length} setting
								{advanced.length === 1 ? "" : "s"}
							</span>
						</button>
					)}
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
	scope,
	highlightPath,
}: {
	section: SettingsSection;
	settings: CliSettings;
	disabled?: boolean;
	onUpdate: (path: string, value: unknown) => void;
	search: string;
	scope: Scope;
	highlightPath?: string | null;
}) {
	const allFields = section.fields ?? [];
	const q = search.trim().toLowerCase();

	const matches = useMemo(() => {
		if (!q) return allFields;
		return allFields.filter((field) => {
			return (
				field.label.toLowerCase().includes(q) ||
				(field.hint ?? "").toLowerCase().includes(q) ||
				field.path.toLowerCase().includes(q)
			);
		});
	}, [allFields, q]);

	const advanced = useMemo(
		() => matches.filter((field) => field.advanced),
		[matches],
	);
	const simple = useMemo(
		() => matches.filter((field) => !field.advanced),
		[matches],
	);

	const [manualAdvanced, setManualAdvanced] = useState(false);

	if (matches.length === 0) return null;

	const isSearching = q.length > 0;
	const advancedHasHighlight = Boolean(
		highlightPath && advanced.some((field) => field.path === highlightPath),
	);
	const showAdvanced = isSearching || manualAdvanced || advancedHasHighlight;
	const needsToggle = advanced.length > 0;

	return (
		<section className="space-y-2">
			{simple.length > 0 && (
				<div className="divide-y divide-pi-border rounded-lg bg-pi-surface-raised px-4 shadow-ring transition-smooth">
					{simple.map((spec) => (
						<FieldRow
							key={spec.path}
							spec={spec}
							value={readPath(settings, spec.path)}
							onChange={(v) => onUpdate(spec.path, v)}
							disabled={disabled}
							settings={settings}
							onUpdateField={onUpdate}
							scope={scope}
							highlighted={highlightPath === spec.path}
						/>
					))}
				</div>
			)}
			{showAdvanced && advanced.length > 0 && (
				<div className="divide-y divide-pi-border rounded-lg bg-pi-surface-raised px-4 shadow-ring transition-smooth">
					{advanced.map((spec) => (
						<FieldRow
							key={spec.path}
							spec={spec}
							value={readPath(settings, spec.path)}
							onChange={(v) => onUpdate(spec.path, v)}
							disabled={disabled}
							settings={settings}
							onUpdateField={onUpdate}
							scope={scope}
							highlighted={highlightPath === spec.path}
						/>
					))}
				</div>
			)}
			{needsToggle && !isSearching && (
				<button
					type="button"
					onClick={() => setManualAdvanced((value) => !value)}
					className="flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
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
			)}
		</section>
	);
}

// ============================================================================
// Advanced — raw JSON escape hatch
// ============================================================================

function AdvancedJsonEditor({
	scope,
	cwd,
	onSaved,
}: {
	scope: Scope;
	cwd?: string;
	onSaved: () => void;
}) {
	const [text, setText] = useState("{}");
	const [original, setOriginal] = useState("{}");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const path = settingsFilePath(scope, cwd);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await rpc.readSettingsFile({ scope, cwd });
			const formatted = JSON.stringify(data ?? {}, null, 2);
			setText(formatted);
			setOriginal(formatted);
			setError(null);
		} catch (e) {
			setText("{}");
			setOriginal("{}");
			setError((e as Error).message);
		} finally {
			setLoading(false);
		}
	}, [scope, cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	const dirty = text !== original;

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
			await persistCliSettings(scope, parsed as CliSettings, cwd);
			const formatted = JSON.stringify(parsed, null, 2);
			setText(formatted);
			setOriginal(formatted);
			setError(null);
			onSaved();
		} catch (e) {
			setError((e as Error).message);
		}
	}, [text, scope, cwd, onSaved]);

	const reload = useCallback(async () => {
		if (dirty) {
			const confirmed = await confirm({
				title: "Discard unsaved changes?",
				message: "The raw editor has edits that have not been saved.",
				confirmLabel: "Discard changes",
				danger: true,
			});
			if (!confirmed) return;
		}
		await load();
	}, [dirty, load]);

	const reset = useCallback(async () => {
		const confirmed = await confirm({
			title: "Reset this scope to defaults?",
			message:
				"This clears every setting in this scope. Global and project settings are independent.",
			detail: path,
			confirmLabel: "Reset settings",
			danger: true,
			onConfirm: async () => {
				await persistCliSettings(scope, {}, cwd);
			},
		});
		if (!confirmed) return;
		setText("{}");
		setOriginal("{}");
		setError(null);
		onSaved();
	}, [scope, cwd, path, onSaved]);

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-2xs font-medium text-pi-text">
							Raw settings
						</span>
						{dirty ? (
							<span className="rounded-full bg-pi-warning/15 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-pi-warning">
								Unsaved
							</span>
						) : (
							<span className="text-3xs text-pi-text-faint">
								{loading ? "Loading…" : "Saved to disk"}
							</span>
						)}
					</div>
					<p className="mt-0.5 truncate font-mono text-3xs text-pi-text-faint" title={path}>
						{path}
					</p>
				</div>
				<p className="text-3xs text-pi-text-muted">
					Raw edits are manual — the rest of Settings saves automatically.
				</p>
			</div>

			<div
				className={`rounded-lg border bg-pi-bg transition-smooth ${
					error ? "border-pi-error" : "border-pi-border-strong"
				} ${loading ? "opacity-60" : ""}`}
			>
				<textarea
					value={text}
					onChange={(e) => {
						setText(e.target.value);
						validate(e.target.value);
					}}
					onBlur={() => validate(text)}
					disabled={loading}
					className="h-64 w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-pi-text focus:outline-none disabled:cursor-wait"
					spellCheck={false}
					aria-label={`Raw ${scope} settings JSON`}
				/>
			</div>

			{error && (
				<div className="rounded-md bg-pi-error/10 px-3 py-1.5 text-2xs font-medium text-pi-error">
					{error.startsWith("Invalid") || error.startsWith("Unexpected")
						? `Invalid JSON: ${error}`
						: error}
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				<Button
					variant="primary"
					size="sm"
					icon={ChevronRight}
					onClick={() => void save()}
					disabled={!dirty || loading}
				>
					Save raw JSON
				</Button>

				<Button
					variant="secondary"
					size="sm"
					icon={RefreshCw}
					onClick={() => void reload()}
					disabled={loading}
				>
					Reload
				</Button>

				<Button
					variant="secondary"
					size="sm"
					icon={RotateCcw}
					onClick={() => void reset()}
					disabled={loading}
				>
					Reset to defaults
				</Button>

				<Button
					variant="secondary"
					size="sm"
					icon={FileText}
					onClick={() => rpc.openInEditor(path).catch(() => {})}
				>
					Open in editor
				</Button>

				<Button
					variant="secondary"
					size="sm"
					onClick={() => rpc.revealInFileManager(path).catch(() => {})}
				>
					Reveal in Finder
				</Button>
			</div>
		</div>
	);
}

function MarkMatch({ text, query }: { text: string; query: string }) {
	const needle = query.trim();
	const index =
		needle.length < 2 ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
	if (index < 0) return <>{text}</>;
	return (
		<>
			{text.slice(0, index)}
			<mark className="rounded-sm bg-pi-accent-soft px-0.5 font-semibold text-pi-text">
				{text.slice(index, index + needle.length)}
			</mark>
			{text.slice(index + needle.length)}
		</>
	);
}

function SearchResultsView({
	groups,
	query,
	onSelect,
	onClear,
}: {
	groups: SettingsSearchGroup[];
	query: string;
	onSelect: (hit: SettingsSearchHit) => void;
	onClear: () => void;
}) {
	const count = countSettingsSearchHits(groups);

	if (query.trim().length < 2) {
		return (
			<div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg bg-pi-surface-raised px-6 py-10 text-center shadow-ring">
				<div className="flex h-10 w-10 items-center justify-center rounded-full bg-pi-surface-overlay text-pi-text-muted">
					<Search className="h-5 w-5" />
				</div>
				<div className="text-sm font-semibold text-pi-text">
					Keep typing to search
				</div>
				<p className="text-2xs text-pi-text-muted">
					Try a feature name like “thinking”, “proxy”, or “voice”.
				</p>
			</div>
		);
	}

	if (count === 0) {
		return (
			<div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-lg bg-pi-surface-raised px-6 py-10 text-center shadow-ring">
				<div className="flex h-10 w-10 items-center justify-center rounded-full bg-pi-surface-overlay text-pi-text-muted">
					<SearchX className="h-5 w-5" />
				</div>
				<div>
					<div className="text-sm font-semibold text-pi-text">
						No settings match “{query.trim()}”
					</div>
					<p className="mt-1 text-2xs text-pi-text-muted">
						Try a feature name like “thinking”, “proxy”, or “voice”.
					</p>
				</div>
				<Button variant="secondary" size="sm" onClick={onClear}>
					Clear search
				</Button>
			</div>
		);
	}

	return (
		<div
			role="region"
			aria-label="Settings search results"
			className="space-y-5"
		>
			<p className="text-2xs text-pi-text-muted">
				{count} result{count === 1 ? "" : "s"} across {groups.length} page
				{groups.length === 1 ? "" : "s"}
			</p>
			{groups.map((group) => {
				const Icon = NAV_ICONS[group.navId] ?? SettingsIcon;
				return (
					<section key={group.navId} className="space-y-1.5">
						<div className="flex items-center gap-2 px-1">
							<Icon className="h-3.5 w-3.5 text-pi-accent" />
							<h3 className="text-2xs font-semibold uppercase tracking-wider text-pi-text-muted">
								{group.label}
							</h3>
							<span className="text-3xs text-pi-text-faint">
								{group.hits.length}
							</span>
						</div>
						<div className="divide-y divide-pi-border overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring">
							{group.hits.map((hit) => {
								const breadcrumb =
									hit.kind === "field" &&
									hit.sectionLabel !== hit.pageLabel
										? `${hit.pageLabel} › ${hit.sectionLabel}`
										: hit.kind === "field"
											? hit.pageLabel
											: hit.kind === "section"
												? `Go to ${hit.pageLabel}`
												: "Open page";
								return (
									<button
										key={`${hit.kind}:${hit.sectionId}:${hit.path ?? ""}`}
										type="button"
										data-settings-search-hit
										onClick={() => onSelect(hit)}
										className="group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-hover hover:bg-pi-surface-overlay focus-visible:bg-pi-surface-overlay focus-visible:shadow-focus focus-visible:outline-none"
									>
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
												<span className="text-xs font-medium text-pi-text">
													<MarkMatch text={hit.label} query={query} />
												</span>
												<span className="text-3xs text-pi-text-faint">
													{breadcrumb}
												</span>
											</div>
											{hit.hint && (
												<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
													<MarkMatch text={hit.hint} query={query} />
												</p>
											)}
										</div>
										<ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-pi-text" />
									</button>
								);
							})}
						</div>
					</section>
				);
			})}
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

type SaveState = "idle" | "saving" | "saved" | "error";

interface PendingSave {
	scope: Scope;
	value: CliSettings;
	cwd?: string;
	timer: ReturnType<typeof setTimeout>;
}

export function SettingsPanel({
	onClose,
	initialNavId,
	cwd,
}: {
	onClose: () => void;
	initialNavId?: string;
	cwd?: string;
}) {
	const projectCwd = cwd?.trim() || undefined;
	const projectAvailable = Boolean(projectCwd);
	const [scope, setScope] = useState<Scope>("global");
	const [activeNavId, setActiveNavId] = useState<string>(() => {
		if (typeof window !== "undefined" && window.location.hash) {
			const h = window.location.hash.replace(/^#/, "");
			if (h) return normalizeNavId(h);
		}
		return "general";
	});
	const [search, setSearch] = useState("");
	const [highlightPath, setHighlightPath] = useState<string | null>(null);
	const [highlightSectionId, setHighlightSectionId] = useState<string | null>(
		null,
	);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveError, setSaveError] = useState<string | null>(null);
	const pendingSave = useRef<PendingSave | null>(null);
	const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const aliveRef = useRef(true);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
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

	useEffect(() => {
		if (initialNavId) setActiveNavId(normalizeNavId(initialNavId));
	}, [initialNavId]);

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

	const activeSettings: CliSettings =
		scope === "global" ? cliGlobalSettings : cliProjectSettings;

	const navGroups = useMemo(() => listNavGroups(), []);
	const sections = useMemo(() => sectionsForNavId(activeNavId), [activeNavId]);
	const section = sections[0];
	// Merged pages (Models, Integrations) render several sections; the first
	// provides the page heading, later ones get sub-headings in the body.
	const isMergedPage = sections.length > 1;
	const sectionFieldSpecs = useMemo(
		() =>
			sections.flatMap(
				(s) => s.fields ?? s.cards?.flatMap((card) => card.fields) ?? [],
			),
		[sections],
	);

	const searchGroups = useMemo(
		() => groupSettingsSearchHits(searchSettings(search)),
		[search],
	);
	const searchCount = countSettingsSearchHits(searchGroups);
	const searching = search.trim().length > 0;

	// Reload whenever the workspace changes. Project settings are scoped to
	// the active session's cwd, not the app process cwd.
	useEffect(() => {
		let cancelled = false;
		void loadCliSettings(projectCwd)
			.then(({ global, project }) => {
				if (cancelled) return;
				useSettingsStore.getState().setCliSettings(global, project);
			})
			.catch(() => {
				if (cancelled) return;
				useSettingsStore.getState().setCliSettings({}, {});
			});
		return () => {
			cancelled = true;
		};
	}, [projectCwd]);

	// Project scope cannot exist without an open workspace.
	useEffect(() => {
		if (!projectAvailable && scope === "project") setScope("global");
	}, [projectAvailable, scope]);

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

	const markSaved = useCallback(() => {
		if (!aliveRef.current) return;
		setSaveState("saved");
		setSaveError(null);
		if (savedTimer.current) clearTimeout(savedTimer.current);
		savedTimer.current = setTimeout(() => setSaveState("idle"), 2400);
	}, []);

	const flushPendingSave = useCallback(() => {
		const pending = pendingSave.current;
		if (!pending) return;
		clearTimeout(pending.timer);
		pendingSave.current = null;
		void persistCliSettings(pending.scope, pending.value, pending.cwd)
			.then(() => {
				if (!pendingSave.current) markSaved();
			})
			.catch((error: unknown) => {
				if (!aliveRef.current) return;
				setSaveState("error");
				setSaveError(error instanceof Error ? error.message : String(error));
			});
	}, [markSaved]);

	const updateField = useCallback(
		(path: string, value: unknown) => {
			const store = useSettingsStore.getState();
			const current =
				scope === "global"
					? store.cliGlobalSettings
					: store.cliProjectSettings;
			const next = writePath(current, path, value);

			useSettingsStore.setState(
				scope === "global"
					? { cliGlobalSettings: next }
					: { cliProjectSettings: next },
			);

			// Push runtime fields straight to the engine.
			const spec = sectionFieldSpecs.find((field) => field.path === path);
			if (spec?.runtimeSync) applyRuntimeSync(path, value);

			// A scope switch must not cancel the previous scope's pending write.
			const pending = pendingSave.current;
			if (pending && pending.scope !== scope) {
				clearTimeout(pending.timer);
				pendingSave.current = null;
				void persistCliSettings(
					pending.scope,
					pending.value,
					pending.cwd,
				).catch(() => {});
			} else if (pending) {
				clearTimeout(pending.timer);
			}

			const timer = setTimeout(() => {
				const currentPending = pendingSave.current;
				if (!currentPending || currentPending.timer !== timer) return;
				pendingSave.current = null;
				void persistCliSettings(scope, next, projectCwd)
					.then(markSaved)
					.catch((error: unknown) => {
						if (!aliveRef.current) return;
						setSaveState("error");
						setSaveError(
							error instanceof Error ? error.message : String(error),
						);
					});
			}, 400);

			if (savedTimer.current) {
				clearTimeout(savedTimer.current);
				savedTimer.current = null;
			}
			pendingSave.current = { scope, value: next, cwd: projectCwd, timer };
			setSaveState("saving");
			setSaveError(null);
		},
		[scope, sectionFieldSpecs, projectCwd, markSaved],
	);

	// Flush any debounced write when the modal closes, otherwise the last
	// change inside the 400ms window would be lost.
	useEffect(
		() => () => {
			aliveRef.current = false;
			flushPendingSave();
			if (savedTimer.current) clearTimeout(savedTimer.current);
		},
		[flushPendingSave],
	);

	// Scroll the content pane to the top when changing pages or entering
	// search. The highlight effect below deliberately runs afterwards.
	useEffect(() => {
		bodyRef.current?.scrollTo({ top: 0 });
	}, [activeNavId, searching]);

	// Scroll a search target into view and flash it briefly.
	useEffect(() => {
		if (!highlightPath && !highlightSectionId) return;
		const id = highlightPath
			? fieldDomId(highlightPath)
			: sectionDomId(highlightSectionId ?? "");
		const frame = requestAnimationFrame(() => {
			document.getElementById(id)?.scrollIntoView({
				block: "center",
				behavior: "smooth",
			});
		});
		const timer = setTimeout(() => {
			setHighlightPath(null);
			setHighlightSectionId(null);
		}, HIGHLIGHT_MS);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	}, [highlightPath, highlightSectionId]);

	// `/` focuses search when no field is already focused.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (
				event.key !== "/" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				isEditableTarget(event.target)
			) {
				return;
			}
			event.preventDefault();
			searchInputRef.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const dismissFirstLaunch = useCallback(() => {
		setShowFirstLaunch(false);
		try {
			localStorage.setItem(FIRST_LAUNCH_KEY, "1");
		} catch {
			// ignore
		}
	}, []);

	const handleSaved = useCallback(() => {
		if (pendingSave.current) clearTimeout(pendingSave.current.timer);
		pendingSave.current = null;
		markSaved();
		void loadCliSettings(projectCwd).then(({ global, project }) => {
			useSettingsStore.getState().setCliSettings(global, project);
		});
	}, [projectCwd, markSaved]);

	const changeScope = useCallback(
		(next: Scope) => {
			if (next === "project" && !projectAvailable) return;
			if (next === scope) return;
			flushPendingSave();
			setScope(next);
			setSearch("");
			setHighlightPath(null);
			setHighlightSectionId(null);
		},
		[scope, projectAvailable, flushPendingSave],
	);

	const selectNav = useCallback((id: string) => {
		triggerHaptic("selection");
		setSearch("");
		setHighlightPath(null);
		setHighlightSectionId(null);
		setActiveNavId(id);
		bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
	}, []);

	const selectSearchHit = useCallback((hit: SettingsSearchHit) => {
		triggerHaptic("selection");
		setSearch("");
		setActiveNavId(normalizeNavId(hit.navId));
		if (hit.path) {
			setHighlightSectionId(null);
			setHighlightPath(hit.path);
		} else {
			setHighlightPath(null);
			setHighlightSectionId(hit.sectionId);
		}
	}, []);

	const showBanner = showFirstLaunch && authEmpty === true && !searching;
	const headerTitle = searching
		? "Search results"
		: (section?.label ?? "Settings");
	const headerDescription = searching
		? search.trim().length < 2
			? "Type at least two characters to search every settings page."
			: `${searchCount} matching setting${searchCount === 1 ? "" : "s"} across every page.`
		: section?.description;

	return (
		<ModalBackdrop ref={modalRef} aria-label="Settings" onClick={onClose}>
			<ModalPanel
				className="max-w-[min(1080px,calc(100vw-3rem))] bg-pi-surface"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Row wrapper: ModalPanel is flex-col, the sidebar needs a row */}
				<div className="flex min-h-0 flex-1">
					{/* =================== Left nav =================== */}
					<nav
						aria-label="Settings sections"
						className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-pi-border px-3 py-5"
					>
						<div className="mb-4 px-1 text-2xs font-semibold uppercase tracking-wider text-pi-text-faint">
							Settings
						</div>

						{/* Scope toggle */}
						<div className="mb-2 flex gap-0.5 rounded-md bg-pi-surface-raised p-0.5 shadow-ring">
							{(["global", "project"] as const).map((value) => {
								const disabled = value === "project" && !projectAvailable;
								return (
									<button
										key={value}
										type="button"
										onClick={() => changeScope(value)}
										disabled={disabled}
										title={
											disabled
												? "Open a project to edit project settings"
												: value === "global"
													? "Settings for every project"
													: "Settings for this project only"
										}
										className={`flex h-6 flex-1 items-center justify-center rounded text-3xs font-semibold uppercase tracking-wider transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
											scope === value
												? "bg-pi-accent text-white shadow-sm hover:bg-pi-accent-hover"
												: "text-pi-text-muted hover:bg-pi-surface-overlay hover:text-pi-text"
										}`}
									>
										{value === "global" ? "Global" : "Project"}
									</button>
								);
							})}
						</div>
						<p className="mb-4 px-1 text-3xs leading-relaxed text-pi-text-faint">
							{scope === "global"
								? "Applies everywhere."
								: "Overrides Global for this project."}
						</p>

						{/* Grouped nav items */}
						<div className="space-y-4">
							{navGroups.map((group) => (
								<div key={group.label}>
									<div className="mb-1 px-1 text-3xs font-semibold uppercase tracking-[0.14em] text-pi-text-faint">
										{group.label}
									</div>
									<div className="space-y-0.5">
										{group.items.map(({ id, label }) => {
											const Icon = NAV_ICONS[id] ?? SettingsIcon;
											const active = activeNavId === id;
											return (
												<button
													key={id}
													type="button"
													onClick={() => selectNav(id)}
													aria-current={active ? "page" : undefined}
													className={`relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
														active
															? "bg-pi-surface-raised text-pi-text"
															: "text-pi-text-muted hover:bg-pi-surface-raised hover:text-pi-text"
													}`}
												>
													{active && (
														<span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-pi-accent" />
													)}
													<Icon
														className={`h-4 w-4 shrink-0 transition-smooth ${
															active
																? "text-pi-accent"
																: "text-pi-text-muted"
														}`}
													/>
													<span className="truncate text-xs font-medium">
														{label}
													</span>
												</button>
											);
										})}
									</div>
								</div>
							))}
						</div>
					</nav>

					{/* =================== Right panel =================== */}
					<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
						{/* Header */}
						<div className="flex shrink-0 items-center justify-between gap-4 border-b border-pi-border px-6 py-4">
							<div className="min-w-0">
								<h2 className="text-[15px] font-semibold tracking-tight">
									{headerTitle}
								</h2>
								{headerDescription && (
									<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
										{headerDescription}
									</p>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<div className="relative">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pi-text-faint transition-smooth" />
									<input
										ref={searchInputRef}
										type="text"
										value={search}
										onChange={(e) => setSearch(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Escape") {
												if (search) {
													e.preventDefault();
													e.stopPropagation();
													setSearch("");
												}
												return;
											}
											if (e.key === "Enter" && searching) {
												e.preventDefault();
												document
													.querySelector<HTMLButtonElement>(
														"[data-settings-search-hit]",
													)
													?.focus();
											}
										}}
										placeholder="Search all settings…"
										aria-label="Search all settings"
										aria-keyshortcuts="/"
										className="w-60 rounded-md bg-pi-surface-raised py-1.5 pl-8 pr-8 text-xs text-pi-text placeholder:text-pi-text-faint shadow-ring transition-smooth focus:shadow-focus focus:outline-none"
									/>
									{search ? (
										<button
											type="button"
											onClick={() => {
												setSearch("");
												searchInputRef.current?.focus();
											}}
											aria-label="Clear search"
											className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-pi-text-faint transition-hover hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
										>
											<X className="h-3 w-3" />
										</button>
									) : (
										<kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-pi-border px-1 font-mono text-[10px] leading-4 text-pi-text-faint">
											/
										</kbd>
									)}
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
						<div
							ref={bodyRef}
							className="flex-1 space-y-6 overflow-auto p-6"
						>
							{!cliSettingsLoaded ? (
								<div className="flex h-full items-center justify-center text-xs text-pi-text-muted">
									Loading settings…
								</div>
							) : searching ? (
								<SearchResultsView
									groups={searchGroups}
									query={search}
									onSelect={selectSearchHit}
									onClear={() => {
										setSearch("");
										searchInputRef.current?.focus();
									}}
								/>
							) : (
								<>
									{showBanner && (
										<FirstLaunchBanner
											onDismiss={dismissFirstLaunch}
											onGoToAccount={() => selectNav("account")}
										/>
									)}
									{sections.map((s, index) => (
										<div
											key={s.id}
											id={sectionDomId(s.id)}
											className={`scroll-mt-6 space-y-6 rounded-lg transition-smooth ${
												highlightSectionId === s.id
													? "ring-2 ring-pi-accent/50"
													: ""
											}`}
										>
											{isMergedPage && index > 0 && (
												<header className="pt-2">
													<h3 className="text-[15px] font-semibold tracking-tight">
														{s.label}
													</h3>
													<p className="mt-0.5 text-2xs leading-relaxed text-pi-text-muted">
														{s.description}
													</p>
												</header>
											)}
											{s.id === "account" ? (
												<AccountSection />
											) : s.id === "custom-providers" ? (
												<CustomProvidersSection />
											) : s.id === "keybindings" ? (
												<KeybindingsSection />
											) : s.id === "resources" ? (
												<ResourcesSection search={search} />
											) : s.id === "voice" ? (
												<VoiceSection />
											) : s.id === "mobile" ? (
												<MobileAccessSection />
											) : s.id === "updates" ? (
												<UpdatesSection />
											) : s.id === "bench" ? (
												<BenchRunnerSection />
											) : s.id === "advanced" ? (
												<AdvancedJsonEditor
													scope={scope}
													cwd={projectCwd}
													onSaved={handleSaved}
												/>
											) : s.cards ? (
												<div className="space-y-3">
													{s.cards.map((card) => (
														<CardView
															key={card.title}
															card={card}
															settings={activeSettings}
															onUpdate={updateField}
															search={search}
															scope={scope}
															highlightPath={highlightPath}
														/>
													))}
												</div>
											) : (
												<SectionView
													section={s}
													settings={activeSettings}
													onUpdate={updateField}
													search={search}
													scope={scope}
													highlightPath={highlightPath}
												/>
											)}
										</div>
									))}
								</>
							)}
						</div>

						{/* Footer */}
						<div className="flex shrink-0 items-center justify-between gap-2 border-t border-pi-border bg-pi-surface/40 px-5 py-3">
							<div
								className="flex min-w-0 items-center gap-2 text-2xs"
								aria-live="polite"
							>
								{saveState === "saving" ? (
									<Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-text-muted" />
								) : saveState === "saved" ? (
									<Check className="h-3 w-3 shrink-0 text-pi-success" />
								) : saveState === "error" ? (
									<AlertCircle className="h-3 w-3 shrink-0 text-pi-error" />
								) : (
									<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-text-faint/60" />
								)}
								<span
									className={`truncate ${
										saveState === "error"
											? "text-pi-error"
											: "text-pi-text-faint"
									}`}
									title={saveError ?? undefined}
								>
									{saveState === "saving"
										? "Saving…"
										: saveState === "saved"
											? "Saved just now"
											: saveState === "error"
												? "Couldn't save changes"
												: "Changes save automatically"}
								</span>
							</div>
							<Button variant="ghost" size="md" onClick={onClose}>
								Close
							</Button>
						</div>
					</div>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

// Re-export `setByPath` so callers outside this file (e.g. tests) can use it.
export { setByPath };

export default SettingsPanel;
