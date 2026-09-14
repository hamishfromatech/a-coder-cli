// Hidden grader for 001-fix-crash. Run with cwd = the agent's repo copy.
// Pass = `node main.js` prints exactly "12" and exits 0.
import { spawnSync } from "node:child_process";

const run = spawnSync(process.execPath, ["main.js"], { encoding: "utf8", timeout: 15000 });
const out = (run.stdout ?? "").trim();
const pass = run.status === 0 && out === "12";
console.log(
	JSON.stringify({
		pass,
		exitCode: run.status,
		stdout: out.slice(0, 200),
		stderr: (run.stderr ?? "").split("\n").slice(-3).join(" | ").slice(0, 500),
	}),
);
process.exit(pass ? 0 : 1);