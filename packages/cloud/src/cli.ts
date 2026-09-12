#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./config.ts";
import { sendIpcRequest } from "./ipc/client.ts";
import { serve } from "./serve.ts";
import type { CloudResponse } from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as { version: string };

function printHelp(): void {
	console.log(
		`a-coder-cloud v${packageJson.version}\n\nUsage:\n  a-coder-cloud serve\n  a-coder-cloud spawn <repo> <prompt...> [--base <branch>] [--model <provider>/<id>] [--timeout <minutes>] [--push]\n  a-coder-cloud status\n  a-coder-cloud review <task-id>\n  a-coder-cloud stop <task-id>\n  a-coder-cloud --version\n`,
	);
}

function printResponse(response: CloudResponse): void {
	console.log(JSON.stringify(response, null, 2));
	if (!response.ok) {
		process.exitCode = 1;
	}
}

function getFlagValue(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	if (index === -1 || index + 1 >= args.length) {
		return undefined;
	}
	return args[index + 1];
}

async function main(argv: string[]): Promise<void> {
	const [command, ...rest] = argv;
	switch (command) {
		case "serve":
			await serve();
			return;
		case "spawn": {
			const positional = rest.filter((arg, index) => {
				const previous = rest[index - 1];
				return (
					!(previous === "--base" || previous === "--model" || previous === "--timeout") &&
					!["--base", "--model", "--timeout", "--push"].includes(arg)
				);
			});
			if (positional.length < 2) {
				printHelp();
				process.exitCode = 1;
				return;
			}
			const response = await sendIpcRequest({
				type: "spawn_task",
				repo: positional[0],
				prompt: positional.slice(1).join(" "),
				baseBranch: getFlagValue(rest, "--base"),
				model: getFlagValue(rest, "--model")?.split("/")[1],
				provider: getFlagValue(rest, "--model")?.split("/")[0],
				timeoutMinutes: getFlagValue(rest, "--timeout") ? Number(getFlagValue(rest, "--timeout")) : undefined,
				push: rest.includes("--push"),
			});
			printResponse(response);
			return;
		}
		case "status": {
			const response = await sendIpcRequest({ type: "list_tasks" });
			printResponse(response);
			return;
		}
		case "review": {
			if (rest.length === 0) {
				printHelp();
				process.exitCode = 1;
				return;
			}
			const response = await sendIpcRequest({ type: "get_task", taskId: rest[0] });
			printResponse(response);
			return;
		}
		case "stop": {
			if (rest.length === 0) {
				printHelp();
				process.exitCode = 1;
				return;
			}
			const response = await sendIpcRequest({ type: "stop_task", taskId: rest[0] });
			printResponse(response);
			return;
		}
		case "--version":
		case "-v":
			console.log(`a-coder-cloud v${VERSION}`);
			return;
		default:
			printHelp();
			process.exitCode = command === undefined || command === "--help" || command === "-h" ? 0 : 1;
			return;
	}
}

main(process.argv.slice(2)).catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
