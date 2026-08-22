import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	routeCommand,
	findBuiltin,
	filterSlashEntries,
	BUILTIN_COMMANDS,
	type CommandHelpers,
} from "./commandRouter";

// Mock dependencies
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
	save: vi.fn(),
}));

vi.mock("./rpc", () => ({
	getPermissionMode: vi.fn().mockResolvedValue({ mode: "ask" }),
	setPermissionMode: vi.fn().mockResolvedValue(undefined),
	exportJsonl: vi.fn().mockResolvedValue({ path: "/tmp/test.jsonl" }),
	exportHtml: vi.fn().mockResolvedValue({ path: "/tmp/test.html" }),
	importJsonl: vi.fn().mockResolvedValue(undefined),
	shareSessionGist: vi.fn().mockResolvedValue({ url: "https://gist.github.com/test" }),
	bash: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
	setSessionName: vi.fn().mockResolvedValue(undefined),
	getSessionStats: vi.fn().mockResolvedValue({
		tokens: 1000,
		cost: 0.05,
		durationMs: 30000,
		messageCount: 5,
	}),
	newSession: vi.fn().mockResolvedValue(undefined),
	compact: vi.fn().mockResolvedValue(undefined),
	clone: vi.fn().mockResolvedValue(undefined),
	setProjectTrust: vi.fn().mockResolvedValue(undefined),
	reloadAuth: vi.fn().mockResolvedValue(undefined),
	prompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../stores/toast-store", () => ({
	toast: {
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
		error: vi.fn(),
	},
}));

const mockHelpers: CommandHelpers = {
	openModelPicker: vi.fn(),
	openSessionPicker: vi.fn(),
	copyLastReply: vi.fn().mockResolvedValue(undefined),
	copyToClipboard: vi.fn().mockResolvedValue(undefined),
	getCwd: vi.fn().mockReturnValue("/test/project"),
};

