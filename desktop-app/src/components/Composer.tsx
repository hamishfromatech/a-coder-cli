import {
	CornerDownLeft,
	File as FileIcon,
	FileText,
	FolderOpen,
	Image as ImageIcon,
	Loader2,
	Mic,
	Paperclip,
	PhoneCall,
	Square,
	UploadCloud,
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
import { useVoiceCallStore, voiceCall } from "../lib/voice-call";
import * as rpc from "../lib/rpc";
import { triggerHaptic } from "../lib/haptics";
import { abortRun } from "../lib/session-abort";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getFileKind } from "../lib/files";
import {
	attachmentBudgetError,
	attachmentFromFile,
	attachmentFromPath,
	buildAttachmentPrompt,
	FILE_ATTACHMENT_MIME,
	formatAttachmentBytes,
	type ComposerAttachment,
} from "../lib/composer-attachments";
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
import { ComposerPills } from "./ComposerPills";
import { Button, IconButton } from "./ui/Button";
import { useShallow } from "zustand/react/shallow";

export function Composer() {
	const [text, setText] = useState("");
	const [focused, setFocused] = useState(false);
	const [paletteHighlight, setPaletteHighlight] = useState(0);
	const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
	const [attachBusy, setAttachBusy] = useState(false);
	const [dragActive, setDragActive] = useState(false);
	const [cursor, setCursor] = useState(0);
	const attachmentsRef = useRef<ComposerAttachment[]>([]);
	const composerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const micRef = useRef<MicRecorder | null>(null);
	const [recording, setRecording] = useState(false);
	const [transcribing, setTranscribing] = useState(false);
	const callActive = useVoiceCallStore((s) => s.active);
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
	} = useSessionStore(
		useShallow((s) => ({
			status: s.status,
			isStreaming: s.isStreaming,
			setIsStreaming: s.setIsStreaming,
			availableCommands: s.availableCommands,
			cwd: s.cwd,
			steering: s.steering,
			followUp: s.followUp,
			streamingVerb: s.streamingVerb,
		})),
	);
	const connected = status === "connected";
	const canSend = (text.trim().length > 0 || attachments.length > 0) && connected;

	const setAttachmentState = useCallback((next: ComposerAttachment[]) => {
		attachmentsRef.current = next;
		setAttachments(next);
	}, []);

	const loadAttachments = useCallback(
		async (loads: Array<() => Promise<ComposerAttachment>>) => {
			if (loads.length === 0) return;
			setAttachBusy(true);
			const next = [...attachmentsRef.current];
			try {
				for (const load of loads) {
					try {
						const candidate = await load();
						if (
							next.some(
								(item) =>
									(item.path && item.path === candidate.path) ||
									(!candidate.path &&
										item.name === candidate.name &&
										item.bytes === candidate.bytes),
							)
						) {
							continue;
						}
						const error = attachmentBudgetError(next, candidate);
						if (error) {
							toast.warning("Attachment not added", error);
							continue;
						}
						next.push(candidate);
					} catch (e) {
						toast.error("Could not attach file", e instanceof Error ? e.message : String(e));
					}
				}
				if (next.length !== attachmentsRef.current.length) setAttachmentState(next);
			} finally {
				setAttachBusy(false);
			}
		},
		[setAttachmentState],
	);

	const attachPaths = useCallback(
		async (paths: string[]) => {
			await loadAttachments(paths.map((path) => () => attachmentFromPath(path)));
		},
		[loadAttachments],
	);

	const attachFiles = useCallback(
		async (files: File[]) => {
			await loadAttachments(files.map((file) => () => attachmentFromFile(file)));
		},
		[loadAttachments],
	);

	const pickFiles = useCallback(async () => {
		if (!("__TAURI_INTERNALS__" in window)) {
			fileInputRef.current?.click();
			return;
		}
		try {
			const selected = await openDialog({
				multiple: true,
				directory: false,
				title: "Attach files or images",
			});
			if (!selected) return;
			await attachPaths(Array.isArray(selected) ? selected : [selected]);
		} catch (e) {
			toast.error("Could not open file picker", e instanceof Error ? e.message : String(e));
		}
	}, [attachPaths]);

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
		setAttachmentState([]);
	}, [sessionFile, saveDraft, takeDraft, setAttachmentState]);

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
		if ((!text.trim() && attachments.length === 0) || !connected) return;
		const trimmed = text.trim();
		const pending = attachments;
		const payload = buildAttachmentPrompt(text, pending);
		setText("");
		setAttachmentState([]);

		// Slash commands typed directly (no palette selection) get the same
		// routing as picking them from the popover: built-ins like /compact,
			// /model and /settings are wired here on the desktop — engine-side
			// prompt() only handles extension/skill commands and templates, so a
			// literal prompt("/compact") would go to the LLM as prose.
		if (trimmed.startsWith("/")) {
			triggerHaptic("submit");
			const action = routeCommand(trimmed, helpers);
			try {
				switch (action.kind) {
					case "rpc":
						await action.call();
						break;
					case "edit":
						setText(action.text);
						break;
					case "open":
						action.open();
						break;
				}
			} catch (e) {
				toast.error("Command failed", e instanceof Error ? e.message : String(e));
			}
			return;
		}

		setIsStreaming(true);
		triggerHaptic("submit");
		try {
			await rpc.prompt(
				payload.text || "Please review the attached file(s).",
				payload.images.length > 0 ? payload.images : undefined,
			);
		} catch (e) {
			setIsStreaming(false);
			setText(trimmed);
			setAttachmentState(pending);
			toast.error("Failed to send message", e instanceof Error ? e.message : String(e));
		}
	};

	const handleAbort = async () => {
		await abortRun();
	};

	const handleMic = async () => {
		if (transcribing || useVoiceCallStore.getState().active) return;
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
				const payload = buildAttachmentPrompt(transcribed, attachmentsRef.current);
				setAttachmentState([]);
				setText("");
				setIsStreaming(true);
				triggerHaptic("submit");
				try {
					await rpc.prompt(
						payload.text || transcribed,
						payload.images.length > 0 ? payload.images : undefined,
					);
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
				if (!text.trim() && attachmentsRef.current.length === 0) return;
				const payload = buildAttachmentPrompt(text, attachmentsRef.current);
				setText("");
				setAttachmentState([]);
				triggerHaptic("submit");
				void rpc.steer(
					payload.text || "Please review the attached file(s).",
					payload.images.length > 0 ? payload.images : undefined,
				);
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

	// ---- Attachments: paste, native drop, explorer drop, event bridge ----
	const handlePaste = useCallback(
		(e: ClipboardEvent) => {
			const files = Array.from(e.clipboardData?.files ?? []);
			if (files.length === 0) return;
			e.preventDefault();
			void attachFiles(files);
		},
		[attachFiles],
	);

	useEffect(() => {
		const el = composerRef.current;
		if (!el) return;
		el.addEventListener("paste", handlePaste);
		return () => el.removeEventListener("paste", handlePaste);
	}, [handlePaste]);

	// Tauri intercepts drags of OS files before the webview sees a DOM drop.
	// Its event carries real paths, so the composer can read them and still
	// show the drop target while the pointer is over the window.
	useEffect(() => {
		if (!("__TAURI_INTERNALS__" in window)) return;
		let unlisten: (() => void) | undefined;
		let disposed = false;
		void getCurrentWebview()
			.onDragDropEvent((event) => {
				const payload = event.payload;
				if (payload.type === "enter" || payload.type === "over") {
					setDragActive(true);
					return;
				}
				if (payload.type === "drop") {
					setDragActive(false);
					if (payload.paths.length > 0) void attachPaths(payload.paths);
					return;
				}
				setDragActive(false);
			})
			.then((fn) => {
				if (disposed) fn();
				else unlisten = fn;
			})
			.catch(() => {});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [attachPaths]);

	// Browser/dev fallback and drags started inside the File Explorer panel.
	useEffect(() => {
		const hasAttachments = (event: DragEvent) => {
			const types = Array.from(event.dataTransfer?.types ?? []);
			return types.includes("Files") || types.includes(FILE_ATTACHMENT_MIME);
		};
		const onDragEnter = (event: DragEvent) => {
			if (!hasAttachments(event)) return;
			event.preventDefault();
			setDragActive(true);
		};
		const onDragOver = (event: DragEvent) => {
			if (!hasAttachments(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			setDragActive(true);
		};
		const onDragLeave = (event: DragEvent) => {
			if (event.relatedTarget === null) setDragActive(false);
		};
		const onDrop = (event: DragEvent) => {
			if (!hasAttachments(event)) return;
			event.preventDefault();
			setDragActive(false);
			const path = event.dataTransfer?.getData(FILE_ATTACHMENT_MIME);
			if (path) void attachPaths([path]);
			const files = Array.from(event.dataTransfer?.files ?? []);
			if (files.length > 0) void attachFiles(files);
		};
		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
		};
	}, [attachPaths, attachFiles]);

	useEffect(() => {
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<{ paths?: unknown }>).detail;
			if (!Array.isArray(detail?.paths)) return;
			const paths = detail.paths.filter((path): path is string => typeof path === "string");
			if (paths.length > 0) void attachPaths(paths);
		};
		window.addEventListener("a-coder:attach-files", handler);
		return () => window.removeEventListener("a-coder:attach-files", handler);
	}, [attachPaths]);

	const removeAttachment = (id: string) => {
		setAttachmentState(attachmentsRef.current.filter((attachment) => attachment.id !== id));
	};

	const revealAttachment = (attachment: ComposerAttachment) => {
		if (!attachment.path) return;
		void rpc
			.revealInFileManager(attachment.path)
			.catch((e) => toast.error("Could not reveal file", e instanceof Error ? e.message : String(e)));
	};

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

	return (
		<div ref={composerRef} data-tour-id="tour-composer" className="chat-composer relative shrink-0 pt-1 pb-3">
			<input
				ref={fileInputRef}
				type="file"
				multiple
				className="hidden"
				onChange={(event) => {
					const files = Array.from(event.target.files ?? []);
					event.target.value = "";
					if (files.length > 0) void attachFiles(files);
				}}
			/>
			{dragActive && (
				<div className="pointer-events-none fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-pi-bg/55 p-8 backdrop-blur-sm">
					<div className="flex max-w-sm flex-col items-center gap-3 rounded-pi-2xl border border-pi-accent/40 bg-pi-surface-overlay px-8 py-7 text-center shadow-overlay">
						<span className="flex h-12 w-12 items-center justify-center rounded-full bg-pi-accent/15 text-pi-accent">
							<UploadCloud className="h-6 w-6" />
						</span>
						<div className="text-sm font-medium text-pi-text">Drop files to attach</div>
						<div className="text-2xs leading-relaxed text-pi-text-muted">
							Images, code, text, and PDFs. Up to 8 files; text is inlined, images are sent to the model.
						</div>
					</div>
				</div>
			)}
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
				className={`pi-glass group relative flex items-end gap-2 rounded-pi-2xl border border-pi-border p-2 transition-smooth ${
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
						disabled={!connected}
						rows={1}
					/>
				</div>

				<Button
					variant="secondary"
					size="icon"
					icon={attachBusy ? Loader2 : Paperclip}
					loading={attachBusy}
					onClick={() => void pickFiles()}
					disabled={!connected || attachBusy}
					aria-label="Attach files or images"
					title="Attach files or images — or drag them into the chat"
				/>
				{voiceEnabled && !isStreaming && !callActive && (
					<>
						<Button
							variant={recording ? "danger" : "secondary"}
							size="icon" icon={transcribing ? Loader2 : recording ? Square : Mic} loading={transcribing} onClick={() => void handleMic()} disabled={transcribing} aria-label={recording ? "Stop recording" : "Voice input"} className={recording ? "animate-pulse" : ""}
						/>
						{connected && (
							<Button
								variant="secondary"
								size="icon"
								icon={PhoneCall}
								onClick={() => void voiceCall.start()}
								aria-label="Start voice call"
								title="Start voice call - hands-free, speak and get spoken replies"
							/>
						)}
					</>
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

			{/* Attachments: image thumbnails and file chips. */}
			{attachments.length > 0 && (
				<div role="list" className="flex flex-wrap gap-2 px-1 pt-2">
					{attachments.map((attachment) => {
						const kind = getFileKind(attachment.path ?? attachment.name);
						const FileTypeIcon =
							attachment.kind === "image"
								? ImageIcon
								: kind === "code" ||
									  kind === "markdown" ||
									  kind === "mermaid" ||
									  kind === "html" ||
									  kind === "csv" ||
									  kind === "svg"
									? FileText
									: FileIcon;
						return (
							<div
								key={attachment.id}
								role="listitem"
								className="group flex max-w-64 items-center gap-2 rounded-pi-md border border-pi-border bg-pi-surface px-2 py-1.5"
								title={attachment.path ?? attachment.name}
							>
								{attachment.kind === "image" && attachment.data ? (
									<button
										type="button"
										onClick={() => revealAttachment(attachment)}
										disabled={!attachment.path}
										className="shrink-0 overflow-hidden rounded-pi-sm focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default"
										aria-label={`Attached image ${attachment.name}`}
									>
										<img
											src={`data:${attachment.mimeType ?? "image/png"};base64,${attachment.data}`}
											alt=""
											className="h-9 w-9 object-cover"
										/>
									</button>
								) : (
									<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pi-sm bg-pi-surface-raised text-pi-text-muted">
										<FileTypeIcon className="h-4 w-4" />
									</span>
								)}
								<div className="min-w-0 flex-1">
									<div className="truncate text-2xs text-pi-text-secondary">{attachment.name}</div>
									<div className="mt-0.5 flex items-center gap-1.5 text-3xs text-pi-text-faint">
										<span>{attachment.kind === "image" ? "Image" : attachment.kind === "text" ? "Text" : "File"}</span>
										{attachment.bytes > 0 && <span>· {formatAttachmentBytes(attachment.bytes)}</span>}
									</div>
								</div>
								{attachment.path && (
									<IconButton
										variant="ghost"
										size="sm"
										icon={FolderOpen}
										onClick={() => revealAttachment(attachment)}
										aria-label={`Reveal ${attachment.name}`}
										title="Reveal in file manager"
									/>
								)}
								<IconButton
									variant="ghost"
									size="sm"
									icon={X}
									onClick={() => removeAttachment(attachment.id)}
									aria-label={`Remove ${attachment.name}`}
									title="Remove attachment"
								/>
							</div>
						);
					})}
				</div>
			)}

			{/* Composer footer: turn-scoped controls, then keyboard hints. */}
			<div className="flex items-center justify-between gap-3 px-2 pt-1.5 text-3xs text-pi-text-faint">
				<div className="flex min-w-0 items-center gap-2">
					<ComposerPills />
					<div className="hidden min-w-0 items-center gap-3 md:flex">
						<span className="flex items-center gap-1">
							<kbd className="rounded-pi-sm border border-pi-border bg-pi-surface px-1 font-mono text-4xs text-pi-text-muted">
								↵
							</kbd>
							{slashMatch ? "select command" : isStreaming ? "steer" : "send"}
						</span>
						<span className="flex items-center gap-1">
							<kbd className="rounded-pi-sm border border-pi-border bg-pi-surface px-1 font-mono text-4xs text-pi-text-muted">
								⇧↵
							</kbd>
							newline
						</span>
						{slashMatch && (
							<span className="flex items-center gap-1">
								<kbd className="rounded-pi-sm border border-pi-border bg-pi-surface px-1 font-mono text-4xs text-pi-text-muted">
									esc
								</kbd>
								cancel
							</span>
						)}
					</div>
				</div>
				<span className="shrink-0 font-mono uppercase tracking-wide opacity-70">
					{isStreaming ? `● ${streamingVerb.toLowerCase()}` : connected ? "ready" : "offline"}
				</span>
			</div>
		</div>
			<ExtensionWidgets placement="belowEditor" />
		</div>
	);
}