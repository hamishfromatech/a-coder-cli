import { useWidgetStore } from "../stores/widget-store";

export function ExtensionWidgets({ placement }: { placement: "aboveEditor" | "belowEditor" }) {
	const { widgets, widgetOrder } = useWidgetStore();
	const visible = widgetOrder.filter((key) => widgets[key]?.placement === placement);

	if (visible.length === 0) return null;

	return (
		<div className="flex flex-col gap-2">
			{visible.map((key) => {
				const widget = widgets[key];
				if (!widget) return null;
				return (
					<div
						key={key}
						className="overflow-hidden rounded-lg border border-pi-border bg-pi-surface-raised"
					>
						<div className="border-b border-pi-border bg-pi-surface px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-pi-text-muted">
							{key}
						</div>
						<pre className="max-h-32 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-pi-text-secondary">
							{widget.lines.join("\n")}
						</pre>
					</div>
				);
			})}
		</div>
	);
}
