import { Mic, Volume2, Eye, EyeOff, Loader2, Check, AlertCircle, Phone, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSettingsStore } from "../../../stores/settings-store";
import {
	createMicRecorder,
	transcribe,
	synthesize,
	playAudioBlob,
	listVoiceModels,
	listVoiceVoices,
	type VoiceSettings,
} from "../../../lib/voice";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Switch } from "../../ui/Switch";

/**
 * Voice mode settings. Users supply OpenAI-compatible STT/TTS endpoints so
 * any provider works. Fields persist in the local UI settings store.
 */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<Switch size="sm" checked={checked} onChange={() => onChange(!checked)} />
	);
}

const CUSTOM_OPTION = "__custom__";

/**
 * A model/voice picker for a voice endpoint: fetches the catalog from
 * {base}/models or {base}/voices on open (through the Rust CORS bridge),
 * renders a dropdown, and falls back to a manual text input when the
 * endpoint has no catalog (or the user picks "Custom…").
 */
function CatalogSelect({
	label,
	value,
	onChange,
	baseUrl,
	apiKey,
	route,
	mono = true,
placeholder,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	baseUrl: string;
	apiKey: string;
	route: "models" | "voices";
	mono?: boolean;
	placeholder?: string;
}) {
	const [options, setOptions] = useState<string[] | null>(null); // null = not fetched
	const [fetching, setFetching] = useState(false);
	const [fetchError, setFetchError] = useState<string>("");
	const custom = !options || options.includes(value) === false;
	const selectValue = custom && value ? CUSTOM_OPTION : value || "";

	async function fetchOptions() {
		setFetching(true);
		setFetchError("");
		try {
			const list = route === "models" ? await listVoiceModels(baseUrl, apiKey) : await listVoiceVoices(baseUrl, apiKey);
			setOptions(list);
			if (!list.length) setFetchError("Endpoint returned no " + route + "; using manual entry.");
		} catch (e) {
			setOptions([]);
			setFetchError(e instanceof Error ? e.message : String(e));
		} finally {
			setFetching(false);
		}
	}

	const hasCatalog = Boolean(options && options.length);
	return (
		<label className="block space-y-1">
			<span className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">{label}</span>
			<div className="space-y-1">
				<div className="flex items-center gap-1">
					<select
						value={selectValue}
						onChange={(e) => {
							const v = e.target.value;
							if (v === CUSTOM_OPTION) {
								// Switch to manual entry, keeping the box editable with a blank
								onChange("");
							} else {
								onChange(v);
							}
						}}
						onFocus={() => {
							if (!options && !fetching && baseUrl.trim()) void fetchOptions();
						}}
						disabled={fetching || !baseUrl.trim()}
						className="w-full cursor-pointer rounded-md border border-pi-border bg-pi-surface px-2 py-1.5 text-xs text-pi-text disabled:opacity-50"
					>
						{!baseUrl.trim() && <option value="">Configure base URL first</option>}
						{baseUrl.trim() && fetching && <option value="">Loading…</option>}
						{baseUrl.trim() && !fetching && options === null && <option value="">Click to load {route}…</option>}
						{options && !options.length && <option value={value || ""}>{value || "No entries — type manually"}</option>}
						{options?.map((o) => (
							<option key={o} value={o}>
								{o}
							</option>
						))}
						{hasCatalog && <option value={CUSTOM_OPTION}>Custom…</option>}
					</select>
					<IconButton
						variant="ghost"
						size="sm"
						icon={fetching ? Loader2 : RefreshCw}
						loading={fetching}
						aria-label={`Refresh ${label} options`}
						onClick={() => void fetchOptions()}
					/>
				</div>
				{(custom || !hasCatalog) && (
					<Input
						type="text"
						value={value}
						onChange={(e) => onChange(e.target.value)}
						placeholder={placeholder}
						spellCheck={false}
						autoComplete="off"
						scale="sm"
						mono={mono}
					/>
				)}
				{fetchError && <span className="block text-3xs text-pi-text-faint">{fetchError}</span>}
			</div>
		</label>
	);
}

function LabeledInput({
	label,
	value,
	onChange,
	placeholder,
	type = "text",
	mono = false,
	hint,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: "text" | "password";
	mono?: boolean;
	hint?: string;
}) {
	const [show, setShow] = useState(false);
	const isPassword = type === "password";
	return (
		<label className="block space-y-1">
			<span className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">{label}</span>
			<div className="relative">
				<Input
					type={isPassword && !show ? "password" : "text"}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					spellCheck={false}
					autoComplete="off"
					scale="sm"
					mono={mono}
					className={isPassword ? "pr-9" : undefined}
				/>
				{isPassword && (
					<IconButton
						variant="ghost"
						size="sm"
						icon={show ? EyeOff : Eye}
						onClick={() => setShow((s) => !s)}
						aria-label={show ? "Hide" : "Show"}
						className="absolute right-1 top-1/2 -translate-y-1/2 text-pi-text-faint hover:text-pi-text"
						style={{ transform: "translateY(-50%)" }}
					/>
				)}
			</div>
			{hint && <span className="block text-3xs text-pi-text-faint">{hint}</span>}
		</label>
	);
}

