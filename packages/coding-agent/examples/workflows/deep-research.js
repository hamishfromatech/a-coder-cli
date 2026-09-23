export const meta = {
	name: 'deep-research',
	description: 'Investigate a question across many web sources: fan out searches, cross-check claims adversarially, and return a cited report',
	phases: ['read', 'verify', 'report'],
}

// args.question is the research question passed at invocation:
//   run_workflow { workflow: "deep-research", args: { question: "..." } }

const angles = [
	`${args.question} — official documentation`,
	`${args.question} — recent changelogs and release notes`,
	`${args.question} — practitioner write-ups and known gotchas`,
]

// Phase 1: fan out one search agent per angle.
const searches = await pipeline(angles, (angle) =>
	agent(
		`Search the web for: ${angle}. Return the strongest sources with URLs and a one-line summary of what each covers.`,
		{
			schema: {
				type: 'object',
				required: ['sources'],
				properties: {
					sources: { type: 'array', items: { type: 'object', required: ['url', 'summary'], properties: { url: { type: 'string' }, summary: { type: 'string' } } } },
				},
			},
			label: angle.slice(0, 40),
		},
	),
)

// Phase 2: dedupe URLs and fetch/extract claims from each source.
const urls = [...new Set(searches.filter(Boolean).flatMap((s) => s.sources.map((src) => src.url)))].slice(0, 10)

phase('read')
const claims = (await pipeline(urls, (url) =>
	agent(
		`Fetch ${url} and extract concrete claims relevant to: ${args.question}. Return ONLY claims this source actually supports, each with a short quote.`,
		{
			schema: {
				type: 'object',
				required: ['claims'],
				properties: {
					claims: { type: 'array', items: { type: 'object', required: ['claim', 'quote'], properties: { claim: { type: 'string' }, quote: { type: 'string' } } } },
				},
			},
			label: url,
		},
	),
)).filter(Boolean).flatMap((c) => c.claims)

// Phase 3: adversarial verification — one independent reader per claim.
phase('verify')
const verified = await pipeline(claims, (entry) =>
	agent(
		`Adversarially verify this claim against its quote. A claim that the quote does not fully support fails.\nClaim: ${entry.claim}\nQuote: ${entry.quote}`,
		{ schema: { type: 'object', required: ['pass', 'reason'], properties: { pass: { type: 'boolean' }, reason: { type: 'string' } } }, label: entry.claim.slice(0, 40) },
	),
).then((results) => claims.filter((_, i) => results[i]?.pass))

// Phase 4: synthesize the surviving claims into one cited report.
phase('report')
return agent(
	`Write a cited report answering: ${args.question}. Use only these verified claims (each already source-backed); list them with their source URL. If a claim could not be checked, mark it unverified instead of refuted.\n\nClaims:\n${JSON.stringify(verified, null, 2)}`,
	{ label: 'write report' },
)