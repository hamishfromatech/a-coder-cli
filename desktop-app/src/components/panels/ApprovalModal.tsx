import { Shield, X, Check, AlertTriangle, MessageSquare, FileText } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useModalA11y } from "../../hooks/useModalA11y";
import type { UiRequest } from "../../stores/session-store";

export interface ApprovalModalProps {
	request: UiRequest;
	onResolve: (response: { confirmed?: boolean; value?: string; cancelled?: true }) => void;
}

export function ApprovalModal({ request, onResolve }: ApprovalModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const [inputValue, setInputValue] = useState(
		request.method === "editor" ? (request.prefill ?? "") : (request.placeholder ?? ""),
	);
	const [selectedOption, setSelectedOption] = useState<string | null>(request.options?.[0] ?? null);
	useModalA11y(modalRef, true, () => onResolve({ cancelled: true }));

	useEffect(() => {
		setInputValue(request.method === "editor" ? (request.prefill ?? "") : (request.placeholder ?? ""));
		setSelectedOption(request.options?.[0] ?? null);
	}, [request.id, request.method, request.prefill, request.placeholder]);

	const handleAllow = () => {
		if (request.method === "input" || request.method === "editor") {
			onResolve({ value: inputValue });
		} else if (request.method === "select") {
			onResolve({ value: selectedOption ?? "" });
		} else {
			onResolve({ confirmed: true });
		}
	};

	const handleDeny = () => {
		onResolve({ confirmed: false });
	};

	const handleClose = () => {
		onResolve({ cancelled: true });
	};

	const title = request.title || "Permission needed";
	const isSelect = request.method === "select";
	const isInput = request.method === "input";
	const isEditor = request.method === "editor";

	return (
		<div
			ref={modalRef}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
			onClick={handleClose}
		>
			<div
				className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center gap-3 border-b border-pi-border px-4 py-3">
					<div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${isEditor ? "bg-pi-accent-soft text-pi-accent" : "bg-pi-warning/15 text-pi-warning"}`}>
						{isEditor ? <FileText className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
					</div>
					<div className="min-w-0 flex-1">
						<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">
							{title}
						</h2>
						<p className="mt-0.5 text-2xs text-pi-text-muted">
							{isEditor ? "Extension requests text input" : "Permission mode is set to “Ask first”"}
						</p>
					</div>
					<button
						onClick={handleClose}
						className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						title="Close"
						aria-label="Close"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				{/* Body */}
				<div className="px-4 py-4">
					{request.message && (
						<div className="flex items-start gap-2.5 rounded-lg bg-pi-surface-raised p-3">
							<MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
							<p className="text-xs leading-relaxed text-pi-text-secondary">
								{request.message}
							</p>
						</div>
					)}

					{isSelect && request.options && (
						<div className="mt-3 space-y-1">
							{request.options.map((option) => (
								<button
									key={option}
									onClick={() => setSelectedOption(option)}
									className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
										selectedOption === option
											? "bg-pi-accent-soft text-pi-accent"
											: "hover:bg-pi-surface-raised text-pi-text-secondary"
									}`}
								>
									<span className={`h-3.5 w-3.5 rounded-full border ${selectedOption === option ? "border-pi-accent bg-pi-accent" : "border-pi-border"}`} />
									{option}
								</button>
							))}
						</div>
					)}

					{isInput && (
						<div className="mt-3">
							<input
								type="text"
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								placeholder={request.placeholder ?? ""}
								className="w-full rounded-lg border border-pi-border bg-pi-surface-raised px-3 py-2 text-xs text-pi-text placeholder:text-pi-text-faint focus:border-pi-accent focus:outline-none focus:ring-2 focus:ring-pi-accent-ring"
							/>
						</div>
					)}

					{isEditor && (
						<div className="mt-3">
							<textarea
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								rows={10}
								className="w-full resize-y rounded-lg border border-pi-border bg-pi-surface-raised px-3 py-2 font-mono text-xs leading-relaxed text-pi-text placeholder:text-pi-text-faint focus:border-pi-accent focus:outline-none focus:ring-2 focus:ring-pi-accent-ring"
							/>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<button
						onClick={handleDeny}
						className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-pi-text-secondary transition-hover active-press hover:bg-pi-error-soft hover:text-pi-error focus-visible:shadow-focus focus-visible:outline-none"
					>
						<AlertTriangle className="h-3.5 w-3.5" />
						Deny
					</button>
					<button
						onClick={handleAllow}
						className="inline-flex items-center gap-1.5 rounded-lg bg-pi-accent px-3 py-2 text-xs font-medium text-white shadow-ring-accent transition-hover active-press hover:bg-pi-accent-hover focus-visible:shadow-focus focus-visible:outline-none"
					>
						<Check className="h-3.5 w-3.5" />
						Allow
					</button>
				</div>
			</div>
		</div>
	);
}
