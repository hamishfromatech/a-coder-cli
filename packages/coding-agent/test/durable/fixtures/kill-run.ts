/**
 * Child process for the kill-mid-tool test: starts a durable run whose first model
 * response calls bash with a long sleep, then hangs until the parent SIGKILLs it.
 */

import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { runDurablePrompt } from "../../../src/core/durable/runner.ts";

const storageDir = process.env.KILL_STORAGE;
const cwd = process.env.KILL_CWD;
if (!storageDir || !cwd) throw new Error("KILL_STORAGE and KILL_CWD are required");

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
	() =>
		fauxAssistantMessage(
			[
				{
					type: "toolCall",
					id: "call-1",
					name: "bash",
					arguments: {
						command: "count=$(cat count.txt 2>/dev/null || echo 0); echo $((count + 1)) > count.txt; sleep 30",
					},
				},
			],
			{ stopReason: "toolUse" },
		),
	() => fauxAssistantMessage("resumed after kill"),
]);

await runDurablePrompt({
	storageDir,
	runId: "kill-1",
	models,
	model: { provider: "faux", id: "faux-1" },
	cwd,
	prompt: "run the long sweep",
});
