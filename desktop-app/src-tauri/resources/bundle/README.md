# Bundled engine

`scripts/stage-desktop-engine.mjs` writes `engine.tar.gz` and `engine.version`
here during `npm run tauri:build` / CI. The archive is intentionally ignored:
it is ~70 MB and platform-specific.

When the archive is absent (for example a source build without a matching
release), the desktop still builds and falls back to downloading the engine on
first launch.
