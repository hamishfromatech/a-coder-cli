import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./ui-store";

describe("ui-store", () => {
	beforeEach(() => {
		// Reset to known state before each test
		const store = useUiStore.getState();
		store.setLeftSidebarOpen(true);
		store.setRightSidebarOpen(false);
		store.setRightSidebarWidth(320);
		store.setRightSidebarTab("files");
		store.setSelectedGitFile(null);
		store.setSelectedArtifactPath(null);
		store.setSelectedArtifactViewMode("preview");
	});

	describe("initial state", () => {
		it("has correct default values after reset", () => {
			const store = useUiStore.getState();
			store.setLeftSidebarOpen(true);
			store.setRightSidebarOpen(false);
			expect(useUiStore.getState().leftSidebarOpen).toBe(true);
			expect(useUiStore.getState().rightSidebarOpen).toBe(false);
		});
	});

	describe("sidebar controls", () => {
		it("setLeftSidebarOpen updates left sidebar state", () => {
			const store = useUiStore.getState();
			store.setLeftSidebarOpen(false);
			expect(useUiStore.getState().leftSidebarOpen).toBe(false);
			store.setLeftSidebarOpen(true);
			expect(useUiStore.getState().leftSidebarOpen).toBe(true);
		});

		it("setRightSidebarOpen updates right sidebar state", () => {
			const store = useUiStore.getState();
			store.setRightSidebarOpen(true);
			expect(useUiStore.getState().rightSidebarOpen).toBe(true);
			store.setRightSidebarOpen(false);
			expect(useUiStore.getState().rightSidebarOpen).toBe(false);
		});

		it("toggleLeftSidebar toggles the state", () => {
			const store = useUiStore.getState();
			store.setLeftSidebarOpen(true);
			store.toggleLeftSidebar();
			expect(useUiStore.getState().leftSidebarOpen).toBe(false);
			store.toggleLeftSidebar();
			expect(useUiStore.getState().leftSidebarOpen).toBe(true);
		});

		it("toggleRightSidebar toggles the state", () => {
			const store = useUiStore.getState();
			store.setRightSidebarOpen(false);
			store.toggleRightSidebar();
			expect(useUiStore.getState().rightSidebarOpen).toBe(true);
			store.toggleRightSidebar();
			expect(useUiStore.getState().rightSidebarOpen).toBe(false);
		});
	});

	describe("right sidebar tab", () => {
		it("setRightSidebarTab updates tab and opens sidebar", () => {
			const store = useUiStore.getState();
			store.setRightSidebarOpen(false);
			store.setRightSidebarTab("git");
			expect(useUiStore.getState().rightSidebarTab).toBe("git");
			expect(useUiStore.getState().rightSidebarOpen).toBe(true);
		});

		it("setRightSidebarWidth updates width", () => {
			const store = useUiStore.getState();
			store.setRightSidebarWidth(500);
			expect(useUiStore.getState().rightSidebarWidth).toBe(500);
		});
	});

	describe("git file selection", () => {
		it("setSelectedGitFile updates path and staged flag", () => {
			const store = useUiStore.getState();
			store.setSelectedGitFile("/path/to/file.ts", true);
			expect(useUiStore.getState().selectedGitFile).toBe("/path/to/file.ts");
			expect(useUiStore.getState().selectedGitStaged).toBe(true);
		});

		it("setSelectedGitFile defaults staged to false", () => {
			const store = useUiStore.getState();
			store.setSelectedGitFile("/path/to/file.ts");
			expect(useUiStore.getState().selectedGitStaged).toBe(false);
		});

		it("setSelectedGitFile clears selection with null", () => {
			const store = useUiStore.getState();
			store.setSelectedGitFile("/path/to/file.ts", true);
			store.setSelectedGitFile(null);
			expect(useUiStore.getState().selectedGitFile).toBeNull();
			expect(useUiStore.getState().selectedGitStaged).toBe(false);
		});
	});

	describe("artifact selection", () => {
		it("setSelectedArtifactPath updates path", () => {
			const store = useUiStore.getState();
			store.setSelectedArtifactPath("/path/to/artifact.html");
			expect(useUiStore.getState().selectedArtifactPath).toBe(
				"/path/to/artifact.html",
			);
		});

		it("setSelectedArtifactViewMode updates mode", () => {
			const store = useUiStore.getState();
			store.setSelectedArtifactViewMode("raw");
			expect(useUiStore.getState().selectedArtifactViewMode).toBe("raw");
			store.setSelectedArtifactViewMode("preview");
			expect(useUiStore.getState().selectedArtifactViewMode).toBe("preview");
		});
	});
});