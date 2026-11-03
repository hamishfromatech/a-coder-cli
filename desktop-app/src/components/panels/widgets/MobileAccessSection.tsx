import {
	AlertCircle,
	Check,
	ChevronDown,
	Copy,
	Eye,
	EyeOff,
	KeyRound,
	Loader2,
	Radio,
	RefreshCw,
	ShieldCheck,
	ShieldOff,
	Smartphone,
	Square,
	Trash2,
	Wifi,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
	bridgeStatus,
	buildPairingPayload,
	maskToken,
	manualChunks,
	onServeExit,
	onServeInfo,
	onServeLine,
	parseServeBannerLine,
	platformLabel,
	relativeTime,
	serveDevices,
	serveInfo,
	serveRemoveDevice,
	serveStart,
	serveStop,
	STOPPED_SNAPSHOT,
	type ServeBanner,
	type ServeDevice,
	type ServeRegistry,
	type ServeSnapshot,
} from "../../../lib/serve";
import { useConfirmStore } from "../../../stores/confirm-store";
import { useToastStore } from "../../../stores/toast-store";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import { Badge, StatusDot } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardHeader, EmptyState } from "../../ui/Card";

const EMPTY_BANNER: ServeBanner = {
	endpoint: null,
	token: null,
	manual: null,
	name: null,
	tls: false,
	pin: null,
};
const LOG_LINES = 12;
const DEVICE_POLL_MS = 5_000;

type Busy = "start" | "stop" | "rotate" | `remove:${string}` | "refresh" | null;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-4xs font-medium uppercase tracking-wide text-pi-text-faint">{label}</div>
			<div className="mt-0.5 truncate text-2xs text-pi-text">{children}</div>
		</div>
	);
}

function DeviceRow({
	device,
	busy,
	onRemove,
}: {
	device: ServeDevice;
	busy: Busy;
	onRemove: (device: ServeDevice) => void;
}) {
	const lastSeen = relativeTime(device.lastSeen);
	const added = relativeTime(device.addedAt);
	const platform = platformLabel(device.platform);
	const removing = busy === `remove:${device.id}`;
	return (
		<div className="flex items-center gap-3 px-3.5 py-2.5">
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pi-surface-overlay text-pi-text-muted">
				<Smartphone className="h-3.5 w-3.5" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-2xs font-medium text-pi-text">{device.name}</span>
					{platform && (
						<Badge variant="outline" size="sm">
							{platform}
						</Badge>
					)}
				</div>
				<div className="mt-0.5 truncate text-4xs text-pi-text-faint">
					{lastSeen ? `Last seen ${lastSeen}` : "Not seen yet"}
					{added ? ` · Added ${added}` : ""}
				</div>
			</div>
			<Button
				variant="ghost-danger"
				size="icon-sm"
				icon={removing ? Loader2 : Trash2}
				loading={removing}
				onClick={() => onRemove(device)}
				disabled={busy !== null}
				aria-label={`Remove ${device.name}`}
				title={`Remove ${device.name}`}
			/>
		</div>
	);
}

/**
 * Mobile access settings section. Starts/stops `a-coder-cli serve` for the
 * current workspace, shows the pairing QR + masked manual token, lists the
 * devices recorded in the bridge registry, and can rotate the pairing token.
 *
 * The bridge owns the token and registry. Rotating restarts `serve --rotate`,
 * which disconnects existing clients; their old token is rejected with 401 on
 * the next connection.
 */
