#Requires -Version 5.1
# ============================================================================
# Install-A-Coder.ps1 — One-shot installer for A-Coder CLI on Windows
# Copyright (c) The A-Tech Corporation PTY LTD
# Usage:
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/<org>/<repo>/main/Install-A-Coder.ps1 | iex"
#   or   .\Install-A-Coder.ps1 [-Version latest] [-InstallDir "$env:USERPROFILE\.a-coder"]
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
if ([string]::IsNullOrEmpty($InstallDir)) {
    $InstallDir = Join-Path $env:USERPROFILE ".a-coder"
}

$BinDir = Join-Path $InstallDir "bin"
$LibDir = Join-Path $InstallDir "lib\a-coder-cli"
$BinShim = Join-Path $BinDir "a-coder-cli.cmd"
$BinExe = Join-Path $BinDir "a-coder-cli.exe"
$Repo = "hamishfromatech/pi-mono"

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
        Copy-Item -Path "$TempExtract\*" -Destination $LibDir -Recurse -Force

        New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
        # A .cmd shim avoids duplicating the large binary and preserves argv.
        $ShimContent = '@"%~dp0..\lib\a-coder-cli\pi.exe" %*'
        Set-Content -Path $BinShim -Value $ShimContent -Encoding ASCII -NoNewline
        Add-Content -Path $BinShim -Value "`r`n" -Encoding ASCII

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
    $Asset = $Rel.assets | Where-Object { $_.name -match "A-Coder.Desktop_${Arch}-setup.exe$" } | Select-Object -First 1
    if (-not $Asset) {
        $Asset = $Rel.assets | Where-Object { $_.name -match "A-Coder.Desktop_${Arch}_en-US.msi$" } | Select-Object -First 1
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
if ((Test-Path $BinShim) -and (-not $Force)) {
    $InstalledTag = ""
    $VersionFile = Join-Path $InstallDir "VERSION"
    if (Test-Path $VersionFile) { $InstalledTag = ((Get-Content $VersionFile -ErrorAction SilentlyContinue | Select-Object -First 1) -replace '\s','') }
    $LatestTag = Resolve-Version -Version $Version
    if ($InstalledTag -and $LatestTag -and ($InstalledTag -ne $LatestTag)) {
        Write-Host "A-Coder CLI $InstalledTag installed; updating to $LatestTag ..." -ForegroundColor Cyan
    } else {
        Write-Host "A-Coder CLI already installed at $BinShim ($InstalledTag)." -ForegroundColor Cyan
        Write-Host "Re-run with -Force to reinstall." -ForegroundColor Cyan
        exit 0
    }
}

$Installed = Install-FromReleases
if (-not $Installed) {
    Write-Host ""
    Write-Host "Could not install from a GitHub release." -ForegroundColor Red
    Write-Host "This usually means no release exists for '$Version' yet." -ForegroundColor Yellow
    Write-Host "Push a v* tag to create a release, or build from source:" -ForegroundColor Yellow
    Write-Host "  git clone -b feat/desktop-unified-release https://github.com/$Repo.git" -ForegroundColor White
    Write-Host "  cd pi-mono && npm install --ignore-scripts && npm run build" -ForegroundColor White
    Write-Host "  cd packages/coding-agent && npm link" -ForegroundColor White
    throw "No release asset found for $Version."
}

if (-not (Test-Path $BinShim)) {
    throw "Could not find the a-coder-cli shim after install."
}

Add-ToPath -Dir $BinDir

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "A-Coder CLI installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Binary:     $BinShim"
Write-Host "  Config dir: $(Join-Path $env:USERPROFILE '.a-coder')"
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

# --- install the desktop app from the same release (best-effort) -------------
Install-Desktop
Write-Host "=================================================="