import { Card, CardHeader, CardBody } from "../../ui/Card";

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

export function VoiceSection() {
	const s = useSettingsStore();
	const [testing, setTesting] = useState(false);
	const [testStatus, setTestStatus] = useState<{ kind: "idle" | "ok" | "error"; message?: string }>({ kind: "idle" });

	const settings: VoiceSettings = {
		voiceSttBaseUrl: s.voiceSttBaseUrl,
		voiceSttApiKey: s.voiceSttApiKey,
		voiceSttModel: s.voiceSttModel,
		voiceTtsBaseUrl: s.voiceTtsBaseUrl,
		voiceTtsApiKey: s.voiceTtsApiKey,
		voiceTtsModel: s.voiceTtsModel,
		voiceTtsVoice: s.voiceTtsVoice,
	};

	async function runTest() {
		setTesting(true);
		setTestStatus({ kind: "idle" });
		try {
			const mic = await createMicRecorder();
			await mic.start();
			// Record ~2.5s for the test.
			await new Promise((r) => setTimeout(r, 2500));
			const blob = await mic.stop();
			const text = await transcribe(blob, settings);
			if (!text.trim()) {
				setTestStatus({ kind: "error", message: "Transcription returned empty text." });
				return;
			}
			const audio = await synthesize(`I heard: ${text}`, settings);
			playAudioBlob(audio);
			setTestStatus({ kind: "ok", message: `Heard: "${text.slice(0, 80)}"` });
		} catch (e) {
			setTestStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
		} finally {
			setTesting(false);
		}
	}

	return (
		<section className="space-y-3">
			<header>
				<h2 className="text-[15px] font-semibold tracking-tight">Voice</h2>
				<p className="mt-0.5 text-2xs text-pi-text-muted">
					Bring your own OpenAI-compatible speech endpoints. STT uses{" "}
					<code className="font-mono text-pi-text">/v1/audio/transcriptions</code>, TTS uses{" "}
					<code className="font-mono text-pi-text">/v1/audio/speech</code>.
				</p>
			</header>

			{/* Master enable */}
			<div className="flex items-center justify-between rounded-lg bg-pi-surface-raised px-4 py-3 shadow-ring">
				<div className="pr-4">
					<p className="text-xs font-semibold text-pi-text">Enable voice mode</p>
					<p className="text-2xs text-pi-text-muted">Show the mic button and auto-speak replies.</p>
				</div>
				<Toggle checked={s.voiceEnabled} onChange={s.setVoiceEnabled} />
			</div>

			<SectionCard title="Speech-to-text" icon={<Mic className="h-4 w-4 text-pi-text-muted" />}>
				<LabeledInput
					label="Base URL"
					value={s.voiceSttBaseUrl}
					onChange={s.setVoiceSttBaseUrl}
					placeholder="https://api.openai.com/v1"
					mono
					hint="Base URL; /v1 is appended automatically if missing."
				/>
				<LabeledInput
					label="API key"
					value={s.voiceSttApiKey}
					onChange={s.setVoiceSttApiKey}
					placeholder="sk-... (leave blank for keyless local servers)"
					type="password"
				/>
				<CatalogSelect
					label="Model"
					value={s.voiceSttModel}
					onChange={s.setVoiceSttModel}
					baseUrl={s.voiceSttBaseUrl}
					apiKey={s.voiceSttApiKey}
					route="models"
					placeholder="whisper-1"
				/>
			</SectionCard>

			<SectionCard title="Text-to-speech" icon={<Volume2 className="h-4 w-4 text-pi-text-muted" />}>
				<LabeledInput
					label="Base URL"
					value={s.voiceTtsBaseUrl}
					onChange={s.setVoiceTtsBaseUrl}
					placeholder="https://api.openai.com/v1"
					mono
					hint="Base URL; /v1 is appended automatically if missing."
				/>
				<LabeledInput
					label="API key"
					value={s.voiceTtsApiKey}
					onChange={s.setVoiceTtsApiKey}
					placeholder="sk-... (leave blank for keyless local servers)"
					type="password"
				/>
				<div className="grid grid-cols-2 gap-3">
					<CatalogSelect
						label="Model"
						value={s.voiceTtsModel}
						onChange={s.setVoiceTtsModel}
						baseUrl={s.voiceTtsBaseUrl}
						apiKey={s.voiceTtsApiKey}
						route="models"
						placeholder="gpt-4o-mini-tts"
					/>
					<CatalogSelect
						label="Voice"
						value={s.voiceTtsVoice}
						onChange={s.setVoiceTtsVoice}
						baseUrl={s.voiceTtsBaseUrl}
						apiKey={s.voiceTtsApiKey}
						route="voices"
						mono={false}
						placeholder="alloy"
					/>
				</div>
			</SectionCard>

			<SectionCard title="Behaviour" icon={<Volume2 className="h-4 w-4 text-pi-text-muted" />}>
				<div className="flex items-center justify-between">
					<div className="pr-4">
						<p className="text-xs font-medium text-pi-text">Auto-send transcribed text</p>
						<p className="text-2xs text-pi-text-muted">Send each transcription as a prompt immediately.</p>
					</div>
					<Toggle checked={s.voiceAutoSubmit} onChange={s.setVoiceAutoSubmit} />
				</div>
				<div className="flex items-center justify-between">
					<div className="pr-4">
						<p className="text-xs font-medium text-pi-text">Auto-speak replies</p>
						<p className="text-2xs text-pi-text-muted">Read assistant responses aloud automatically.</p>
					</div>
					<Toggle checked={s.voiceAutoSpeak} onChange={s.setVoiceAutoSpeak} />
				</div>
			</SectionCard>

			<SectionCard title="Call mode" icon={<Phone className="h-4 w-4 text-pi-text-muted" />}>
				<p className="-mt-1 mb-1 text-2xs text-pi-text-muted">
					Hands-free mode: speak, pause, and the app sends and replies aloud automatically.
				</p>
				<div className="flex items-center justify-between">
					<div className="pr-4">
						<p className="text-xs font-medium text-pi-text">Auto-barge into replies</p>
						<p className="text-2xs text-pi-text-muted">
							Speak over the agent to interrupt. Best with headphones; without them the reply's own sound can trigger it.
						</p>
					</div>
					<Toggle checked={s.voiceBargeIn} onChange={s.setVoiceBargeIn} />
				</div>
				<div className="flex items-center justify-between">
					<div className="pr-4">
						<p className="text-xs font-medium text-pi-text">Status sounds</p>
						<p className="text-2xs text-pi-text-muted">
							Connected, thinking, tool ticks and hang-up cues from the same sound bank as turn-end chimes.
						</p>
					</div>
					<Toggle checked={s.voiceCallCues} onChange={s.setVoiceCallCues} />
				</div>
				<div className="grid grid-cols-3 gap-3">
					<LabeledInput
						label="Silence (ms)"
						value={String(s.voiceCallSilenceMs)}
						onChange={(v) => {
							const n = Number.parseInt(v, 10);
							if (!Number.isNaN(n) && n >= 300 && n <= 5000) s.setVoiceCallSilenceMs(n);
						}}
						mono
						hint="Quiet before sending (300–5000)."
					/>
					<LabeledInput
						label="Max utterance (s)"
						value={String(Math.round(s.voiceCallMaxUtteranceMs / 1000))}
						onChange={(v) => {
							const n = Number.parseInt(v, 10);
							if (!Number.isNaN(n) && n >= 3 && n <= 120) s.setVoiceCallMaxUtteranceMs(n * 1000);
						}}
						mono
						hint="Hard cap (3–120s)."
					/>
					<LabeledInput
						label="Spoken limit (chars)"
						value={String(s.voiceMaxSpokenChars)}
						onChange={(v) => {
							const n = Number.parseInt(v, 10);
							if (!Number.isNaN(n) && n >= 0) s.setVoiceMaxSpokenChars(n);
						}}
						mono
						hint="0 replies fully."
					/>
				</div>
			</SectionCard>

			<div className="space-y-2">
				<Button
					variant="primary"
					size="md"
					icon={testing ? Loader2 : Mic}
					loading={testing}
					onClick={() => void runTest()}
					disabled={testing || !s.voiceSttBaseUrl || !s.voiceTtsBaseUrl}
				>
					{testing ? "Listening…" : "Test voice (2.5s)"}
				</Button>
				{testStatus.kind === "ok" && (
					<p className="flex items-start gap-1.5 text-2xs text-pi-success">
						<Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>{testStatus.message}</span>
					</p>
				)}
				{testStatus.kind === "error" && (
					<p className="flex items-start gap-1.5 text-2xs text-pi-error">
						<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span className="break-all">{testStatus.message}</span>
					</p>
				)}
			</div>
		</section>
	);
}