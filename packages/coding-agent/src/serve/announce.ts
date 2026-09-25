/**
 * mDNS announce for the serve bridge (doc 04 §5.1).
 *
 * Advertises `_a-coder._tcp` so phones on the LAN can discover the bridge.
 * TXT records carry the metadata the app needs to connect (path, versioning,
 * machine id) — never the token itself.
 */

import { Bonjour } from "bonjour-service";

export interface AnnounceOptions {
	name: string;
	port: number;
	machineId: string;
}

export class BridgeAnnounce {
	private bonjour: Bonjour | undefined;

	start(options: AnnounceOptions): void {
		try {
			this.bonjour = new Bonjour();
			this.bonjour.publish({
				name: options.name,
				port: options.port,
				type: "a-coder",
				txt: {
					v: "1",
					path: "/rpc",
					tokenReq: "1",
					engine: "a-coder-cli",
					id: options.machineId,
				},
			});
		} catch (error) {
			// Discovery is best-effort; manual pairing always works.
			process.stderr.write(
				`[serve] mDNS announce failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			this.bonjour = undefined;
		}
	}

	stop(): void {
		try {
			this.bonjour?.unpublishAll(() => {
				this.bonjour?.destroy();
			});
		} catch {
			// best effort
		}
		this.bonjour = undefined;
	}
}
