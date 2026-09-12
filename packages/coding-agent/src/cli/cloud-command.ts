/**
 * `a-coder cloud` subcommand: control plane client for A-Coder Cloud
 * (self-hosted always-on agent fleet).
 *
 * Handled before parseArgs so `cloud` is never mistaken for a prompt.
 */

import type { CloudTask } from "@earendil-works/pi-cloud";
import { cloudGet, cloudList, cloudSpawn, cloudStop, serve, VERSION } from "@earendil-works/pi-cloud";
import chalk from "chalk";

interface ParsedCloudArgs {
	positionals: string[];
	base?: string;
	model?: string;
	provider?: string;
	timeout?: number;
	push: boolean;
	json: boolean;
}

function parseCloudArgs(args: string[]): ParsedCloudArgs {
	const valueFlags = new Set(["--base", "--model", "--timeout"]);
	const parsed: ParsedCloudArgs = { positionals: [], push: false, json: false };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--push") {
			parsed.push = true;
		} else if (arg === "--json") {
			parsed.json = true;
		} else if (valueFlags.has(arg)) {
			const value = args[i + 1] ?? "";
			i += 1;
			if (arg === "--base") {
				parsed.base = value;
			} else if (arg === "--model") {
				const slash = value.indexOf("/");
				if (slash > 0 && slash < value.length - 1) {
					parsed.provider = value.slice(0, slash);
					parsed.model = value.slice(slash + 1);
				} else {
					parsed.model = value;
				}
			} else if (arg === "--timeout") {
				parsed.timeout = Number(value);
			}
		} else {
			parsed.positionals.push(arg);
		}
	}
	return parsed;
}

function printCloudHelp(): void {
	console.log(
		`A-Coder Cloud v${VERSION} — self-hosted always-on agent fleet\n
Usage:
  a-coder cloud spawn <repo> <prompt...> [--base <branch>] [--model <provider>/<model>] [--timeout <minutes>] [--push]
      Give the agent a repo and a task. It runs in a container-grade workspace
      under ~/.a-coder/cloud/, committing WIP checkpoints to branch ac-cloud/<task-id>
      as it works — even while your machine is away.
  a-coder cloud status [--json]
      Overview of all cloud tasks.
  a-coder cloud review <task-id>
      Print the report, the commits, and how to resume or merge the work.
  a-coder cloud stop <task-id>
      Stop a running task (partial work is preserved on its branch).
  a-coder cloud serve
      Run the cloud daemon in the foreground (auto-started on demand otherwise).
`,
	);
}

function printTaskRow(task: {
	id: string;
	status: string;
	repoSource: string;
	branch: string;
	updatedAt: string;
}): void {
	const repo = task.repoSource.split("/").filter(Boolean).pop() ?? task.repoSource;
	const updated = new Date(task.updatedAt).toLocaleTimeString();
	console.log(`${task.id}  ${task.status.padEnd(9)} ${repo.padEnd(24)} ${task.branch}  (updated ${updated})`);
}

function printReview(task: CloudTask): void {
	console.log(chalk.bold(`Task ${task.id} — ${task.status}`));
	console.log(`repo:     ${task.repoSource}`);
	console.log(`branch:   ${task.branch} (from ${task.baseBranch} @ ${task.baseSha.slice(0, 8)})`);
	console.log(`workspace: ${task.workspacePath}`);
	if (task.error) {
		console.log(chalk.red(`error:    ${task.error}`));
	}
	if (task.commits.length > 0) {
		console.log("");
		console.log("commits:");
		for (const commit of task.commits) {
			console.log(`  ${commit.hash.slice(0, 8)}  ${commit.subject}`);
		}
	}
	if (task.warnings.length > 0) {
		console.log("");
		console.log(chalk.yellow("warnings:"));
		for (const warning of task.warnings) {
			console.log(chalk.yellow(`  - ${warning}`));
		}
	}
	if (task.reportMarkdown) {
		console.log("");
		console.log(task.reportMarkdown);
	} else {
		console.log("");
		console.log("The agent is still working. Run `a-coder cloud review` again when status is done.");
	}
}

export async function handleCloudCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "cloud") return false;
	const [subcommand, ...rest] = args.slice(1);
	if (subcommand === undefined || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
		printCloudHelp();
		return true;
	}

	try {
		switch (subcommand) {
			case "serve": {
				await serve();
				return true;
			}
			case "spawn": {
				const parsed = parseCloudArgs(rest);
				if (parsed.positionals.length < 2) {
					printCloudHelp();
					process.exitCode = 1;
					return true;
				}
				const task = await cloudSpawn({
					repo: parsed.positionals[0],
					prompt: parsed.positionals.slice(1).join(" "),
					baseBranch: parsed.base,
					provider: parsed.provider,
					model: parsed.model,
					timeoutMinutes: parsed.timeout,
					push: parsed.push,
				});
				if (!task) {
					throw new Error("spawn failed");
				}
				console.log(`Cloud task spawned: ${chalk.bold(task.id)}`);
				console.log(`branch:    ${task.branch}`);
				console.log(`workspace: ${task.workspacePath}`);
				console.log("");
				console.log("The agent is now working in the background. Check progress with:");
				console.log(`  a-coder cloud status`);
				console.log(`  a-coder cloud review ${task.id}`);
				return true;
			}
			case "status": {
				const parsed = parseCloudArgs(rest);
				const tasks = await cloudList();
				if (parsed.json) {
					console.log(JSON.stringify(tasks, null, 2));
					return true;
				}
				if (tasks.length === 0) {
					console.log("No cloud tasks yet. Start one with: a-coder cloud spawn <repo> <prompt>");
					return true;
				}
				console.log(`${"ID".padEnd(14)}${"STATUS".padEnd(11)}REPO`);
				for (const task of tasks) {
					printTaskRow(task);
				}
				return true;
			}
			case "review": {
				const parsed = parseCloudArgs(rest);
				const taskId = parsed.positionals[0];
				if (!taskId) {
					printCloudHelp();
					process.exitCode = 1;
					return true;
				}
				const task = await cloudGet(taskId);
				if (!task) {
					throw new Error(`Task not found: ${taskId}`);
				}
				if (parsed.json) {
					console.log(JSON.stringify(task, null, 2));
				} else {
					printReview(task);
				}
				return true;
			}
			case "stop": {
				const parsed = parseCloudArgs(rest);
				const taskId = parsed.positionals[0];
				if (!taskId) {
					printCloudHelp();
					process.exitCode = 1;
					return true;
				}
				await cloudStop(taskId);
				console.log(`Stop signal sent to task ${taskId}.`);
				return true;
			}
			default:
				console.error(chalk.red(`Unknown cloud subcommand: ${subcommand}`));
				printCloudHelp();
				process.exitCode = 1;
				return true;
		}
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
}
