import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownRight, Loader2 } from "lucide-react";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import * as rpc from "../../lib/rpc";
import { cn } from "../../lib/cn";
import { triggerHaptic } from "../../lib/haptics";
import { useSessionStore, type QuestionUiRequest } from "../../stores/session-store";
import { Button } from "../ui/Button";

// Inline ask_user_question card, modeled on Hermes desktop's ClarifyTool:
// the pending question renders as an interactive widget IN the transcript at
// the tool-call row (letter-badged option rows, per-question "Other" free-text
// row, staged answers, one confirm action) instead of a modal over the chat.
// Once the tool result lands, the card settles into a read-only Q&A summary,
// so the transcript keeps a record of what was asked and answered.

interface ParsedQuestion {
	question: string;
	header?: string;
	options: Array<{ label: string; description?: string }>;
	multiSelect: boolean;
}

/** Leniently parse the questions array out of raw tool-call arguments. */
function parseQuestions(args: Record<string, unknown>): ParsedQuestion[] {
	const raw = args.questions;
	if (!Array.isArray(raw)) return [];
	const parsed: ParsedQuestion[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry as Record<string, unknown>;
		const question = typeof row.question === "string" ? row.question : "";
		if (!question) continue;
		const options: ParsedQuestion["options"] = [];
		if (Array.isArray(row.options)) {
			for (const opt of row.options) {
				if (typeof opt === "string") {
					options.push({ label: opt });
					continue;
				}
				if (typeof opt !== "object" || opt === null) continue;
				const optRow = opt as Record<string, unknown>;
				const label = typeof optRow.label === "string" ? optRow.label : "";
				if (!label) continue;
				options.push({
					label,
					description: typeof optRow.description === "string" ? optRow.description : undefined,
				});
			}
		}
		parsed.push({
			question,
			header: typeof row.header === "string" && row.header ? row.header : undefined,
			options,
			multiSelect: row.multiSelect === true,
		});
	}
	return parsed;
}

interface SettledDetails {
	questions?: ParsedQuestion[];
	answers?: Record<string, string>;
	declined?: boolean;
}

function readSettledDetails(result: ToolResultMessage | undefined): SettledDetails | undefined {
	const details = result?.details as SettledDetails | undefined;
	if (details && typeof details === "object") return details;
	return undefined;
}

export interface AskUserQuestionCardProps {
	toolCall: {
		id?: string;
		name: string;
		arguments: Record<string, unknown>;
	};
}

export function AskUserQuestionCard({ toolCall }: AskUserQuestionCardProps) {
	const messages = useSessionStore((s) => s.messages);
	const request = useSessionStore((s) => s.questionRequest);
	const questions = useMemo(() => parseQuestions(toolCall.arguments), [toolCall.arguments]);

	const result = useMemo<ToolResultMessage | undefined>(() => {
		if (!toolCall.id) return undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "toolResult") continue;
			const r = m as ToolResultMessage;
			if (r.toolCallId === toolCall.id) return r;
		}
		return undefined;
	}, [messages, toolCall.id]);

	if (result) {
		return <SettledCard details={readSettledDetails(result)} questions={questions} />;
	}

	// The tool runs sequentially, so at most one question request is open at a
	// time; match it to this row by the first question's text (question texts
	// are validated unique by the tool). Without a match (e.g. the request is
	// parked for another session) the card renders read-only.
	const active =
		request && questions.length > 0 && request.questions[0]?.question === questions[0]?.question
			? request
			: null;

	return <PendingCard questions={questions} request={active} />;
}

function letterFor(index: number): string {
	return String.fromCharCode(65 + index);
}

// ─── Pending (interactive when a request is active) ─────────────────────────

interface Stage {
	choices: string[];
	draft: string;
}

const emptyStage: Stage = { choices: [], draft: "" };

