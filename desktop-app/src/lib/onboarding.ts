/** Onboarding flow state: first-run detection and replay plumbing. */

export const ONBOARDING_FLAG = "onboarding-complete";

/** DOM event App.tsx listens for to re-open the onboarding overlay. */
export const REPLAY_ONBOARDING_EVENT = "a-coder:replay-onboarding";

export function isOnboardingComplete(): boolean {
	return localStorage.getItem(ONBOARDING_FLAG) === "true";
}

export function markOnboardingComplete(): void {
	localStorage.setItem(ONBOARDING_FLAG, "true");
}

/** Request the onboarding overlay (tour + setup) from anywhere (e.g. Settings). */
export function replayOnboarding(): void {
	window.dispatchEvent(new CustomEvent(REPLAY_ONBOARDING_EVENT));
}