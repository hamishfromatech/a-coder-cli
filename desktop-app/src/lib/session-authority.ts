/**
 * Authoritative session identity for the active session.
 *
 * The engine is the source of truth for "which session is active and what is
 * it called". This module records WHICH session file the sessionName currently
 * in the store belongs to, so UI derived from the name (session tab labels)
 * never applies a name that belongs to a different session — the stale-name
 * window of an optimistic switch otherwise renames the freshly activated tab
 * to "Untitled session".
 */

let authoritativeFile: string | null = null;

/** Mark `file` as the session the current store name is authoritative for. */
export function setAuthoritativeSession(file: string | null): void {
	authoritativeFile = file;
}

/** True when the store's current sessionName is authoritative for `file`. */
export function isAuthoritativeSession(file: string | null | undefined): boolean {
	return file !== null && authoritativeFile === file;
}

/** Reset (tests, disconnects). */
export function resetAuthoritativeSession(): void {
	authoritativeFile = null;
}