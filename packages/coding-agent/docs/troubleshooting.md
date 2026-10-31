# Troubleshooting

## macOS: `EPERM` / "operation not permitted" on files you own

**Symptom.** Read, write, edit or bash fails with `EPERM` or `EACCES`
("operation not permitted") on a path that exists and that you can open in
Finder or in another terminal. It often starts after an app update.

**Cause.** macOS privacy protection (TCC) guards `Desktop`, `Documents`,
`Downloads`, `Movies`, `Music`, `Pictures` and iCloud Drive. Access is granted
per *responsible app* — the terminal you launched the CLI from, or the A-Coder
Desktop app — and the grant is bound to that app's code signature. When the
signature changes (a rebuilt or ad-hoc-signed bundle, a moved binary), macOS no
longer recognizes the app and denies access without a prompt. The file
permissions on disk are fine; the kernel is refusing the app.

**Fix.**

1. Open **System Settings → Privacy & Security → Files and Folders**.
2. Enable the entry for your terminal (Terminal, iTerm, VS Code…) or
   **A-Coder Desktop**. If the app is not listed, add it under
   **Full Disk Access** instead — that covers every folder.
3. Quit and reopen the app. Grants apply to new processes.

`a-coder-cli doctor` reports the working directory and each guarded folder as
`ok` or `blocked`, so you can confirm the fix without guessing:

```
File access (macOS)
  working dir    /Users/you/Downloads/project  blocked by macOS privacy settings
  Downloads      blocked
```

**Why it comes back after updates.** A locally rebuilt desktop app is signed
ad-hoc, so each build has a new identity and macOS forgets the grant. Release
builds signed with a stable Developer ID keep the grant across updates;
re-granting once after a local rebuild is expected.

**If you do not want to grant access** to a whole folder, move the project out
of the guarded folders (for example under `~/code`) or use a directory you have
already granted.

## Bash tool: backgrounded commands keep running

Pressing `ctrl+b` detaches a running bash command; it continues and its process
tree is killed on quit. Use the background-processes chip to inspect, kill, or
re-attach output.

## Scheduled runs were marked interrupted

A scheduled run that was executing when the engine stopped is marked
`interrupted`. Enable **Settings → Models → Crash-proof scheduled runs**
(`cron.durable`) to checkpoint every step instead: an interrupted run resumes on
the next start and its history shows `durable · resumable`.
