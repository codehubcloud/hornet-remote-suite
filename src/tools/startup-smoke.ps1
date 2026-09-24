$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HornetStartupWindow {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
}
'@
$sourceRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$originalData = $env:HORNET_USER_DATA
$originalSmoke = $env:HORNET_SMOKE
$testData = Join-Path ([IO.Path]::GetTempPath()) ('hornet-startup-' + [guid]::NewGuid())
$launcher = $null
$desktop = $null
$second = $null
try {
    $env:HORNET_USER_DATA = $testData
    $env:HORNET_SMOKE = $null
    $launcher = Start-Process -FilePath $node -ArgumentList 'tools/start.mjs' -WorkingDirectory $sourceRoot -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 250
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.Id) AND Name = 'electron.exe'" | Select-Object -First 1
        if ($child) { $desktop = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
        if ($desktop) { $desktop.Refresh() }
    } until (($desktop -and $desktop.MainWindowHandle -ne 0) -or (Get-Date) -gt $deadline)
    if (-not $desktop -or $desktop.MainWindowHandle -eq 0) { throw 'The real launcher did not create a visible desktop window.' }
    $handle = $desktop.MainWindowHandle
    if (-not [HornetStartupWindow]::IsWindowVisible($handle)) { throw 'Desktop window is hidden.' }
    [void][HornetStartupWindow]::ShowWindow($handle, 6)
    if (-not [HornetStartupWindow]::IsIconic($handle)) { throw 'Could not minimize the desktop for the restore test.' }
    $second = Start-Process -FilePath $node -ArgumentList 'tools/start.mjs' -WorkingDirectory $sourceRoot -WindowStyle Hidden -PassThru
    if (-not $second.WaitForExit(15000)) { throw 'Second launcher did not exit.' }
    if ($second.ExitCode -ne 0) { throw 'Second launcher failed.' }
    $deadline = (Get-Date).AddSeconds(5)
    while ([HornetStartupWindow]::IsIconic($handle) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if ([HornetStartupWindow]::IsIconic($handle) -or -not [HornetStartupWindow]::IsWindowVisible($handle)) { throw 'Second launch did not restore the existing window.' }
    Write-Output 'Startup smoke passed: real launcher shows a window; second launch restores it.'
} finally {
    if ($desktop) { Stop-Process -Id $desktop.Id -ErrorAction SilentlyContinue }
    foreach ($helper in @($second, $launcher)) {
        if ($helper -and -not $helper.HasExited) { Stop-Process -Id $helper.Id -ErrorAction SilentlyContinue }
    }
    $env:HORNET_USER_DATA = $originalData
    $env:HORNET_SMOKE = $originalSmoke
    # The isolated test profile is retained in the OS temp directory for diagnosis.
}
