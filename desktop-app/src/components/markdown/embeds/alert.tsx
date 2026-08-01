import { cloneElement, isValidElement, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info, Zap, type LucideIcon } from "lucide-react";
import { cn } from "../../../lib/cn";

export type AlertType = "caution" | "important" | "note" | "tip" | "warning";

interface AlertStyle {
	accent: string;
	icon: LucideIcon;
	label: string;
}

// GitHub's five alert kinds, mapped to our icon set + a tinted accent.
const ALERT_STYLES: Record<AlertType, AlertStyle> = {
	caution: { accent: "text-pi-error", icon: AlertTriangle, label: "Caution" },
	important: { accent: "text-purple-500 dark:text-purple-400", icon: AlertCircle, label: "Important" },
	note: { accent: "text-pi-accent", icon: Info, label: "Note" },
	tip: { accent: "text-pi-success", icon: Zap, label: "Tip" },
	warning: { accent: "text-pi-warning", icon: AlertTriangle, label: "Warning" },
};

const MARKER_RE = /^\s*\[!(note|tip|important|warning|caution)\]\s*\n?/i;

function firstText(node: ReactNode): string {
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) {
		for (const child of node) {
			const text = firstText(child);
			if (text.trim()) return text;
		}
		return "";
	}
	if (isValidElement(node)) {
		return firstText((node.props as { children?: ReactNode }).children);
	}
	return "";
}

function stripMarker(node: ReactNode, state: { done: boolean }): ReactNode {
	if (state.done) return node;
	if (typeof node === "string") {
		const replaced = node.replace(MARKER_RE, "");
		if (replaced !== node) {
			state.done = true;
			return replaced;
		}
		return node;
	}
	if (Array.isArray(node)) {
		return node.map((child, index) => <Fragmentless key={index} node={stripMarker(child, state)} />);
	}
	if (isValidElement(node)) {
		const children = (node.props as { children?: ReactNode }).children;
		if (children == null) return node;
		return cloneElement(node, undefined, stripMarker(children, state));
	}
	return node;
}

function Fragmentless({ node }: { node: ReactNode }) {
	return <>{node}</>;
}

/** Detect a GitHub-style alert blockquote (`> [!NOTE]`). Returns the alert kind
 *  and the body with the marker stripped, or null for a plain blockquote. */
export function extractAlert(children: ReactNode): { body: ReactNode; type: AlertType } | null {
	const match = firstText(children).match(MARKER_RE);
	if (!match) return null;
	return { body: stripMarker(children, { done: false }), type: match[1].toLowerCase() as AlertType };
}

export function MarkdownAlert({ children, type }: { children: ReactNode; type: AlertType }) {
	const style = ALERT_STYLES[type];
	const Icon = style.icon;
	return (
		<div
			className="aui-md-alert my-2 rounded-lg border border-pi-border bg-pi-surface-raised/50 px-3 py-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
			data-slot="aui_markdown-alert"
		>
			<div className={cn("mb-1 flex items-center gap-1.5 text-[0.8125rem] font-semibold", style.accent)}>
				<Icon className="size-4 shrink-0" />
				{style.label}
			</div>
			{children}
		</div>
	);
}