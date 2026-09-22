/**
 * Structured output for workflow agents: extract a JSON value from an
 * agent's final text and validate it against a subset of JSON Schema
 * (object / array / string / number / boolean / null, required,
 * additionalProperties: false, properties, items, enum).
 *
 * Mirrors upstream's behavior: schema validation with retries (the host
 * re-invokes with the validation failure appended), and a static
 * self-contradiction check (a required key that additionalProperties: false
 * rules out) that fails before any agent spawns.
 */

export interface SchemaIssue {
	path: string;
	message: string;
}

/** Validate a parsed JSON value against the supported schema subset. */
export function validateAgainstSchema(value: unknown, schema: unknown, path = ""): SchemaIssue[] {
	if (typeof schema !== "object" || schema === null) return [];
	const s = schema as Record<string, unknown>;

	if (s.type !== undefined) {
		const expected = Array.isArray(s.type) ? s.type : [s.type];
		const actual = actualType(value);
		if (!expected.includes(actual) && !(expected.includes("number") && actual === "integer")) {
			return [{ path, message: `expected ${String(expected)}, got ${actual}` }];
		}
	}

	const issues: SchemaIssue[] = [];

	if (s.enum !== undefined && !Array.isArray(s.enum)) {
		// ignore malformed enum
	} else if (Array.isArray(s.enum) && !s.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
		issues.push({ path, message: `value not in enum: ${JSON.stringify(s.enum)}` });
	}

	if (actualType(value) === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		const properties = (s.properties ?? {}) as Record<string, unknown>;
		const required = Array.isArray(s.required) ? (s.required as unknown[]) : [];
		const additionalPropertiesFalse = s.additionalProperties === false;

		for (const key of required) {
			if (typeof key === "string" && !(key in record)) {
				issues.push({ path: joinPath(path, key), message: "required key is missing" });
			}
		}
		for (const [key, child] of Object.entries(record)) {
			const childSchema = properties[key];
			if (childSchema !== undefined) {
				issues.push(...validateAgainstSchema(child, childSchema, joinPath(path, key)));
			} else if (additionalPropertiesFalse) {
				issues.push({
					path: joinPath(path, key),
					message: "additional property not allowed by additionalProperties: false",
				});
			}
		}
	}

	if (Array.isArray(value) && s.items !== undefined) {
		for (const [index, child] of value.entries()) {
			issues.push(...validateAgainstSchema(child, s.items, joinPath(path, String(index))));
		}
	}

	return issues;
}

/**
 * Static check for provable schema self-contradictions: a required key that
 * `additionalProperties: false` rules out. Returns human-readable
 * contradictions; an empty list means "no provable contradiction".
 */
export function findSchemaContradictions(schema: unknown, path = ""): string[] {
	if (typeof schema !== "object" || schema === null) return [];
	const s = schema as Record<string, unknown>;
	const contradictions: string[] = [];

	if (
		s.additionalProperties === false &&
		Array.isArray(s.required) &&
		s.properties &&
		typeof s.properties === "object"
	) {
		for (const key of s.required as unknown[]) {
			if (typeof key === "string" && !(key in (s.properties as Record<string, unknown>))) {
				contradictions.push(
					`${path || "schema"}: required key "${key}" is ruled out by additionalProperties: false`,
				);
			}
		}
	}
	if (s.properties && typeof s.properties === "object") {
		for (const [key, child] of Object.entries(s.properties as Record<string, unknown>)) {
			contradictions.push(...findSchemaContradictions(child, joinPath(path, key)));
		}
	}
	if (Array.isArray(s.items)) {
		for (const [i, child] of s.items.entries())
			contradictions.push(...findSchemaContradictions(child, `${path}[${i}]`));
	} else if (s.items !== undefined) {
		contradictions.push(...findSchemaContradictions(s.items, path));
	}
	return contradictions;
}

/** Extract a JSON value from agent text: strips code fences, finds the outermost JSON. */
export function extractJson(text: string): unknown | undefined {
	const trimmed = text.trim();
	const candidates: string[] = [];

	const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
	if (fence?.[1]) candidates.push(fence[1].trim());
	candidates.push(trimmed);

	for (const candidate of candidates) {
		const parsed = parseOutermost(candidate);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

function parseOutermost(text: string): unknown | undefined {
	const start = findFirst(text, ["{", "["]);
	if (start === undefined) return undefined;
	const open = text[start];
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === open) depth++;
		else if (ch === close) {
			depth--;
			if (depth === 0) {
				try {
					return JSON.parse(text.slice(start, i + 1));
				} catch {
					return undefined;
				}
			}
		}
	}
	return undefined;
}

function findFirst(text: string, opens: string[]): number | undefined {
	let best: number | undefined;
	for (const open of opens) {
		const index = text.indexOf(open);
		if (index !== -1 && (best === undefined || index < best)) best = index;
	}
	return best;
}

function actualType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function joinPath(base: string, key: string): string {
	return base ? `${base}.${key}` : key;
}
