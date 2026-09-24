# A-Coder Cloud

> **Package name:** the npm package is still `@earendil-works/pi-cloud` — the scope is inherited from the upstream pi project this codebase was forked from. It will move to `@the-atech-corp/...` when npm publishing is enabled.


A-Coder Cloud (Sovereign Edition) control plane: self-hosted always-on agent
fleet built on the Open-PC architecture. The daemon clones a repo into an
isolated workspace, runs an a-coder agent against the task headlessly,
checkpoints work to an `ac-cloud/<task-id>` branch, and produces a report plus
a resumable session when it finishes.

- `a-coder cloud serve` — run the daemon (auto-started on demand)
- `a-coder cloud spawn <repo> [prompt...]` — dispatch a task
- `a-coder cloud spawn <repo> [prompt...] --workflow <name> [--args <json>]` — dispatch a task driven by a saved declarative workflow (`docs/sops.md`, "Workflows"); the prompt becomes optional task context. Finalize summarizes the workflow runs into the report (per-run status, agents, failed steps) and copies run state into the task artifacts; interrupted runs print resume hints
- `a-coder cloud status` — fleet overview
- `a-coder cloud review <task-id>` — report, commits, workflow runs, resume instructions
- `a-coder cloud stop <task-id>` — stop a running task

Part of the a-coder-cli monorepo. See `docs/cloud/README.md` in the Open-PC
repository for the full architecture and roadmap.