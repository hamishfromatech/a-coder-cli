# Release verification runbook

Per-release checks for the unified CLI + desktop release on
`feat/desktop-unified-release`. Run the pre-tag phase before the tag is pushed
and the post-publish phase after GitHub publishes the release.

This runbook verifies a release. It does not create one. Only the board can
approve a release, and only the release owner pushes the tag.

## Authority and gates

- **Board approval is the first gate.** The approval must be written on the
  release task and name the exact tag and scope (CLI, desktop, npm publish
  on/off). No approval means no tag, even if every automated check passes.
- **This task never pushes tags, publishes GitHub releases, or runs
  `npm publish`.** It records evidence and reports pass/fail.
- **A failed gate stops the release.** Report it on the task. Do not tag, do not
  work around the gate, and do not move or reuse an existing tag.
- **The tag is immutable.** Once pushed, a bad release is fixed by shipping the
  next patch, not by deleting or moving the tag.

## Roles

| Role | Owns |
| --- | --- |
| Board | Approves the exact tag and scope |
| Release owner | Bumps the version, commits, tags, pushes |
| Verifier (this task) | Pre-tag checks, post-publish checks, evidence report |

## Inputs

- Candidate tag, for example `v0.80.191`.
- Approved scope comment on the release task.
- Local checkout: `/Users/hamishfromatech/Downloads/Code/A-Coder/a-coder-cli`,
  branch `feat/desktop-unified-release`, clean working tree.
- Repo: `hamishfromatech/a-coder-cli`.

## Evidence

Run the verifier and keep its report. Paste the report into the release task.

```bash
node scripts/verify-release.mjs pre-tag --version 0.80.191 --approval "<task comment URL>" --run-checks
node scripts/verify-release.mjs post-publish --tag v0.80.191 --install-smoke
```

Both commands exit non-zero on a failed check. `WARN` and `MANUAL` lines do not
fail the run; a `WARN` must still be written into the task report.

## Phase 0: Board approval

1. Read the release task. Confirm the board approved this exact tag and scope.
2. Record the approval comment URL in the report.
3. If the approval is missing, ambiguous, or names a different version, stop and
   ask the board. Do not infer approval from a previous release.

## Phase 1: Pre-tag (before `git push origin vX.Y.Z`)

Run from the repo root on the commit that will be tagged.

### 1. Release commit state

- Branch is `feat/desktop-unified-release`.
- `git status --porcelain` is empty.
- `HEAD` is the intended release commit (`git log -1`).
- `vX.Y.Z` does not exist locally or on `origin`.

### 2. Version lockstep

Every workspace package, the desktop app, the Tauri config, and the
coding-agent install lock must report the same `X.Y.Z` as the candidate tag:

```bash
node scripts/verify-release.mjs pre-tag --version 0.80.191 --approval "<ref>"
```

The verifier reads:

- `packages/*/package.json` (including `cloud` and `orchestrator`)
- `desktop-app/package.json`
- `desktop-app/src-tauri/tauri.conf.json`
- `packages/coding-agent/install-lock/package.json`

It also confirms the candidate is newer than the latest published GitHub
release.

### 3. Changelogs

Every package whose `src/` changed since the last release tag has a non-empty
`## [Unreleased]` section in `packages/<pkg>/CHANGELOG.md`. Desktop changes need
an entry in `desktop-app/src/CHANGELOG.md`. `[Unreleased]` entries use the
sections `Breaking Changes`, `Added`, `Changed`, `Fixed`, `Removed`.

The verifier flags changed packages with no entry. It cannot prove that prose
covers every change; read the release notes preview for that.

### 4. Checks and tests

These are the release-blocking gates. The verifier runs them with
`--run-checks`; the release owner must also have a green CI run for the same
commit.

```bash
npm run check
./test.sh
```

`npm run check` includes Biome, pinned deps, relative imports, shrinkwrap, the
coding-agent install lock, `tsgo --noEmit`, browser smoke, and the desktop
`tsc`. `./test.sh` runs the suites without provider keys. Never substitute a raw
`vitest` run: it activates e2e tests when endpoint or auth env vars are present.

Record the final line of each command and the commit SHA. A skipped check is a
failed gate.

### 5. Release notes preview

Generate the deterministic notes without the LLM writer and read them:

```bash
node scripts/release-notes.mjs generate --version 0.80.191 --tag v0.80.191 --no-ai --out /tmp/release-notes-0.80.191.md
```

Confirm the notes name the user-visible changes the board approved. The CI
pipeline may replace this text with the AI-written version; the fallback must
still be accurate.

### 6. Scope confirmation

Confirm with the board, in writing, exactly what ships:

- tag and version
- CLI archives (six platform/arch pairs)
- desktop installers (macOS dmg, Linux deb/rpm/AppImage, Windows setup.exe/msi)
- `latest.json` updater manifest and notes
- npm packages only when `ENABLE_NPM_PUBLISH=true`

## Phase 2: Tag and publish

The release owner does this after the pre-tag report is green.

```bash
git tag -a v0.80.191 -m "v0.80.191"
git push origin v0.80.191
```

The tag triggers `.github/workflows/build-binaries.yml`:

1. `build` builds the six CLI archives and release assets.
2. `desktop-build` builds and signs the desktop installers, then stages them.
3. `stage-github-release` generates `latest.json`, validates versions, creates
   a draft release, and uploads every asset.
4. `publish-npm` runs only when `ENABLE_NPM_PUBLISH=true`.
5. `publish-github-release` flips the draft to public.
6. `cleanup-draft-github-release` deletes the draft if a later job fails.

Do not push the tag until the pre-tag report is attached to the release task.
Do not rerun a release for the same version; use `workflow_dispatch` with the
same tag only for CI recovery.

