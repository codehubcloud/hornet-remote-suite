param([Parameter(Mandatory=$true)][ValidateSet('Detect','Close','Prompt','DeferredNotice','ScheduleFailed')][string]$Mode)
$ErrorActionPreference = 'Stop'
function Write-ProbeDiagnostic([string]$Message) {
    if ($env:HORNET_INSTALLER_DIAGNOSTICS) {
        # Optional diagnostics must never change process detection or setup.
        try { [IO.File]::AppendAllText($env:HORNET_INSTALLER_DIAGNOSTICS, ([DateTime]::UtcNow.ToString('o')+' '+$Mode+' '+$Message+[Environment]::NewLine)) } catch {}
    }
}
try {
    Write-ProbeDiagnostic 'started'
    if ($Mode -in @('DeferredNotice','ScheduleFailed')) {
        $result=& (Join-Path $PSScriptRoot 'installer-files-in-use.ps1') -Action $Mode
        exit $result
    }
    # All paths come from environment variables, never interpolated source.
    $roots = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($root in @($env:HORNET_INSTALL_DIRECTORY,$env:HORNET_INSTALL_PREVIOUS_USER,$env:HORNET_INSTALL_PREVIOUS_MACHINE)) {
        if ($root) { [void]$roots.Add([IO.Path]::GetFullPath($root).TrimEnd('\')) }
    }
    # Query only the two executable names we need. Enumerating every process
    # can exceed NSIS's bounded 15-second probe on busy Windows runners and
    # incorrectly present the installer error/retry dialog on a cold install.
    $appExecutable = $env:HORNET_INSTALL_EXECUTABLE.Replace("'", "''")
    $processes = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = '$appExecutable' OR Name = 'NativeHost.exe'" -ErrorAction Stop)
    $matched = New-Object 'System.Collections.Generic.List[object]'
    $identityCache = @{}
    foreach ($process in $processes) {
        if ($process.Name -ine $env:HORNET_INSTALL_EXECUTABLE) { continue }
        if (!$process.ExecutablePath) { throw 'Cannot inspect a possible running application.' }
        $path = [IO.Path]::GetFullPath($process.ExecutablePath)
        $directory = [IO.Path]::GetDirectoryName($path)
        $owned = $roots.Contains($directory)
        if (!$owned) {
            # Genuine Hornet can be running from an older/custom/unpacked
            # directory. A filename alone is not sufficient to close a process.
            if (!$identityCache.ContainsKey($path)) {
                $identity = [Diagnostics.FileVersionInfo]::GetVersionInfo($path)
                $identityCache[$path] = $identity.ProductName -eq $env:HORNET_INSTALL_PRODUCT -and $identity.CompanyName -eq $env:HORNET_INSTALL_COMPANY
            }
            $owned = $identityCache[$path]
        }
        if ($owned) { $matched.Add($process); [void]$roots.Add($directory) }
    }
    foreach ($process in $processes) {
        if ($process.Name -ine 'NativeHost.exe' -or !$process.ExecutablePath) { continue }
        foreach ($root in $roots) {
            if ($process.ExecutablePath -ieq (Join-Path $root 'resources\app.asar.unpacked\dist\NativeHost.exe')) {
                $matched.Add($process)
                break
            }
        }
    }
    if ($Mode -eq 'Detect') {
        Write-ProbeDiagnostic ('matched='+$matched.Count)
        if ($matched.Count -gt 0) { exit 0 }
        exit 1
    }
    if ($Mode -eq 'Prompt') {
        if ($matched.Count -eq 0) { exit 1 }
        $result=& (Join-Path $PSScriptRoot 'installer-files-in-use.ps1') -Processes $matched.ToArray()
        exit $result
    }
    foreach ($process in $matched) {
        # A process which exited during the check needs no further action.
        $live = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
        if ($live) { Stop-Process -InputObject $live -Force -ErrorAction Stop }
    }
    exit 0
} catch {
    Write-ProbeDiagnostic ($_.Exception.ToString())
    # Detection failures must not silently permit an overwrite.
    [Console]::Error.WriteLine('Installer process check failed: '+$_.Exception.Message)
    exit 2
}
