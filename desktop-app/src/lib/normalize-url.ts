/** Address-bar normalization. Bare localhost/loopback hosts default to http;
 *  everything else defaults to https. Returns null for non-web addresses. */
export const normalizeUrl = (input: string): string | null => {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|(?:[a-z0-9-]+\.)*localhost)(?::\d+)?(?:[/?#]|$)/i.test(
		trimmed,
	);
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
		? trimmed
		: `${local ? "http" : "https"}://${trimmed}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.toString();
	} catch {
		return null;
	}
};