function PendingCard({ questions, request }: { questions: ParsedQuestion[]; request: QuestionUiRequest | null }) {
	const setQuestionRequest = useSessionStore((s) => s.setQuestionRequest);
	const [staged, setStaged] = useState<Record<string, Stage>>({});
	const [submitting, setSubmitting] = useState(false);

	const busy = submitting || request === null;

	const stagedAnswer = useCallback((q: ParsedQuestion): string | null => {
		const stage = staged[q.question] ?? emptyStage;
		if (stage.choices.length > 0) {
			return q.multiSelect ? stage.choices.join(", ") : stage.choices[0];
		}
		return stage.draft.trim() || null;
	}, [staged]);

	const answeredCount = questions.filter((q) => stagedAnswer(q) !== null).length;
	const allAnswered = questions.length > 0 && answeredCount === questions.length;

	const toggleChoice = useCallback((q: ParsedQuestion, label: string) => {
		setStaged((prev) => {
			const current = prev[q.question] ?? emptyStage;
			const next = q.multiSelect
				? current.choices.includes(label)
					? current.choices.filter((l) => l !== label)
					: [...current.choices, label]
				: [label];
			return { ...prev, [q.question]: { choices: next, draft: "" } };
		});
	}, []);

	const setDraft = useCallback((q: ParsedQuestion, value: string) => {
		setStaged((prev) => ({ ...prev, [q.question]: { choices: [], draft: value } }));
	}, []);

	const submit = useCallback(() => {
		if (!request || !allAnswered || submitting) return;
		setSubmitting(true);
		triggerHaptic("submit");
		const answers: Record<string, string> = {};
		for (const q of questions) {
			answers[q.question] = stagedAnswer(q) ?? "";
		}
		void rpc
			.sendUiResponse({ type: "extension_ui_response", id: request.id, answers })
			.finally(() => setQuestionRequest(null));
	}, [allAnswered, request, stagedAnswer, submitting]);

	const decline = useCallback(() => {
		if (!request || submitting) return;
		setSubmitting(true);
		triggerHaptic("cancel");
		void rpc
			.sendUiResponse({ type: "extension_ui_response", id: request.id, cancelled: true as const })
			.finally(() => setQuestionRequest(null));
	}, [request, setQuestionRequest, submitting]);

	// Keyboard: letter keys pick an option (or focus the Other row), Enter
	// confirms — hermes-style. Stands down whenever a focusable control is
	// focused so it never eats keystrokes meant for the composer or a field.
	// Only bound for a single question; the batch form is click-driven (same
	// as hermes, where letter keys would be ambiguous across questions).
	const otherInputRefs = useRef<Array<HTMLInputElement | null>>([]);

	useEffect(() => {
		if (!request || questions.length !== 1 || busy) return;
		const q = questions[0];
		const count = q.options.length;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
			const active = document.activeElement as HTMLElement | null;
			if (active && (active.isContentEditable || active.matches("a[href], button, input, select, textarea, [role=\"button\"]"))) {
				return;
			}
			if (event.key === "Enter") {
				if (allAnswered) {
					event.preventDefault();
					submit();
				}
				return;
			}
			const key = event.key.toLowerCase();
			if (key.length !== 1 || key < "a" || key > "z") return;
			const index = key.charCodeAt(0) - 97;
			if (index < count) {
				event.preventDefault();
				toggleChoice(q, q.options[index].label);
			} else if (index === count) {
				event.preventDefault();
				otherInputRefs.current[0]?.focus();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [allAnswered, busy, questions, request, submit, toggleChoice]);

	if (questions.length === 0) return null;

	return (
		<form
			className={cn(
				"w-full rounded-lg border bg-pi-surface/60 transition-smooth",
				request ? "border-pi-accent/40" : "border-pi-border opacity-80",
			)}
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<div className="flex items-center gap-2 border-b border-pi-border px-3 py-2">
				<span className="text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
					{request ? "Quick questions" : "Question"}
				</span>
				{questions.length > 1 && (
					<span className="ml-auto font-mono text-3xs text-pi-text-faint">
						{answeredCount}/{questions.length}
					</span>
				)}
			</div>
			<div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto px-3 py-3">
				{questions.map((q, qi) => (
					<QuestionBlock
						key={qi}
						question={q}
						stage={staged[q.question] ?? emptyStage}
						disabled={busy}
						stagedAnswer={stagedAnswer(q) !== null}
						otherInputRef={(el) => {
							otherInputRefs.current[qi] = el;
						}}
						onToggle={(label) => toggleChoice(q, label)}
						onDraft={(value) => setDraft(q, value)}
					/>
				))}
			</div>
			{request ? (
				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-3 py-2.5">
					<Button variant="ghost" size="sm" type="button" disabled={submitting} onClick={decline}>
						Skip
					</Button>
					<Button variant="primary" size="sm" type="submit" disabled={busy || !allAnswered}>
						{submitting ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<>
								Answer
								<span aria-hidden className="ml-0.5 text-2xs opacity-70">
									⏎
								</span>
							</>
						)}
					</Button>
				</div>
			) : null}
		</form>
	);
}

function QuestionBlock({
	question,
	stage,
	disabled,
	stagedAnswer,
	otherInputRef,
	onToggle,
	onDraft,
}: {
	question: ParsedQuestion;
	stage: Stage;
	disabled: boolean;
	stagedAnswer: boolean;
	otherInputRef: (el: HTMLInputElement | null) => void;
	onToggle: (label: string) => void;
	onDraft: (value: string) => void;
}) {
	const hasChoices = question.options.length > 0;

	return (
		<div className="grid gap-2">
			<div className="flex items-start gap-2">
				{question.header && (
					<span className="rounded bg-pi-surface-raised px-1.5 py-0.5 font-mono text-3xs uppercase text-pi-accent">
						{question.header}
					</span>
				)}
				<p className="min-w-0 flex-1 text-sm leading-snug text-pi-text">{question.question}</p>
				{stagedAnswer && (
					<span className="shrink-0 rounded-sm bg-pi-accent-soft px-1 py-px text-3xs text-pi-accent">
						✓
					</span>
				)}
			</div>

			{hasChoices ? (
				<div className="grid gap-px" role="group">
					{question.options.map((opt, j) => (
						<OptionRow
							key={j}
							char={letterFor(j)}
							label={opt.label}
							description={opt.description}
							selected={stage.choices.includes(opt.label)}
							disabled={disabled}
							onClick={() => onToggle(opt.label)}
						/>
					))}
					<label className={cn(optionRowClass, "items-center")}>
						<KeyBadge char={letterFor(question.options.length)} selected={Boolean(stage.draft.trim())} />
						<input
							type="text"
							value={stage.draft}
							onChange={(e) => onDraft(e.target.value)}
							placeholder="Other"
							disabled={disabled}
							ref={otherInputRef}
							className="min-w-0 flex-1 bg-transparent text-xs text-pi-text placeholder:text-pi-text-faint outline-none"
						/>
					</label>
				</div>
			) : (
				<input
					type="text"
					value={stage.draft}
					onChange={(e) => onDraft(e.target.value)}
					placeholder="Type your answer"
					disabled={disabled}
					className="w-full rounded-md border border-pi-border bg-pi-surface-raised px-3 py-2 text-xs text-pi-text placeholder:text-pi-text-faint transition-smooth focus:shadow-focus focus:outline-none"
				/>
			)}
		</div>
	);
}

const optionRowClass =
	"flex w-full items-start gap-2 rounded-[0.25rem] px-1.5 py-1 text-left transition-hover hover:bg-pi-surface-raised focus-visible:shadow-focus focus-visible:outline-none";

function OptionRow({
	char,
	label,
	description,
	selected,
	disabled,
	onClick,
}: {
	char: string;
	label: string;
	description?: string;
	selected: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={selected}
			className={cn(
				optionRowClass,
				"text-pi-text-secondary hover:text-pi-text",
				selected && "bg-pi-accent-soft/60 text-pi-text",
			)}
		>
			<KeyBadge char={char} selected={selected} />
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-medium">{label}</span>
				{description && (
					<span className="block text-3xs leading-snug text-pi-text-muted">{description}</span>
				)}
			</span>
			{selected && <Check className="mt-0.5 h-3 w-3 shrink-0 text-pi-accent" />}
		</button>
	);
}

function KeyBadge({ char, selected }: { char: string; selected: boolean }) {
	return (
		<span
			className={cn(
				"mt-0.5 flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded border px-1 font-mono text-[0.625rem] leading-none transition-smooth",
				selected
					? "border-pi-accent bg-pi-accent text-white shadow-none"
					: "border-pi-border bg-pi-surface-raised text-pi-text-muted",
			)}
		>
			{char}
		</span>
	);
}

// ─── Settled (tool result present) ──────────────────────────────────────────

function SettledCard({
	details,
	questions,
}: {
	details: SettledDetails | undefined;
	questions: ParsedQuestion[];
}) {
	const shown = details?.questions?.length ? details.questions : questions;
	const answers = details?.answers;

	return (
		<div
			className="w-full rounded-lg border border-pi-border bg-pi-surface/60 px-3 py-2.5 transition-smooth"
			data-ask-answered=""
		>
			<div className="flex flex-col gap-2">
				{shown.map((q, i) => {
					const answer = answers?.[q.question];
					const blank = details?.declined || answer === undefined || !answer.trim();
					return (
						<div className="grid gap-1" key={i}>
							<div className="flex items-start gap-2">
								{q.header && (
									<span className="rounded bg-pi-surface-raised px-1.5 py-0.5 font-mono text-3xs uppercase text-pi-text-faint">
										{q.header}
									</span>
								)}
								<p className="min-w-0 flex-1 text-sm font-medium leading-snug text-pi-text">
									{q.question}
								</p>
							</div>
							<div className="flex items-start gap-2 pl-1">
								<CornerDownRight aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
								<p
									className={cn(
										"min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed",
										blank ? "italic text-pi-text-faint" : "text-pi-text-secondary",
									)}
									data-ask-answer=""
								>
									{blank ? "No answer" : answer}
								</p>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// Re-export so the pending card's helper types stay internal to this module.
export type { ParsedQuestion, SettledDetails };