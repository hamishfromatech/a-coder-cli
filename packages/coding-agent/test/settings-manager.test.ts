import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS } from "../src/core/http-dispatcher.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("SettingsManager", () => {
	const testDir = join(process.cwd(), "test-settings-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	describe("computerUse", () => {
		const SAVED_ENV = process.env.A_CODER_CLI_COMPUTER_USE;

		afterEach(() => {
			if (SAVED_ENV !== undefined) {
				process.env.A_CODER_CLI_COMPUTER_USE = SAVED_ENV;
			} else {
				delete process.env.A_CODER_CLI_COMPUTER_USE;
			}
		});

		it("defaults to off, persists the toggle, and honors the env override", async () => {
			delete process.env.A_CODER_CLI_COMPUTER_USE;
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getComputerUseEnabled()).toBe(false);

			manager.setComputerUseEnabled(true);
			// Persisted to disk for the next session/engine (writes are enqueued).
			const settingsPath = join(agentDir, "settings.json");
			let persisted = false;
			for (let attempt = 0; attempt < 50 && !persisted; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 20));
				try {
					persisted = JSON.parse(readFileSync(settingsPath, "utf8")).computerUse === true;
				} catch {
					// not written yet
				}
			}
			expect(persisted).toBe(true);
			expect(SettingsManager.create(projectDir, agentDir).getComputerUseEnabled()).toBe(true);

			// Env override wins even when the setting is off.
			manager.setComputerUseEnabled(false);
			process.env.A_CODER_CLI_COMPUTER_USE = "1";
			expect(manager.getComputerUseEnabled()).toBe(true);
		});
	});

	beforeEach(() => {
		// Clean up and create fresh directories
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".a-coder-cli"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	describe("mcpServers scope union", () => {
		it("unions global and project servers and labels their source", async () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({
					mcpServers: [
						{
							name: "chrome-devtools",
							transport: "stdio",
							commandOrUrl: "npx",
							args: ["-y", "chrome-devtools-mcp@latest"],
						},
						{ name: "context7", transport: "http", commandOrUrl: "https://mcp.context7.com/mcp" },
					],
				}),
			);
			// TRUST the project: setProjectTrusted happens for trusted reads only —
			// write the project file BEFORE manager creation (create() trusts the
			// dir by default in tests: the .a-coder-cli dir itself is the opt-in).
			writeFileSync(
				join(projectDir, ".a-coder-cli", "settings.json"),
				JSON.stringify({
					mcpServers: [{ name: "workspace-tools", transport: "stdio", commandOrUrl: "node", args: ["tools.js"] }],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			const servers = manager.getMcpServers();
			expect(servers.map((s) => s.name)).toEqual(["chrome-devtools", "context7", "workspace-tools"]);
			expect(servers.find((s) => s.name === "context7")?.source).toBe("global");
			expect(servers.find((s) => s.name === "workspace-tools")?.source).toBe("project");
		});

		it("a project entry with the same name replaces the global one entirely", async () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({
					mcpServers: [
						{ name: "workspace-tools", transport: "stdio", commandOrUrl: "npx", args: ["-y", "global-tools"] },
					],
				}),
			);
			writeFileSync(
				join(projectDir, ".a-coder-cli", "settings.json"),
				JSON.stringify({
					mcpServers: [
						{
							name: "workspace-tools",
							transport: "http",
							commandOrUrl: "http://127.0.0.1:4010/mcp",
							headers: { Authorization: "Bearer project" },
						},
					],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			const servers = manager.getMcpServers();
			expect(servers).toHaveLength(1);
			const server = servers[0]!;
			expect(server.source).toBe("project");
			expect(server.transport).toBe("http");
			expect(server.commandOrUrl).toBe("http://127.0.0.1:4010/mcp");
			expect(server.headers).toEqual({ Authorization: "Bearer project" });
			// The global command/args do not leak into the project config.
			expect(server.args).toBeUndefined();
		});

		it("ignores project servers when the project is untrusted", async () => {
			writeFileSync(
				join(projectDir, ".a-coder-cli", "settings.json"),
				JSON.stringify({
					mcpServers: [{ name: "workspace-tools", transport: "stdio", commandOrUrl: "node" }],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
			const servers = manager.getMcpServers();
			const sources = servers.map((s) => s.source);
			expect(sources).not.toContain("project");
		});

		it("project labels do not leak back into saved settings files", async () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({ mcpServers: [{ name: "g", transport: "stdio", commandOrUrl: "npx" }] }),
			);
			writeFileSync(
				join(projectDir, ".a-coder-cli", "settings.json"),
				JSON.stringify({ mcpServers: [{ name: "p", transport: "stdio", commandOrUrl: "node" }] }),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getMcpServers()).toHaveLength(2);
			// A global-side save (desktop editor / setMcpServers) must not pick up
			// the annotated source fields, and the files stay clean.
			await manager.flush();
			const globalFile = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			const projectFile = JSON.parse(readFileSync(join(projectDir, ".a-coder-cli", "settings.json"), "utf-8"));
			expect(JSON.stringify(globalFile)).not.toContain('"source"');
			expect(JSON.stringify(projectFile)).not.toContain('"source"');
		});

		it("getProjectMcpServers returns the raw project list", async () => {
			writeFileSync(
				join(projectDir, ".a-coder-cli", "settings.json"),
				JSON.stringify({ mcpServers: [{ name: "workspace-tools", transport: "stdio", commandOrUrl: "node" }] }),
			);
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getProjectMcpServers().map((s) => s.name)).toEqual(["workspace-tools"]);
		});
	});

	describe("mcpServers stderr suppression", () => {
		it("auto-suppresses chrome-devtools noise and leaves other servers alone", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					mcpServers: [
						{
							name: "chrome-devtools",
							transport: "stdio",
							commandOrUrl: "npx",
							args: ["-y", "chrome-devtools-mcp@latest"],
						},
						{
							name: "custom-name-but-chrome",
							transport: "stdio",
							commandOrUrl: "node",
							args: ["chrome-devtools-mcp/launcher.js"],
						},
						{ name: "context7", transport: "http", commandOrUrl: "https://mcp.context7.com/mcp" },
					],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			const servers = manager.getMcpServers();
			expect(servers[0]?.suppressStderrPatterns).toEqual(["No handler registered for issue code"]);
			// Matched through command args even with a custom server name.
			expect(servers[1]?.suppressStderrPatterns).toEqual(["No handler registered for issue code"]);
			expect(servers[2]?.suppressStderrPatterns).toEqual([]);
		});

		it("keeps explicit patterns (empty array opts out)", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					mcpServers: [
						{
							name: "chrome-devtools",
							transport: "stdio",
							commandOrUrl: "npx",
							args: ["-y", "chrome-devtools-mcp@latest"],
							suppressStderrPatterns: ["^my noise$"],
						},
						{
							name: "chrome-quiet",
							transport: "stdio",
							commandOrUrl: "npx",
							args: ["-y", "chrome-devtools-mcp@latest"],
							suppressStderrPatterns: [],
						},
					],
				}),
			);

			const servers = SettingsManager.create(projectDir, agentDir).getMcpServers();
			expect(servers[0]?.suppressStderrPatterns).toEqual(["^my noise$"]);
			expect(servers[1]?.suppressStderrPatterns).toEqual([]); // explicit opt-out
		});
	});

	describe("preserves externally added settings", () => {
		it("should preserve enabledModels when changing thinking level", async () => {
			// Create initial settings file
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					defaultModel: "claude-sonnet",
				}),
			);

			// Create SettingsManager (simulates pi starting up)
			const manager = SettingsManager.create(projectDir, agentDir);

			// Simulate user editing settings.json externally to add enabledModels
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.enabledModels = ["claude-opus-4-5", "gpt-5.2-codex"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes thinking level via Shift+Tab
			manager.setDefaultThinkingLevel("high");
			await manager.flush();

			// Verify enabledModels is preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.enabledModels).toEqual(["claude-opus-4-5", "gpt-5.2-codex"]);
			expect(savedSettings.defaultThinkingLevel).toBe("high");
			expect(savedSettings.theme).toBe("dark");
			expect(savedSettings.defaultModel).toBe("claude-sonnet");
		});

		it("should preserve custom settings when changing theme", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					defaultModel: "claude-sonnet",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User adds custom settings externally
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.shellPath = "/bin/zsh";
			currentSettings.extensions = ["/path/to/extension.ts"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes theme
			manager.setTheme("light");
			await manager.flush();

			// Verify all settings preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellPath).toBe("/bin/zsh");
			expect(savedSettings.extensions).toEqual(["/path/to/extension.ts"]);
			expect(savedSettings.theme).toBe("light");
		});

		it("should let in-memory changes override file changes for same key", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User externally sets thinking level to "low"
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.defaultThinkingLevel = "low";
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// But then changes it via UI to "high"
			manager.setDefaultThinkingLevel("high");
			await manager.flush();

			// In-memory change should win
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.defaultThinkingLevel).toBe("high");
		});
	});

	describe("packages migration", () => {
		it("should keep local-only extensions in extensions array", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					extensions: ["/local/ext.ts", "./relative/ext.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getPackages()).toEqual([]);
			expect(manager.getExtensionPaths()).toEqual(["/local/ext.ts", "./relative/ext.ts"]);
		});

		it("should handle packages with filtering objects", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					packages: [
						"npm:simple-pkg",
						{
							source: "npm:shitty-extensions",
							extensions: ["extensions/oracle.ts"],
							skills: [],
						},
					],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			const packages = manager.getPackages();
			expect(packages).toHaveLength(2);
			expect(packages[0]).toBe("npm:simple-pkg");
			expect(packages[1]).toEqual({
				source: "npm:shitty-extensions",
				extensions: ["extensions/oracle.ts"],
				skills: [],
			});
		});
	});

	describe("reload", () => {
		it("should reload global settings from disk", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					extensions: ["/before.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "light",
					extensions: ["/after.ts"],
					defaultModel: "claude-sonnet",
				}),
			);

			await manager.reload();

			expect(manager.getTheme()).toBe("light");
			expect(manager.getExtensionPaths()).toEqual(["/after.ts"]);
			expect(manager.getDefaultModel()).toBe("claude-sonnet");
		});

		it("should keep previous settings when file is invalid", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(settingsPath, "{ invalid json");
			await manager.reload();

			expect(manager.getTheme()).toBe("dark");
		});
	});

	describe("theme setting", () => {
		it("stores slash-separated automatic theme settings separately from fixed theme names", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "light/dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getTheme()).toBeUndefined();
			expect(manager.getThemeSetting()).toBe("light/dark");

			manager.setTheme("solarized-light/tokyo-night");
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.theme).toBe("solarized-light/tokyo-night");
		});
	});

	describe("error tracking", () => {
		it("should collect and clear load errors via drainErrors", () => {
			const globalSettingsPath = join(agentDir, "settings.json");
			const projectSettingsPath = join(projectDir, ".a-coder-cli", "settings.json");
			writeFileSync(globalSettingsPath, "{ invalid global json");
			writeFileSync(projectSettingsPath, "{ invalid project json");

			const manager = SettingsManager.create(projectDir, agentDir);
			const errors = manager.drainErrors();

			expect(errors).toHaveLength(2);
			expect(errors.map((e) => e.scope).sort()).toEqual(["global", "project"]);
			expect(manager.drainErrors()).toEqual([]);
		});
	});

	describe("project trust", () => {
		it("should skip project settings when project is not trusted", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "global" }));
			writeFileSync(join(projectDir, ".a-coder-cli", "settings.json"), JSON.stringify({ theme: "project" }));

			const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });

			expect(manager.isProjectTrusted()).toBe(false);
			expect(manager.getTheme()).toBe("global");
			expect(manager.getProjectSettings()).toEqual({});
		});

		it("should reload project settings after trust changes to true", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "global" }));
			writeFileSync(join(projectDir, ".a-coder-cli", "settings.json"), JSON.stringify({ theme: "project" }));
			const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });

			manager.setProjectTrusted(true);

			expect(manager.isProjectTrusted()).toBe(true);
			expect(manager.getTheme()).toBe("project");
		});

		it("should fail project settings writes when project is not trusted", async () => {
			const projectSettingsPath = join(projectDir, ".a-coder-cli", "settings.json");
			writeFileSync(projectSettingsPath, JSON.stringify({ packages: ["npm:existing"] }));
			const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });

			expect(() => manager.setProjectPackages(["npm:new"])).toThrow(
				"Project is not trusted; refusing to write project settings",
			);
			await manager.flush();

			expect(manager.getProjectSettings()).toEqual({});
			expect(JSON.parse(readFileSync(projectSettingsPath, "utf-8"))).toEqual({ packages: ["npm:existing"] });
		});

		it("should read default project trust from global settings only", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
			writeFileSync(
				join(projectDir, ".a-coder-cli", "settings.json"),
				JSON.stringify({ defaultProjectTrust: "never" }),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getDefaultProjectTrust()).toBe("always");
		});

		it("should default invalid project trust settings to ask", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "sometimes" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getDefaultProjectTrust()).toBe("ask");
		});
	});

	describe("project settings directory creation", () => {
		it("should not create .a-coder-cli folder when only reading project settings", () => {
			// Create agent dir with global settings, but NO .a-coder-cli folder in project
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			// Delete the .a-coder-cli folder that beforeEach created
			rmSync(join(projectDir, ".a-coder-cli"), { recursive: true });

			// Create SettingsManager (reads both global and project settings)
			const manager = SettingsManager.create(projectDir, agentDir);

			// .a-coder-cli folder should NOT have been created just from reading
			expect(existsSync(join(projectDir, ".a-coder-cli"))).toBe(false);

			// Settings should still be loaded from global
			expect(manager.getTheme()).toBe("dark");
		});

		it("should create .a-coder-cli folder when writing project settings", async () => {
			// Create agent dir with global settings, but NO .a-coder-cli folder in project
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			// Delete the .a-coder-cli folder that beforeEach created
			rmSync(join(projectDir, ".a-coder-cli"), { recursive: true });

			const manager = SettingsManager.create(projectDir, agentDir);

			// .a-coder-cli folder should NOT exist yet
			expect(existsSync(join(projectDir, ".a-coder-cli"))).toBe(false);

			// Write a project-specific setting
			manager.setProjectPackages([{ source: "npm:test-pkg" }]);
			await manager.flush();

			// Now .a-coder-cli folder should exist
			expect(existsSync(join(projectDir, ".a-coder-cli"))).toBe(true);

			// And settings file should be created
			expect(existsSync(join(projectDir, ".a-coder-cli", "settings.json"))).toBe(true);
		});
	});

	describe("httpIdleTimeoutMs", () => {
		it("should default to 5 minutes", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getHttpIdleTimeoutMs()).toBe(DEFAULT_HTTP_IDLE_TIMEOUT_MS);
		});

		it("should use merged global and project settings", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ httpIdleTimeoutMs: 300000 }));
			writeFileSync(join(projectDir, ".a-coder-cli", "settings.json"), JSON.stringify({ httpIdleTimeoutMs: 0 }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getHttpIdleTimeoutMs()).toBe(0);
		});

		it("should reject invalid timeout values", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ httpIdleTimeoutMs: -1 }));
			const manager = SettingsManager.create(projectDir, agentDir);

			expect(() => manager.getHttpIdleTimeoutMs()).toThrow("Invalid httpIdleTimeoutMs setting");
		});
	});

	describe("externalEditor", () => {
		const originalVisual = process.env.VISUAL;
		const originalEditor = process.env.EDITOR;
		const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

		function setEditorEnv(visual?: string, editor?: string): void {
			if (visual === undefined) delete process.env.VISUAL;
			else process.env.VISUAL = visual;
			if (editor === undefined) delete process.env.EDITOR;
			else process.env.EDITOR = editor;
		}

		afterEach(() => {
			setEditorEnv(originalVisual, originalEditor);
			if (originalPlatform) {
				Object.defineProperty(process, "platform", originalPlatform);
			}
		});

		it("should resolve editor commands by precedence", () => {
			setEditorEnv("vim", "nano");
			expect(SettingsManager.inMemory({ externalEditor: "code --wait" }).getExternalEditorCommand()).toBe(
				"code --wait",
			);
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("vim");

			setEditorEnv(undefined, "emacs");
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("emacs");
		});

		it("should fall back to platform defaults", () => {
			setEditorEnv();
			Object.defineProperty(process, "platform", { value: "win32" });
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("notepad");

			Object.defineProperty(process, "platform", { value: "darwin" });
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("nano");

			Object.defineProperty(process, "platform", { value: "linux" });
			expect(SettingsManager.inMemory().getExternalEditorCommand()).toBe("nano");
		});
	});

	describe("outputPad", () => {
		it("should default to 1 and persist binary values", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getOutputPad()).toBe(1);

			manager.setOutputPad(0);
			await manager.flush();

			expect(manager.getOutputPad()).toBe(0);
			const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(savedSettings.outputPad).toBe(0);
		});

		it("should treat unsupported outputPad values as default padding", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ outputPad: 2 }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getOutputPad()).toBe(1);
		});
	});

	describe("shellCommandPrefix", () => {
		it("should load shellCommandPrefix from settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBe("shopt -s expand_aliases");
		});

		it("should return undefined when shellCommandPrefix is not set", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBeUndefined();
		});

		it("should preserve shellCommandPrefix when saving unrelated settings", async () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);
			manager.setTheme("light");
			await manager.flush();

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellCommandPrefix).toBe("shopt -s expand_aliases");
			expect(savedSettings.theme).toBe("light");
		});
	});

	describe("getSessionDir", () => {
		it("should return undefined when not set", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBeUndefined();
		});

		it("should return global sessionDir", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "/tmp/sessions" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe("/tmp/sessions");
		});

		it("should return project sessionDir, overriding global", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "/global/sessions" }));
			writeFileSync(join(projectDir, ".a-coder-cli", "settings.json"), JSON.stringify({ sessionDir: "./sessions" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe("./sessions");
		});

		it("should expand ~ in sessionDir", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "~/sessions" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionDir()).toBe(join(homedir(), "sessions"));
		});
	});

	describe("applies local-provider base URLs to process.env", () => {
		const envVars = ["LM_STUDIO_BASE_URL", "LLAMACPP_BASE_URL", "OLLAMA_BASE_URL", "UNSLOTH_BASE_URL"] as const;

		beforeEach(() => {
			for (const v of envVars) delete process.env[v];
		});
		afterEach(() => {
			for (const v of envVars) delete process.env[v];
		});

		it("applies lmStudioBaseUrl, llamaCppBaseUrl, ollamaBaseUrl, and unslothBaseUrl to env", () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({
					localProviders: {
						lmStudioBaseUrl: "http://lm:1234/v1",
						llamaCppBaseUrl: "http://llama:8080/v1",
						ollamaBaseUrl: "http://ollama:11434/v1",
						unslothBaseUrl: "http://unsloth:8888/v1",
						vllmBaseUrl: "http://vllm:8000/v1",
						sglangBaseUrl: "http://sglang:30000/v1",
					},
				}),
			);
			SettingsManager.create(projectDir, agentDir);
			expect(process.env.LM_STUDIO_BASE_URL).toBe("http://lm:1234/v1");
			expect(process.env.LLAMACPP_BASE_URL).toBe("http://llama:8080/v1");
			expect(process.env.OLLAMA_BASE_URL).toBe("http://ollama:11434/v1");
			expect(process.env.UNSLOTH_BASE_URL).toBe("http://unsloth:8888/v1");
			expect(process.env.VLLM_BASE_URL).toBe("http://vllm:8000/v1");
			expect(process.env.SGLANG_BASE_URL).toBe("http://sglang:30000/v1");
		});

		it("leaves a shell-exported env var intact when the setting is absent", () => {
			process.env.OLLAMA_BASE_URL = "http://shell:11434/v1";
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
			SettingsManager.create(projectDir, agentDir);
			expect(process.env.OLLAMA_BASE_URL).toBe("http://shell:11434/v1");
		});
	});

	describe("getShellPath", () => {
		it("should return undefined when not set", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBeUndefined();
		});

		it("should return an absolute shellPath unchanged", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ shellPath: "/bin/zsh" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBe("/bin/zsh");
		});

		it("should expand ~ in shellPath", () => {
			writeFileSync(
				join(agentDir, "settings.json"),
				JSON.stringify({ shellPath: "~/.local/bin/agent-shell-sandbox" }),
			);
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBe(join(homedir(), ".local/bin/agent-shell-sandbox"));
		});

		it("should expand a bare ~ in shellPath", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ shellPath: "~" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getShellPath()).toBe(homedir());
		});
	});

	describe("fresh-install chrome-devtools MCP seed", () => {
		it("seeds the built-in browser-control server into a fresh agent dir and persists it", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			const servers = manager.getMcpServers();
			expect(servers).toHaveLength(1);
			expect(servers[0]?.name).toBe("chrome-devtools");
			expect(servers[0]?.transport).toBe("stdio");
			const args = servers[0]?.args ?? [];
			expect(args).toContain("chrome-devtools-mcp@latest");
			expect(args).toContain("--isolated");
			expect(args).toContain("--no-usage-statistics");
			expect(args).toContain("--no-performance-crux");

			// The seed persists immediately: later partial saves must not drop it.
			await manager.flush();
			const persisted = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(persisted.mcpServers).toHaveLength(1);
			expect(persisted.mcpServers[0].name).toBe("chrome-devtools");
		});

		it("survives a subsequent unrelated settings save", async () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			manager.setHttpIdleTimeoutMs(90_000);
			await manager.flush();

			const persisted = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
			expect(persisted.httpIdleTimeoutMs).toBe(90_000);
			expect(JSON.stringify(persisted.mcpServers)).toContain("chrome-devtools");
		});

		it("stays removed once the user deletes the entry", async () => {
			SettingsManager.create(projectDir, agentDir);
			await SettingsManager.create(projectDir, agentDir).flush();
			await SettingsManager.create(projectDir, agentDir).flush();

			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getMcpServers()).toHaveLength(1);
			manager.setMcpServers([]);
			await manager.flush();

			const reloaded = SettingsManager.create(projectDir, agentDir);
			expect(reloaded.getMcpServers()).toEqual([]);
			await reloaded.setHttpIdleTimeoutMs(60_000); // unrelated save must not resurrect it
			await reloaded.flush();
			expect(SettingsManager.create(projectDir, agentDir).getMcpServers()).toEqual([]);
		});

		it("does not seed when a settings file already exists", () => {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getMcpServers()).toEqual([]);
		});

		it("does not seed project-scope settings", () => {
			SettingsManager.create(projectDir, agentDir);
			expect(existsSync(join(projectDir, ".a-coder-cli", "settings.json"))).toBe(false);
		});
	});
});
