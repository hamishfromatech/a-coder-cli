/**
 * Derive a display goal from a sub-agent prompt.
 *
 * Prompts frequently open with a persona preamble ("You are a …", "You're a
 * …"), which reads badly in status surfaces (the inline agents panel, the
 * running-tasks viewer, the desktop runtime panel). The goal should describe
 * the task, so skip leading persona lines and surface the first task-like
 * line instead. When every line is preamble, there is no goal to show.
 */
export function deriveSubAgentGoal(prompt: string | undefined): string | undefined {
	if (!prompt) return undefined;
	const lines = prompt
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return lines.find((line) => !/^you(?:'re| are)\b/i.test(line));
}