## Phase 3: Post-publish

Run after the GitHub release is public.

```bash
node scripts/verify-release.mjs post-publish --tag v0.80.191 --install-smoke
```

### 1. Release object

- `draft: false`, `prerelease: false`.
- `tag_name` is exactly `vX.Y.Z`.
- Release body is non-empty and matches the approved scope.

### 2. Assets

Required CLI assets:

- `pi-darwin-arm64.tar.gz`
- `pi-darwin-x64.tar.gz`
- `pi-linux-x64.tar.gz`
- `pi-linux-arm64.tar.gz`
- `pi-windows-x64.zip`
- `pi-windows-arm64.zip`
- `pi-coding-agent-install-package.json`
- `pi-coding-agent-install-package-lock.json`
- `SHA256SUMS`
- `latest.json`

Required desktop assets: at least one macOS `.dmg`, one Linux `.deb` and
`.AppImage` (with `.sig`), one Windows `-setup.exe` (with `.sig`), and one
`.msi` (with `.sig`). A missing `.rpm` is a warning, not a release blocker.

Use `--verify-checksums` to download the CLI archives and compare them against
`SHA256SUMS`. This is slow but is the strongest integrity check; do it for a
release that matters.

### 3. `latest.json`

The updater endpoint is:

```text
https://github.com/hamishfromatech/a-coder-cli/releases/latest/download/latest.json
```

`latest.json` must contain:

- `version` equal to `X.Y.Z`
- non-empty `notes`, with the same text as the GitHub release body
- `pub_date` in ISO 8601
- exactly these platform keys, each with a non-empty signature and a download
  URL that points at this tag:
  - `darwin-aarch64`
  - `darwin-x86_64`
  - `linux-x86_64`
  - `windows-x86_64`

The verifier checks that every URL returns HTTP 200 and that the manifest served
by `/releases/latest/download/latest.json` is the same manifest as the tag's
asset. If the new release is not GitHub's latest (for example a backfill), the
endpoint comparison is reported as skipped.

### 4. Install script smoke test

The installer lives on `feat/desktop-unified-release`:

```text
https://raw.githubusercontent.com/hamishfromatech/a-coder-cli/feat/desktop-unified-release/install-a-coder.sh
```

Test a pinned release into a throwaway directory:

```bash
bash <(curl -sSfL https://raw.githubusercontent.com/hamishfromatech/a-coder-cli/feat/desktop-unified-release/install-a-coder.sh) \
  v0.80.191 --dir /tmp/a-coder-install-check --force --no-desktop
/tmp/a-coder-install-check/bin/a-coder-cli --version
```

Expected output is exactly `0.80.191`. `--install-smoke` runs this step.

Also check the unpinned path, because that is what users run:

```bash
curl -sSfL https://api.github.com/repos/hamishfromatech/a-coder-cli/releases/latest \
  | grep -m1 '"tag_name"'
```

The resolved tag must be the new tag.

Known issue as of 2026-10-31: `install-a-coder.sh` on `main` returns 404; the
script only exists on `feat/desktop-unified-release`. The runbook therefore uses
the feature-branch URL. When the branch merges, switch to `main` and verify both
URLs. The release-cli workflow's notice still prints a `main` URL, and
`AGENTS.md` still points at `pi-mono`; both are stale.

### 5. Desktop updater modal

The desktop updater reads `latest.json` from the endpoint above. This check is
manual and needs a desktop build of the previous version.

1. Install the previous desktop version (for example `0.80.190`) on the same
   platform you are checking.
2. Open the app and run the update check from the update surface.
3. Confirm the modal shows the new `X.Y.Z` version and the release notes text.
4. Confirm the download starts and the signature is accepted.
5. Capture a screenshot and attach it to the release task.

Repeat on at least one macOS build. Windows and Linux use the same manifest but
different assets; check them when the release changes updater behavior.

## Phase 4: Report

Post one table on the release task:

| Item | Result | Evidence |
| --- | --- | --- |
| Board approval | pass/fail | comment URL |
| Release commit clean | pass/fail | `git status`, SHA |
| Version lockstep | pass/fail | verifier output |
| Changelog coverage | pass/fail | verifier output |
| `npm run check` | pass/fail | final line + SHA |
| `./test.sh` | pass/fail | final line + SHA |
| Scope confirmed | pass/fail | board comment |
| Release published | pass/fail | release URL |
| Asset set | pass/fail | verifier output |
| `latest.json` | pass/fail | verifier output |
| Install script | pass/fail | `--version` output |
| Desktop updater modal | pass/fail | screenshot |

Attach the verifier's Markdown report (`--report <path>`). If anything failed,
state the failing check, the observed value, and what the release owner must do
next. Do not close the release task as verified until every row passes or the
board explicitly accepts a documented risk.

## Failure handling

| Symptom | Action |
| --- | --- |
| Pre-tag check fails | Fix on the branch and rerun. Do not tag. |
| CI fails before the draft publishes | Fix, then rerun the workflow with the same tag via `workflow_dispatch`. Never push a new tag for the same version. |
| Draft release exists from a failed run | CI deletes it automatically. If it remains, the release owner deletes the draft after confirming no assets were published. |
| Release published with a bad asset | Do not delete or move the tag. Ship the fix in the next patch release and, if the board approves, patch `latest.json` in place only as a documented recovery step. |
| `latest.json` missing a platform | The platform stays on its current version. Ship a patch that restores the platform; do not hand-edit a published manifest without board approval. |
| Install script 404 | Check the ref in the URL and whether the branch was merged. Report the broken endpoint; do not tell users to install from a different unpinned source. |
| npm publish failed (when enabled) | Rerun the `publish-npm` job. The helper skips already-published versions. Do not rerun the whole release. |
