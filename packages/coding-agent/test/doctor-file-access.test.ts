import { describe, expect, it } from "vitest";
import { collectDoctorReport, formatDoctorReport } from "../src/cli/doctor-command.ts";

describe("doctor file access", () => {
	it("reports the macOS privacy state for the working directory", () => {
		const report = collectDoctorReport();
		expect(report.fileAccess.platform).toBe(process.platform);
		expect(report.fileAccess.cwd).toBe(process.cwd());
		if (process.platform === "darwin") {
			expect(["ok", "denied", "missing"]).toContain(report.fileAccess.status);
			expect(Array.isArray(report.guardedFolders)).toBe(true);
		} else {
			expect(report.fileAccess.status).toBe("not_applicable");
			expect(report.guardedFolders).toEqual([]);
		}
	});

	it("renders the file-access section with the restore hint", () => {
		const report = collectDoctorReport();
		const rendered = formatDoctorReport({
			...report,
			fileAccess: {
				platform: "darwin",
				cwd: "/Users/tester/Downloads/project",
				status: "denied",
				guardedFolder: "Downloads",
				hint: "macOS is blocking access to ~/Downloads. Open System Settings → Privacy & Security.",
			},
		});
		expect(rendered).toContain("File access (macOS)");
		expect(rendered).toContain("blocked by macOS privacy settings");
		expect(rendered).toContain("Privacy & Security");
	});
});
