/** Find the closest known command name for an unknown slash command. */
export function suggestSlashCommandName(input: string, names: Iterable<string>, maxDistance = 2): string | undefined {
	const normalized = input.toLowerCase();
	let bestName: string | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const name of names) {
		const candidate = name.toLowerCase();
		if (candidate === normalized) continue;
		const distance = levenshtein(normalized, candidate);
		if (distance <= maxDistance && distance < bestDistance) {
			bestName = name;
			bestDistance = distance;
		}
	}

	return bestName;
}

/** Levenshtein edit distance with a rolling row (commands are short). */
function levenshtein(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
			current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
		}
		previous = current;
	}
	return previous[b.length]!;
}
