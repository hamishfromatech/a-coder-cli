/**
 * Whimsical loading verbs shown while the model is streaming a reply.
 * Kept lightweight so it can be duplicated in the desktop frontend.
 */
export const LOADING_VERBS = [
	"Flibbertigibbeting",
	"Wibbling",
	"Booping",
	"Honking",
	"Bloviating",
	"Noodling",
	"Smooshing",
	"Marinating",
	"Schlepping",
	"Concocting",
	"Percolating",
	"Combobulating",
	"Razzmatazzing",
	"Vibing",
	"Pondering",
	"Ruminating",
	"Simmering",
	"Brewing",
	"Tinkering",
	"Fermenting",
	"Jiving",
] as const;

let lastVerbIndex = -1;

/** Pick a whimsical verb, avoiding the same one twice in a row. */
export function pickLoadingVerb(): string {
	let idx = Math.floor(Math.random() * LOADING_VERBS.length);
	if (idx === lastVerbIndex && LOADING_VERBS.length > 1) {
		idx = (idx + 1) % LOADING_VERBS.length;
	}
	lastVerbIndex = idx;
	return LOADING_VERBS[idx];
}

/** Format a verb for the working indicator. */
export function formatLoadingMessage(verb: string, interruptKey?: string): string {
	return interruptKey ? `${verb}… (${interruptKey} to interrupt)` : `${verb}…`;
}
