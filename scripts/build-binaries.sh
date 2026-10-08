#!/usr/bin/env bash
#
# Build pi binaries for all platforms locally.
# Mirrors .github/workflows/build-binaries.yml
#
# Usage:
#   ./scripts/build-binaries.sh [--skip-install] [--skip-deps] [--skip-build] [--platform <platform>] [--out <dir>]
#
# Options:
#   --skip-install      Skip npm ci
#   --skip-deps         Skip installing cross-platform dependencies
#   --skip-build        Skip npm run build
#   --platform <name>   Build only for specified platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64)
#   --out <dir>         Output directory (default: packages/coding-agent/binaries)
#
# Output:
#   packages/coding-agent/binaries/
#     pi-darwin-arm64.tar.gz
#     pi-darwin-x64.tar.gz
#     pi-linux-x64.tar.gz
#     pi-linux-arm64.tar.gz
#     pi-windows-x64.zip
#     pi-windows-arm64.zip

set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_INSTALL=false
SKIP_DEPS=false
SKIP_BUILD=false
PLATFORM=""
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-install)
            SKIP_INSTALL=true
            shift
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --out)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

## Bun version policy for engine binaries (oven-sh/bun#30613):
## - bun >= 1.3.9 crashes at startup on x64 CPUs/VMs without SSE4.2/POPCNT
##   (upstream WebKit pass of -march=nehalem) — compiled engines die with
##   0xC0000005/SIGILL on --version. x64 targets MUST be built with bun <= 1.3.8.
## - bun < 1.3.10 has no bun-windows-aarch64 cross-compile download, so the
##   windows-arm64 target needs bun >= 1.3.10 (ARM64 is unaffected by the
##   x64 regression).
## This means one bun cannot build all six targets. Provide the baseline
## executable via BUN_BASELINE_BIN (path to a bun <= 1.3.8 binary); the PATH
## bun (>= 1.3.10) is used for arm64 targets.
bun_ok_for_x64() {
	awk -v a="$1" -v b="1.3.8" 'BEGIN {
		n = split(a, P, "."); m = split(b, Q, ".");
		for (i = 1; i <= n || i <= m; i++) {
			x = (i <= n ? P[i] + 0 : 0); y = (i <= m ? Q[i] + 0 : 0);
			if (x < y) exit 0; if (x > y) exit 1;
		}
		exit 0;
	}'
}
BUN_VERSION="$(bun --version 2>/dev/null || echo 0)"
BUN_BASELINE_BIN="${BUN_BASELINE_BIN:-}"
BUN_BASELINE_VERSION=""
if [[ -n "$BUN_BASELINE_BIN" ]]; then
	if [[ ! -x "$BUN_BASELINE_BIN" ]]; then
		echo "Error: BUN_BASELINE_BIN is set but not executable: $BUN_BASELINE_BIN"
		exit 1
	fi
	BUN_BASELINE_VERSION="$($BUN_BASELINE_BIN --version 2>/dev/null || echo 0)"
	if ! bun_ok_for_x64 "$BUN_BASELINE_VERSION"; then
		echo "Error: BUN_BASELINE_BIN must be bun <= 1.3.8 (got $BUN_BASELINE_VERSION)."
		exit 1
	fi
fi
if ! command -v bun >/dev/null 2>&1; then
	echo "Error: bun is required to build engine binaries."
	exit 1
fi

echo "==> PATH bun: $BUN_VERSION; baseline bun: ${BUN_BASELINE_VERSION:-unset} (policy: x64 <= 1.3.8, windows-arm64 >= 1.3.10)"

## Pick the bun executable for a platform; errors with instructions.
bun_for_platform() {
	local platform="$1"
	case "$platform" in
		*-x64)
			if bun_ok_for_x64 "$BUN_VERSION"; then
				echo "bun"
				return 0
			fi
			if [[ -n "$BUN_BASELINE_VERSION" ]]; then
				echo "$BUN_BASELINE_BIN"
				return 0
			fi
			echo "Error: $platform needs bun <= 1.3.8 but the PATH bun is $BUN_VERSION (bun >= 1.3.9 crashes on non-AVX2/SSE4.2 CPUs, oven-sh/bun#30613)." >&2
			echo "Provide a baseline bun: npm install -g bun@1.3.8 (then re-path), or download it and set BUN_BASELINE_BIN=/path/to/bun." >&2
			return 1
			;;
		windows-arm64)
			if ! awk -v a="$BUN_VERSION" -v b="1.3.10" 'BEGIN { n=split(a,P,"."); m=split(b,Q,"."); for(i=1;i<=n||i<=m;i++){x=(i<=n?P[i]+0:0);y=(i<=m?Q[i]+0:0); if(x>y)exit 0; if(x<y)exit 1;} exit 0; }'; then
				echo "Error: windows-arm64 needs bun >= 1.3.10 (the bun-windows-aarch64 cross-compile does not exist earlier; PATH bun is $BUN_VERSION)." >&2
				return 1
			fi
			echo "bun"
			return 0
			;;
		*)
			echo "bun"
			return 0
			;;
	esac
}

