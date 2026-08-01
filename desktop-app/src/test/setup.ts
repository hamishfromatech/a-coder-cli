import { vi } from "vitest";

// Mock Tauri APIs
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
	save: vi.fn(),
}));

// Mock window.dispatchEvent
const originalDispatchEvent = window.dispatchEvent;
window.dispatchEvent = vi.fn((event: Event) => {
	return originalDispatchEvent(event);
});

// Mock navigator.clipboard
Object.assign(navigator, {
	clipboard: {
		writeText: vi.fn().mockResolvedValue(undefined),
	},
});