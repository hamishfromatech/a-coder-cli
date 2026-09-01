#Requires -Version 5.1
# ============================================================================
# Install-A-Coder.ps1 — One-shot installer for A-Coder CLI on Windows
# Copyright (c) The A-Tech Corporation PTY LTD
# Usage:
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/<org>/<repo>/main/Install-A-Coder.ps1 | iex"
#   or   .\Install-A-Coder.ps1 [-Version latest] [-InstallDir "$env:USERPROFILE\.a-coder\cli"]
# ============================================================================
[CmdletBinding()]
param(
    [string]$Version = "latest",
    [string]$InstallDir = "",
    [switch]$Force,
    [switch]$NoDesktop
)

$ErrorActionPreference = "Stop"

# Defaults
# Products nest under the shared ~\.a-coder root: the CLI installs into
# ~\.a-coder\cli (lib + bin + VERSION), alongside its config (agent/, teams/,
# tasks/, MEMORY.md). IDE -> ide\, desktop -> desktop\.
if ([string]::IsNullOrEmpty($InstallDir)) {
    $InstallDir = Join-Path $env:USERPROFILE ".a-coder\cli"
}

$BinDir = Join-Path $InstallDir "bin"
$LibDir = Join-Path $InstallDir "lib\a-coder-cli"
$BinShim = Join-Path $BinDir "a-coder-cli.cmd"
$BinExe = Join-Path $BinDir "a-coder-cli.exe"
$Repo = "hamishfromatech/a-coder-cli"

# Legacy single-product layout (pre product nesting): ~\.a-coder\{lib,bin}.
# When present we keep a shim there pointing at the new binary so existing
# PATH entries keep working, and clean the stale tree once the new one lands.
$LegacyACoderDir = Join-Path $env:USERPROFILE ".a-coder"
$LegacyLibDir = Join-Path $LegacyACoderDir "lib\a-coder-cli"
$LegacyBinDir = Join-Path $LegacyACoderDir "bin"

function Write-Header {
    Write-Host "Installing A-Coder CLI v$Version for Windows ..." -ForegroundColor Cyan
}

