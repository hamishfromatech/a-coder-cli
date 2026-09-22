import { beforeEach, describe, expect, it } from "vitest";
import { adoptSwitchResult } from "./adopt-session";
import { isAuthoritativeSession, resetAuthoritativeSession } from "./session-authority";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";

describe("adoptSwitchResult", () => {
	beforeEach(() => {
		resetAuthoritativeSession();
		useSessionStore.getState().resetSession();
		useWorkspaceStore.getState().setCurrent("/home/user/project-a");
	});

	it("applies the switch response's identity, name, and workspace", () => {
		adoptSwitchResult({
			cancelled: false,
			sessionFile: "/s/b.jsonl",
			sessionId: "sess-b",
			sessionName: "Build app",
			cwd: "/home/user/project-b",
		});
		const store = useSessionStore.getState();
		expect(store.sessionFile).toBe("/s/b.jsonl");
		expect(store.sessionId).toBe("sess-b");
		expect(store.sessionName).toBe("Build app");
		expect(store.cwd).toBe("/home/user/project-b");
		expect(isAuthoritativeSession("/s/b.jsonl")).toBe(true);
		// Workspace indicator follows the session's own workspace.
		expect(useWorkspaceStore.getState().current).toBe("/home/user/project-b");
	});

	it("clears the name for an unnamed session without inheriting the previous one", () => {
		useSessionStore.getState().setSessionName("Stale name");
		adoptSwitchResult({
			cancelled: false,
			sessionFile: "/s/c.jsonl",
			sessionName: null,
			cwd: "/home/user/project-a",
		});
		expect(useSessionStore.getState().sessionName).toBeNull();
	});

	it("does nothing for a cancelled switch", () => {
		useSessionStore.getState().setSessionFile("/s/keep.jsonl");
		adoptSwitchResult({ cancelled: true });
		expect(useSessionStore.getState().sessionFile).toBe("/s/keep.jsonl");
	});
});