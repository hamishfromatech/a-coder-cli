import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI: a UTF-8 multi-byte
 * character (e.g. an em-dash) decodes into curly quotes that close string
 * literals early and break the whole script's parse. `a-coder-cli update`
 * downloads and executes this script on every Windows update, so it must stay
 * pure ASCII.
 */
describe("Install-A-Coder.ps1", () => {
	it("is pure ASCII (PS 5.1 reads BOM-less scripts as ANSI)", () => {
		const script = readFileSync(join(import.meta.dirname, "../../../Install-A-Coder.ps1"), "latin1");
		const nonAscii = [...script].filter((ch) => ch.charCodeAt(0) > 127);
		expect(nonAscii, `${nonAscii.join("")} — replace typographic characters with ASCII`).toEqual([]);
	});

	it("parses clean under the PowerShell language parser", async () => {
		// The static-ASCII guard prevents the observed breakage; this second check
		// catches gross syntax damage when the file is edited on a machine with pwsh.
		const { execFileSync } = await import("node:child_process");
		let hasPwsh = true;
		try {
			execFileSync("which", ["pwsh"], { stdio: "pipe" });
		} catch {
			hasPwsh = false;
		}
		if (!hasPwsh) return;
		const result = execFileSync("pwsh", [
			"-NoProfile",
			"-Command",
			`$t = $null; $e = $null\n` +
				`[void][System.Management.Automation.Language.Parser]::ParseFile("${join(
					import.meta.dirname,
					"../../../Install-A-Coder.ps1",
				)}", [ref]$t, [ref]$e)\n` +
				`if ($e.Count -gt 0) { exit 1 }`,
		]);
		expect(result).toBeTruthy();
	});
});
