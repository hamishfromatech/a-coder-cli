import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	clearAgentSessionServicesCache,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";

/**
 * Phase 1 of the session architecture roadmap (desktop-app/SESSION-ARCHITECTURE.md):
 * switching away from a session with an in-flight turn detaches the runtime
 * (keeps the turn streaming in the background) instead of aborting it, and
 * switching back re-attaches the same live runtime.
 */
describe("AgentSessionRuntime background (detached) sessions", () => {
	const cleanups: Array<() => Promise<void> | void> = [];
	/** Resolvers for the faux provider's deferred responses: each unresolved
	 *  entry represents a turn still streaming. Resolving one finishes it. */
	let resolvers: Array<(text: string) => void>;

	beforeEach(() => {
		clearAgentSessionServicesCache();
		resolvers = [];
	});

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeHost() {
		const tempDir = join(tmpdir(), `pi-runtime-detach-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider();
		faux.setResponses([
			() =>
				new Promise((resolve) => {
					resolvers.push((text) => resolve(fauxAssistantMessage(text)));
				}),
			() =>
				new Promise((resolve) => {
					resolvers.push((text) => resolve(fauxAssistantMessage(text)));
				}),
			() =>
				new Promise((resolve) => {
					resolvers.push((text) => resolve(fauxAssistantMessage(text)));
				}),
		]);

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				agentDir: tempDir,
				authStorage,
				cwd,
				resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true },
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtimeHost = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});

		cleanups.push(async () => {
			await runtimeHost.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return runtimeHost;
	}

	it("detaches a running turn on switch, keeps it streaming, and reaps it when it settles", async () => {
		const runtimeHost = await createRuntimeHost();

		// Start a turn on session A and leave it streaming (unresolved faux step).
		void runtimeHost.session.prompt("hello");
		await vi.waitFor(() => expect(runtimeHost.session.isStreaming).toBe(true));
		const sessionAFile = runtimeHost.session.sessionFile;
		expect(sessionAFile).toBeTruthy();

		// Switch to a fresh session B while A's turn is still in flight.
		await runtimeHost.newSession();
		const sessionBFile = runtimeHost.session.sessionFile;
		expect(sessionBFile).not.toBe(sessionAFile);

		// Session A is detached but still streaming in the background.
		const statuses = runtimeHost.getSessionsStatus();
		expect(statuses).toHaveLength(2);
		const statusA = statuses.find((s) => s.sessionFile === sessionAFile);
		expect(statusA?.running).toBe(true);
		expect(statusA?.active).toBe(false);

		// A's turn completes while detached — Phase 2 keep-alive: the settled
		// runtime stays in the registry (idle) instead of being reaped.
		resolvers[0]?.("done");
		await vi.waitFor(() => {
			const latest = runtimeHost.getSessionsStatus();
			const a = latest.find((s) => s.sessionFile === sessionAFile);
			expect(a?.running).toBe(false);
			expect(a?.active).toBe(false);
		});

		// With an eager idle timeout, the settled runtime is reaped.
		runtimeHost.setDetachedIdleTimeoutMs(300);
		await vi.waitFor(
			() => {
				const latest = runtimeHost.getSessionsStatus();
				expect(latest.some((s) => s.sessionFile === sessionAFile)).toBe(false);
			},
			{ timeout: 10000 },
		);
		expect(runtimeHost.getSessionsStatus()).toHaveLength(1);
		expect(runtimeHost.getSessionsStatus()[0]?.sessionFile).toBe(sessionBFile);
	});

	it("re-attaches the same live runtime when switching back mid-turn", async () => {
		const runtimeHost = await createRuntimeHost();

		void runtimeHost.session.prompt("hello");
		await vi.waitFor(() => expect(runtimeHost.session.isStreaming).toBe(true));
		const sessionAFile = runtimeHost.session.sessionFile!;

		await runtimeHost.newSession();
		expect(runtimeHost.getSessionsStatus().some((s) => s.active && s.sessionFile === sessionAFile)).toBe(false);

		// Switch back to A while its turn is still streaming.
		const switchResult = await runtimeHost.switchSession(sessionAFile);
		expect(switchResult.cancelled).toBe(false);
		expect(switchResult.reattached).toBe(true);
		expect(switchResult.snapshot?.running).toBe(true);
		expect(runtimeHost.session.sessionFile).toBe(sessionAFile);
		expect(runtimeHost.session.isStreaming).toBe(true);

		// The same live runtime is active again — A re-attached; B stays in the
		// registry (idle, keep-alive).
		const statuses = runtimeHost.getSessionsStatus();
		expect(statuses).toHaveLength(2);
		expect(statuses.find((s) => s.sessionFile === sessionAFile)?.running).toBe(true);
		expect(statuses.find((s) => s.active)?.sessionFile).toBe(sessionAFile);

		// The turn still completes and lands in the re-attached session.
		resolvers[0]?.("done");
		await vi.waitFor(() => expect(runtimeHost.session.isStreaming).toBe(false));
		expect(
			runtimeHost.session.messages.some((m) => m.role === "assistant" && JSON.stringify(m).includes("done")),
		).toBe(true);
	});

	it("abortSession aborts a detached (background) turn", async () => {
		const runtimeHost = await createRuntimeHost();

		void runtimeHost.session.prompt("hello");
		await vi.waitFor(() => expect(runtimeHost.session.isStreaming).toBe(true));
		const sessionAFile = runtimeHost.session.sessionFile!;

		await runtimeHost.newSession();
		expect(runtimeHost.getSessionsStatus().some((s) => s.sessionFile === sessionAFile)).toBe(true);

		// Fire the abort without awaiting: the faux stream is parked on an
		// unresolved promise, so settle it right after to let the abort
		// propagate through the loop. Phase 2 keep-alive: the aborted runtime
		// settles into an idle registry entry (not reaped) until the idle
		// timeout.
		const abortPromise = runtimeHost.abortSession(sessionAFile);
		resolvers[0]?.("aborted");
		const found = await abortPromise;
		expect(found).toBe(true);
		await vi.waitFor(() => {
			const a = runtimeHost.getSessionsStatus().find((s) => s.sessionFile === sessionAFile);
			expect(a?.running).toBe(false);
		});
	});

	it("getSessionForPath resolves detached sessions for session-scoped commands", async () => {
		const runtimeHost = await createRuntimeHost();

		// Session A: start a turn and switch away while it streams (detached).
		void runtimeHost.session.prompt("first");
		await vi.waitFor(() => expect(runtimeHost.session.isStreaming).toBe(true));
		const sessionAFile = runtimeHost.session.sessionFile!;

		await runtimeHost.newSession();
		// Let A's turn finish in the background — it settles into an idle
		// registry entry (Phase 2 keep-alive), still addressable.
		resolvers[0]?.("done");
		await vi.waitFor(() => {
			const a = runtimeHost.getSessionsStatus().find((s) => s.sessionFile === sessionAFile);
			expect(a?.running).toBe(false);
		});

		// Session-scoped resolution finds the detached runtime for A's path...
		const target = runtimeHost.getSessionForPath(sessionAFile);
		expect(target?.sessionFile).toBe(sessionAFile);
		// ...and the ACTIVE session when omitted or matched.
		expect(runtimeHost.getSessionForPath()).toBe(runtimeHost.session);
		expect(runtimeHost.getSessionForPath(runtimeHost.session.sessionFile ?? undefined)).toBe(runtimeHost.session);

		// Prompt the background session: it starts streaming again in the background.
		void target?.prompt("background prompt");
		await vi.waitFor(() => {
			const a = runtimeHost.getSessionsStatus().find((s) => s.sessionFile === sessionAFile);
			expect(a?.running).toBe(true);
		});
		resolvers[1]?.("done too");
		await vi.waitFor(() => {
			const a = runtimeHost.getSessionsStatus().find((s) => s.sessionFile === sessionAFile);
			expect(a?.running).toBe(false);
		});
	});

	it("newSession({ cwd }) hosts a session from another project (Phase 3 multi-project)", async () => {
		const runtimeHost = await createRuntimeHost();
		const projectB = `${runtimeHost.services.cwd}-project-b`;
		mkdirSync(projectB, { recursive: true });

		// Start a turn on project A, then start a new session in project B.
		void runtimeHost.session.prompt("hello from A");
		await vi.waitFor(() => expect(runtimeHost.session.isStreaming).toBe(true));
		const sessionAFile = runtimeHost.session.sessionFile!;

		const result = await runtimeHost.newSession({ cwd: projectB });
		expect(result.cancelled).toBe(false);

		// The new runtime lives in project B: its cwd and session file follow
		// the project's encoded session dir.
		expect(runtimeHost.session.cwd).toBe(projectB);
		expect(runtimeHost.session.sessionFile?.includes("--")).toBe(true);
		expect(runtimeHost.session.sessionFile?.startsWith(projectB.replace(/^\//, ""))).toBe(false); // sanity
		const sessionBFile = runtimeHost.session.sessionFile!;
		expect(sessionBFile).not.toBe(sessionAFile);

		// Project A's runtime is detached but still streaming.
		const statuses = runtimeHost.getSessionsStatus();
		expect(statuses).toHaveLength(2);
		const statusA = statuses.find((s) => s.sessionFile === sessionAFile);
		expect(statusA?.running).toBe(true);
		expect(statusA?.active).toBe(false);
		const statusB = statuses.find((s) => s.sessionFile === sessionBFile);
		expect(statusB?.active).toBe(true);

		// Finish A's turn, then switch back to project A's session.
		resolvers[0]?.("done from A");
		await vi.waitFor(() => {
			expect(runtimeHost.getSessionsStatus().find((s) => s.sessionFile === sessionAFile)?.running).toBe(false);
		});
		await runtimeHost.switchSession(sessionAFile);
		expect(runtimeHost.session.cwd).toBe(projectB.replace(/-project-b$/, ""));
		expect(runtimeHost.session.sessionFile).toBe(sessionAFile);

		// Project B's runtime detached idle and is still addressable.
		expect(runtimeHost.getSessionForPath(sessionBFile)?.sessionFile).toBe(sessionBFile);
	});

	it("abortSession returns false for unknown session paths", async () => {
		const runtimeHost = await createRuntimeHost();
		const found = await runtimeHost.abortSession("/nonexistent/session.jsonl");
		expect(found).toBe(false);
	});
});
