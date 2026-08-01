#!/usr/bin/env bash
# ============================================================================
# install-a-coder.sh — One-shot installer for A-Coder CLI
# Copyright (c) The A-Tech Corporation PTY LTD
# Usage:  curl -sSf https://raw.githubusercontent.com/<org>/<repo>/main/install-a-coder.sh | bash
#         or   wget -qO- https://.../install-a-coder.sh | bash
# ============================================================================
set -euo pipefail

VERSION="${1:-latest}"       # GitHub release tag (e.g. v0.80.4) or "latest"
INSTALL_DIR=""               # user-specified install dir
FORCE=false
QUIET=false

REPO="hamishfromatech/pi-mono"

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [VERSION]

Install A-Coder CLI globally from the unified GitHub Release.

The release ships self-contained archives (pi-<platform>-<arch>.tar.gz /
.zip) that bundle the binary alongside its runtime assets (themes, native
modules). This script extracts the whole tree into a lib directory and links
an \`a-coder-cli\` command onto your PATH.

Options:
  --dir <path>    Install to a custom directory (default: ~/.a-coder)
  --force         Overwrite an existing installation
  --quiet         Suppress status messages
  -h, --help      Show this help

VERSION   GitHub release tag (e.g. v0.80.4) or "latest" (default: latest)

Examples:
  $(basename "$0")                    # install latest
  $(basename "$0") v0.80.4            # pin to a release tag
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)   INSTALL_DIR="$2"; shift 2 ;;
    --force) FORCE=true;       shift ;;
    --quiet) QUIET=true;       shift ;;
    -h|--help) usage; exit 0 ;;
    *) VERSION="$1"; shift ;;
  esac
done

# --- platform detection -------------------------------------------------------
detect_platform() {
  case "$(uname -s)" in
    Linux)   echo "linux" ;;
    Darwin)  echo "darwin" ;;
    *)       echo "$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64)  echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)       echo "$(uname -m)" ;;
  esac
}

PLATFORM="$(detect_platform)"
ARCH="$(detect_arch)"

# --- resolve install directory -----------------------------------------------
if [[ -z "$INSTALL_DIR" ]]; then
  INSTALL_DIR="$HOME/.a-coder"
fi

LIB_DIR="$INSTALL_DIR/lib/a-coder-cli"
BIN_DIR="$INSTALL_DIR/bin"
COMMAND="$BIN_DIR/a-coder-cli"

mkdir -p "$INSTALL_DIR" "$LIB_DIR" "$BIN_DIR"

# --- check for existing install ---------------------------------------------
if [[ -e "$LIB_DIR/bin" || -e "$COMMAND" ]] && [[ "$FORCE" == "false" ]]; then
  echo "A-Coder CLI already installed in $INSTALL_DIR."
  echo "Re-run with --force to reinstall, or use the built-in update command:"
  echo "  a-coder-cli update --self"
  exit 0
fi

# --- downloader --------------------------------------------------------------
download() {
  local url="$1" out="$2"
  if command -v curl &>/dev/null; then
    curl -sSfL --connect-timeout 5 --max-time 120 -o "$out" "$url"
  elif command -v wget &>/dev/null; then
    wget -qO "$out" "$url"
  else
    echo "ERROR: Neither curl nor wget found. Install one and retry." >&2
    exit 1
  fi
}

# --- resolve "latest" to a concrete tag via the GitHub API -------------------
resolve_tag() {
  local tag="$1"
  if [[ "$tag" == "latest" ]]; then
    local api="https://api.github.com/repos/${REPO}/releases/latest"
    if command -v curl &>/dev/null; then
      tag="$(curl -sSfL "$api" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
    else
      tag="$(wget -qO- "$api" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
    fi
    if [[ -z "$tag" ]]; then
      echo "ERROR: Could not resolve latest release tag from GitHub." >&2
      exit 1
    fi
  fi
  echo "$tag"
}

# --- download + extract the self-contained archive --------------------------
install_from_release() {
  local tag asset archive_ext
  tag="$(resolve_tag "$VERSION")"
  if [[ "$PLATFORM" == "windows" ]]; then
    archive_ext="zip"
  else
    archive_ext="tar.gz"
  fi
  asset="pi-${PLATFORM}-${ARCH}.${archive_ext}"
  local url="https://github.com/${REPO}/releases/download/${tag}/${asset}"

  echo "Installing A-Coder CLI ${tag} for ${PLATFORM}/${ARCH} ..."
  echo "  $url"

  local tmp_archive="$INSTALL_DIR/${asset}"
  download "$url" "$tmp_archive"

  # Clear any previous install.
  rm -rf "$LIB_DIR"
  mkdir -p "$LIB_DIR"

  if [[ "$archive_ext" == "zip" ]]; then
    if ! command -v unzip &>/dev/null; then
      echo "ERROR: unzip is required to install the Windows archive." >&2
      rm -f "$tmp_archive"
      return 1
    fi
    (cd "$LIB_DIR" && unzip -q "$tmp_archive")
  else
    # The tarball wraps its contents in a top-level `pi/` directory; strip it
    # so the binary + assets land directly in LIB_DIR.
    tar -xzf "$tmp_archive" -C "$LIB_DIR" --strip-components=1
  fi
  rm -f "$tmp_archive"

  # Locate the compiled binary.
  local binary
  if [[ "$PLATFORM" == "windows" ]]; then
    binary="$LIB_DIR/pi.exe"
  else
    binary="$LIB_DIR/pi"
  fi

  if [[ ! -x "$binary" ]]; then
    echo "ERROR: Binary not found after extraction ($binary)." >&2
    echo "Archive contents:" >&2
    ls -la "$LIB_DIR" >&2
    return 1
  fi

  # Expose the command. The bun-compiled binary loads its sibling assets
  # (themes, native modules) relative to itself, so we keep it in LIB_DIR and
  # link/shim it from BIN_DIR.
  rm -f "$COMMAND" "$COMMAND.exe" "$COMMAND.cmd"
  if [[ "$PLATFORM" == "windows" ]]; then
    # A .cmd shim avoids duplicating the large binary and preserves argv.
    printf '@"%%~dp0..\\lib\\a-coder-cli\\pi.exe" %%*\r\n' > "$COMMAND.cmd"
  else
    ln -s "../lib/a-coder-cli/pi" "$COMMAND"
  fi

  echo "Downloaded and installed ${tag}."
  echo "$tag" > "$INSTALL_DIR/VERSION"
  return 0
}

# --- npm fallback ------------------------------------------------------------
install_from_npm() {
  local pkg="@earendil-works/pi-coding-agent@${VERSION#v}"
  if ! command -v npm &>/dev/null; then
    echo "ERROR: npm not found. Install Node.js first." >&2
    return 1
  fi
  echo "Falling back to npm: npm install -g $pkg"
  npm install -g "$pkg"
  # npm puts the `a-coder-cli` bin on the global PATH itself.
}

# --- attempt install ---------------------------------------------------------
if ! install_from_release; then
  echo "GitHub release archive unavailable; falling back to npm..." >&2
  install_from_npm || {
    echo "" >&2
    echo "ERROR: Could not install A-Coder CLI." >&2
    echo "Try: npm install -g @earendil-works/pi-coding-agent@${VERSION#v}" >&2
    exit 1
  }
fi

# --- make it available in PATH for current session ---------------------------
export PATH="$BIN_DIR:$PATH"

# --- shell completions hook (bash / zsh) -------------------------------------
if [[ -x "$COMMAND" || -f "$COMMAND.cmd" ]]; then
  "$COMMAND" --generate-completion bash > "$INSTALL_DIR/etc/a-coder-cli.sh" 2>/dev/null || true
  "$COMMAND" --generate-completion zsh > "$INSTALL_DIR/etc/a-coder-cli.zsh" 2>/dev/null || true
fi

# --- summary -----------------------------------------------------------------
INSTALLED_VERSION="$("$COMMAND" --version 2>/dev/null || echo '?')"

echo ""
echo "=================================================="
echo "A-Coder CLI installed successfully!"
echo ""
echo "  Command:    $COMMAND"
echo "  Runtime:    $LIB_DIR"
echo "  Version:    $INSTALLED_VERSION"
echo ""

if [[ "$QUIET" == "false" ]]; then
  echo "To start:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
  echo "  a-coder-cli"
  echo ""
  echo "Add this to your shell config (~/.bashrc, ~/.zshrc):"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi
echo "=================================================="