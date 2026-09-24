param(
    [ValidateSet('start', 'check', 'build', 'test', 'desktop-test')]
    [string]$Action = 'start'
)
$ErrorActionPreference = 'Stop'
$previousLocation = Get-Location
$previousPath = $env:PATH
try {
    Set-Location -LiteralPath $PSScriptRoot
    $portableDirectory = Join-Path $PSScriptRoot '..\.tools\node-v24.21.0-win-x64'
    if (Test-Path -LiteralPath (Join-Path $portableDirectory 'node.exe')) {
        $env:PATH = (Resolve-Path -LiteralPath $portableDirectory).Path + ';' + $env:PATH
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js 24 LTS is required. Install Node.js, then run npm ci in src.'
    }
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        throw 'Dependencies are missing. Run npm ci in src first.'
    }
    if ($Action -eq 'start') {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
        & npm.cmd start
    } elseif ($Action -eq 'desktop-test') {
        & npm.cmd run test:desktop
    } elseif ($Action -eq 'test') {
        & npm.cmd test
    } else {
        & npm.cmd run $Action
    }
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Action" }
} finally {
    $env:PATH = $previousPath
    Set-Location -LiteralPath $previousLocation
}
