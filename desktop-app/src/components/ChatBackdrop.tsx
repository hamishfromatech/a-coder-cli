import type { CSSProperties } from "react";
import { assetPath } from "../lib/asset-path";
import { useSettingsStore } from "../stores/settings-store";

/** Faint image backdrop behind the chat surface.
 *
 * Ported from Hermes desktop's <Backdrop />: a very low-opacity texture layer
 * behind the thread so the chat surface has subtle grain without hurting
 * readability.
 *
 * It used to sit ABOVE the transcript (`z-content`) with
 * `mix-blend-mode: difference` plus a `filter`. Because the layer overlapped
 * streaming text, every text paint invalidated the blend and forced the
 * compositor to re-blend the whole chat rect — the most expensive repeated
 * operation during a reply.
 *
 * Now the layer is:
 *   - behind the message column (`-z-10`, inside ChatContainer's paint
 *     containment) so nothing above it feeds a blend;
 *   - free of `mix-blend-mode` and `filter` — the inversion is baked
 *     element-locally by `.chat-backdrop`'s own background blending, so the
 *     layer is a static, self-contained paint the compositor rasterizes once.
 * Visual intent is unchanged: the same image at 2.5% opacity.
 */
export function ChatBackdrop() {
	const enabled = useSettingsStore((state) => state.chatBackdrop);

	if (!enabled) {
		return null;
	}

	return (
		<div
			aria-hidden
			className="chat-backdrop pointer-events-none absolute inset-0 z-0"
			style={
				{
					"--chat-backdrop-image": `url(${assetPath("ds-assets/filler-bg0.jpg")})`,
				} as CSSProperties
			}
		/>
	);
}
