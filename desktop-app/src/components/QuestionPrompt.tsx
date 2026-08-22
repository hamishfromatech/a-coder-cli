import { useRef, useState } from "react";
import { Check, ChevronRight, HelpCircle, X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import type { UserQuestion } from "../lib/rpc";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface QuestionPromptProps {
	questions: UserQuestion[];
	onAnswer: (answers: Record<string, string> | undefined) => void;
}

/**
 * Structured multiple-choice question modal for the `ask_user_question` tool.
 * Renders each question with its options; multi-select questions allow several
 * picks. Answer submits everything; the close button / Esc declines all.
 */
export function QuestionPrompt({ questions, onAnswer }: QuestionPromptProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const [answers, setAnswers] = useState<Record<string, string[]>>({});
	useModalA11y(modalRef, true, () => decline());

	const decline = () => {
		onAnswer(undefined);
	};

	const toggle = (question: UserQuestion, label: string) => {
		setAnswers((prev) => {
			if (question.multiSelect) {
				const current = prev[question.question] ?? [];
				const next = current.includes(label)
					? current.filter((l) => l !== label)
					: [...current, label];
				return { ...prev, [question.question]: next };
			}
			return { ...prev, [question.question]: [label] };
		});
	};

	const allAnswered = questions.every((q) => (answers[q.question] ?? []).length > 0);

	const submit = () => {
		if (!allAnswered) return;
		const flat: Record<string, string> = {};
		for (const q of questions) {
			flat[q.question] = (answers[q.question] ?? []).join(", ");
		}
		onAnswer(flat);
	};

	return (
		<ModalBackdrop>
			<ModalPanel className="max-w-md" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center gap-2 border-b border-pi-border px-4 py-3">
					<HelpCircle className="h-4 w-4 shrink-0 text-pi-accent" />
					<span className="text-sm font-semibold text-pi-text">Quick questions</span>
					<IconButton variant="ghost" size="sm" className="ml-auto" icon={X} onClick={decline} aria-label="Decline" />
				</div>

				<div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto px-4 py-4">
					{questions.map((q, i) => (
						<div key={i} className="flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<span className="rounded bg-pi-surface-raised px-1.5 py-0.5 font-mono text-3xs uppercase text-pi-accent">
									{q.header}
								</span>
								{questions.length > 1 && (
									<span className="font-mono text-3xs text-pi-text-faint">
										{i + 1}/{questions.length}
									</span>
								)}
							</div>
							<p className="text-sm leading-snug text-pi-text">{q.question}</p>
							<div className="flex flex-col gap-1.5">
								{q.options.map((opt, j) => {
									const selected = (answers[q.question] ?? []).includes(opt.label);
									return (
										<button
											key={j}
											type="button"
											onClick={() => toggle(q, opt.label)}
											className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-smooth ${
												selected
													? "border-pi-accent bg-pi-accent/10"
													: "border-pi-border bg-pi-surface hover:bg-pi-surface-raised"
											}`}
										>
											{selected ? (
												<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-accent" strokeWidth={2.5} />
											) : (
												<ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
											)}
											<span className="flex flex-col">
												<span className="text-xs font-medium text-pi-text">{opt.label}</span>
												{opt.description && (
													<span className="text-3xs leading-snug text-pi-text-muted">
														{opt.description}
													</span>
												)}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					))}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button variant="ghost" onClick={decline}>
						Decline
					</Button>
					<Button variant="primary" onClick={submit} disabled={!allAnswered}>
						Answer
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
