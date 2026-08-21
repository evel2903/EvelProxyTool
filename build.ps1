[CmdletBinding()]
param(
    [int]$BuildJobs,

    [string]$GitCodeGuiRepository = 'lzt404/EvelProxyTool',

    [string]$GitCodeCoreRepository = 'lzt404/CLIProxyAPI'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RootDir = $PSScriptRoot
$AppBin = Join-Path $RootDir 'src-tauri\target\release\cpa-gui.exe'
$BinDir = Join-Path $RootDir 'bin-work'
$BinOut = Join-Path $BinDir 'EvelProxyTool.exe'
$PortableScript = Join-Path $RootDir 'scripts\portable.mjs'

Set-Location -LiteralPath $RootDir

if (-not $PSBoundParameters.ContainsKey('BuildJobs')) {
    $BuildJobs = if ($env:CARGO_BUILD_JOBS) {
        [int]$env:CARGO_BUILD_JOBS
    }
    else {
        16
    }
}
if ($BuildJobs -lt 1 -or $BuildJobs -gt 256) {
    throw 'BuildJobs must be between 1 and 256.'
}
if ($GitCodeGuiRepository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'GitCodeGuiRepository must use the owner/repository format.'
}
if ($GitCodeCoreRepository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'GitCodeCoreRepository must use the owner/repository format.'
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw 'bun is not installed or not in PATH.'
}

Write-Host "Cargo build jobs: $BuildJobs"
Write-Host "GitCode GUI fallback repository: $GitCodeGuiRepository"
Write-Host "GitCode core fallback repository: $GitCodeCoreRepository"

& bun install
if ($LASTEXITCODE -ne 0) {
    throw "bun install failed with exit code $LASTEXITCODE."
}

$PreviousBuildJobs = $env:CARGO_BUILD_JOBS
$PreviousGitCodeGuiRepository = $env:GITCODE_GUI_REPOSITORY
$PreviousGitCodeCoreRepository = $env:GITCODE_CORE_REPOSITORY
try {
    $env:CARGO_BUILD_JOBS = [string]$BuildJobs
    $env:GITCODE_GUI_REPOSITORY = $GitCodeGuiRepository
    $env:GITCODE_CORE_REPOSITORY = $GitCodeCoreRepository
    & bun tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $PreviousBuildJobs) {
        Remove-Item Env:CARGO_BUILD_JOBS -ErrorAction SilentlyContinue
    }
    else {
        $env:CARGO_BUILD_JOBS = $PreviousBuildJobs
    }
    if ($null -eq $PreviousGitCodeGuiRepository) {
        Remove-Item Env:GITCODE_GUI_REPOSITORY -ErrorAction SilentlyContinue
    }
    else {
        $env:GITCODE_GUI_REPOSITORY = $PreviousGitCodeGuiRepository
    }
    if ($null -eq $PreviousGitCodeCoreRepository) {
        Remove-Item Env:GITCODE_CORE_REPOSITORY -ErrorAction SilentlyContinue
    }
    else {
        $env:GITCODE_CORE_REPOSITORY = $PreviousGitCodeCoreRepository
    }
}

if (-not (Test-Path -LiteralPath $AppBin -PathType Leaf)) {
    throw "Build finished, but executable not found: $AppBin"
}

& bun $PortableScript --binary $AppBin --output $BinDir --download true --preserve-runtime-config true
if ($LASTEXITCODE -ne 0) {
    throw "Portable preparation failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $BinOut -PathType Leaf)) {
    throw "Portable preparation finished, but executable not found: $BinOut"
}

$CoreOut = Join-Path $BinDir 'cpa-core'
$CoreArchives = @(
    Get-ChildItem -LiteralPath $CoreOut -File |
        Where-Object { $_.Name -match '^CLIProxyAPI_.+_windows_.+\.zip$' }
)
if ($CoreArchives.Count -ne 1) {
    throw "Portable core output must contain exactly one Windows core archive: $CoreOut"
}

Write-Host "Built: $AppBin"
Write-Host "Copied: $BinOut"
Write-Host "Bundled core archive: $($CoreArchives[0].FullName)"
