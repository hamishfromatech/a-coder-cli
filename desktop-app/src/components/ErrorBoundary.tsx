import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
	children: ReactNode;
	/** Short label naming what failed, e.g. "message" or "app". */
	label?: string;
}

interface ErrorBoundaryState {
	error: Error | null;
}

/**
 * Catches render-time exceptions and renders a small recovery card instead of
 * letting the exception bubble up and unmount the entire React tree (which
 * leaves the window showing only the dark background — a "black screen").
 * Used at the app root (last resort) and around individual transcript items so
 * one bad message degrades to a single broken row instead of the whole UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(`[a-coder] render error in ${this.props.label ?? "component"}:`, error, info.componentStack);
	}

	private reset = (): void => {
		this.setState({ error: null });
	};

	render(): ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;
		return (
			<div className="my-2 flex items-start gap-2.5 rounded-lg border border-pi-error/30 bg-pi-error-soft px-3 py-2.5">
				<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-error" />
				<div className="min-w-0 flex-1">
					<div className="text-xs font-medium text-pi-error">
						This {this.props.label ?? "section"} failed to render
					</div>
					<p className="mt-0.5 break-words font-mono text-2xs leading-relaxed text-pi-error/80">
						{error.message || String(error)}
					</p>
					<button
						onClick={this.reset}
						className="mt-1.5 flex items-center gap-1 rounded-md border border-pi-border px-1.5 py-0.5 text-3xs text-pi-text-muted transition-hover hover:bg-pi-surface-overlay hover:text-pi-text"
					>
						<RotateCcw className="h-3 w-3" />
						Retry
					</button>
				</div>
			</div>
		);
	}
}