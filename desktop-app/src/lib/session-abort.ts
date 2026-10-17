import { abort as rpcAbort } from "./rpc";
import { triggerHaptic } from "./haptics";
import { useSessionStore } from "../stores/session-store";
import { useVoiceCallStore, voiceCall } from "./voice-call";

/** Abort the in-flight agent run — the shared path for the composer's Stop
 *  button and the global Escape-while-running shortcut. Marks the turn as
 *  user-cancelled so the end-of-turn cue doesn't fire for an abort. */
export async function abortRun(): Promise<void> {
	triggerHaptic("cancel");
	// Mark the turn as user-cancelled so agent_end doesn't play the cue.
	useSessionStore.getState().setAbortRequested(true);
	try {
		await rpcAbort();
	} finally {
		useSessionStore.getState().setIsStreaming(false);
		// Interrupting a call must also tear down any TTS the agent was
		// speaking — the abort supersedes the spoken reply.
		if (useVoiceCallStore.getState().active) voiceCall.interrupt();
	}
}