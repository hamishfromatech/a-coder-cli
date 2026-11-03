import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useConfirmStore } from "../../../stores/confirm-store";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import {
	STOPPED_SNAPSHOT,
	type ServeDevice,
	type ServeRegistry,
	type ServeSnapshot,
} from "../../../lib/serve";
import { MobileAccessSection } from "./MobileAccessSection";

vi.mock("qrcode", () => ({
	default: {
		toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr"),
	},
}));

vi.mock("../../../lib/serve", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../lib/serve")>();
	return {
		...actual,
		serveInfo: vi.fn(),
		serveDevices: vi.fn(),
		serveRemoveDevice: vi.fn(),
		serveStart: vi.fn(),
		serveStop: vi.fn(),
		onServeInfo: vi.fn(() => Promise.resolve(() => {})),
		onServeLine: vi.fn(() => Promise.resolve(() => {})),
		onServeExit: vi.fn(() => Promise.resolve(() => {})),
		buildPairingPayload: vi.fn(),
	};
});

import * as serve from "../../../lib/serve";

const mocked = serve as unknown as {
	serveInfo: Mock;
	serveDevices: Mock;
	serveRemoveDevice: Mock;
	serveStart: Mock;
	serveStop: Mock;
	onServeInfo: Mock;
	onServeLine: Mock;
	onServeExit: Mock;
	buildPairingPayload: Mock;
};

const TOKEN = "abcd1234efgh5678ijkl9012mnop3456qrst7890";
const MANUAL = "abcd1234-efgh5678-ijkl9012-mnop3456";

const RUNNING: ServeSnapshot = {
	running: true,
	starting: false,
	endpoint: "ws://192.168.1.20:8787",
	port: 8787,
	tls: false,
	pin: null,
	token: TOKEN,
	manual: MANUAL,
	name: "A-Coder on mac",
};

const DEVICE: ServeDevice = {
	id: "d1",
	name: "iPhone",
	platform: "ios",
	lastSeen: new Date().toISOString(),
	addedAt: new Date(Date.now() - 86_400_000).toISOString(),
};

function registryWith(devices: ServeDevice[]): ServeRegistry {
	return {
		available: true,
		path: "/tmp/serve/clients.json",
		devices,
		error: null,
	};
}

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function renderCard(): Promise<void> {
	await act(async () => {
		root.render(<MobileAccessSection />);
	});
	await flush();
}

function buttonByLabel(label: string): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
	if (!button) throw new Error(`No button with aria-label "${label}"`);
	return button;
}

function buttonByText(text: string): HTMLButtonElement {
	const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
		candidate.textContent?.includes(text),
	);
	if (!button) throw new Error(`No button containing "${text}"`);
	return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
	await act(async () => {
		button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await flush();
}

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	useWorkspaceStore.setState({ current: "/tmp/ws" });
	mocked.serveInfo.mockResolvedValue(STOPPED_SNAPSHOT);
	mocked.serveDevices.mockResolvedValue(registryWith([]));
	mocked.serveRemoveDevice.mockResolvedValue(registryWith([]));
	mocked.serveStart.mockResolvedValue(undefined);
	mocked.serveStop.mockResolvedValue(undefined);
	mocked.buildPairingPayload.mockResolvedValue({
		v: 1,
		kind: "acoder",
		host: "192.168.1.20",
		port: 8787,
		tls: false,
		token: TOKEN,
		name: "A-Coder on mac",
		id: "abcd1234",
	});
	// Run the confirmation action like the real confirm store would.
	const ask = vi.fn(async (options: { onConfirm?: () => Promise<void> | void }) => {
		await options.onConfirm?.();
		return true;
	});
	useConfirmStore.setState({ ask });
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	vi.clearAllMocks();
});

describe("MobileAccessSection", () => {
	it("shows a stopped bridge and the start action", async () => {
		mocked.serveDevices.mockResolvedValue({
			available: false,
			path: "/tmp/serve/clients.json",
			devices: [],
			error: null,
		});

		await renderCard();

		expect(container.textContent).toContain("Stopped");
		expect(container.textContent).toContain("Start bridge");
		expect(container.textContent).toContain("No device registry yet");
		expect(container.textContent).toContain("/tmp/serve/clients.json");
		expect(container.textContent).not.toContain("Manual code");
	});

	it("shows status, port and endpoint, masks the token, and reveals it on demand", async () => {
		mocked.serveInfo.mockResolvedValue(RUNNING);
		mocked.serveDevices.mockResolvedValue(registryWith([]));

		await renderCard();

		expect(container.textContent).toContain("Running");
		expect(container.textContent).toContain("8787");
		expect(container.textContent).toContain("ws://192.168.1.20:8787");
		expect(container.textContent).toContain("Plain ws");
		expect(container.textContent).toContain("Manual code");
		expect(container.textContent).toContain("abcd••••");
		expect(container.textContent).not.toContain(TOKEN);
		expect(container.querySelector("img[alt='Pairing QR code']")).not.toBeNull();

		await click(buttonByLabel("Reveal pairing token"));
		expect(container.textContent).toContain(MANUAL);

		await click(buttonByLabel("Copy pairing token"));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(TOKEN);

		await click(buttonByLabel("Hide pairing token"));
		expect(container.textContent).not.toContain(MANUAL);
	});

	it("lists registry devices and removes one", async () => {
		mocked.serveInfo.mockResolvedValue(RUNNING);
		mocked.serveDevices.mockResolvedValue(registryWith([DEVICE]));
		mocked.serveRemoveDevice.mockResolvedValue(registryWith([]));

		await renderCard();

		expect(container.textContent).toContain("iPhone");
		expect(container.textContent).toContain("iOS");
		expect(container.textContent).toContain("Last seen just now");

		await click(buttonByLabel("Remove iPhone"));

		expect(mocked.serveRemoveDevice).toHaveBeenCalledWith("d1");
		expect(container.textContent).not.toContain("iPhone");
	});

	it("rotates the token by stopping and restarting the bridge", async () => {
		mocked.serveInfo.mockResolvedValue(RUNNING);
		mocked.serveDevices.mockResolvedValue(registryWith([]));

		await renderCard();
		await click(buttonByText("Rotate token"));

		expect(mocked.serveStop).toHaveBeenCalledTimes(1);
		expect(mocked.serveStart).toHaveBeenCalledWith("/tmp/ws", undefined, true);
	});
});
