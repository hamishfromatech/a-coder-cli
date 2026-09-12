# @earendil-works/pi-cloud

A-Coder Cloud (Sovereign Edition) control plane: self-hosted always-on agent
fleet built on the Open-PC architecture. The daemon clones a repo into an
isolated workspace, runs an a-coder agent against the task headlessly,
checkpoints work to an `ac-cloud/<task-id>` branch, and produces a report plus
a resumable session when it finishes.

- `a-coder cloud serve` — run the daemon (auto-started on demand)
- `a-coder cloud spawn <repo> <prompt...>` — dispatch a task
- `a-coder cloud status` — fleet overview
- `a-coder cloud review <task-id>` — report, commits, resume instructions
- `a-coder cloud stop <task-id>` — stop a running task

Part of the a-coder-cli monorepo. See `docs/cloud/README.md` in the Open-PC
repository for the full architecture and roadmap.