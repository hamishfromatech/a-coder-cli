import { type ComponentProps, useEffect, useState } from "react";

// DecodeText — the "CONNECTING" scramble-decode effect, ported from Hermes
// desktop's components/ui/decode-text.tsx. Even-weight mono ascii charset so
// cycling glyphs never jump width. Decode resolves half a character per 45ms
// tick; when fully resolved it holds for 16 ticks, then (in loop mode) replays.
// The first `prefix` characters NEVER scramble — split at render level so no
// timer logic can garble them. Optional blinking cursor square.

export const DECODE_SCRAMBLE_CHARS = "/\\|-_=+<>~:*";
const TICK_MS = 45;
const HOLD_TICKS = 16;

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
	);
}

function scrambled(tail: string, resolvedCount: number): string {
	return Array.from(tail, (ch, i) =>
		ch === " " || i < resolvedCount
			? ch
			: DECODE_SCRAMBLE_CHARS[(Math.random() * DECODE_SCRAMBLE_CHARS.length) | 0],
	).join("");
}

export interface DecodeTextProps extends Omit<ComponentProps<"span">, "prefix"> {
	text: string;
	/** Leading character count that stays legible at all times. */
	prefix?: number;
	/** Run the decode. When false, renders the plain resolved text (used to
	 *  freeze the word during exit choreography). */
	active?: boolean;
	/** Replay after the hold, or resolve once and stop. */
	loop?: boolean;
	/** Blinking cursor square after the text. */
	cursor?: boolean;
}

export function DecodeText({
	active = true,
	className,
	cursor = false,
	loop = true,
	prefix = 0,
	text,
	...props
}: DecodeTextProps) {
	const staticPrefix = text.slice(0, prefix);
	const tailText = text.slice(prefix);
	const [tail, setTail] = useState(tailText);

	useEffect(() => {
		if (!active) {
			setTail(tailText);
			return;
		}

		// Under reduced motion, skip the scramble interval and render the fully
		// resolved text immediately.
		if (prefersReducedMotion()) {
			setTail(tailText);
			return;
		}

		let resolved = 0;
		let hold = 0;

		const id = window.setInterval(() => {
			if (resolved >= tailText.length) {
				hold += 1;
				if (hold > HOLD_TICKS) {
					if (loop) {
						resolved = 0;
						hold = 0;
					} else {
						window.clearInterval(id);
					}
				}
				setTail(tailText);
				return;
			}

			resolved += 0.5;
			setTail(scrambled(tailText, Math.floor(resolved)));
		}, TICK_MS);

		return () => window.clearInterval(id);
	}, [active, loop, tailText]);

	return (
		<span
			className={cn(
				"inline-flex items-center font-mono text-[0.64rem] font-semibold uppercase tracking-[0.4em] tabular-nums",
				className,
			)}
			{...props}
		>
			{cursor && (
				<style>{"@keyframes decode-cursor { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }"}</style>
			)}
			{staticPrefix}
			{tail}
			{cursor && (
				<span
					aria-hidden="true"
					className="ml-1 inline-block size-2 shrink-0 -translate-y-px rounded-[1px] bg-current"
					style={{ animation: "decode-cursor 1s step-end infinite" }}
				/>
			)}
		</span>
	);
}