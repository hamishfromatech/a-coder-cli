import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Windows installer cannot be executed on CI, but its ordering rules are
// what keep a failed self-update from deleting the only working binary.
const script = readFileSync(new URL("../../../Install-A-Coder.ps1", import.meta.url), "utf8");

describe("Windows installer self-update", () => {
	it("stages the new pi.exe before moving the live binary", () => {
		const stage = script.indexOf("Copy-Item -Path $Src.FullName -Destination $StagedExe");
		const moveLive = script.indexOf("Move-Item -Path $LiveExe -Destination $OldExe");
		expect(stage).toBeGreaterThan(-1);
		expect(moveLive).toBeGreaterThan(stage);
	});

	it("restores the old binary if the staged swap fails", () => {
		expect(script).toContain("Move-Item -Path $OldExe -Destination $LiveExe");
	});

	it("never reports success when files were deferred", () => {
		const deferred = script.indexOf("if ($deferred.Count -gt 0)");
		const failure = script.indexOf('throw "Update incomplete:', deferred);
		expect(deferred).toBeGreaterThan(-1);
		expect(failure).toBeGreaterThan(deferred);
	});

	it("requires pi.exe before skipping an up-to-date install", () => {
		expect(script).toContain('(Test-Path (Join-Path $LibDir "pi.exe"))');
	});

	it("does not truncate the 128 MB download at 60 seconds", () => {
		expect(script).toContain("--max-time 600");
		expect(script).toContain("if ($LASTEXITCODE -ne 0)");
	});

	it("validates the archive before touching the install", () => {
		const validation = script.indexOf("System.IO.Compression.ZipFile");
		const stage = script.indexOf("Copy-Item -Path $Src.FullName -Destination $StagedExe");
		expect(validation).toBeGreaterThan(-1);
		expect(stage).toBeGreaterThan(validation);
	});

	it("prefers bsdtar over the Windows PowerShell Expand-Archive bug", () => {
		const tar = script.indexOf("tar.exe -xf");
		const expand = script.indexOf("Expand-Archive -Path");
		expect(tar).toBeGreaterThan(-1);
		expect(expand).toBeGreaterThan(tar);
	});
});
