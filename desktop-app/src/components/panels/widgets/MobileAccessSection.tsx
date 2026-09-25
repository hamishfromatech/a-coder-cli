import { AlertCircle, Check, Copy, Loader2, Smartphone, Square } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
	buildPairingPayload,
	onServeExit,
	onServeLine,
	parseServeBannerLine,
	serveStart,
	serveStatus,
	serveStop,
	type ServeBanner,
} from "../../../lib/serve";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardHeader } from "../../ui/Card";

const EMPTY_BANNER: ServeBanner = { endpoint: null, token: null, manual: null, name: null };
const LOG_LINES = 8;

/**
 * Mobile access settings section. Starts/stops `a-coder-cli serve` for the
 * current workspace via the tauri serve commands and renders the pairing QR
 * from the banner the CLI prints on stderr.
 */
export function MobileAccessSection() {
	const workspace = useWorkspaceStore((w) => w.current);
	const [running, setRunning] = useState(false);
	const [busy, setBusy] = useState(false);
	const [banner, setBanner] = useState<ServeBanner>(EMPTY_BANNER);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [logs, setLogs] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		void serveStatus().then(setRunning).catch(() => {});
		const unlistenLine = onServeLine((line) => {
			setLogs((prev) => [...prev.slice(-(LOG_LINES - 1)), line]);
			setBanner((current) => parseServeBannerLine(current, line));
		});
		const unlistenExit = onServeExit(() => {
			setRunning(false);
			setBanner(EMPTY_BANNER);
			setQrDataUrl(null);
		});
		return () => {
			void unlistenLine.then((fn) => fn()).catch(() => {});
			void unlistenExit.then((fn) => fn()).catch(() => {});
		};
	}, []);

	// Re-render the QR whenever the banner completes.
	useEffect(() => {
		let cancelled = false;
		void buildPairingPayload(banner).then(async (payload) => {
			if (!payload || cancelled) {
				return;
			}
			const url = await QRCode.toDataURL(JSON.stringify(payload), { width: 180, margin: 1 });
			if (!cancelled) setQrDataUrl(url);
		});
		return () => {
			cancelled = true;
		};
	}, [banner]);

	async function handleStart(): Promise<void> {
		if (!workspace) return;
		setBusy(true);
		setError(null);
		setBanner(EMPTY_BANNER);
		setQrDataUrl(null);
		setLogs([]);
		try {
			await serveStart(workspace);
			setRunning(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function handleStop(): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			await serveStop();
			setRunning(false);
			setBanner(EMPTY_BANNER);
			setQrDataUrl(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	function handleCopy(): void {
		if (!banner.token) return;
		void navigator.clipboard.writeText(banner.token).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}

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
					<span className={`ml-auto text-2xs ${running ? "text-pi-success" : "text-pi-text-faint"}`}>
						{running ? "Running" : "Stopped"}
					</span>
				</CardHeader>
				<CardBody className="space-y-3 py-3">
					{!workspace ? (
						<p className="text-2xs text-pi-text-muted">Open a workspace first.</p>
					) : (
						<div className="flex items-center gap-2">
							<Button
								variant={running ? "secondary" : "primary"}
								size="sm"
								icon={busy ? Loader2 : running ? Square : Smartphone}
								loading={busy}
								onClick={() => void (running ? handleStop() : handleStart())}
								disabled={busy}
							>
								{running ? "Stop bridge" : "Start bridge"}
							</Button>
							{banner.endpoint && <span className="font-mono text-2xs text-pi-text-muted">{banner.endpoint}</span>}
						</div>
					)}

					{running && banner.token && (
						<div className="flex items-start gap-4 rounded-lg bg-pi-surface-raised px-4 py-3 shadow-ring">
							{qrDataUrl && <img src={qrDataUrl} alt="Pairing QR code" className="h-[180px] w-[180px] rounded-md bg-white p-1" />}
							<div className="min-w-0 space-y-2">
								<p className="text-2xs text-pi-text-muted">Scan with A-Coder Mobile, or enter the token manually:</p>
								<div className="flex items-center gap-2">
									<code className="truncate font-mono text-2xs text-pi-text">{banner.manual ?? banner.token}</code>
									<Button
										variant="ghost"
										size="sm"
										icon={copied ? Check : Copy}
										onClick={() => handleCopy()}
										aria-label="Copy pairing token"
									>
										{copied ? "Copied" : "Copy"}
									</Button>
								</div>
								<p className="text-2xs text-pi-text-faint">
									Both devices must be on the same network (or connected via VPN such as Tailscale).
								</p>
							</div>
						</div>
					)}

					{error && (
						<p className="flex items-start gap-1.5 text-2xs text-pi-error">
							<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span className="break-all">{error}</span>
						</p>
					)}

					{logs.length > 0 && (
						<div className="max-h-28 overflow-y-auto rounded bg-black/20 p-2 font-mono text-2xs leading-relaxed text-pi-text-faint">
							{logs.map((line, i) => (
								<div key={`${i}-${line.slice(0, 12)}`} className="break-all">
									{line}
								</div>
							))}
						</div>
					)}
				</CardBody>
			</Card>
		</section>
	);
}