function Test-CommandAvailable {
    param([string]$Name)
    return [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Invoke-Download {
    param(
        [string]$Url,
        [string]$OutFile
    )
    if (Test-CommandAvailable "curl") {
        curl.exe -sSL --connect-timeout 5 --max-time 60 -o "$OutFile" "$Url"
    } elseif (Test-CommandAvailable "wget") {
        wget.exe -qO "$OutFile" "$Url"
    } else {
        try {
            Invoke-WebRequest -Uri "$Url" -OutFile "$OutFile" -UseBasicParsing -MaximumRedirection 10
        } catch {
            throw "Download failed: $($_.Exception.Message)"
        }
    }
}

function Resolve-Version {
    param([string]$Version)
    if ($Version -ne "latest") { return $Version }
    $Api = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $Rel = Invoke-WebRequest -Uri $Api -UseBasicParsing -MaximumRedirection 10 | ConvertFrom-Json
        return $Rel.tag_name
    } catch {
        throw "Could not resolve latest release tag from GitHub. Pass -Version <tag> explicitly."
    }
}

function Install-FromReleases {
    $Tag = Resolve-Version -Version $Version
    $Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "arm64" }
    # build-binaries.sh produces pi-windows-<arch>.zip containing pi.exe
    $AssetName = "pi-windows-$Arch.zip"
    $Url = "https://github.com/$Repo/releases/download/$Tag/$AssetName"
    $TempArchive = Join-Path $env:TEMP "pi-windows-$Arch.zip"
    $TempExtract = Join-Path $env:TEMP ("ac-extract-" + [Guid]::NewGuid().ToString("N").Substring(0,8))

    Write-Host "Downloading $AssetName from $Tag ..." -ForegroundColor Cyan
    try {
        Invoke-Download -Url $Url -OutFile $TempArchive
        if (-not (Test-Path $TempArchive)) {
            throw "Download did not produce an archive."
        }

        New-Item -ItemType Directory -Force -Path $TempExtract | Out-Null
        Expand-Archive -Path $TempArchive -DestinationPath $TempExtract -Force

        # Find pi.exe inside the archive (matches build-binaries.sh output)
        $Src = Get-ChildItem -Path $TempExtract -Filter "pi.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $Src) {
            # Fall back to a-coder-cli.exe if a future release renames it
            $Src = Get-ChildItem -Path $TempExtract -Filter "a-coder-cli.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if (-not $Src) {
            throw "No pi.exe or a-coder-cli.exe found inside the release archive."
        }

        # Install the whole archive (pi.exe + theme/ + docs/ + examples/) into
        # lib/a-coder-cli/. pi.exe is bun-compiled (JS embedded) but it loads
        # theme/*.json and docs at runtime via fs.readFileSync, so those must
        # be on disk next to the binary.
        New-Item -ItemType Directory -Force -Path $LibDir | Out-Null
        # The running a-coder-cli process holds LibDir\pi.exe open. Windows
        # won't let us overwrite or delete a running .exe, but it DOES allow
        # renaming it. Rename the live binary out of the way (the running
        # process keeps using the renamed file via its open handle), then copy
        # the new one in. Old backups no longer held by any process are cleaned
        # up here; the one still in use simply fails to delete (harmless).
        Get-ChildItem -Path $LibDir -Filter 'pi.exe.old.*' -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        $stamp = Get-Date -Format 'yyyyMMddHHmmss'
        $LiveExe = Join-Path $LibDir 'pi.exe'
        if (Test-Path $LiveExe) {
            try { Move-Item -Path $LiveExe -Destination "$LiveExe.old.$stamp" -Force -ErrorAction Stop } catch {}
        }
        # Native addons (*.node) are also locked while loaded by a running
        # a-coder-cli (or the desktop); rename them out of the way too so the
        # copy can write fresh ones at the original names. Windows allows
        # renaming a loaded .node. Clean stale .node.old.* backups first.
        Get-ChildItem -Path $LibDir -Recurse -Filter '*.node.old.*' -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $LibDir -Recurse -Filter '*.node' -File -ErrorAction SilentlyContinue | ForEach-Object {
            try { Move-Item -Path $_.FullName -Destination "$($_.FullName).old.$stamp" -Force -ErrorAction Stop } catch {}
        }
        # Clean stale deferred sidecars from a previous run that couldn't
        # replace an in-use file (see the per-file copy loop below).
        Get-ChildItem -Path $LibDir -Recurse -Filter '*.new.*' -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue

        # Copy the archive into LibDir one file at a time so a single in-use
        # file can't abort the whole update. The renames above already move the
        # running pi.exe and loaded *.node out of the way in the common case;
        # this loop is the backstop for a file whose rename silently failed
        # (held with a handle that blocks rename too). For such a file we stage
        # the new content as <name>.new.<stamp> and defer it: the VERSION marker
        # is NOT bumped, so re-running the installer (after closing A-Coder
        # Desktop / all a-coder-cli terminals) retries the swap and finishes the
        # update instead of leaving a half-installed tree and skipping desktop.
        $deferred = [System.Collections.Generic.List[string]]::new()
        Get-ChildItem -Path $TempExtract -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = $_.FullName.Substring($TempExtract.Length + 1)
            $dst = Join-Path $LibDir $rel
            $dstDir = Split-Path $dst -Parent
            if (-not (Test-Path $dstDir)) {
                New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
            }
            $copied = $false
            try {
                Copy-Item -Path $_.FullName -Destination $dst -Force -ErrorAction Stop
                $copied = $true
            } catch {
                # Destination is locked. Try renaming it out of the way, then
                # retry the copy (recovers files the global rename missed).
                $renamed = $false
                if (Test-Path $dst) {
                    try { Move-Item -Path $dst -Destination "$dst.old.$stamp" -Force -ErrorAction Stop; $renamed = $true } catch {}
                }
                if ($renamed) {
                    try { Copy-Item -Path $_.FullName -Destination $dst -Force -ErrorAction Stop; $copied = $true } catch {}
                }
            }
            if (-not $copied) {
                # Still locked: stage the new content as a .new sidecar for a
                # re-run to swap in, and record it so VERSION isn't bumped.
                try { Copy-Item -Path $_.FullName -Destination "$dst.new.$stamp" -Force -ErrorAction Stop } catch {}
                $deferred.Add($rel) | Out-Null
            }
        }

        New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
        # A .cmd shim avoids duplicating the large binary and preserves argv.
        $ShimContent = '@"%~dp0..\lib\a-coder-cli\pi.exe" %*'
        Set-Content -Path $BinShim -Value $ShimContent -Encoding ASCII -NoNewline
        Add-Content -Path $BinShim -Value "`r`n" -Encoding ASCII

        if ($deferred.Count -gt 0) {
            Write-Host "Downloaded $AssetName; $($deferred.Count) file(s) in use, staged as .new for next run." -ForegroundColor Yellow
            Write-Host "Close all A-Coder Desktop windows and a-coder-cli terminals, then re-run this command to finish:" -ForegroundColor Yellow
            $deferred | Select-Object -First 5 | ForEach-Object { Write-Host "  - $_" -ForegroundColor DarkGray }
            # Do NOT bump VERSION: a re-run must retry replacing the deferred files.
            return $true
        }

        Write-Host "Downloaded $AssetName and installed a-coder-cli." -ForegroundColor Green
        Set-Content -Path (Join-Path $InstallDir "VERSION") -Value $Tag -NoNewline
        return $true
    } catch {
        Write-Host "Release download failed: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    } finally {
        Remove-Item -Path $TempArchive -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $TempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Add-ToPath {
    param(
        [string]$Dir
    )
    $env:Path = "$Dir;$env:Path"
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$Dir*") {
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$Dir", "User")
        Write-Host "Added $Dir to your user PATH. Restart your terminal to use it everywhere." -ForegroundColor Green
    } else {
        Write-Host "$Dir is already in your user PATH." -ForegroundColor DarkGray
    }
}

