/** Split a match line into plain/highlighted segments for the search panel. */

export interface HighlightSegment {
	text: string;
	hit: boolean;
}

export function highlightSegments(line: string, query: string, caseSensitive: boolean): HighlightSegment[] {
	const needle = query.trim();
	if (!needle) return [{ text: line, hit: false }];
	const haystack = caseSensitive ? line : line.toLowerCase();
	const wanted = caseSensitive ? needle : needle.toLowerCase();
	const segments: HighlightSegment[] = [];
	let from = 0;
	let found = haystack.indexOf(wanted, from);
	while (found >= 0) {
		if (found > from) segments.push({ text: line.slice(from, found), hit: false });
		segments.push({ text: line.slice(found, found + wanted.length), hit: true });
		from = found + wanted.length;
		found = haystack.indexOf(wanted, from);
	}
	if (from < line.length) segments.push({ text: line.slice(from), hit: false });
	return segments.length > 0 ? segments : [{ text: line, hit: false }];
}