# Validate platform if specified
if [[ -n "$PLATFORM" ]]; then
    case "$PLATFORM" in
        darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64|windows-arm64)
            ;;
        *)
            echo "Invalid platform: $PLATFORM"
            echo "Valid platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64"
            exit 1
            ;;
    esac
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="packages/coding-agent/binaries"
fi
if [[ "$OUTPUT_DIR" != /* ]]; then
    OUTPUT_DIR="$(pwd)/$OUTPUT_DIR"
fi

if [[ "$SKIP_INSTALL" == "false" ]]; then
    echo "==> Installing dependencies..."
    npm ci --ignore-scripts
else
    echo "==> Skipping npm ci (--skip-install)"
fi

if [[ "$SKIP_DEPS" == "false" ]]; then
    echo "==> Skipping cross-platform native bindings: none required (--skip-deps)"
else
    echo "==> Skipping cross-platform native bindings (--skip-deps)"
fi

if [[ "$SKIP_BUILD" == "false" ]]; then
    echo "==> Building all packages..."
    # Release builds use the committed model catalogs instead of re-fetching
    # upstream (which can fail on CI network/rate-limits). The committed
    # .models.ts are already valid; generate-models/generate-image-models
    # honor PI_SKIP_GENERATE=1 and exit early.
    export PI_SKIP_GENERATE=1
    npm run build
else
    echo "==> Skipping package build (--skip-build)"
fi

echo "==> Building binaries..."
cd packages/coding-agent

# Clean previous builds
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64,windows-arm64}

# Determine which platforms to build
if [[ -n "$PLATFORM" ]]; then
    PLATFORMS=("$PLATFORM")
else
    PLATFORMS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64 windows-arm64)
fi

for platform in "${PLATFORMS[@]}"; do
    echo "Building for $platform..."
    BUN="$(bun_for_platform "$platform")"
    echo "  bun for $platform: $BUN ($(BUN="$BUN" $BUN --version))"
    # Bun compiled executables only embed worker scripts when they are passed as
    # explicit build entrypoints. The runtime can still use new URL(...), but the
    # worker must be present in the compiled executable.
    if [[ "$platform" == windows-* ]]; then
        "$BUN" build --compile --target=bun-$platform ./dist/bun/cli.js ./src/utils/image-resize-worker.ts --outfile "$OUTPUT_DIR/$platform/pi.exe"
    else
        "$BUN" build --compile --target=bun-$platform ./dist/bun/cli.js ./src/utils/image-resize-worker.ts --outfile "$OUTPUT_DIR/$platform/pi"
    fi
done

echo "==> Creating release archives..."

# Copy shared files to each platform directory
for platform in "${PLATFORMS[@]}"; do
    cp package.json "$OUTPUT_DIR/$platform/"
    cp README.md "$OUTPUT_DIR/$platform/"
    cp CHANGELOG.md "$OUTPUT_DIR/$platform/"
    cp ../../node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm "$OUTPUT_DIR/$platform/"
    mkdir -p "$OUTPUT_DIR/$platform/theme"
    cp dist/modes/interactive/theme/*.json "$OUTPUT_DIR/$platform/theme/"
    mkdir -p "$OUTPUT_DIR/$platform/assets"
    cp dist/modes/interactive/assets/* "$OUTPUT_DIR/$platform/assets/"
    cp -r dist/core/export-html "$OUTPUT_DIR/$platform/"
    cp -r docs "$OUTPUT_DIR/$platform/"
    cp -r examples "$OUTPUT_DIR/$platform/"
    cp -r skills "$OUTPUT_DIR/$platform/"

    # Copy pi-tui's native platform helper (clipboard, native modifier probes, Windows
    # virtual-terminal input) next to the compiled binary — the runtime probes these
    # paths, relative to the executable, before falling back to command-line tools.
    native_platform="${platform/windows-/win32-}"
    native_arch="${native_platform%-*}"
    native_src="../tui/native/${native_platform%%-*}/prebuilds/$native_platform"
    mkdir -p "$OUTPUT_DIR/$platform/native/${native_platform%%-*}/prebuilds/$native_platform"
    cp -R "$native_src" "$OUTPUT_DIR/$platform/native/${native_platform%%-*}/prebuilds/$native_platform/"
done

# Create archives
cd "$OUTPUT_DIR"

for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        # Windows (zip)
        echo "Creating pi-$platform.zip..."
        (cd "$platform" && zip -r ../pi-$platform.zip .)
    else
        # Unix platforms (tar.gz) - use wrapper directory for mise compatibility
        echo "Creating pi-$platform.tar.gz..."
        mv "$platform" pi && tar -czf pi-$platform.tar.gz pi && mv pi "$platform"
    fi
done

# Extract archives for easy local testing
echo "==> Extracting archives for testing..."
for platform in "${PLATFORMS[@]}"; do
    rm -rf "$platform"
    if [[ "$platform" == windows-* ]]; then
        mkdir -p "$platform" && (cd "$platform" && unzip -q ../pi-$platform.zip)
    else
        tar -xzf pi-$platform.tar.gz && mv pi "$platform"
    fi
done

echo ""
echo "==> Build complete!"
echo "Archives available in $OUTPUT_DIR/"
ls -lh *.tar.gz *.zip 2>/dev/null || true
echo ""
echo "Extracted directories for testing:"
for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        echo "  $OUTPUT_DIR/$platform/pi.exe"
    else
        echo "  $OUTPUT_DIR/$platform/pi"
    fi
done