function Install-Desktop {
    if ($NoDesktop) { return }
    $Tag = Resolve-Version -Version $Version
    $Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "arm64" }
    # Query the release assets (asset names embed the Tauri bundle version,
    # not the tag) and find the Windows desktop installer by pattern.
    $Api = "https://api.github.com/repos/$Repo/releases/tags/$Tag"
    try {
        $Rel = Invoke-WebRequest -Uri $Api -UseBasicParsing -MaximumRedirection 10 | ConvertFrom-Json
    } catch {
        Write-Host "  (could not fetch release assets — skipping desktop install)" -ForegroundColor DarkGray
        return
    }
    $Asset = $Rel.assets | Where-Object { $_.name -match "A-Coder\.Desktop_.*_${Arch}-setup\.exe$" } | Select-Object -First 1
    if (-not $Asset) {
        $Asset = $Rel.assets | Where-Object { $_.name -match "A-Coder\.Desktop_.*_${Arch}_en-US\.msi$" } | Select-Object -First 1
    }
    if (-not $Asset) {
        Write-Host "  (no Windows desktop installer in release $Tag — skipping)" -ForegroundColor DarkGray
        return
    }
    $Url = "https://github.com/$Repo/releases/download/$Tag/$($Asset.name)"
    $TempInstaller = Join-Path $env:TEMP $Asset.name
    Write-Host "Installing A-Coder Desktop from $($Asset.name) ..." -ForegroundColor Cyan
    try {
        Invoke-Download -Url $Url -OutFile $TempInstaller
        # Run the NSIS installer silently (/S). If silent mode is unsupported,
        # fall back to an interactive install.
        $proc = Start-Process -FilePath $TempInstaller -ArgumentList "/S" -Wait -PassThru -ErrorAction SilentlyContinue
        if ($null -eq $proc -or $proc.ExitCode -ne 0) {
            Write-Host "  (silent install returned non-zero, launching interactive installer)" -ForegroundColor DarkGray
            Start-Process -FilePath $TempInstaller -Wait
        }
        Write-Host "  Installed A-Coder Desktop." -ForegroundColor Green
    } catch {
        Write-Host "  (desktop install failed: $($_.Exception.Message))" -ForegroundColor DarkGray
    } finally {
        Remove-Item -Path $TempInstaller -Force -ErrorAction SilentlyContinue
    }
}

# --- main ---------------------------------------------------------------------
Write-Header

