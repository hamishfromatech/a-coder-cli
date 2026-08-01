import * as React from "react";
import {
	Box,
	Braces,
	Code,
	Database,
	FileText,
	GitCompare,
	Globe,
	type LucideIcon,
	Palette,
	Terminal,
	Workflow,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { sanitizeLanguageTag } from "../../lib/markdown-code";

// Rounded-card shell for fenced code (and diffs / raw payloads), sized for the
// conversation column. Adapted from Hermes' chat/code-card.tsx; the codicon
// glyph is replaced with a lucide icon keyed by language.

const ICON_BY_LANGUAGE: Record<string, LucideIcon> = {
	bash: Terminal, cmd: Terminal, console: Terminal, fish: Terminal, powershell: Terminal,
	ps1: Terminal, sh: Terminal, shell: Terminal, zsh: Terminal,
	md: FileText, markdown: FileText,
	json: Braces, json5: Braces,
	ini: Braces, toml: Braces, yaml: Braces, yml: Braces, env: Braces,
	graphql: Database, gql: Database, mysql: Database, postgres: Database, sql: Database, sqlite: Database,
	diff: GitCompare, patch: GitCompare,
	css: Palette, less: Palette, sass: Palette, scss: Palette, svg: Palette,
	http: Globe,
	docker: Box, dockerfile: Box,
	mermaid: Workflow,
};

export function iconForLanguage(language: string | undefined): LucideIcon {
	return ICON_BY_LANGUAGE[sanitizeLanguageTag(language || "")] ?? Code;
}

function CodeCard({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"min-w-0 max-w-full overflow-hidden rounded-[0.625rem] border border-pi-border text-[length:var(--conversation-tool-font-size)] text-pi-text-muted",
				className,
			)}
			data-slot="code-card"
			{...props}
		/>
	);
}

function CodeCardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex items-center justify-between gap-2 border-b border-pi-border px-2 py-1.5", className)}
			data-slot="code-card-header"
			{...props}
		/>
	);
}

function CodeCardTitle({ className, children, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"flex min-w-0 items-center gap-1.5 truncate text-[length:var(--conversation-tool-font-size)] font-medium leading-relaxed text-pi-text-secondary",
				className,
			)}
			data-slot="code-card-title"
			{...props}
		>
			{children}
		</span>
	);
}

function CodeCardIcon({ language, className }: { language: string | undefined; className?: string }) {
	const Icon = iconForLanguage(language);
	return <Icon className={cn("size-3.5 shrink-0 text-pi-text-muted", className)} />;
}

function CodeCardSubtitle({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span className={cn("font-normal text-pi-text-faint", className)} data-slot="code-card-subtitle" {...props} />
	);
}

function CodeCardBody({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"font-mono text-[0.7rem] leading-relaxed text-pi-text-secondary [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:font-mono [&_pre]:leading-relaxed",
				className,
			)}
			data-slot="code-card-body"
			{...props}
		/>
	);
}

export { CodeCard, CodeCardBody, CodeCardHeader, CodeCardIcon, CodeCardSubtitle, CodeCardTitle };