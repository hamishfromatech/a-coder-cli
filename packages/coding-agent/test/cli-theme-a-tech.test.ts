import { describe, expect, it } from "vitest";
import { getAvailableThemes, getThemeByName, initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

describe("A-Tech CLI themes", () => {
	it("registers both A-Tech themes in the selector list", () => {
		const themes = getAvailableThemes();
		expect(themes).toContain("a-tech");
		expect(themes).toContain("a-tech-light");
	});

	it("loads both themes with their accent colors", () => {
		expect(getThemeByName("a-tech")?.fg("accent", "A")).toContain("\x1b[");
		expect(getThemeByName("a-tech-light")?.fg("accent", "A")).toContain("\x1b[");
	});
});
