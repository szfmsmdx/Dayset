param(
    [ValidateRange(1, 64)]
    [int]$Jobs = 8
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$env:PATH = "$cargoBin;$env:PATH"

$sccache = Get-Command sccache -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $sccache) {
    $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $sccache = Get-ChildItem $wingetPackages -Directory -Filter 'Mozilla.sccache*' -ErrorAction SilentlyContinue |
        Get-ChildItem -Recurse -Filter sccache.exe -File -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName -First 1
}
if (-not $sccache) {
    throw 'sccache is missing. Run: winget install --id Mozilla.sccache --exact'
}

$previousWrapper = $env:RUSTC_WRAPPER
$previousJobs = $env:CARGO_BUILD_JOBS
$env:RUSTC_WRAPPER = $sccache
$env:CARGO_BUILD_JOBS = "$Jobs"

try {
    Push-Location (Join-Path $projectRoot 'apps\desktop')
    try {
        & npm run tauri -- build --bundles nsis
        if ($LASTEXITCODE -ne 0) {
            throw "Dayset build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
    & $sccache --show-stats
}
finally {
    $env:RUSTC_WRAPPER = $previousWrapper
    $env:CARGO_BUILD_JOBS = $previousJobs
}
