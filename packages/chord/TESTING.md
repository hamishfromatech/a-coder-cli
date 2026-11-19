# Testing

This release line ships chord 0.80.x. Its test suite lives in `test/` and runs with
`npm test` (`vitest --run`).

## The upstream suite is not ported

The suite on `main` targets chord 1.5.x: it imports package exports this version does
not have (`./json`, `./watch`, `./http`, `./workers`, ...), across 318 changed source
files and roughly 171k lines of tests against this line's ~10k-line `src/`. Porting it
would mean porting that source — a version bump of the shipped package, not a test
port (THE-79).

## What this line tests

The `src/sqlite` module kept the same shape across the version bump, so the sqlite
driver suites port directly and cover the part of chord that touches user data:

- `test/sqlite/node.test.ts` — the `node:sqlite` adapter: connection pragmas,
  `runCounted`, transaction serialization and ordering, stale-handle rejection, and
  rollback/commit failure outcomes.
- `test/sqlite/cloudflare.test.ts` — the Durable Object adapter: BLOB binding,
  `runCounted` without index writes, first-row `get`, bigint range refusal, ordering
  across adapters, and commit-failure outcomes.
- `test/sqlite/migrations.test.ts` — migration version tracking, prefix validation,
  and atomic bootstrap rollback.

Adaptations from the upstream files: no prepared-statement eviction test (this line's
statement cache does not evict), no read-only-connection test (no `mode` option on
`openNodeSqliteDatabase`), and no store-level test (this line has no `src/store`).
`runCounted` was added to both sqlite adapters for the driver assertions.

When chord is bumped to the 1.5.x generation on this line, replace this suite with the
upstream one.
