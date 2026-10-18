import { describe, expect, it } from "vitest";
import { ThemeGalleryComponent } from "../src/modes/interactive/components/theme-gallery.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

const themes = [
	{ name: "dark", path: "/themes/dark.json" },
	{ name: "light", path: "/themes/light.json" },
	{ name: "system", path: undefined },
];

describe("ThemeGalleryComponent", () => {
	it("lists themes, marks the current one, and shows a palette sample", () => {
		const component = new ThemeGalleryComponent({
			themes,
			current: "dark",
			onPreview: () => {},
			onConfirm: () => {},
			onCancel: () => {},
		});
		const out = component.render(100).join("\n");
		expect(out).toContain("✓ dark");
		expect(out).toContain("light");
		expect(out).toContain("system (follows terminal)");
		expect(out).toContain("The quick brown fox");
		expect(out).toContain("+ added line");
	});

	it("previews on selection change and confirms on Enter", () => {
		const previewed: string[] = [];
		let confirmed: string | undefined;
		const component = new ThemeGalleryComponent({
			themes,
			current: "dark",
			onPreview: (name) => void previewed.push(name),
			onConfirm: (name) => {
				confirmed = name;
			},
			onCancel: () => {},
		});
		component.handleInput("\x1b[B");
		expect(previewed.at(-1)).toBe("light");
		component.handleInput("\r");
		expect(confirmed).toBe("light");
	});

	it("cancels on Escape", () => {
		let cancelled = 0;
		const component = new ThemeGalleryComponent({
			themes,
			current: "dark",
			onPreview: () => {},
			onConfirm: () => {},
			onCancel: () => void cancelled++,
		});
		component.handleInput("\x1b");
		expect(cancelled).toBe(1);
	});
});
