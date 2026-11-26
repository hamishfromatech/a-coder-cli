/**
 * Path comparisons shared by project/session switching.
 *
 * Windows paths can arrive in three spellings for the same folder:
 * `C:\Repo`, `C:/Repo`, and the verbatim form `\\?\C:\Repo` that
 * `std::fs::canonicalize` returns. Session headers store the first, the
 * desktop's canonicalized picker target used to return the third, and the
 * resume filter therefore missed every existing session and tried to create
 * a new one. Normalize separators, the verbatim prefix, trailing slashes, and
 * casing before comparing (case-insensitive matches the previous behavior on
 * every platform).
 */
export function comparablePath(value: string | undefined | null): string {
	let path = value ?? "";
	// `\\?\UNC\server\share` is the verbatim spelling of `\\server\share`.
	path = path.replace(/^\\\\\?\\UNC\\/i, "\\\\");
	// `\\?\C:\...` is the verbatim spelling of `C:\...`.
	path = path.replace(/^\\\\\?\\/, "");
	path = path.replace(/\\/g, "/");
	while (path.length > 1 && path.endsWith("/")) {
		path = path.slice(0, -1);
	}
	return path.toLowerCase();
}

export function samePath(a: string | undefined | null, b: string | undefined | null): boolean {
	return comparablePath(a) === comparablePath(b);
}
