import { Minus, Plus } from "lucide-react";
import { useEffect } from "react";
import {
	applyChatTextScale,
	CHAT_TEXT_DEFAULT,
	CHAT_TEXT_MAX,
	CHAT_TEXT_MIN,
	useChatTextStore,
} from "../../../stores/chat-text-store";

/**
 * Chat Text Size: scales the conversation only — sidebar, settings, and panes
 * keep their size, because window zoom is the wrong tool for "the messages are
 * too small".
 */
export function ChatTextSizeSection() {
	const scale = useChatTextStore((s) => s.scale);
	const setScale = useChatTextStore((s) => s.setScale);

	// Persisted rehydration lands after first paint; applying here covers both
	// the boot value and every change without a separate subscription.
	useEffect(() => {
		applyChatTextScale(scale);
	}, [scale]);

	const step = (delta: number) => setScale(scale + delta);
	const percent = Math.round(scale * 100);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => step(-0.05)}
					disabled={scale <= CHAT_TEXT_MIN}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-pi-border text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-40"
					aria-label="Smaller chat text"
				>
					<Minus className="h-3.5 w-3.5" />
				</button>
				<input
					type="range"
					min={Math.round(CHAT_TEXT_MIN * 100)}
					max={Math.round(CHAT_TEXT_MAX * 100)}
					step={5}
					value={percent}
					onChange={(e) => setScale(Number(e.target.value) / 100)}
					className="h-1 min-w-0 flex-1 accent-pi-accent"
					aria-label="Chat text size"
				/>
				<button
					type="button"
					onClick={() => step(0.05)}
					disabled={scale >= CHAT_TEXT_MAX}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-pi-border text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-40"
					aria-label="Larger chat text"
				>
					<Plus className="h-3.5 w-3.5" />
				</button>
				<span className="w-10 shrink-0 text-right font-mono pi-tabular text-2xs text-pi-text-muted">
					{percent}%
				</span>
			</div>
			<p className="rounded-md border border-pi-border bg-pi-surface px-3 py-2 text-[length:calc(0.8125rem*var(--chat-text-scale,1.1))] leading-relaxed text-pi-text">
				Preview: this is how a message reads at {percent}%.
			</p>
			{scale !== CHAT_TEXT_DEFAULT && (
				<button
					type="button"
					onClick={() => setScale(CHAT_TEXT_DEFAULT)}
					className="self-start text-2xs text-pi-text-muted underline-offset-2 transition-hover hover:text-pi-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
				>
					Reset to {Math.round(CHAT_TEXT_DEFAULT * 100)}%
				</button>
			)}
		</div>
	);
}
