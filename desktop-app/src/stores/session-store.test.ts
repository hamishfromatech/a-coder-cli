import { describe, it, expect, vi } from "vitest";

// Mock the modules before importing the store
vi.mock("@theatechcorporation/pi-agent-core", () => ({
	AgentMessage: {},
}));

vi.mock("@theatechcorporation/pi-ai", () => ({
	AssistantMessage: {},
	Api: {},
	Model: {},
}));

// Now import the store
import { useSessionStore } from "./session-store";

describe("session-store", () => {
	describe("initial state", () => {
		it("has correct default values", () => {
			// Create a fresh store instance by getting the initial state
			const state = useSessionStore.getState();
			expect(state.status).toBe("idle");
			expect(state.error).toBeNull();
			expect(state.permissionMode).toBe("allow");
			expect(state.isStreaming).toBe(false);
			expect(state.messages).toEqual([]);
		});
	});

	describe("setters", () => {
		it("setStatus updates status and error", () => {
			const store = useSessionStore.getState();
			store.setStatus("connecting");
			expect(useSessionStore.getState().status).toBe("connecting");
			expect(useSessionStore.getState().error).toBeNull();

			store.setStatus("error", "Connection failed");
			expect(useSessionStore.getState().status).toBe("error");
			expect(useSessionStore.getState().error).toBe("Connection failed");

			store.setStatus("connected");
			expect(useSessionStore.getState().status).toBe("connected");
			expect(useSessionStore.getState().error).toBeNull();
		});

		it("setCwd updates cwd", () => {
			const store = useSessionStore.getState();
			store.setCwd("/new/project");
			expect(useSessionStore.getState().cwd).toBe("/new/project");
		});

		it("setModel updates model", () => {
			const store = useSessionStore.getState();
			const mockModel = { id: "test-model", provider: "test" } as any;
			store.setModel(mockModel);
			expect(useSessionStore.getState().model).toBe(mockModel);
		});

		it("setPermissionMode updates permission mode", () => {
			const store = useSessionStore.getState();
			store.setPermissionMode("ask");
			expect(useSessionStore.getState().permissionMode).toBe("ask");
			store.setPermissionMode("read-only");
			expect(useSessionStore.getState().permissionMode).toBe("read-only");
		});

		it("setIsStreaming updates streaming state", () => {
			const store = useSessionStore.getState();
			store.setIsStreaming(true);
			expect(useSessionStore.getState().isStreaming).toBe(true);
			store.setIsStreaming(false);
			expect(useSessionStore.getState().isStreaming).toBe(false);
		});
	});

	describe("message handling", () => {
		it("appendMessage adds message to array", () => {
			const store = useSessionStore.getState();
			store.resetSession(); // Start fresh
			const message = { role: "user", content: "Hello" } as any;
			store.appendMessage(message);
			expect(useSessionStore.getState().messages.length).toBe(1);
			expect(useSessionStore.getState().messages[0]).toBe(message);
		});

		it("setMessages replaces all messages", () => {
			const store = useSessionStore.getState();
			store.resetSession();
			const messages = [
				{ role: "user", content: "Hello" } as any,
				{ role: "assistant", content: "Hi there" } as any,
			];
			store.setMessages(messages);
			expect(useSessionStore.getState().messages).toEqual(messages);
		});

		it("updateLastAssistantMessage updates only last assistant message", () => {
			const store = useSessionStore.getState();
			store.resetSession();
			const messages = [
				{ role: "user", content: "Hello" } as any,
				{ role: "assistant", content: "Original" } as any,
			];
			store.setMessages(messages);

			const updatedMessage = {
				role: "assistant",
				content: "Updated",
			} as any;
			store.updateLastAssistantMessage(updatedMessage);

			const state = useSessionStore.getState();
			expect(state.messages.length).toBe(2);
			expect((state.messages[1] as any).content).toBe("Updated");
		});

		it("updateLastAssistantMessage does nothing if last message is not assistant", () => {
			const store = useSessionStore.getState();
			store.resetSession();
			const messages = [
				{ role: "user", content: "Hello" } as any,
				{ role: "user", content: "World" } as any,
			];
			store.setMessages(messages);

			const updatedMessage = {
				role: "assistant",
				content: "Updated",
			} as any;
			store.updateLastAssistantMessage(updatedMessage);

			expect((useSessionStore.getState().messages[1] as any).content).toBe("World");
		});

		it("updateLastAssistantMessage does nothing if no messages", () => {
			const store = useSessionStore.getState();
			store.resetSession();
			const updatedMessage = {
				role: "assistant",
				content: "Updated",
			} as any;
			store.updateLastAssistantMessage(updatedMessage);
			expect(useSessionStore.getState().messages.length).toBe(0);
		});
	});

	describe("resetSession", () => {
		it("clears all session data", () => {
			const store = useSessionStore.getState();

			// Set up some state
			store.setMessages([{ role: "user", content: "Test" } as any]);
			store.setSessionId("test-id");
			store.setSessionName("Test Session");
			store.setIsStreaming(true);
			store.setStatus("error", "Test error");

			// Reset
			store.resetSession();

			const state = useSessionStore.getState();
			expect(state.messages).toEqual([]);
			expect(state.sessionId).toBeNull();
			expect(state.sessionName).toBeNull();
			expect(state.sessionFile).toBeNull();
			expect(state.messageCount).toBe(0);
			expect(state.pendingMessageCount).toBe(0);
			expect(state.contextUsage).toBeNull();
			expect(state.isStreaming).toBe(false);
			expect(state.isCompacting).toBe(false);
			expect(state.error).toBeNull();
		});
	});

	describe("queue handling", () => {
		it("updateQueue updates steering and followUp", () => {
			const store = useSessionStore.getState();
			store.updateQueue(["steer1", "steer2"], ["follow1"]);
			expect(useSessionStore.getState().steering).toEqual(["steer1", "steer2"]);
			expect(useSessionStore.getState().followUp).toEqual(["follow1"]);
		});
	});

	describe("UI request handling", () => {
		it("addUiRequest adds request and returns promise", async () => {
			const store = useSessionStore.getState();
			// Clear any existing requests
			store.resolveUiRequest("clear-all", {});
			store.resetSession();

			const request = {
				id: "test-request",
				method: "confirm" as const,
				title: "Test",
			};

			const promise = store.addUiRequest(request);
			expect(useSessionStore.getState().uiRequests.length).toBeGreaterThanOrEqual(1);

			// Resolve the request
			store.resolveUiRequest("test-request", { confirmed: true });
			const result = await promise;
			expect(result.confirmed).toBe(true);
		});

		it("resolveUiRequest removes the request", async () => {
			const store = useSessionStore.getState();
			store.resetSession();

			// Add requests and resolve immediately
			store.addUiRequest({
				id: "req1",
				method: "confirm",
				title: "Test 1",
			});
			store.resolveUiRequest("req1", { confirmed: true });

			expect(useSessionStore.getState().uiRequests.find((r) => r.id === "req1")).toBeUndefined();
		});
	});

	describe("available commands", () => {
		it("setAvailableCommands updates commands list", () => {
			const store = useSessionStore.getState();
			const commands = [
				{
					name: "test",
					description: "Test command",
					source: "extension" as const,
					sourceInfo: null,
				},
			];
			store.setAvailableCommands(commands);
			expect(useSessionStore.getState().availableCommands).toEqual(commands);
		});
	});

	describe("context usage", () => {
		it("setContextUsage updates context usage", () => {
			const store = useSessionStore.getState();
			const usage = {
				tokens: 5000,
				contextWindow: 100000,
				percent: 5,
			};
			store.setContextUsage(usage);
			expect(useSessionStore.getState().contextUsage).toEqual(usage);
		});
	});
});