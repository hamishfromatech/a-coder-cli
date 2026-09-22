# Changelog

All notable changes to Open-PC's A-Coder Cloud control plane are documented here.

## [Unreleased]

### Added

- Workflow support for cloud tasks: tasks can be driven with a saved declarative workflow instead of a plain prompt — `a-coder cloud spawn <repo> [prompt...] --workflow <name> [--args <json>]` (workflow-only spawns make the prompt optional task context) composes a run_workflow invocation for the headless worker. At finalize the runner summarizes the session's workflow runs into the task record (`workflowRuns`: run id, workflow, status, agent count, per-step rounds/errors) and copies the run-state files into the task artifacts for session continuity; the structured report gains a Workflows section and, for interrupted runs, resume hints (`run_workflow { workflow, resume: "<runId>" }`). `a-coder cloud review` prints workflow runs and failed steps. Launch authorization follows the worker's permission settings like any other tool call.
- First release of `@earendil-works/pi-cloud`: A-Coder Cloud (Sovereign Edition) control plane — task store, git sync layer with `ac-cloud/<task-id>` branches and WIP checkpoints, report builder, unix-socket daemon, and a task runner that drives a-coder RPC agents headlessly with wall-clock budgets and extension-UI auto-decline.
