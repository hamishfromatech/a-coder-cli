# Mobile access (desktop Settings card)

Settings → **Mobile access** starts and stops the `a-coder-cli serve` bridge for
the current workspace, shows the pairing QR, and manages the paired-device
registry. It is desktop-only UI over the existing CLI; the card never changes
the engine protocol.

## What the card shows

| Area | Behaviour |
|---|---|
| **Bridge** | `Running` / `Starting…` / `Stopped`, actual port, endpoint, announced name, and `TLS` / `TLS · pinned` with the SHA-256 certificate pin when `serve --tls-cert/--tls-key` is active. |
| **Start / Stop** | Spawns or stops `a-coder-cli serve --cwd <workspace>`. Stop sends `SIGTERM` first and escalates to `SIGKILL` after 3 seconds, so the bridge can stop its engine cleanly. |
| **Pair a phone** | QR built from the live banner (`v:1`, `kind:acoder`, host, port, TLS + pin, token, name, machine id). The manual token is masked by default; **Reveal** shows the 4×8 manual groups and **Copy** always copies the real token. |
| **Devices** | Reads `serve/clients.json` from the bridge state directory. Each row shows name, platform, last seen, and added date; **Remove** deletes that record. The registry is polled every 5 seconds while the card is open. |
| **Rotate token** | Confirms, stops the bridge, restarts it with `serve --rotate`, and updates the QR/token. Existing sockets are closed by the restart; the old token gets **401** on reconnect. |

The banner is parsed in Rust and cached in `ServeState`, so closing and
reopening Settings does not lose the QR while the bridge is still running.

## Registry path and contract

The bridge state directory is `~/.a-coder/cli/agent/serve` (honouring
`A_CODER_CLI_CODING_AGENT_DIR`). Device records live in `clients.json`.

The desktop accepts either a top-level array or an object with a `devices`
array, and tolerates the field-name variants the bridge may use:

```json
{
  "version": 1,
  "devices": [
    {
      "id": "8f3a1c2d",
      "name": "iPhone",
      "platform": "ios",
      "lastSeen": "2026-11-04T10:42:00Z",
      "addedAt": "2026-11-01T09:15:00Z"
    }
  ]
}
```

Recognised aliases: `deviceName`/`device`/`label` for the name, `os`/`kind`
for the platform, `last_seen`/`lastConnected` for last seen, and
`added_at`/`pairedAt`/`createdAt` for the added time. Removing an entry
preserves every other key in the file.

**Bridge dependency:** per `mobile-app/plan/04 §5.3`, write-through of
`clients.json` and per-device revocation are bridge-side follow-ups. Until that
lands, a fresh install shows the "No device registry yet" empty state, and
**Remove** clears records that the bridge has written. Token rotation is the
only operation that revokes access today (old clients receive 401 on reconnect).

## Manual QA

Run against a workspace with the CLI available:

1. Open Settings → Mobile access. With no bridge running, confirm the card says
   `Stopped`, the start button is enabled, and the device card shows the
   registry path (or "No device registry yet").
2. Click **Start bridge**. Confirm the status moves to `Starting…` then
   `Running`, the port/endpoint appear, and the QR + masked manual code render.
3. Click **Reveal**: the 4×8 manual code appears. Click **Copy** and verify the
   clipboard holds the full token (compare with the `Pairing token:` line in
   the bridge log).
4. Scan the QR with A-Coder Mobile on the same network. Pairing should complete
   in under 30 seconds and the live transcript should sync.
5. Open Settings again while the bridge is running: the QR/token should still be
   there (cached banner), without restarting the bridge.
6. Click **Rotate token**, confirm. Confirm the bridge restarts with a new
   token, the QR changes, and the previously paired phone is disconnected; its
   next connection attempt is rejected with 401 until it re-pairs.
7. Click **Stop bridge**. Confirm the status returns to `Stopped` and the QR is
   cleared. Restart and confirm the persisted token is reused (no rotate).
8. If `clients.json` exists with records, confirm the list renders and **Remove**
   deletes only the selected record.

### Recorded result

Backend verification (2026-11-04, source CLI
`node packages/coding-agent/src/cli.ts serve`):

- Bridge started on `127.0.0.1:18788`; the banner carried the endpoint, token
  and 4x8 manual code.
- Correct token upgraded to `/rpc` (`open`).
- Restart with `--rotate` issued a new token; the previous token got
  `unexpected-response 401` and the new token connected.
- `serve/clients.json` is not written by the bridge yet (matching plan/04
  §5.3), so the card shows the empty registry state.

Desktop checks:

- `npx tsc --noEmit --project desktop-app/tsconfig.json` — clean.
- `cargo check --manifest-path desktop-app/src-tauri/Cargo.toml` — clean.
- `cargo test --manifest-path desktop-app/src-tauri/Cargo.toml serve::tests` —
  5 passed.
- `npx vitest run src/lib/serve.test.ts src/components/panels/widgets/MobileAccessSection.test.tsx`
  — 17 passed.

App-window pass (2026-11-04, macOS dev build; screenshots captured):

- Settings → Mobile access showed `Stopped`, the workspace's start action and
  the "No device registry yet" empty state.
- **Start bridge** moved to `Running` and filled in port `8787`, endpoint
  `ws://192.168.88.2:8787` and `A-Coder on Hamish's-Mac-Stud…`; the QR and
  masked manual code rendered.
- **Reveal** showed the 4×8 manual code; **Copy** copied the full token.
- **Rotate token** opened the confirmation, restarted the bridge, and changed
  the persisted token (`dcXt…` → `Ztd0…`); the QR changed with it.
- A synthetic `clients.json` entry rendered as `QA iPhone / iOS / Last seen
  just now · Added 2d ago`; **Remove** opened the confirmation, rewrote the
  registry with the other keys preserved, and the list emptied.
- **Stop bridge** returned the card to `Stopped`, cleared the QR and released
  port 8787.

Two bugs found during this pass were fixed: the `[serve]` prefix on the mDNS
line hid the announced name, and confirmation dialogs raised inside Settings
rendered behind the Settings modal (`z-backdrop` → `z-over-modal`).

Outstanding acceptance item: an actual phone scan of the card's QR
(`< 30s` pairing) was not run in this pass because no mobile device/emulator
was attached. The QR payload construction and the bridge auth/rotate path are
covered by the tests and CLI run above.
