/**
 * Convert a title into a URL slug:
 * - lowercase
 * - spaces and underscores become single hyphens
 * - accented characters are transliterated to ASCII (e.g. é -> e)
 * - characters other than a-z, 0-9, and hyphens are removed
 * - runs of hyphens collapse to one; leading/trailing hyphens are trimmed
 *
 * Examples:
 *   slugify("Hello World")        === "hello-world"
 *   slugify("  Multiple   Spaces ") === "multiple-spaces"
 *   slugify("Hello_World")        === "hello-world"
 *   slugify("Café & Bar!")        === "cafe-bar"
 *   slugify("")                   === ""
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
	// TODO: implement
	return title;
}