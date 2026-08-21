#!/usr/bin/env bash
# ============================================================================
# install-a-coder.sh — One-shot installer for A-Coder CLI
# Copyright (c) The A-Tech Corporation PTY LTD
# Usage:  curl -sSf https://raw.githubusercontent.com/<org>/<repo>/main/install-a-coder.sh | bash
#         or   wget -qO- https://.../install-a-coder.sh | bash
# ============================================================================
set -euo pipefail

VERSION="latest"             # GitHub release tag (e.g. v0.80.4) or "latest"
INSTALL_DIR=""                 # user-specified install dir
FORCE=false
NO_DESKTOP=false
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
    --dir)        INSTALL_DIR="$2"; shift 2 ;;
    --force)      FORCE=true;         shift ;;
    --no-desktop) NO_DESKTOP=true;    shift ;;
    --quiet)      QUIET=true;         shift ;;
    -h|--help)    usage; exit 0 ;;
    *) VERSION="$1"; shift ;;
  esac
done

# Positional argument (if any) is the version/tag.
if [[ $# -gt 0 ]]; then
  VERSION="$1"
fi

# --- downloader -------------------------------------------------------------
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
# Auto-update: when an install exists and isn't forced, compare the installed
# version marker to the latest release tag. If they differ, reinstall to
# latest so `curl ... | bash` upgrades in place; if they match, skip the CLI
# download but still fall through to the desktop install below.
CLI_ALREADY_UP_TO_DATE=false
if [[ -e "$LIB_DIR/bin" || -e "$COMMAND" ]] && [[ "$FORCE" == "false" ]]; then
  installed_tag="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null | tr -d '[:space:]')"
  latest_tag="$(resolve_tag "$VERSION")"
  if [[ -n "$latest_tag" && "$installed_tag" != "$latest_tag" ]]; then
    echo "A-Coder CLI $installed_tag installed; updating to $latest_tag ..."
  else
    echo "A-Coder CLI already installed in $INSTALL_DIR (${installed_tag:-unknown})."
    echo "Re-run with --force to reinstall the CLI."
    CLI_ALREADY_UP_TO_DATE=true
  fi
fi

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

# --- desktop app install (best-effort) --------------------------------------
# Downloads the matching A-Coder Desktop installer from the same release and
# installs it alongside the CLI (macOS DMG to /Applications, Linux deb/rpm/
# AppImage). The desktop asset name embeds the Tauri bundle version (e.g.
# A-Coder.Desktop_0.80.4_aarch64.dmg), not the tag, so we resolve the asset
# via the GitHub release API by pattern.
install_desktop() {
  local tag
  tag="$(resolve_tag "$VERSION")"
  local api="https://api.github.com/repos/${REPO}/releases/tags/${tag}"
  local assets_json
  if command -v curl &>/dev/null; then
    assets_json="$(curl -sSfL "$api")"
  else
    assets_json="$(wget -qO- "$api")"
  fi
  if [[ -z "$assets_json" ]]; then
    echo "  (could not fetch release assets — skipping desktop install)"
    return 0
  fi

  # Pick the asset name pattern for this platform/arch.
  local pattern
  if [[ "$PLATFORM" == "darwin" ]]; then
    if [[ "$ARCH" == "arm64" ]]; then
      pattern="A-Coder.Desktop_.*_aarch64.dmg"
    else
      pattern="A-Coder.Desktop_.*_x64.dmg"
    fi
  elif [[ "$PLATFORM" == "linux" ]]; then
    if command -v dpkg &>/dev/null; then
      pattern="A-Coder.Desktop_.*_amd64.deb"
    elif command -v rpm &>/dev/null; then
      pattern="A-Coder.Desktop-.*\.x86_64.rpm"
    else
      pattern="A-Coder.Desktop_.*_amd64.AppImage"
    fi
  else
    echo "  (desktop app not available for $PLATFORM — skipping)"
    return 0
  fi

  local asset_url asset_name
  asset_name="$(echo "$assets_json" | grep -oE '"name": "'"$pattern"'"' | head -1 | sed -E 's/.*"name": "([^"]+)".*/\1/')"
  if [[ -z "$asset_name" ]]; then
    echo "  (no desktop asset matching $pattern in release $tag — skipping)"
    return 0
  fi
  asset_url="https://github.com/${REPO}/releases/download/${tag}/${asset_name}"

  echo "Installing A-Coder Desktop from $asset_name ..."
  local tmp_asset="$INSTALL_DIR/${asset_name}"
  download "$asset_url" "$tmp_asset"

  if [[ "$PLATFORM" == "darwin" ]]; then
    # Mount the DMG, copy the .app to /Applications, detach.
    local mount_dir
    mount_dir="$(hdiutil attach "$tmp_asset" -nobrowse -noautoopen | grep -oE '/Volumes/[^"]+' | tail -1)"
    if [[ -z "$mount_dir" ]]; then
      echo "  (could not mount DMG — skipping desktop install)"
      rm -f "$tmp_asset"
      return 0
    fi
    local app="$(find "$mount_dir" -maxdepth 2 -name 'A-Coder Desktop.app' | head -1)"
    if [[ -z "$app" ]]; then
      echo "  (no A-Coder Desktop.app inside DMG — skipping)"
      hdiutil detach "$mount_dir" >/dev/null 2>&1
      rm -f "$tmp_asset"
      return 0
    fi
    if [[ -w "/Applications" ]]; then
      rm -rf "/Applications/A-Coder Desktop.app"
      cp -R "$app" "/Applications/"
    else
      echo "  (need permission to write /Applications — running with sudo)"
      sudo rm -rf "/Applications/A-Coder Desktop.app"
      sudo cp -R "$app" "/Applications/"
    fi
    hdiutil detach "$mount_dir" >/dev/null 2>&1
    rm -f "$tmp_asset"
    echo "  Installed A-Coder Desktop to /Applications/"
  elif [[ "$PLATFORM" == "linux" ]]; then
    if [[ "$asset_name" == *.deb ]]; then
      sudo dpkg -i "$tmp_asset" || sudo apt-get install -f -y
      rm -f "$tmp_asset"
      echo "  Installed A-Coder Desktop (.deb)"
    elif [[ "$asset_name" == *.rpm ]]; then
      sudo rpm -i --replacepkgs "$tmp_asset" || sudo yum install -y "$tmp_asset"
      rm -f "$tmp_asset"
      echo "  Installed A-Coder Desktop (.rpm)"
    else
      # AppImage: make executable + move into ~/.local/bin (no root needed)
      local appdir="$HOME/.local/bin"
      mkdir -p "$appdir"
      chmod +x "$tmp_asset"
      mv "$tmp_asset" "$appdir/A-Coder-Desktop.AppImage"
      echo "  Installed A-Coder Desktop (AppImage) to $appdir/"
    fi
  fi
  return 0
}

# --- npm fallback ------------------------------------------------------------
install_from_npm() {
  local pkg="@theatechcorporation/pi-coding-agent@${VERSION#v}"
  if ! command -v npm &>/dev/null; then
    echo "ERROR: npm not found. Install Node.js first." >&2
    return 1
  fi
  echo "Falling back to npm: npm install -g $pkg"
  npm install -g "$pkg"
  # npm puts the `a-coder-cli` bin on the global PATH itself.
}

# --- attempt install ---------------------------------------------------------
if [[ "$CLI_ALREADY_UP_TO_DATE" == "false" ]]; then
  if ! install_from_release; then
    echo "GitHub release archive unavailable; falling back to npm..." >&2
    install_from_npm || {
      echo "" >&2
      echo "ERROR: Could not install A-Coder CLI." >&2
      echo "Try: npm install -g @theatechcorporation/pi-coding-agent@${VERSION#v}" >&2
      exit 1
    }
  fi

  # --- make it available in PATH for current session ---------------------------
  export PATH="$BIN_DIR:$PATH"

  # --- shell completions hook (bash / zsh) -------------------------------------
  if [[ -x "$COMMAND" || -f "$COMMAND.cmd" ]]; then
    mkdir -p "$INSTALL_DIR/etc"
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
fi

# --- install the desktop app from the same release (best-effort) -------------
if [[ "$NO_DESKTOP" == "false" ]]; then
  echo ""
  install_desktop || echo "  (desktop install skipped)"
  echo ""
  echo "=================================================="
  if [[ "$PLATFORM" == "darwin" ]]; then
    echo "A-Coder Desktop installed to /Applications/ — launch with Spotlight."
  elif [[ "$PLATFORM" == "linux" ]]; then
    echo "A-Coder Desktop installed — find it in your app menu, or run 'a-coder-cli --desktop'."
  fi
  echo "=================================================="
fi