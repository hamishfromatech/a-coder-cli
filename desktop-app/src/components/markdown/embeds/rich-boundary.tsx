import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback: ReactNode;
	/** Changing this clears a caught error (e.g. new source for a re-parse). */
	resetKey?: string;
}

// Local error boundary for rich renderers (mermaid parse throws, malformed SVG,
// a provider widget blowing up). A failed embed must never blank the
// transcript — show the fallback and recover when resetKey changes.
export class RichBoundary extends Component<Props, { failed: boolean }> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidUpdate(prev: Props) {
		if (this.state.failed && prev.resetKey !== this.props.resetKey) {
			this.setState({ failed: false });
		}
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}