export function MobileAccessSection() {
	const workspace = useWorkspaceStore((w) => w.current);
	const ask = useConfirmStore((s) => s.ask);
	const pushToast = useToastStore((s) => s.push);

	const [info, setInfo] = useState<ServeSnapshot>(STOPPED_SNAPSHOT);
	const [registry, setRegistry] = useState<ServeRegistry | null>(null);
	const [banner, setBanner] = useState<ServeBanner>(EMPTY_BANNER);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [logs, setLogs] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<Busy>(null);
	const [revealed, setRevealed] = useState(false);
	const [copied, setCopied] = useState<"token" | "pin" | null>(null);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const status = bridgeStatus(info);
	const running = status !== "stopped";
	const token = info.token ?? banner.token;
	const manual = info.manual ?? banner.manual ?? (token ? manualChunks(token) : null);
	const name = info.name ?? banner.name;
	const endpoint = info.endpoint ?? banner.endpoint;
	const tls = info.tls || banner.tls;
	const pin = info.pin ?? banner.pin;

	const refreshInfo = useCallback(async () => {
		try {
			const next = await serveInfo();
			setInfo(next);
			if (!next.running) setBanner(EMPTY_BANNER);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);

	const refreshDevices = useCallback(async () => {
		try {
			setRegistry(await serveDevices());
		} catch (e) {
			setRegistry({ available: false, path: "", devices: [], error: e instanceof Error ? e.message : String(e) });
		}
	}, []);

	useEffect(() => {
		void refreshInfo();
		void refreshDevices();
		let disposed = false;
		const unlisteners: Promise<() => void>[] = [];
		unlisteners.push(
			onServeInfo((snapshot) => {
				if (!disposed) setInfo(snapshot);
			}),
			onServeLine((line) => {
				if (disposed) return;
				setLogs((prev) => [...prev.slice(-(LOG_LINES - 1)), line]);
				setBanner((current) => parseServeBannerLine(current, line));
			}),
			onServeExit(() => {
				if (disposed) return;
				setInfo(STOPPED_SNAPSHOT);
				setBanner(EMPTY_BANNER);
				setQrDataUrl(null);
				setRevealed(false);
				void refreshDevices();
			}),
		);
		return () => {
			disposed = true;
			for (const pending of unlisteners) {
				void pending.then((unlisten) => unlisten()).catch(() => {});
			}
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		};
	}, [refreshDevices, refreshInfo]);

	// Device records are written by the bridge on pairing, so poll while the
	// card is open instead of requiring a manual refresh.
	useEffect(() => {
		const timer = setInterval(() => void refreshDevices(), DEVICE_POLL_MS);
		return () => clearInterval(timer);
	}, [refreshDevices]);

	// Build the QR from whichever pairing values are freshest (Rust snapshot
	// first, streamed banner as a fallback).
	useEffect(() => {
		let cancelled = false;
		const payloadBanner = {
			endpoint,
			token,
			name,
			pin,
			tls,
		};
		void buildPairingPayload(payloadBanner).then(async (payload) => {
			if (!payload || cancelled) {
				if (!payload && !cancelled) setQrDataUrl(null);
				return;
			}
			try {
				const url = await QRCode.toDataURL(JSON.stringify(payload), { width: 200, margin: 1 });
				if (!cancelled) setQrDataUrl(url);
			} catch {
				if (!cancelled) setQrDataUrl(null);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [endpoint, token, name, pin, tls]);

	async function handleStart(): Promise<void> {
		if (!workspace) return;
		setBusy("start");
		setError(null);
		setBanner(EMPTY_BANNER);
		setQrDataUrl(null);
		setLogs([]);
		try {
			await serveStart(workspace);
			await refreshInfo();
			void refreshDevices();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	async function handleStop(): Promise<void> {
		setBusy("stop");
		setError(null);
		try {
			await serveStop();
			setInfo(STOPPED_SNAPSHOT);
			setBanner(EMPTY_BANNER);
			setQrDataUrl(null);
			setRevealed(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	async function handleRotate(): Promise<void> {
		if (!workspace) return;
		setError(null);
		const done = await ask({
			title: "Rotate the pairing token?",
			message:
				"Every paired device loses access. The bridge restarts with a new token, so the QR and manual code change and old clients are rejected with 401 on reconnect.",
			confirmLabel: "Rotate token",
			danger: true,
			onConfirm: async () => {
				setBusy("rotate");
				try {
					if (running) await serveStop();
					await serveStart(workspace, undefined, true);
					await refreshInfo();
				} finally {
					setBusy(null);
				}
			},
		});
		if (done) {
			setRevealed(false);
			setQrDataUrl(null);
			void refreshDevices();
			pushToast({ kind: "success", title: "Pairing token rotated", message: "Old clients must pair again." });
		}
	}

	async function handleRemove(device: ServeDevice): Promise<void> {
		setError(null);
		const done = await ask({
			title: `Remove ${device.name}?`,
			message:
				"This clears the device's record from the pairing registry. To revoke a credential that is already paired, rotate the pairing token.",
			confirmLabel: "Remove device",
			danger: true,
			onConfirm: async () => {
				setBusy(`remove:${device.id}`);
				try {
					setRegistry(await serveRemoveDevice(device.id));
				} finally {
					setBusy(null);
				}
			},
		});
		if (done) pushToast({ kind: "success", title: "Device removed", message: device.name });
	}

	function copyText(value: string, kind: "token" | "pin"): void {
		void navigator.clipboard.writeText(value).then(() => {
			setCopied(kind);
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
			copiedTimer.current = setTimeout(() => setCopied(null), 1_500);
		});
	}

	const devices = registry?.devices ?? [];
	const deviceCount = devices.length;
	const securityLabel = tls ? (pin ? "TLS · pinned" : "TLS") : "Plain ws";
	const statusTone = status === "running" ? "success" : status === "starting" ? "warning" : "muted";

	const qrPayloadReady = Boolean(qrDataUrl);
	const deviceSummary = useMemo(() => {
		if (!registry) return "Loading…";
		if (!registry.available) return "No registry yet";
		if (deviceCount === 0) return "No devices";
		return `${deviceCount} device${deviceCount === 1 ? "" : "s"}`;
	}, [registry, deviceCount]);

	return (
		<section className="space-y-3">
			<header>
				<h2 className="text-[15px] font-semibold tracking-tight">Mobile access</h2>
				<p className="mt-0.5 text-2xs text-pi-text-muted">
					Pair the A-Coder mobile app to this workspace over your local network. The bridge runs the same engine
					in a separate session.
				</p>
			</header>

			<Card>
				<CardHeader className="flex items-center gap-2 py-2.5">
					<Smartphone className="h-4 w-4 text-pi-text-muted" />
					<h3 className="text-xs font-semibold text-pi-text">Bridge</h3>
					<span className="ml-auto inline-flex items-center gap-1.5 text-2xs text-pi-text-muted">
						<StatusDot variant={statusTone} />
						{status === "running" ? "Running" : status === "starting" ? "Starting…" : "Stopped"}
					</span>
				</CardHeader>
				<CardBody className="space-y-3 py-3">
					{!workspace ? (
						<p className="text-2xs text-pi-text-muted">Open a workspace first.</p>
					) : (
						<>
							<div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
								<Stat label="Port">
									{info.port ? <span className="font-mono">{info.port}</span> : "—"}
								</Stat>
								<Stat label="Security">
									<span className="inline-flex items-center gap-1">
										{tls ? (
											<ShieldCheck className="h-3 w-3 text-pi-success" />
										) : (
											<ShieldOff className="h-3 w-3 text-pi-text-faint" />
										)}
										{securityLabel}
									</span>
								</Stat>
								<Stat label="Endpoint">
									{endpoint ? <span className="font-mono">{endpoint}</span> : "—"}
								</Stat>
								<Stat label="Announced as">{name ?? "—"}</Stat>
							</div>

							{pin && (
								<div className="flex items-center gap-2 rounded-md bg-pi-surface-overlay px-2.5 py-1.5">
									<ShieldCheck className="h-3 w-3 shrink-0 text-pi-success" />
									<span className="text-4xs text-pi-text-faint">Certificate pin</span>
									<code className="min-w-0 flex-1 truncate font-mono text-4xs text-pi-text-muted">
										{pin}
									</code>
									<Button
										variant="ghost"
										size="xs"
										icon={copied === "pin" ? Check : Copy}
										onClick={() => copyText(pin, "pin")}
										aria-label="Copy certificate pin"
									>
										{copied === "pin" ? "Copied" : "Copy"}
									</Button>
								</div>
							)}

							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant={running ? "secondary" : "primary"}
									size="sm"
									icon={busy === "start" ? Loader2 : running ? Square : Radio}
									loading={busy === "start" || busy === "stop"}
									onClick={() => void (running ? handleStop() : handleStart())}
									disabled={busy !== null}
								>
									{running ? "Stop bridge" : "Start bridge"}
								</Button>
								{token && (
									<Button
										variant="ghost-danger"
										size="sm"
										icon={busy === "rotate" ? Loader2 : KeyRound}
										loading={busy === "rotate"}
										onClick={() => void handleRotate()}
										disabled={busy !== null}
									>
										Rotate token
									</Button>
								)}
							</div>
						</>
					)}

					{error && (
						<p className="flex items-start gap-1.5 text-2xs text-pi-error">
							<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span className="break-all">{error}</span>
						</p>
					)}
				</CardBody>
			</Card>

			{token && (
				<Card>
					<CardHeader className="flex items-center gap-2 py-2.5">
						<Wifi className="h-4 w-4 text-pi-text-muted" />
						<h3 className="text-xs font-semibold text-pi-text">Pair a phone</h3>
						{status === "starting" && (
							<span className="ml-auto text-2xs text-pi-text-faint">Waiting for the bridge banner…</span>
						)}
					</CardHeader>
					<CardBody className="py-3">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
							<div className="flex h-[200px] w-[200px] shrink-0 items-center justify-center rounded-lg bg-white p-1.5">
								{qrPayloadReady ? (
									<img src={qrDataUrl ?? ""} alt="Pairing QR code" className="h-full w-full" />
								) : (
									<div className="flex flex-col items-center gap-1.5 text-pi-text-faint">
										<Loader2 className="h-4 w-4 animate-spin" />
										<span className="text-4xs">Building QR…</span>
									</div>
								)}
							</div>
							<div className="min-w-0 flex-1 space-y-3">
								<div>
									<div className="text-4xs font-medium uppercase tracking-wide text-pi-text-faint">
										Manual code
									</div>
									<div className="mt-1 flex items-center gap-2">
										<code className="min-w-0 flex-1 truncate rounded-md bg-pi-surface-overlay px-2 py-1.5 font-mono text-2xs text-pi-text">
											{revealed ? (manual ?? token) : maskToken(token)}
										</code>
										<Button
											variant="ghost"
											size="icon-sm"
											icon={revealed ? EyeOff : Eye}
											onClick={() => setRevealed((value) => !value)}
											aria-label={revealed ? "Hide pairing token" : "Reveal pairing token"}
											title={revealed ? "Hide token" : "Reveal token"}
										/>
										<Button
											variant="ghost"
											size="icon-sm"
											icon={copied === "token" ? Check : Copy}
											onClick={() => copyText(token, "token")}
											aria-label="Copy pairing token"
											title="Copy token"
										/>
									</div>
									<p className="mt-1.5 text-4xs leading-relaxed text-pi-text-faint">
										Scan the QR with A-Coder Mobile, or type the four groups manually. The QR contains the
										pairing token.
									</p>
								</div>
								<p className="text-4xs leading-relaxed text-pi-text-faint">
									Both devices must be on the same network (or connected through a VPN such as Tailscale).
									macOS may ask you to allow incoming connections the first time the bridge starts.
								</p>
							</div>
						</div>
					</CardBody>
				</Card>
			)}

			<Card>
				<CardHeader className="flex items-center gap-2 py-2.5">
					<Smartphone className="h-4 w-4 text-pi-text-muted" />
					<h3 className="text-xs font-semibold text-pi-text">Devices</h3>
					<span className="text-2xs text-pi-text-faint">{deviceSummary}</span>
					<Button
						variant="ghost"
						size="icon-sm"
						className="ml-auto"
						icon={busy === "refresh" ? Loader2 : RefreshCw}
						loading={busy === "refresh"}
						onClick={() => {
							setBusy("refresh");
							void refreshDevices().finally(() => setBusy(null));
						}}
						disabled={busy !== null}
						aria-label="Refresh device list"
						title="Refresh"
					/>
				</CardHeader>
				<CardBody className="p-0">
					{registry?.error && (
						<p className="flex items-start gap-1.5 px-3.5 py-2.5 text-2xs text-pi-error">
							<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span className="break-all">{registry.error}</span>
						</p>
					)}
					{!registry?.error && !registry?.available && (
						<EmptyState
							icon={Smartphone}
							title="No device registry yet"
							description={`Devices appear here after the bridge records a pairing in ${registry?.path || "serve/clients.json"}.`}
						/>
					)}
					{!registry?.error && registry?.available && deviceCount === 0 && (
						<EmptyState
							icon={Smartphone}
							title="No devices recorded"
							description="Scan the QR from a phone. The bridge adds it to the registry on first connect."
						/>
					)}
					{deviceCount > 0 && (
						<div className="divide-y divide-pi-border">
							{devices.map((device) => (
								<DeviceRow key={device.id} device={device} busy={busy} onRemove={(d) => void handleRemove(d)} />
							))}
						</div>
					)}
					<p className="border-t border-pi-border px-3.5 py-2 text-4xs leading-relaxed text-pi-text-faint">
						Removing a device clears its registry record. Rotate the token to invalidate credentials that are
						already paired.
					</p>
				</CardBody>
			</Card>

			{logs.length > 0 && (
				<details className="group rounded-lg bg-pi-surface-raised shadow-ring">
					<summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2 text-2xs text-pi-text-muted">
						<ChevronDown className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0" />
						Bridge log
						<span className="text-pi-text-faint">({logs.length})</span>
					</summary>
					<div className="max-h-36 overflow-y-auto border-t border-pi-border p-2 font-mono text-4xs leading-relaxed text-pi-text-faint">
						{logs.map((line, i) => (
							<div key={`${i}-${line.slice(0, 16)}`} className="break-all">
								{line}
							</div>
						))}
					</div>
				</details>
			)}
		</section>
	);
}
