# Testing

This release line ships chord 0.80.x and does not carry the upstream chord test suite.
The suite on `main` targets chord 1.5.x: it imports package exports this version does
not have (`./json`, `./watch`, `./http`, `./workers`, ...), across 318 changed source
files. Porting the tests would mean porting that source, which is a version bump of
the shipped package, not a test port (THE-79).

`npm test` therefore runs `vitest --run --passWithNoTests`. If a chord suite is added
to this line, drop the flag with the first test file.
