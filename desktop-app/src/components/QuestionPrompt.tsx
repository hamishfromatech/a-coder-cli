import { useRef, useState } from "react";
import { Check, HelpCircle, X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import type { UserQuestion } from "../lib/rpc";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface QuestionPromptProps {
	questions: UserQuestion[];
	onAnswer: (answers: Record<string, string> | undefined) => void;
}

// Structured multiple-choice question modal for the `ask_user_question` tool.
// Styled after Hermes's `ClarifyTool`: letter-badged option rows, "Other"
// free-text row per question, and a single confirm action.
export function QuestionPrompt({ questions, onAnswer }: QuestionPromptProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	useModalA11y(modalRef, true, () => decline());

	const [staged, setStaged] = useState<
		Record<string, { choices: string[]; draft: string }>
	>({});

	const decline = () => {
		onAnswer(undefined);
	};

	const stageFor = (question: string) => staged[question] ?? { choices: [], draft: "" };

	const toggleChoice = (question: string, multiSelect: boolean | undefined, label: string) => {
		setStaged((prev) => {
			const current = prev[question] ?? { choices: [], draft: "" };
			const next = multiSelect
				? current.choices.includes(label)
					? current.choices.filter((l) => l !== label)
					: [...current.choices, label]
				: [label];
			return { ...prev, [question]: { choices: next, draft: "" } };
		});
	};

	const setDraft = (question: string, value: string) => {
		setStaged((prev) => ({ ...prev, [question]: { choices: [], draft: value } }));
	};

	const stagedAnswer = (q: UserQuestion): string | null => {
		const stage = staged[q.question] ?? { choices: [], draft: "" };
		if (stage.choices.length > 0) {
			return q.multiSelect ? stage.choices.join(", ") : stage.choices[0];
		}
		return stage.draft.trim() || null;
	};

	const answeredCount = questions.filter((q) => stagedAnswer(q) !== null).length;
	const allAnswered = answeredCount === questions.length;

	const submit = () => {
		if (!allAnswered) return;
		const flat: Record<string, string> = {};
		for (const q of questions) {
			flat[q.question] = stagedAnswer(q) ?? "";
		}
		onAnswer(flat);
	};

	return (
		<ModalBackdrop>
			<ModalPanel className="max-w-md" centered={false} onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center gap-2 border-b border-pi-border px-4 py-3">
					<HelpCircle className="h-4 w-4 shrink-0 text-pi-accent" />
					<span className="min-w-0 flex-1 text-sm font-semibold text-pi-text">
						Quick questions
					</span>
					{questions.length > 1 && (
						<span className="font-mono text-3xs text-pi-text-faint">
							{answeredCount}/{questions.length}
						</span>
					)}
					<IconButton
						variant="ghost"
						size="sm"
						className="ml-1"
						icon={X}
						onClick={decline}
						aria-label="Decline"
					/>
				</div>

				<div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto px-4 py-4">
					{questions.map((q, qi) => (
						<QuestionBlock
							key={qi}
							index={qi}
							question={q}
							stage={stageFor(q.question)}
							onToggle={(label) => toggleChoice(q.question, q.multiSelect, label)}
							onDraft={(value) => setDraft(q.question, value)}
						/>
					))}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button variant="ghost" size="sm" onClick={decline}>
						Decline
					</Button>
					<Button variant="primary" size="sm" onClick={submit} disabled={!allAnswered}>
						Answer
						<span aria-hidden className="ml-0.5 text-2xs opacity-70">
							⏎
						</span>
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}

function QuestionBlock({
	index,
	question,
	stage,
	onToggle,
	onDraft,
}: {
	index: number;
	question: UserQuestion;
	stage: { choices: string[]; draft: string };
	onToggle: (label: string) => void;
	onDraft: (value: string) => void;
}) {
	const options = question.options;
	const hasChoices = options.length > 0;

	return (
		<div className="grid gap-2">
			<div className="flex items-start gap-2">
				<span className="rounded bg-pi-surface-raised px-1.5 py-0.5 font-mono text-3xs uppercase text-pi-accent">
					{question.header}
				</span>
				{index > 0 ? null : null}
				<p className="min-w-0 flex-1 text-sm leading-snug text-pi-text">{question.question}</p>
			</div>

			{hasChoices ? (
				<div className="grid gap-px" role="group">
					{options.map((opt, j) => (
						<OptionRow
							key={j}
							char={letterFor(j)}
							label={opt.label}
							description={opt.description}
							selected={stage.choices.includes(opt.label)}
							onClick={() => onToggle(opt.label)}
						/>
					))}
					<label className={cn(optionRowClass, "items-center")}>
						<KeyBadge char={letterFor(options.length)} selected={Boolean(stage.draft.trim())} />
						<input
							type="text"
							value={stage.draft}
							onChange={(e) => onDraft(e.target.value)}
							placeholder="Other"
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
	onClick,
}: {
	char: string;
	label: string;
	description?: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selected}
			className={cn(
				optionRowClass,
				"text-pi-text-secondary hover:text-pi-text",
				selected && "text-pi-text",
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

function letterFor(index: number): string {
	return String.fromCharCode(65 + index);
}
