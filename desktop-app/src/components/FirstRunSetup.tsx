/**
 * Post-connect first-run setup: pick a model from the providers the engine can
 * see, then optionally start the first turn with a guided prompt. Skippable.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Settings, Sparkles } from "lucide-react";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";
import { Button } from "./ui/Button";
import * as rpc from "../lib/rpc";
import { useSessionStore } from "../stores/session-store";
import { markFirstRunSetupComplete } from "../lib/onboarding";

const GUIDED_PROMPT =
	"Give me a tour of this project: what are the main packages, how do I run the tests, and where should I start?";

export function FirstRunSetup({
	onClose,
	onOpenSettings,
}: {
	onClose: () => void;
	onOpenSettings: () => void;
}) {
	const [models, setModels] = useState<Model<Api>[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [provider, setProvider] = useState("");
	const [modelId, setModelId] = useState("");
	const [prompt, setPrompt] = useState(GUIDED_PROMPT);
	const [busy, setBusy] = useState<"model" | "prompt" | null>(null);
	const applied = useRef(false);

	useEffect(() => {
		let cancelled = false;
		void rpc
			.getAvailableModels()
			.then((result) => {
				if (cancelled) return;
				setModels(result.models ?? []);
			})
			.catch((reason) => {
				if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const providers = useMemo(() => {
		const grouped = new Map<string, Model<Api>[]>();
		for (const model of models ?? []) {
			const list = grouped.get(model.provider) ?? [];
			list.push(model);
			grouped.set(model.provider, list);
		}
		return [...grouped.entries()]
			.map(([id, list]) => ({ id, models: list }))
			.sort((a, b) => a.id.localeCompare(b.id));
	}, [models]);

	useEffect(() => {
		if (applied.current || providers.length === 0) return;
		applied.current = true;
		const current = useSessionStore.getState().model;
		const preferred = providers.find((entry) => entry.id === current?.provider) ?? providers[0];
		setProvider(preferred.id);
		const first = preferred.models.find((entry) => entry.id === current?.id) ?? preferred.models[0];
		setModelId(first?.id ?? "");
	}, [providers]);

	const selectedProvider = providers.find((entry) => entry.id === provider);
	const selectedModel = selectedProvider?.models.find((entry) => entry.id === modelId);

	const useModel = async () => {
		if (!selectedModel) return false;
		setBusy("model");
		try {
			await rpc.sendCommand({
				type: "set_model",
				provider: selectedModel.provider,
				modelId: selectedModel.id,
			});
			useSessionStore.getState().setModel(selectedModel as never);
			return true;
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
			return false;
		} finally {
			setBusy(null);
		}
	};

	const finish = (sendPrompt: boolean) => {
		void (async () => {
			if (sendPrompt) {
				setBusy("prompt");
				if (selectedModel && !(await useModel())) return;
				try {
					await rpc.sendCommand({ type: "prompt", message: prompt.trim() || GUIDED_PROMPT });
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : String(reason));
					return;
				}
			}
			markFirstRunSetupComplete();
			onClose();
		})();
	};

	return (
		<ModalBackdrop onClick={() => finish(false)}>
			<ModalPanel className="w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
				<div className="flex flex-col items-center border-b border-pi-border px-6 py-6">
					<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-pi-accent to-pi-accent-hover text-white shadow-lg">
						<Sparkles className="h-5 w-5" />
					</div>
					<h2 className="mt-3 text-lg font-semibold tracking-tight text-pi-text">One last step</h2>
					<p className="mt-1.5 text-center text-[13px] leading-relaxed text-pi-text-secondary">
						Pick a model and start your first turn. You can change both later.
					</p>
				</div>

				<div className="space-y-4 px-5 py-4">
					{error && (
						<div className="rounded-md bg-pi-surface-raised p-2 text-2xs text-pi-error">{error}</div>
					)}
					{models === null && (
						<div className="flex items-center gap-2 text-2xs text-pi-text-muted">
							<Loader2 className="h-3 w-3 animate-spin" />
							Loading models…
						</div>
					)}
					{models !== null && providers.length === 0 && (
						<div className="space-y-2 rounded-lg border border-dashed border-pi-border p-3 text-2xs text-pi-text-muted">
							No providers are signed in yet. Add a provider key or sign in, then come back.
							<Button variant="secondary" size="xs" icon={Settings} onClick={onOpenSettings}>
								Configure providers
							</Button>
						</div>
					)}
					{providers.length > 0 && (
						<div className="grid grid-cols-2 gap-2">
							<label className="space-y-1">
								<span className="block text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">
									Provider
								</span>
								<select
									value={provider}
									onChange={(event) => {
										const next = event.target.value;
										setProvider(next);
										const first = providers.find((entry) => entry.id === next)?.models[0];
										setModelId(first?.id ?? "");
									}}
									className="h-8 w-full rounded-md border border-pi-border bg-pi-surface px-2 text-xs text-pi-text focus:border-pi-accent focus:outline-none"
								>
									{providers.map((entry) => (
										<option key={entry.id} value={entry.id}>
											{entry.id}
										</option>
									))}
								</select>
							</label>
							<label className="space-y-1">
								<span className="block text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">
									Model
								</span>
								<select
									value={modelId}
									onChange={(event) => setModelId(event.target.value)}
									className="h-8 w-full rounded-md border border-pi-border bg-pi-surface px-2 text-xs text-pi-text focus:border-pi-accent focus:outline-none"
								>
									{selectedProvider?.models.map((entry) => (
										<option key={entry.id} value={entry.id}>
											{entry.name || entry.id}
										</option>
									))}
								</select>
							</label>
						</div>
					)}

					<label className="block space-y-1">
						<span className="block text-2xs font-semibold uppercase tracking-wide text-pi-text-muted">
							First prompt
						</span>
						<textarea
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							rows={3}
							className="w-full resize-y rounded-md bg-pi-surface-raised px-2.5 py-1.5 text-xs text-pi-text shadow-ring transition-smooth placeholder:text-pi-text-faint focus:shadow-focus focus:outline-none"
						/>
					</label>
				</div>

				<div className="flex items-center justify-between border-t border-pi-border px-5 py-3">
					<div className="flex items-center gap-1">
						<Button variant="ghost" size="sm" onClick={() => finish(false)}>
							Just open the app
						</Button>
						<Button variant="ghost" size="xs" icon={Settings} onClick={onOpenSettings}>
							Providers &amp; keys
						</Button>
					</div>
					<Button
						variant="primary"
						size="sm"
						loading={busy === "prompt"}
						disabled={!prompt.trim() && providers.length > 0}
						onClick={() => finish(true)}
					>
						Start with this prompt
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
