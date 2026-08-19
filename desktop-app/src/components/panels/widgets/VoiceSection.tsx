import { Mic, Volume2, Eye, EyeOff, Loader2, Check, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useSettingsStore } from "../../../stores/settings-store";
import { createMicRecorder, transcribe, synthesize, playAudioBlob, type VoiceSettings } from "../../../lib/voice";

/**
 * Voice mode settings. Users supply OpenAI-compatible STT/TTS endpoints so
 * any provider works. Fields persist in the local UI settings store.
 */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			onClick={() => onChange(!checked)}
			className={`relative h-4 w-7 shrink-0 rounded-full transition-smooth active-press ${checked ? "bg-pi-accent" : "bg-pi-surface-overlay"}`}
			aria-pressed={checked}
		>
			<span
				className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-smooth ${checked ? "translate-x-3.5" : "translate-x-0.5"}`}
			/>
		</button>
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
			<span className="text-[10.5px] font-semibold uppercase tracking-wider text-pi-text-faint">{label}</span>
			<div className="relative">
				<input
					type={isPassword && !show ? "password" : "text"}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					spellCheck={false}
					autoComplete="off"
					className={`w-full rounded-md bg-pi-surface-raised py-1.5 pl-3 ${isPassword ? "pr-9" : "pr-3"} ${mono ? "font-mono" : ""} text-[11.5px] text-pi-text placeholder:text-pi-text-faint shadow-ring focus:shadow-focus focus:outline-none`}
				/>
				{isPassword && (
					<button
						type="button"
						onClick={() => setShow((s) => !s)}
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-pi-text-faint hover:text-pi-text"
						aria-label={show ? "Hide" : "Show"}
					>
						{show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
					</button>
				)}
			</div>
			{hint && <span className="block text-[10.5px] text-pi-text-faint">{hint}</span>}
		</label>
	);
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<section className="overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring">
			<header className="flex items-center gap-2 border-b border-pi-border px-4 py-2.5">
				{icon}
				<h3 className="text-[12.5px] font-semibold text-pi-text">{title}</h3>
			</header>
			<div className="space-y-3 px-4 py-3">{children}</div>
		</section>
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
				<p className="mt-0.5 text-[11.5px] text-pi-text-muted">
					Bring your own OpenAI-compatible speech endpoints. STT uses{" "}
					<code className="font-mono text-pi-text">/v1/audio/transcriptions</code>, TTS uses{" "}
					<code className="font-mono text-pi-text">/v1/audio/speech</code>.
				</p>
			</header>

			{/* Master enable */}
			<div className="flex items-center justify-between rounded-lg bg-pi-surface-raised px-4 py-3 shadow-ring">
				<div className="pr-4">
					<p className="text-[12.5px] font-semibold text-pi-text">Enable voice mode</p>
					<p className="text-[11px] text-pi-text-muted">Show the mic button and auto-speak replies.</p>
				</div>
				<Toggle checked={s.voiceEnabled} onChange={s.setVoiceEnabled} />
			</div>

			<Card title="Speech-to-text" icon={<Mic className="h-4 w-4 text-pi-text-muted" />}>
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
				<LabeledInput
					label="Model"
					value={s.voiceSttModel}
					onChange={s.setVoiceSttModel}
					placeholder="whisper-1"
				/>
			</Card>

			<Card title="Text-to-speech" icon={<Volume2 className="h-4 w-4 text-pi-text-muted" />}>
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
					<LabeledInput label="Model" value={s.voiceTtsModel} onChange={s.setVoiceTtsModel} placeholder="gpt-4o-mini-tts" />
					<LabeledInput label="Voice" value={s.voiceTtsVoice} onChange={s.setVoiceTtsVoice} placeholder="alloy" />
				</div>
			</Card>

			<Card title="Behaviour" icon={<Volume2 className="h-4 w-4 text-pi-text-muted" />}>
				<div className="flex items-center justify-between">
					<div className="pr-4">
						<p className="text-[12px] font-medium text-pi-text">Auto-send transcribed text</p>
						<p className="text-[11px] text-pi-text-muted">Send each transcription as a prompt immediately.</p>
					</div>
					<Toggle checked={s.voiceAutoSubmit} onChange={s.setVoiceAutoSubmit} />
				</div>
				<div className="flex items-center justify-between">
					<div className="pr-4">
						<p className="text-[12px] font-medium text-pi-text">Auto-speak replies</p>
						<p className="text-[11px] text-pi-text-muted">Read assistant responses aloud automatically.</p>
					</div>
					<Toggle checked={s.voiceAutoSpeak} onChange={s.setVoiceAutoSpeak} />
				</div>
			</Card>

			<div className="space-y-2">
				<button
					type="button"
					onClick={() => void runTest()}
					disabled={testing || !s.voiceSttBaseUrl || !s.voiceTtsBaseUrl}
					className="inline-flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-[12px] font-semibold text-white transition-hover active-press hover:bg-pi-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
				>
					{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
					{testing ? "Listening…" : "Test voice (2.5s)"}
				</button>
				{testStatus.kind === "ok" && (
					<p className="flex items-start gap-1.5 text-[11px] text-pi-success">
						<Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>{testStatus.message}</span>
					</p>
				)}
				{testStatus.kind === "error" && (
					<p className="flex items-start gap-1.5 text-[11px] text-pi-error">
						<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span className="break-all">{testStatus.message}</span>
					</p>
				)}
			</div>
		</section>
	);
}