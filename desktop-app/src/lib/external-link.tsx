// External-link helpers, adapted from Hermes desktop's lib/external-link.tsx.
// Drops the gateway link-title bridge (we don't fetch titles) and opens links
// via the Tauri shell plugin so they leave the app for the system browser.

import { open } from "@tauri-apps/plugin-shell";
import type { ComponentProps, ReactNode } from "react";
import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "./cn";

const DOMAIN_RE = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?$/i;
const SKIP_PROTO_RE = /^(?:file|data|mailto|javascript|blob|chrome|about|tauri):/i;
const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/i;

export function normalizeExternalUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed;
	return DOMAIN_RE.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function parseUrl(value: string): null | URL {
	try {
		return new URL(normalizeExternalUrl(value));
	} catch {
		return null;
	}
}

export function shortHostLabel(value: string): string {
	return parseUrl(value)?.hostname.replace(/^www\./, "") ?? value;
}

export function hostPathLabel(value: string): string {
	const url = parseUrl(value);
	if (!url) return value;
	const host = url.hostname.replace(/^www\./, "");
	const path = url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : "";
	return `${host}${path}`;
}

function cleanSlug(segment: string): string {
	try {
		return decodeURIComponent(segment)
			.replace(/\.a\d+\..*$/i, "")
			.replace(/\.(?:html?|php|aspx?)$/i, "")
			.replace(/(?:[-_.](?:[a-z]{1,3}\d{2,}|i\d{2,}))+$/i, "")
			.replace(/[_-]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	} catch {
		return "";
	}
}

export function urlSlugTitleLabel(value: string): string {
	const url = parseUrl(value);
	for (const segment of url?.pathname.split("/").filter(Boolean).reverse() ?? []) {
		const cleaned = cleanSlug(segment);
		if (!cleaned || !/[a-z]/i.test(cleaned)) continue;
		if (/^(?:[a-z]{1,3}\d+|\d+)$/i.test(cleaned.replace(/\s+/g, ""))) continue;
		const titled = cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase());
		if (titled.length >= 4) return titled;
	}
	return hostPathLabel(value);
}

export function openExternalLink(href: string): void {
	if (!href || SKIP_PROTO_RE.test(href)) return;
	const target = normalizeExternalUrl(href);
	if (!/^https?:\/\//i.test(target)) return;
	if (LOCAL_HOST_RE.test(parseUrl(target)?.host ?? "")) return;
	void open(target).catch(() => undefined);
}

export function ExternalLinkIcon({ className }: { className?: string }) {
	return <ArrowUpRight aria-hidden className={cn("ml-1 inline size-[0.78em] align-[-0.08em] opacity-70", className)} />;
}

interface ExternalLinkProps extends Omit<ComponentProps<"a">, "href" | "target"> {
	href: string;
	children?: ReactNode;
	showExternalIcon?: boolean;
}

export function ExternalLink({
	children,
	className,
	href,
	onClick,
	showExternalIcon = true,
	...rest
}: ExternalLinkProps) {
	const target = normalizeExternalUrl(href);
	return (
		<a
			className={cn("font-semibold text-pi-text underline underline-offset-4 decoration-pi-accent/30", className)}
			href={target}
			onClick={(event) => {
				event.stopPropagation();
				onClick?.(event);
				if (event.defaultPrevented) return;
				event.preventDefault();
				openExternalLink(target);
			}}
			rel="noopener noreferrer"
			target="_blank"
			{...rest}
		>
			{children ?? urlSlugTitleLabel(target)}
			{showExternalIcon && <ExternalLinkIcon />}
		</a>
	);
}

interface PrettyLinkProps extends Omit<ComponentProps<"a">, "href" | "target"> {
	href: string;
	label?: string;
	fallbackLabel?: string;
}

export function PrettyLink({ className, fallbackLabel, href, label, ...rest }: PrettyLinkProps) {
	const target = useMemo(() => normalizeExternalUrl(href), [href]);
	const display = label?.trim() || fallbackLabel?.trim() || urlSlugTitleLabel(target);
	return (
		<ExternalLink className={cn("wrap-break-word", className)} href={target} title={target} {...rest}>
			<span className="font-medium">{display}</span>
		</ExternalLink>
	);
}