/**
 * JSON helpers for workflow data flow: path resolution, template
 * interpolation, and the declarative loop predicates.
 *
 * Paths are dot-separated ("audit", "discover.files", "checks.0.pass").
 * Everything is plain JSON — no scripting, by design.
 */

/** Resolve a dot path into a JSON value; undefined when any hop is missing. */
export function resolvePath(value: unknown, path: string | undefined): unknown {
	if (!path) return value;
	let current: unknown = value;
	for (const segment of path.split(".")) {
		if (current === null || current === undefined) return undefined;
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
			current = current[index];
			continue;
		}
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/** Render a template value for prompt interpolation. */
function renderValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	return JSON.stringify(value, null, 2);
}

/**
 * Interpolate a prompt template. Supports `${item}` (fan-out item),
 * `${stepId}` / `${stepId.path}` (earlier step outputs), and `${args.x}`.
 * Unknown references render as "" (and are reported via `missing`).
 */
export function interpolate(
	template: string,
	refs: { steps: Record<string, unknown>; args: Record<string, unknown> | undefined },
	options?: { item?: unknown; missing?: (ref: string) => void },
): string {
	return template.replace(/\$\{([^}]+)\}/g, (_match, rawRef: string) => {
		const ref = rawRef.trim();

		let value: unknown;
		if (ref === "item") {
			if (options?.item === undefined) options?.missing?.(ref);
			value = options?.item;
		} else if (ref === "args" || ref.startsWith("args.")) {
			if (!refs.args) {
				options?.missing?.(ref);
				value = undefined;
			} else {
				const path = ref === "args" ? undefined : ref.slice(5);
				value = resolvePath(refs.args, path);
				if (value === undefined) options?.missing?.(ref);
			}
		} else {
			const dot = ref.indexOf(".");
			const stepId = dot === -1 ? ref : ref.slice(0, dot);
			const stepOutput = refs.steps[stepId];
			if (stepOutput === undefined) {
				options?.missing?.(ref);
				value = undefined;
			} else {
				value = dot === -1 ? stepOutput : resolvePath(stepOutput, ref.slice(dot + 1));
				if (value === undefined) options?.missing?.(ref);
			}
		}
		return renderValue(value);
	});
}

/**
 * Evaluate a declarative predicate against a step output.
 * Multiple criteria combine with AND; an empty predicate fails (never loops
 * forever on a tautology).
 */
export function checkPredicate(
	predicate: { path?: string; equals?: unknown; notEquals?: unknown; exists?: boolean } | undefined,
	output: unknown,
): boolean {
	if (
		!predicate ||
		(predicate.equals === undefined && predicate.notEquals === undefined && predicate.exists === undefined)
	) {
		return false;
	}
	const value = resolvePath(output, predicate.path);
	if (predicate.exists !== undefined) {
		const exists = value !== undefined && value !== null;
		if (exists !== predicate.exists) return false;
	}
	if (predicate.equals !== undefined && JSON.stringify(value) !== JSON.stringify(predicate.equals)) {
		return false;
	}
	if (predicate.notEquals !== undefined && JSON.stringify(value) === JSON.stringify(predicate.notEquals)) {
		return false;
	}
	return true;
}
