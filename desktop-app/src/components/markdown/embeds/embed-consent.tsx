import { type CSSProperties } from "react";
import { Play } from "lucide-react";
import type { EmbedDescriptor } from "./providers/types";

// Privacy placeholder shown before an embed reaches out to a third party.
// Simplified from Hermes: a single "Load <label>" button (no persisted
// "always allow" store). Sized to the embed's footprint (no layout shift).

export function EmbedFacade({ descriptor, onLoad }: { descriptor: EmbedDescriptor; onLoad: () => void }) {
	const style: CSSProperties = descriptor.aspectRatio
		? { aspectRatio: descriptor.aspectRatio }
		: { height: descriptor.height ?? 320 };

	return (
		<span
			className="flex size-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-pi-border bg-pi-surface-raised/40"
			style={style}
		>
			<button
				className="flex items-center gap-1.5 rounded-md bg-pi-accent px-2.5 py-1 text-2xs font-medium text-white transition-smooth hover:bg-pi-accent-hover focus-visible:shadow-focus focus-visible:outline-none"
				onClick={onLoad}
				type="button"
			>
				<Play className="size-3 translate-x-px fill-current" />
				Load {descriptor.label}
			</button>
			<span className="text-[0.6875rem] text-pi-text-muted">{hostOf(descriptor)}</span>
		</span>
	);
}

function hostOf(descriptor: EmbedDescriptor): string {
	if (descriptor.provider === "twitter") return "x.com";
	try {
		return new URL(descriptor.sourceUrl).hostname.replace(/^www\./, "");
	} catch {
		return descriptor.label;
	}
}