# Auto-update: when an install exists and isn't forced, compare the installed
# version marker to the latest release tag. If they differ, reinstall to latest
# so `irm ... | iex` upgrades in place; if they match, skip.
# The CLI is already installed and up to date -> skip the CLI download, but
# still fall through to the desktop install below so a re-run also installs
# (or updates) A-Coder Desktop without needing -Force.
$CliAlreadyUpToDate = $false
if ((Test-Path $BinShim) -and (-not $Force)) {
    $InstalledTag = ""
    $VersionFile = Join-Path $InstallDir "VERSION"
    if (Test-Path $VersionFile) { $InstalledTag = ((Get-Content $VersionFile -ErrorAction SilentlyContinue | Select-Object -First 1) -replace '\s','') }
    $LatestTag = Resolve-Version -Version $Version
    if ($LatestTag -and ($InstalledTag -ne $LatestTag)) {
        Write-Host "A-Coder CLI $InstalledTag installed; updating to $LatestTag ..." -ForegroundColor Cyan
    } else {
        Write-Host "A-Coder CLI already installed at $BinShim ($InstalledTag)." -ForegroundColor Cyan
        Write-Host "Use -Force to reinstall or downgrade anyway." -ForegroundColor DarkGray
        $CliAlreadyUpToDate = $true
    }
}

if (-not $CliAlreadyUpToDate) {
    $Installed = Install-FromReleases
    if (-not $Installed) {
        Write-Host ""
        Write-Host "Could not install from a GitHub release." -ForegroundColor Red
        Write-Host "This usually means no release exists for '$Version' yet." -ForegroundColor Yellow
        Write-Host "Push a v* tag to create a release, or build from source:" -ForegroundColor Yellow
        Write-Host "  git clone -b feat/desktop-unified-release https://github.com/$Repo.git" -ForegroundColor White
        Write-Host "  cd a-coder-cli && npm install --ignore-scripts && npm run build" -ForegroundColor White
        Write-Host "  cd packages/coding-agent && npm link" -ForegroundColor White
        throw "No release asset found for $Version."
    }

    if (-not (Test-Path $BinShim)) {
        throw "Could not find the a-coder-cli shim after install."
    }

    Add-ToPath -Dir $BinDir

    # Keep the legacy ~\.a-coder\bin shim working and drop the stale lib tree
    # (best-effort — a running process may still hold files open; the shim
    # already points at the new binary, and a re-run finishes the cleanup).
    if ((Test-Path $LegacyBinDir) -and ($LegacyBinDir -ne $BinDir)) {
        Remove-Item -Path (Join-Path $LegacyBinDir "a-coder-cli.cmd") -Force -ErrorAction SilentlyContinue
        Remove-Item -Path (Join-Path $LegacyBinDir "a-coder-cli.exe") -Force -ErrorAction SilentlyContinue
        $LegacyShimContent = '@"%~dp0..\cli\lib\a-coder-cli\pi.exe" %*'
        Set-Content -Path (Join-Path $LegacyBinDir "a-coder-cli.cmd") -Value $LegacyShimContent -Encoding ASCII -NoNewline
        Add-Content -Path (Join-Path $LegacyBinDir "a-coder-cli.cmd") -Value "`r`n" -Encoding ASCII
    }
    if ((Test-Path $LegacyLibDir) -and ($LegacyLibDir -ne $LibDir)) {
        Remove-Item -Path $LegacyLibDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "A-Coder CLI installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Binary:     $BinShim"
    Write-Host "  Config dir: $(Join-Path $env:USERPROFILE '.a-coder\cli')"
    try {
        $Ver = & $BinShim --version 2>$null
        Write-Host "  Version:    $Ver"
    } catch {
        Write-Host "  Version:    ?"
    }
    Write-Host ""
    Write-Host "To start:" -ForegroundColor Cyan
    Write-Host "  a-coder-cli" -ForegroundColor White
    Write-Host ""
    Write-Host "If the command is not found, restart your terminal or run:" -ForegroundColor DarkGray
    Write-Host "  `$env:Path = `"$BinDir;`$env:Path`"" -ForegroundColor White
}

# --- install the desktop app from the same release (best-effort) -------------
Install-Desktop
Write-Host "=================================================="