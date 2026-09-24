/** Resolve a path inside the app's public/ assets against the Vite base URL. */
export const assetPath = (path: string) =>
	`${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;