# Changelog

## [Unreleased]

### Fixed

- Fixed the orchestrator's RPC child spawn failing with ERR_PACKAGE_PATH_NOT_EXPORTED: `require.resolve("@earendil-works/pi-coding-agent/rpc-entry")` cannot resolve an exports subpath that only exposes the `import` condition. Resolution now goes through `import.meta.resolve`.

## [0.80.26] - 2026-08-22

## [0.80.25] - 2026-08-22

## [0.80.24] - 2026-08-21

## [0.80.3] - 2026-06-30

### Changed
- Renamed the npm package scope from `@earendil-works` to `@theatechcorporation`.

