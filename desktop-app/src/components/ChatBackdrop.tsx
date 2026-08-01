import { useSettingsStore } from "../stores/settings-store";

const assetPath = (path: string) =>
	`${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

/** Faint image backdrop behind the chat surface.
 *
 * Ported from Hermes desktop's <Backdrop />: a very low-opacity, inverted,
 * difference-blended image layer that sits behind the thread so the chat
 * surface has subtle texture without hurting readability.
 */
export function ChatBackdrop() {
	const enabled = useSettingsStore((state) => state.chatBackdrop);

	if (!enabled) {
		return null;
	}

	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 z-[2]"
			style={{
				mixBlendMode: "difference",
				opacity: 0.025,
				backgroundImage: `url(${assetPath("ds-assets/filler-bg0.jpg")})`,
				backgroundSize: "cover",
				backgroundPosition: "top left",
				filter:
					"invert(calc(1 * var(--backdrop-invert-mul, 1))) saturate(1) brightness(1)",
			}}
		/>
	);
}
