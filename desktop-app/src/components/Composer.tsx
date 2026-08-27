import {
	CornerDownLeft,
	Loader2,
	Mic,
	Square,
	Image as ImageIcon,
	X,
} from "lucide-react";
import { toast } from "../stores/toast-store";
import { useSettingsStore } from "../stores/settings-store";
import {
	createMicRecorder,
	transcribe,
	type MicRecorder,
	type VoiceSettings,
} from "../lib/voice";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useCallback,
} from "react";
import { useSessionStore } from "../stores/session-store";
import { useDraftStore } from "../stores/draft-store";
import * as rpc from "../lib/rpc";
import { triggerHaptic } from "../lib/haptics";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
	BUILTIN_COMMANDS,
	filterSlashEntries,
	routeCommand,
	type CommandHelpers,
	type SlashEntry,
} from "../lib/commandRouter";
import { CommandPalette } from "./panels/CommandPalette";
import { QueuePanel } from "./QueuePanel";
import { ExtensionWidgets } from "./ExtensionWidgets";
import { Autocomplete } from "./Autocomplete";
import { ComposerBreadcrumb } from "./ComposerBreadcrumb";
import { Button, IconButton } from "./ui/Button";

export function Composer() {
	const [text, setText] = useState("");
	const [focused, setFocused] = useState(false);
	const [paletteHighlight, setPaletteHighlight] = useState(0);
	const [attachedImages, setAttachedImages] = useState<ImageContent[]>([]);
	const [cursor, setCursor] = useState(0);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const micRef = useRef<MicRecorder | null>(null);
	const [recording, setRecording] = useState(false);
	const [transcribing, setTranscribing] = useState(false);
	const { voiceEnabled, voiceAutoSubmit } = useSettingsStore();
	const {
		status,
		isStreaming,
		setIsStreaming,
		availableCommands,
		cwd,
		steering,
		followUp,
		streamingVerb,
	} = useSessionStore();
	const connected = status === "connected";
	const canSend = text.trim().length > 0 && connected;

	// ---- Per-session draft isolation ----
	// Switching sessions stashes the current composer text under the old
	// session and restores the target session's draft, so half-written
	// messages don't leak across sessions (hermes-style draft migration).
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const saveDraft = useDraftStore((s) => s.saveDraft);
	const takeDraft = useDraftStore((s) => s.takeDraft);
	const textRef = useRef(text);
	textRef.current = text;
	const composerSessionRef = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		const prevSession = composerSessionRef.current;
		composerSessionRef.current = sessionFile ?? null;
		if (prevSession === undefined || prevSession === sessionFile) return;
		if (prevSession) {
			saveDraft(prevSession, textRef.current);
		}
		const restored = sessionFile ? takeDraft(sessionFile) : undefined;
		setText(restored ?? "");
	}, [sessionFile, saveDraft, takeDraft]);

	// ---- Auto-grow textarea ----
	useLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [text]);

	// ---- Slash-command detection ----
	const slashMatch = useMemo(() => {
		const firstLine = text.split("\n")[0] ?? "";
		const m = /^\/([^\s]*)$/.exec(firstLine);
		if (!m) return null;
		return { query: m[1], start: 0, end: firstLine.length };
	}, [text]);

	const slashEntries = useMemo<SlashEntry[]>(() => {
		const builtins: SlashEntry[] = BUILTIN_COMMANDS.map((b) => ({
			name: b.name,
			description: b.description,
			source: "builtin" as const,
		}));
		const fromCli: SlashEntry[] = availableCommands.map((c) => ({
			name: c.name,
			description: c.description,
			source:
				c.source === "skill"
					? "skill"
					: c.source === "prompt"
						? "prompt"
						: "extension",
		}));
		const seen = new Set<string>();
		const merged: SlashEntry[] = [];
		for (const entry of [...builtins, ...fromCli]) {
			if (seen.has(entry.name)) continue;
			seen.add(entry.name);
			merged.push(entry);
		}
		return merged;
	}, [availableCommands]);

	const filteredSlash = useMemo(
		() => filterSlashEntries(slashEntries, slashMatch?.query ?? ""),
		[slashEntries, slashMatch],
	);

	useEffect(() => {
		setPaletteHighlight(0);
	}, [slashMatch?.query]);

	// ---- Autocomplete suggestions ----
	const autocompleteSuggestions = useMemo(() => {
		const commands = slashEntries.map((e) => `/${e.name}`);
		const queue = [...steering, ...followUp];
		return [...commands, ...queue];
	}, [slashEntries, steering, followUp]);

	const helpers: CommandHelpers = useMemo(
		() => ({
			openModelPicker: () =>
				window.dispatchEvent(new CustomEvent("a-coder:open-model-picker")),
			openSessionPicker: () =>
				window.dispatchEvent(new CustomEvent("a-coder:open-session-picker")),
			copyLastReply: async () => {
				const result = await rpc.getLastAssistantText();
				if (result.text) {
					await navigator.clipboard.writeText(result.text).catch(() => {});
				}
			},
			copyToClipboard: async (t) => {
				await navigator.clipboard.writeText(t).catch(() => {});
			},
			getCwd: () => cwd,
		}),
		[cwd],
	);

	// ---- set_editor_text listener ----
	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent).detail as { text?: string } | undefined;
			if (typeof detail?.text === "string") {
				setText(detail.text);
				setCursor(detail.text.length);
				textareaRef.current?.focus();
			}
		};
		window.addEventListener("a-coder:set-editor-text", handler);
		return () => window.removeEventListener("a-coder:set-editor-text", handler);
	}, []);

	// ---- Send / abort ----
	const handleSend = async () => {
		if (!text.trim() || !connected) return;
		const trimmed = text.trim();
		const images = attachedImages;
		setText("");
		setAttachedImages([]);
		setIsStreaming(true);
		triggerHaptic("submit");
		try {
			await rpc.prompt(trimmed, images.length > 0 ? images : undefined);
		} catch (e) {
			setIsStreaming(false);
			toast.error("Failed to send message", e instanceof Error ? e.message : String(e));
		}
	};

	const handleAbort = async () => {
		triggerHaptic("cancel");
		// Mark the turn as user-cancelled so agent_end doesn't play the cue.
		useSessionStore.getState().setAbortRequested(true);
		try {
			await rpc.abort();
		} finally {
			setIsStreaming(false);
		}
	};

	const handleMic = async () => {
		if (transcribing) return;
		// Stop -> transcribe -> submit or fill.
		if (recording && micRef.current) {
			const mic = micRef.current;
			micRef.current = null;
			setRecording(false);
			setTranscribing(true);
			let transcribed = "";
			try {
				const blob = await mic.stop();
				const voice = useSettingsStore.getState();
				const settings: VoiceSettings = {
					voiceSttBaseUrl: voice.voiceSttBaseUrl,
					voiceSttApiKey: voice.voiceSttApiKey,
					voiceSttModel: voice.voiceSttModel,
					voiceTtsBaseUrl: voice.voiceTtsBaseUrl,
					voiceTtsApiKey: voice.voiceTtsApiKey,
					voiceTtsModel: voice.voiceTtsModel,
					voiceTtsVoice: voice.voiceTtsVoice,
				};
				transcribed = (await transcribe(blob, settings)).trim();
			} catch (e) {
				setTranscribing(false);
				toast.error("Voice transcription failed", e instanceof Error ? e.message : String(e));
				return;
			}
			setTranscribing(false);
			if (!transcribed) {
				toast.warning("No speech detected");
				return;
			}
			if (voiceAutoSubmit && connected) {
				setIsStreaming(true);
				triggerHaptic("submit");
				try {
					await rpc.prompt(transcribed);
				} catch (e) {
					setIsStreaming(false);
					toast.error("Failed to send message", e instanceof Error ? e.message : String(e));
				}
			} else {
				setText((prev) => (prev ? `${prev} ${transcribed}` : transcribed));
				textareaRef.current?.focus();
			}
			return;
		}
		// Start recording.
		if (!connected) return;
		try {
			const mic = await createMicRecorder();
			await mic.start();
			micRef.current = mic;
			setRecording(true);
		} catch (e) {
			toast.error("Microphone unavailable", e instanceof Error ? e.message : String(e));
		}
	};

	const selectSlashEntry = async (entry: SlashEntry) => {
		const fullText = `/${entry.name}`;
		const action = routeCommand(fullText, helpers);
		setText("");
		setFocused(true);
		switch (action.kind) {
			case "rpc":
				try {
					await action.call();
				} catch (e) {
					toast.error(action.label, e instanceof Error ? e.message : String(e));
				}
				return;
			case "edit":
				setText(action.text);
				return;
			case "open":
				action.open();
				return;
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		// Popover keyboard handling.
		if (slashMatch && filteredSlash.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setPaletteHighlight((h) => (h + 1) % filteredSlash.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setPaletteHighlight((h) => (h - 1 + filteredSlash.length) % filteredSlash.length);
				return;
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				const pick = filteredSlash[paletteHighlight];
				if (pick) {
					void selectSlashEntry(pick);
				}
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setText("");
				return;
			}
		}

		// Ctrl/Cmd+G opens the external editor if configured.
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
			e.preventDefault();
			void openExternalEditor();
			return;
		}

		// Double-escape: dispatch a-coder:double-escape for other components.
		if (e.key === "Escape" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
			// We let the first Escape fall through to close autocomplete/palette.
			// A second rapid Escape is handled by a separate listener below.
		}

		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (isStreaming) {
				const trimmed = text.trim();
				if (!trimmed) return;
				setText("");
				void rpc.steer(trimmed);
			} else {
				void handleSend();
			}
		}
	};

	const openExternalEditor = async () => {
		try {
			const settings = (await rpc.getState()) as { externalEditor?: string } | undefined;
			const editor = settings?.externalEditor;
			if (!editor) {
				toast.warning("No external editor configured", "Set externalEditor in settings");
				return;
			}
			if (!cwd) {
				toast.warning("No project open");
				return;
			}
			const path = `${cwd}/.a-coder/composer-draft.md`;
			// Best-effort open in editor via Tauri shell.
			await rpc.openInEditor(path);
		} catch (e) {
			toast.error("External editor failed", e instanceof Error ? e.message : String(e));
		}
	};

	// ---- Image paste/drop ----
	const readImageFile = async (file: File): Promise<ImageContent | null> => {
		if (!file.type.startsWith("image/")) return null;
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				const base64 = result.split(",")[1] ?? "";
				resolve({
					type: "image",
					mimeType: file.type,
					data: base64,
				});
			};
			reader.readAsDataURL(file);
		});
	};

	const handlePaste = useCallback(
		async (e: ClipboardEvent) => {
			const files = Array.from(e.clipboardData?.files ?? []);
			const images = await Promise.all(files.map(readImageFile));
			const valid = images.filter((img): img is ImageContent => img !== null);
			if (valid.length > 0) {
				e.preventDefault();
				setAttachedImages((prev) => [...prev, ...valid]);
			}
		},
		[],
	);

	const handleDrop = useCallback(
		async (e: React.DragEvent<HTMLTextAreaElement>) => {
			e.preventDefault();
			const files = Array.from(e.dataTransfer.files);
			const images = await Promise.all(files.map(readImageFile));
			const valid = images.filter((img): img is ImageContent => img !== null);
			if (valid.length > 0) {
				setAttachedImages((prev) => [...prev, ...valid]);
			}
		},
		[],
	);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.addEventListener("paste", handlePaste);
		return () => el.removeEventListener("paste", handlePaste);
	}, [handlePaste]);

	// ---- Double-escape ----
	useEffect(() => {
		let lastEsc = 0;
		const handler = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const now = Date.now();
			if (now - lastEsc < 400) {
				window.dispatchEvent(new CustomEvent("a-coder:double-escape"));
			}
			lastEsc = now;
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	const removeImage = (idx: number) => {
		setAttachedImages((prev) => prev.filter((_, i) => i !== idx));
	};

	return (
		<div className="chat-composer relative shrink-0 pt-1 pb-3">
			<ExtensionWidgets placement="aboveEditor" />
			<QueuePanel
				onSend={(t) => {
					setText(t);
					textareaRef.current?.focus();
				}}
			/>

			<div className="chat-column relative">
				<div className="pi-composer-fade pointer-events-none absolute inset-x-0 -top-4 h-8 rounded-t-2xl" />
				<ComposerBreadcrumb />
				<div
				className={`pi-glass group relative flex items-end gap-2 rounded-2xl border border-pi-border p-2 transition-smooth ${
					focused
						? "shadow-focus border-transparent"
						: "shadow-card hover:shadow-card-hover"
				}`}
			>
				<div className="relative flex-1">
					<CommandPalette
						open={!!slashMatch}
						query={slashMatch?.query ?? ""}
						entries={filteredSlash}
						highlight={paletteHighlight}
						onSelect={selectSlashEntry}
						onHighlight={setPaletteHighlight}
						onClose={() => setText("")}
					/>
					<Autocomplete
						text={text}
						cursor={cursor}
						suggestions={autocompleteSuggestions}
						onAccept={(replacement, newCursor) => {
							setText(replacement);
							setCursor(newCursor);
							textareaRef.current?.focus();
						}}
						onClose={() => textareaRef.current?.focus()}
					/>
					<textarea
						ref={textareaRef}
						className="min-h-[40px] max-h-48 w-full resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed text-pi-text placeholder:text-pi-text-faint focus:outline-none"
						placeholder={
							isStreaming
								? "Steer the agent…"
								: connected
									? "Ask A-Coder anything — type / for commands"
									: "Engine not connected"
						}
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							setCursor(e.target.selectionStart ?? 0);
						}}
						onKeyDown={handleKeyDown}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						onDrop={handleDrop}
						disabled={!connected}
						rows={1}
					/>
				</div>

				{voiceEnabled && !isStreaming && (
					<Button
						variant={recording ? "danger" : "secondary"}
						size="icon" icon={transcribing ? Loader2 : recording ? Square : Mic} loading={transcribing} onClick={() => void handleMic()} disabled={transcribing} aria-label={recording ? "Stop recording" : "Voice input"} className={recording ? "animate-pulse" : ""}
					/>
				)}
				{isStreaming ? (
					<Button
						variant="danger" size="icon" icon={Square} onClick={() => void handleAbort()} aria-label="Abort"
					/>
				) : (
					<Button
						variant="primary" size="icon" icon={connected ? CornerDownLeft : Loader2} onClick={() => void handleSend()} disabled={!canSend} aria-label="Send message"
					/>
				)}
			</div>

			{/* Image attachments */}
			{attachedImages.length > 0 && (
				<div className="flex flex-wrap gap-2 px-1 pt-2">
					{attachedImages.map((_, idx) => (
						<div
							key={idx}
							className="group flex items-center gap-2 rounded-md border border-pi-border bg-pi-surface px-2 py-1"
						>
							<ImageIcon className="h-3.5 w-3.5 text-pi-text-muted" />
							<span className="max-w-32 truncate text-2xs text-pi-text-secondary">
								Image {idx + 1}
							</span>
							<IconButton
								variant="ghost"
								size="sm"
								icon={X}
								onClick={() => removeImage(idx)}
								aria-label="Remove image"
							/>
						</div>
					))}
				</div>
			)}

			{/* Hint footer */}
			<div className="flex items-center justify-between px-2 pt-1.5 text-3xs text-pi-text-faint">
				<div className="flex items-center gap-3">
					<span className="flex items-center gap-1">
						<kbd className="rounded border border-pi-border bg-pi-surface px-1 font-mono text-4xs text-pi-text-muted">
							↵
						</kbd>
						{slashMatch ? "select command" : isStreaming ? "steer" : "send"}
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded border border-pi-border bg-pi-surface px-1 font-mono text-4xs text-pi-text-muted">
							⇧↵
						</kbd>
						newline
					</span>
					{slashMatch && (
						<span className="flex items-center gap-1">
							<kbd className="rounded border border-pi-border bg-pi-surface px-1 font-mono text-4xs text-pi-text-muted">
								esc
							</kbd>
							cancel
						</span>
					)}
					<span className="flex items-center gap-1">
						<kbd className="rounded border border-pi-border bg-pi-surface px-1 font-mono text-4xs text-pi-text-muted">
							⌘G
						</kbd>
						external editor
					</span>
				</div>
				<span className="font-mono uppercase tracking-wide opacity-70">
					{isStreaming ? `● ${streamingVerb.toLowerCase()}` : connected ? "ready" : "offline"}
				</span>
			</div>
		</div>
			<ExtensionWidgets placement="belowEditor" />
		</div>
	);
}
