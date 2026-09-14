/**
 * Return the items for a 1-based page.
 *
 * @param {string[]} items full list
 * @param {number} page 1-based page number
 * @param {number} pageSize items per page
 * @returns {string[]} the slice for that page; empty array if the page is
 *   beyond the last page
 */
export function pageItems(items, page, pageSize) {
	const start = page * pageSize + 1;
	return items.slice(start, start + pageSize);
}