import { Mic, Volume2, Eye, EyeOff, Loader2, Check, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useSettingsStore } from "../../../stores/settings-store";
import { createMicRecorder, transcribe, synthesize, playAudioBlob, type VoiceSettings } from "../../../lib/voice";
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
				<LabeledInput
					label="Model"
					value={s.voiceSttModel}
					onChange={s.setVoiceSttModel}
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
					<LabeledInput label="Model" value={s.voiceTtsModel} onChange={s.setVoiceTtsModel} placeholder="gpt-4o-mini-tts" />
					<LabeledInput label="Voice" value={s.voiceTtsVoice} onChange={s.setVoiceTtsVoice} placeholder="alloy" />
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