describe("commandRouter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("findBuiltin", () => {
		it("finds existing builtin commands", () => {
			const settings = findBuiltin("settings");
			expect(settings).toBeDefined();
			expect(settings?.name).toBe("settings");
			expect(settings?.description).toBe("Open settings");
		});

		it("returns undefined for unknown commands", () => {
			const unknown = findBuiltin("unknown-command");
			expect(unknown).toBeUndefined();
		});

		it("finds all documented commands", () => {
			const expectedCommands = [
				"settings",
				"model",
				"permission",
				"scoped-models",
				"export",
				"import",
				"share",
				"copy",
				"name",
				"session",
				"changelog",
				"hotkeys",
				"fork",
				"clone",
				"tree",
				"trust",
				"login",
				"logout",
				"new",
				"clear",
				"compact",
				"resume",
				"reload",
				"subagents",
				"teams",
				"bash",
				"quit",
				"rewind",
			];

			for (const name of expectedCommands) {
				const cmd = findBuiltin(name);
				expect(cmd, `Expected to find command /${name}`).toBeDefined();
			}
		});
	});

	describe("routeCommand", () => {
		describe("settings command", () => {
			it("routes /settings to open action", () => {
				const action = routeCommand("/settings", mockHelpers);
				expect(action.kind).toBe("open");
				if (action.kind === "open") {
					action.open();
					expect(window.dispatchEvent).toHaveBeenCalledWith(
						expect.objectContaining({
							type: "a-coder:open-settings",
						}),
					);
				}
			});
		});

		describe("model command", () => {
			it("routes /model to open model picker", () => {
				const action = routeCommand("/model", mockHelpers);
				expect(action.kind).toBe("open");
				if (action.kind === "open") {
					action.open();
					expect(mockHelpers.openModelPicker).toHaveBeenCalled();
				}
			});
		});

		describe("permission command", () => {
			it("routes /permission to RPC call", async () => {
				const action = routeCommand("/permission", mockHelpers);
				expect(action.kind).toBe("rpc");
				if (action.kind === "rpc") {
					await action.call();
					// Should cycle from "ask" to "allow"
					const { setPermissionMode } = await import("./rpc");
					expect(setPermissionMode).toHaveBeenCalledWith("allow");
				}
			});
		});

		describe("fork command", () => {
			it("routes /fork to edit action", () => {
				const action = routeCommand("/fork 123", mockHelpers);
				expect(action.kind).toBe("edit");
				if (action.kind === "edit") {
					expect(action.text).toBe("/fork 123");
				}
			});

			it("routes /fork with no args", () => {
				const action = routeCommand("/fork", mockHelpers);
				expect(action.kind).toBe("edit");
				if (action.kind === "edit") {
					expect(action.text).toBe("/fork");
				}
			});
		});

		describe("name command", () => {
			it("routes /name with args", async () => {
				const action = routeCommand("/name My Session", mockHelpers);
				expect(action.kind).toBe("rpc");
				if (action.kind === "rpc") {
					await action.call();
					const { setSessionName } = await import("./rpc");
					expect(setSessionName).toHaveBeenCalledWith("My Session");
				}
			});

			it("routes /name without args", async () => {
				const action = routeCommand("/name", mockHelpers);
				expect(action.kind).toBe("rpc");
				if (action.kind === "rpc") {
					await action.call();
					const { setSessionName } = await import("./rpc");
					expect(setSessionName).toHaveBeenCalledWith("Untitled");
				}
			});
		});

		describe("export command", () => {
			it("routes /export for HTML", async () => {
				const { save } = await import("@tauri-apps/plugin-dialog");
				vi.mocked(save).mockResolvedValueOnce("/tmp/session.html");

				const action = routeCommand("/export", mockHelpers);
				expect(action.kind).toBe("rpc");

				if (action.kind === "rpc") {
					await action.call();
					expect(save).toHaveBeenCalled();
				}
			});

			it("routes /export jsonl for JSONL", async () => {
				const { save } = await import("@tauri-apps/plugin-dialog");
				vi.mocked(save).mockResolvedValueOnce("/tmp/session.jsonl");

				const action = routeCommand("/export jsonl", mockHelpers);
				expect(action.kind).toBe("rpc");

				if (action.kind === "rpc") {
					await action.call();
					expect(save).toHaveBeenCalledWith(
						expect.objectContaining({
							defaultPath: "session.jsonl",
						}),
					);
				}
			});
		});

		describe("bash command", () => {
			it("routes /bash with command", async () => {
				const action = routeCommand("/bash ls -la", mockHelpers);
				expect(action.kind).toBe("rpc");

				if (action.kind === "rpc") {
					await action.call();
					const { bash } = await import("./rpc");
					expect(bash).toHaveBeenCalledWith("ls -la");
				}
			});

			it("routes /bash without command shows warning", async () => {
				const action = routeCommand("/bash", mockHelpers);
				expect(action.kind).toBe("rpc");

				if (action.kind === "rpc") {
					await action.call();
					const { bash } = await import("./rpc");
					expect(bash).not.toHaveBeenCalled();
				}
			});
		});

		describe("unknown commands", () => {
			it("falls back to prompt RPC for unknown commands", async () => {
				const action = routeCommand("/custom-command", mockHelpers);
				expect(action.kind).toBe("rpc");

				if (action.kind === "rpc") {
					await action.call();
					const { prompt } = await import("./rpc");
					expect(prompt).toHaveBeenCalledWith("/custom-command");
				}
			});
		});

		describe("command parsing", () => {
			it("parses command with args", () => {
				const action = routeCommand("/name my-session", mockHelpers);
				expect(action.label).toContain("my-session");
			});

			it("parses command without args", () => {
				const action = routeCommand("/name", mockHelpers);
				expect(action.kind).toBe("rpc");
			});

			it("handles leading slash removal", () => {
				const action = routeCommand("/settings", mockHelpers);
				expect(action.kind).toBe("open");
			});
		});
	});

	describe("filterSlashEntries", () => {
		const testEntries = [
			{ name: "settings", description: "Open settings", source: "builtin" as const },
			{ name: "model", description: "Select model", source: "builtin" as const },
			{ name: "export", description: "Export session", source: "builtin" as const },
			{ name: "import", description: "Import session", source: "builtin" as const },
			{ name: "bash", description: "Run shell command", source: "builtin" as const },
		];

		it("returns first 50 entries when no query", () => {
			const manyEntries = Array(100)
				.fill(null)
				.map((_, i) => ({
					name: `cmd${i}`,
					source: "builtin" as const,
				}));
			const filtered = filterSlashEntries(manyEntries, "");
			expect(filtered.length).toBe(50);
		});

		it("filters by name match", () => {
			const filtered = filterSlashEntries(testEntries, "set");
			expect(filtered.length).toBeGreaterThan(0);
			expect(filtered.some((e) => e.name === "settings")).toBe(true);
		});

		it("filters by description match", () => {
			const filtered = filterSlashEntries(testEntries, "session");
			expect(filtered.length).toBeGreaterThan(0);
			expect(filtered.some((e) => e.name === "export" || e.name === "import")).toBe(true);
		});

		it("performs fuzzy matching", () => {
			const filtered = filterSlashEntries(testEntries, "stngs");
			expect(filtered.some((e) => e.name === "settings")).toBe(true);
		});

		it("prioritizes exact name starts", () => {
			const entries = [
				{ name: "mycommand", source: "builtin" as const },
				{ name: "command", source: "builtin" as const },
			];
			const filtered = filterSlashEntries(entries, "com");
			// "command" starts with "com", should come first
			expect(filtered[0].name).toBe("command");
		});

		it("is case-insensitive", () => {
			const filtered = filterSlashEntries(testEntries, "SETTINGS");
			expect(filtered.some((e) => e.name === "settings")).toBe(true);
		});
	});

	describe("BUILTIN_COMMANDS", () => {
		it("has unique names", () => {
			const names = BUILTIN_COMMANDS.map((c) => c.name);
			const unique = new Set(names);
			expect(unique.size).toBe(names.length);
		});

		it("all commands have descriptions", () => {
			for (const cmd of BUILTIN_COMMANDS) {
				expect(cmd.description, `Command ${cmd.name} should have a description`).toBeTruthy();
			}
		});

		it("all commands have route functions", () => {
			for (const cmd of BUILTIN_COMMANDS) {
				expect(typeof cmd.route, `Command ${cmd.name} should have a route function`).toBe(
					"function",
				);
			}
		});
	});
});