import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
	spawn: (...callArgs: unknown[]) => {
		const child = {
			once: vi.fn(),
		};
		spawnMock(...callArgs);
		// Fire the spawn event on the next tick so relaunchSelf proceeds to
		// process.exit(0) without the 5s safety timer.
		queueMicrotask(() => {
			const once = (child.once as ReturnType<typeof vi.fn>).mock;
			const handler = once?.calls[0]?.[1] as (() => void) | undefined;
			handler?.();
		});
		return child;
	},
}));

const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
void exitSpy;

const { relaunchSelf } = await import("../src/utils/cli-self-update.ts");

describe("relaunchSelf", () => {
	afterEach(() => {
		spawnMock.mockClear();
		vi.unstubAllGlobals();
	});

	it("relaunches via execPath with user args for a bun-compiled binary (stale $bunfs entry dropped)", () => {
		const originalArgv = process.argv;
		vi.stubGlobal("process", { ...process, argv: ["bun", "/$bunfs/root/pi-local", "--model", "glm"] });
		relaunchSelf();
		expect(spawnMock).toHaveBeenCalledWith(process.execPath, ["--model", "glm"], { stdio: "inherit" });
		vi.stubGlobal("process", { ...process, argv: originalArgv });
	});

	it("relaunches node-style argv unchanged (node, script, args)", () => {
		relaunchSelf();
		expect(spawnMock).toHaveBeenCalledWith(process.execPath, process.argv.slice(1), { stdio: "inherit" });
	});

	it("relaunches bun runtime scripts unchanged", () => {
		const originalArgv = process.argv;
		vi.stubGlobal("process", { ...process, argv: ["bun", "/some/cli.js", "--foo"] });
		relaunchSelf();
		expect(spawnMock).toHaveBeenCalledWith(process.execPath, ["/some/cli.js", "--foo"], { stdio: "inherit" });
		vi.stubGlobal("process", { ...process, argv: originalArgv });
	});
});
