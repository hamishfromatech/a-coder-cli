/**
 * Agents startup orchestration — single entry point. Built-ins always load
 * first; custom agents are layered on top with project-scope overriding
 * user-scope by the order of `loadAllCustomAgents` (user first, project
 * second → project wins on name collision). Sync to match the skills loader.
 */

import { getBuiltInAgents } from "./builtIn.ts";
import { loadAllCustomAgents } from "./loadAgents.ts";
import { setAgents } from "./registry.ts";

export interface AgentsBootstrapResult {
	builtInCount: number;
	customCount: number;
	totalCount: number;
	warnings: string[];
}

/** Load built-in + custom agents and populate the registry. */
export function bootstrapAgents(cwd: string): AgentsBootstrapResult {
	const builtIns = getBuiltInAgents();
	const { agents: custom, warnings } = loadAllCustomAgents(cwd);

	// Built-ins first → user/project custom agents on top. Map.set() inside
	// setAgents overwrites by name, so a project-scope `Explore.md` shadows the built-in.
	setAgents([...builtIns, ...custom]);

	return {
		builtInCount: builtIns.length,
		customCount: custom.length,
		totalCount: builtIns.length + custom.filter((a) => a.source !== "built-in").length,
		warnings,
	};
}
