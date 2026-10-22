# Exercise the real electron-builder NSIS lifecycle with a disposable app and
# a unique app ID. Never install over the user's Hornet or use its user data.
param([string]$StartupProbeInstaller,[string]$StartupProbeDirectory)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('hornet-installer-' + [guid]::NewGuid().ToString('N'))
$fixtureName = 'Hornet Installer Check'
$installDirectory = Join-Path $fixtureRoot ("install\User's " + $fixtureName)
$unrelatedDirectory = $installDirectory + '-other'
$unpackedDirectory = Join-Path $fixtureRoot 'unpacked'
$outputDirectory = Join-Path $fixtureRoot 'output'
$fixtureProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$fixtureGuid = [guid]::NewGuid().ToString()
$startupPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'HornetSetup-' + $fixtureGuid
$oldRunOncePath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
$oldRunOnceName = '!HornetSetup-' + $fixtureGuid
$fixtureCache = Join-Path $env:LOCALAPPDATA ($fixtureName + '\Installer\' + $fixtureGuid)
$previousDiagnostics = $env:HORNET_INSTALLER_DIAGNOSTICS
$env:HORNET_INSTALLER_DIAGNOSTICS = $fixtureRoot + '.probe.log'
Add-Type -ReferencedAssemblies System.Drawing,Accessibility @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerUI {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr window, EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int count);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window,IntPtr hdc,uint flags);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr window,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out object value);
  public static bool IsRadioChecked(IntPtr window) {
    var iid=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");object value;
    if(AccessibleObjectFromWindow(window,0xfffffffc,ref iid,out value)!=0)throw new InvalidOperationException("Radio accessibility unavailable");
    return (Convert.ToInt32(((Accessibility.IAccessible)value).get_accState(0))&0x10)!=0;
  }
  public static string Text(IntPtr window) {var text=new StringBuilder(4096);GetWindowText(window,text,text.Capacity);return text.ToString();}
  public static IntPtr[] Windows(string title) {var found=new List<IntPtr>();EnumWindows((w,p)=>{if(IsWindowVisible(w)&&Text(w).Contains(title))found.Add(w);return true;},IntPtr.Zero);return found.ToArray();}
  public static IntPtr[] Children(IntPtr window) {var found=new List<IntPtr>();EnumChildWindows(window,(w,p)=>{if(IsWindowVisible(w))found.Add(w);return true;},IntPtr.Zero);return found.ToArray();}
  public static void CloseFixtureDialogs(string title) {EnumWindows((w,p)=>{if(Text(w).Contains(title))PostMessage(w,0x10,IntPtr.Zero,IntPtr.Zero);return true;},IntPtr.Zero);}
  public static void ClickControl(IntPtr window) {PostMessage(window,0xF5,IntPtr.Zero,IntPtr.Zero);}
  public static void SaveWindow(IntPtr window,string path) {
    Rect rect;GetWindowRect(window,out rect);
    using(var bitmap=new System.Drawing.Bitmap(rect.Right-rect.Left,rect.Bottom-rect.Top))using(var graphics=System.Drawing.Graphics.FromImage(bitmap)){
      var hdc=graphics.GetHdc();try{PrintWindow(window,hdc,2);}finally{graphics.ReleaseHdc(hdc);}
      bitmap.Save(path,System.Drawing.Imaging.ImageFormat.Png);
    }
  }
  public static void Click(IntPtr window,int id) {
    var control=GetDlgItem(window,id);
    if(control==IntPtr.Zero)foreach(var child in Children(window)){
      var name=Text(child).Replace("&","").Trim();
      var kind=new StringBuilder(256);GetClassName(child,kind,kind.Capacity);
      if(kind.ToString().ToUpperInvariant().Contains("BUTTON")&&((id==1&&(name=="OK"||name=="\u786e\u5b9a"||name=="\u78ba\u5b9a"))||(id==2&&(name=="Cancel"||name=="\u53d6\u6d88")))){control=child;break;}
    }
    if(control!=IntPtr.Zero)ClickControl(control);
  }
}
'@

function Wait-Condition([scriptblock]$Condition, [string]$Description, [int]$Seconds = 25) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out: $Description"
}

function Start-FixtureInstaller([string]$InstallerPath=$script:installer,[switch]$Resume) {
    $arguments = if ($Resume) { '--hornet-restart-after-install' } else { "/currentuser /D=$installDirectory" }
    # The persistent logon entry launches the resumed interactive wizard normally. SW_HIDE would
    # hide its first window, leaving the simulated sign-in unable to proceed.
    $windowStyle = if ($Resume) { 'Normal' } else { 'Hidden' }
    $process = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -WindowStyle $windowStyle -PassThru
    $fixtureProcesses.Add($process)
    $script:installerProcess = $process
}

function Is-RadioChecked([IntPtr]$Handle) {
    return [InstallerUI]::IsRadioChecked($Handle)
}

function Wait-InstallerPage([string]$Expected, [switch]$NoAdvance) {
    $deadline = [DateTime]::UtcNow.AddSeconds(65)
    $lastText = ''
    while ([DateTime]::UtcNow -lt $deadline) {
        foreach ($window in [InstallerUI]::Windows($fixtureName)) {
            $children = [InstallerUI]::Children($window)
            $text = ($children | ForEach-Object { [InstallerUI]::Text($_) }) -join "`n"
            $lastText = $text
            if ($text -match 'is running|Files in Use') {
                if ($Expected -eq 'confirm') { return $window }
                throw 'Unexpected running-app confirmation in a cold install.'
            }
            if ($text -match 'has been installed|Completing .+ Setup') {
                if ($Expected -eq 'finish') { return $window }
                throw "Expected a running-app confirmation, but installation completed. Controls: $text"
            }
            $next = [InstallerUI]::GetDlgItem($window, 1)
            if (!$NoAdvance -and [InstallerUI]::IsWindowEnabled($next) -and ([InstallerUI]::Text($next) -match 'Next|Install')) {
                [InstallerUI]::Click($window, 1)
            }
        }
        Start-Sleep -Milliseconds 350
    }
    throw "Installer did not reach $Expected. Last controls: $lastText"
}

function Complete-RunningInstall([string]$MarkerPath,[int]$ExpectedStarts) {
    $script:completionText=''
    try {
    Wait-Condition {
        foreach ($window in [InstallerUI]::Windows($fixtureName)) {
            $text = ([InstallerUI]::Children($window) | ForEach-Object { [InstallerUI]::Text($_) }) -join "`n"
            $script:completionText=$text
            if ($text -match 'is running|Files in Use') { throw 'Unexpected second confirmation without an app restart.' }
            $next = [InstallerUI]::GetDlgItem($window,1)
            if ([InstallerUI]::IsWindowEnabled($next) -and ([InstallerUI]::Text($next) -match 'Next|Install')) { [InstallerUI]::Click($window,1) }
        }
        (Test-Path -LiteralPath $MarkerPath) -and @(Get-Content -LiteralPath $MarkerPath).Count -eq $ExpectedStarts -and ([InstallerUI]::Windows($fixtureName)).Count -eq 0
    } 'successful installation, automatic reopen and installer exit' 65
    Wait-Condition { $script:installerProcess.Refresh();$script:installerProcess.HasExited } 'completed installer process exit'
    } catch {
        $script:installerProcess.Refresh()
        Write-Host ('Completion state: exit='+$script:installerProcess.ExitCode+'; starts='+@(Get-Content -LiteralPath $MarkerPath -ErrorAction SilentlyContinue).Count+'; controls='+$script:completionText)
        throw
    }
}

if ($StartupProbeInstaller) {
    # Real application probe: only cancel the startup confirmation. Never click
    # Next/Install/OK or close a real running Hornet during this test.
    if (!$StartupProbeDirectory) { throw 'An isolated startup probe directory is required.' }
    $probe = Start-Process -FilePath $StartupProbeInstaller -ArgumentList "/currentuser /D=$StartupProbeDirectory" -WindowStyle Hidden -PassThru
    try {
        $script:probeConfirmation = [IntPtr]::Zero
        Wait-Condition {
            foreach ($window in [InstallerUI]::Windows('Hornet Remote Suite')) {
                $text = ([InstallerUI]::Children($window) | ForEach-Object { [InstallerUI]::Text($_) }) -join "`n"
                # ASCII escapes keep the regex correct when Windows PowerShell
                # 5.1 reads an UTF-8 script without a BOM on a Chinese system.
                if ($text -match 'Files in Use|\u6b63\u5728\u4f7f\u7528\u7684\u6587\u4ef6') { $script:probeConfirmation = $window; return $true }
            }
            $false
        } 'real installer startup confirmation without navigating any setup page' 30
        $snapshot=Join-Path $projectDirectory 'test-results\installer-files-in-use.png'
        New-Item -ItemType Directory -Path (Split-Path $snapshot -Parent) -Force | Out-Null
        [InstallerUI]::SaveWindow($script:probeConfirmation,$snapshot)
        [InstallerUI]::Click($script:probeConfirmation,2)
        if (!$probe.WaitForExit(15000) -or $probe.ExitCode -ne 2) { throw 'Real installer did not cancel without installation.' }
        Write-Output 'Real installer startup confirmation passed: running genuine app in a different directory; Cancel only, no Next/Install click.'
    } catch {
        if (Test-Path -LiteralPath $env:HORNET_INSTALLER_DIAGNOSTICS) { Get-Content -LiteralPath $env:HORNET_INSTALLER_DIAGNOSTICS | Write-Host }
        throw
    } finally {
        $probe.Refresh();if (!$probe.HasExited) { Stop-Process -Id $probe.Id -Force }
        Remove-Item -LiteralPath ($fixtureRoot + '.probe.log') -ErrorAction SilentlyContinue
        $env:HORNET_INSTALLER_DIAGNOSTICS = $previousDiagnostics
    }
    exit 0
}

try {
    [InstallerUI]::CloseFixtureDialogs($fixtureName)
    New-Item -ItemType Directory -Path $unpackedDirectory,$unrelatedDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $unpackedDirectory 'resources') -Force | Out-Null
    $fixtureSource = @'
using System;
using System.IO;
using System.Threading;
[assembly:System.Reflection.AssemblyProduct("Hornet Installer Check")]
[assembly:System.Reflection.AssemblyCompany("codehubcloud")]
public class FixtureApp {
  public static void Main() {
    var directory=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    File.AppendAllText(Path.Combine(Directory.GetParent(directory).FullName,Path.GetFileName(directory)+".started.txt"),System.Diagnostics.Process.GetCurrentProcess().Id+Environment.NewLine);
    Thread.Sleep(Timeout.Infinite);
  }
}
'@
    $sourcePath = Join-Path $fixtureRoot 'fixture.cs'
    [IO.File]::WriteAllText($sourcePath, $fixtureSource)
    $fixtureExecutable = Join-Path $unpackedDirectory ($fixtureName + '.exe')
    & (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') /nologo /target:winexe ("/out:" + $fixtureExecutable) $sourcePath
    if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed.' }
    # Use production installer hooks with a unique registry identity and no shortcuts.
    $originalConfig = (Join-Path $projectDirectory 'electron-builder.cjs') | ConvertTo-Json -Compress
    $fixtureOutput = $outputDirectory | ConvertTo-Json -Compress
    $fixtureAppId = ('com.codehubcloud.hornet.installertest.' + [guid]::NewGuid().ToString('N')) | ConvertTo-Json -Compress
    $configPath = Join-Path $fixtureRoot 'fixture.cjs'
    $config = "const base=require($originalConfig);module.exports={...base,appId:$fixtureAppId,productName:'$fixtureName',directories:{...base.directories,output:$fixtureOutput},beforePack:undefined,afterPack:undefined,nsis:{...base.nsis,guid:'$fixtureGuid',installerLanguages:['en_US'],createDesktopShortcut:false,createStartMenuShortcut:false,artifactName:'installer.exe'}};"
    [IO.File]::WriteAllText($configPath, $config)
    Push-Location $projectDirectory
    try {
        & npx.cmd --no-install electron-builder --config $configPath --win nsis --x64 --prepackaged $unpackedDirectory --publish never
        if ($LASTEXITCODE -ne 0) { throw 'Fixture installer build failed.' }
    } finally { Pop-Location }
    $script:installer = Join-Path $outputDirectory 'installer.exe'
    $appPath = Join-Path $installDirectory ($fixtureName + '.exe')
    # The old-version uninstaller removes its app directory. Keep the observer
    # outside that directory so a successful upgrade cannot erase the evidence.
    $marker = Join-Path (Split-Path $installDirectory -Parent) ([IO.Path]::GetFileName($installDirectory) + '.started.txt')
    # A stopped app must retain the standard Finish page and launch checkbox.
    Start-FixtureInstaller
    $finish = Wait-InstallerPage 'finish'
    if (!(Test-Path -LiteralPath $appPath) -or (Test-Path -LiteralPath $marker)) { throw 'Cold install launched early or did not install.' }
    $run = [InstallerUI]::Children($finish) | Where-Object { [InstallerUI]::Text($_) -match '^&?Run ' } | Select-Object -First 1
    if (!$run) { throw 'Normal run-after-finish checkbox is missing.' }
    if ([InstallerUI]::SendMessage($run, 0xF0, [IntPtr]::Zero, [IntPtr]::Zero) -ne [IntPtr]1) { throw 'Normal launch checkbox is not checked by default.' }
    [void][InstallerUI]::SendMessage($run, 0xF1, [IntPtr]::Zero, [IntPtr]::Zero) # BM_SETCHECK, BST_UNCHECKED
    [InstallerUI]::Click($finish, 1)
    Wait-Condition { ([InstallerUI]::Windows($fixtureName)).Count -eq 0 } 'cold installer exit'
    Wait-Condition { $script:installerProcess.Refresh(); $script:installerProcess.HasExited } 'cold installer process exit'
    if (Test-Path -LiteralPath $marker) { throw 'Cold install ignored the unchecked launch option.' }
    Write-Output 'Cold install passed: standard Finish page and optional launch.'
    # Same executable name in another directory must not be terminated.
    $otherApp = Join-Path $unrelatedDirectory ($fixtureName + '.exe')
    $otherSource = Join-Path $fixtureRoot 'unrelated.cs'
    [IO.File]::WriteAllText($otherSource,$fixtureSource.Replace('AssemblyProduct("Hornet Installer Check")','AssemblyProduct("Other Product")'))
    & (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') /nologo /target:winexe ("/out:" + $otherApp) $otherSource
    if ($LASTEXITCODE -ne 0) { throw 'Unrelated fixture compilation failed.' }
    $otherProcess = Start-Process -FilePath $otherApp -WindowStyle Hidden -PassThru
    $fixtureProcesses.Add($otherProcess)
    $runningApp = Start-Process -FilePath $appPath -WindowStyle Hidden -PassThru
    $fixtureProcesses.Add($runningApp)
    Wait-Condition { Test-Path -LiteralPath $marker } 'initial app startup'
    $runningApp.Refresh()
    if ($runningApp.HasExited) { throw 'Fixture exited before upgrade.' }
    $beforeHash = (Get-FileHash -LiteralPath $appPath -Algorithm SHA256).Hash
    Start-FixtureInstaller
    $confirmation = Wait-InstallerPage 'confirm' -NoAdvance
    [InstallerUI]::Click($confirmation, 2)
    Wait-Condition { ([InstallerUI]::Windows($fixtureName)).Count -eq 0 } 'cancelled installer exit'
    Wait-Condition { $script:installerProcess.Refresh(); $script:installerProcess.HasExited } 'cancelled installer process exit'
    $runningApp.Refresh()
    if ($runningApp.HasExited -or (Get-FileHash -LiteralPath $appPath -Algorithm SHA256).Hash -ne $beforeHash) { throw 'Cancel changed the running app.' }
    if ((Get-ItemProperty -LiteralPath $startupPath -Name $startupName -ErrorAction SilentlyContinue).$startupName) { throw 'Cancel scheduled an installation.' }
    Write-Output 'Startup prompt and cancellation passed: no Next/Install click; existing process and executable retained.'
    $silent = Start-Process -FilePath $script:installer -ArgumentList "/S /currentuser /D=$installDirectory" -WindowStyle Hidden -PassThru
    $fixtureProcesses.Add($silent)
    if (!$silent.WaitForExit(30000) -or $silent.ExitCode -ne 2) { throw 'Silent install did not refuse to close a running app.' }
    $runningApp.Refresh()
    if ($runningApp.HasExited -or (Get-FileHash -LiteralPath $appPath -Algorithm SHA256).Hash -ne $beforeHash) { throw 'Silent install modified the running app.' }
    Write-Output 'Silent install passed: running app retained without implicit close approval.'
    Start-FixtureInstaller
    $confirmation = Wait-InstallerPage 'confirm' -NoAdvance
    $automatic=[InstallerUI]::Children($confirmation) | Where-Object { [InstallerUI]::Text($_) -like 'Automatically close*' } | Select-Object -First 1
    $deferred=[InstallerUI]::Children($confirmation) | Where-Object { [InstallerUI]::Text($_) -like 'Do not close applications*' } | Select-Object -First 1
    if (!$automatic -or !$deferred) { throw 'Files-in-use choice controls missing.' }
    if (!(Is-RadioChecked $automatic)) { throw 'Automatic close is not the default.' }
    [InstallerUI]::ClickControl($deferred)
    Wait-Condition { Is-RadioChecked $deferred } 'deferred radio selection'
    [InstallerUI]::Click($confirmation,1)
    $script:scheduledNotice=[IntPtr]::Zero
    Wait-Condition {
        foreach ($window in [InstallerUI]::Windows($fixtureName)) {
            $text=([InstallerUI]::Children($window) | ForEach-Object { [InstallerUI]::Text($_) }) -join "`n"
            if ($text -match 'Setup has been scheduled') { $script:scheduledNotice=$window;return $true }
        }
        $false
    } 'deferred install notice'
    [InstallerUI]::Click($script:scheduledNotice,1)
    Wait-Condition { $script:installerProcess.Refresh();$script:installerProcess.HasExited } 'deferred installer exit'
    $runningApp.Refresh()
    if ($script:installerProcess.ExitCode -ne 3010 -or $runningApp.HasExited -or (Get-FileHash -LiteralPath $appPath).Hash -ne $beforeHash) { throw 'Deferred install closed or modified the existing app.' }
    $cachedInstaller=Join-Path $fixtureCache 'pending.exe'
    $pendingCommand=(Get-ItemProperty -LiteralPath $startupPath -Name $startupName).$startupName
    $expectedCommand='"'+$cachedInstaller+'" --hornet-restart-after-install'
    if ($pendingCommand -ne $expectedCommand -or (Get-FileHash -LiteralPath $cachedInstaller).Hash -ne (Get-FileHash -LiteralPath $script:installer).Hash) { throw 'Deferred logon command or cached payload mismatch.' }
    if ((Get-ItemProperty -LiteralPath $oldRunOncePath -Name $oldRunOnceName -ErrorAction SilentlyContinue).$oldRunOnceName) { throw 'Deferred setup retained a competing RunOnce registration.' }
    # Simulate a new sign-in only for this fixture; do not reboot the computer
    # or execute command text read from the registry.
    Stop-Process -Id $runningApp.Id -Force
    Start-Sleep -Milliseconds 1000 # A real reboot also releases the old setup mutex.
    Write-Output ('Resuming cached fixture: '+$cachedInstaller)
    Start-FixtureInstaller -InstallerPath $cachedInstaller -Resume
    Complete-RunningInstall $marker 2
    if ((Get-ItemProperty -LiteralPath $startupPath -Name $startupName -ErrorAction SilentlyContinue).$startupName) { throw 'Successful resume retained its logon registration.' }
    $runningApp=Get-Process -Id ([int](@(Get-Content -LiteralPath $marker)[-1]))
    $fixtureProcesses.Add($runningApp)
    Write-Output 'Deferred branch passed: app retained, installer cached, persistent logon registration and reboot-required status, resumed install reopens once and clears registration.'
    $expectedStarts=@(Get-Content -LiteralPath $marker).Count+1
    Start-FixtureInstaller
    $confirmation = Wait-InstallerPage 'confirm' -NoAdvance
    [InstallerUI]::Click($confirmation, 1)
    Wait-Condition { $runningApp.Refresh(); $runningApp.HasExited } 'confirmed automatic close'
    Complete-RunningInstall $marker $expectedStarts
    $restartedPid = [int](@(Get-Content -LiteralPath $marker)[-1])
    $restarted = Get-Process -Id $restartedPid -ErrorAction Stop
    $fixtureProcesses.Add($restarted)
    $otherProcess.Refresh()
    if ($otherProcess.HasExited) { throw 'Installer closed an unrelated executable.' }
    Start-Sleep -Milliseconds 700
    if (@(Get-Content -LiteralPath $marker).Count -ne $expectedStarts) { throw 'App reopened more than once.' }
    Write-Output 'Running upgrade passed: prompt, confirmed close, successful install, automatic single reopen; unrelated app retained.'
    # Only a genuine portable copy is running. The selected target is new and
    # the registry still names the old folder, so identity discovery is needed.
    Stop-Process -Id $restarted.Id -Force
    $originalInstallDirectory = $installDirectory
    $portableDirectory = Join-Path $fixtureRoot 'portable'
    New-Item -ItemType Directory -Path $portableDirectory -Force | Out-Null
    $portableApp = Join-Path $portableDirectory ($fixtureName + '.exe')
    Copy-Item -LiteralPath $fixtureExecutable -Destination $portableApp
    $portable = Start-Process -FilePath $portableApp -WindowStyle Hidden -PassThru
    $fixtureProcesses.Add($portable)
    Wait-Condition { Test-Path -LiteralPath (Join-Path $fixtureRoot 'portable.started.txt') } 'portable app startup'
    $installDirectory = Join-Path $fixtureRoot ("relocated\User's " + $fixtureName)
    Start-FixtureInstaller
    $confirmation = Wait-InstallerPage 'confirm' -NoAdvance
    [InstallerUI]::Click($confirmation,2)
    Wait-Condition { $script:installerProcess.Refresh();$script:installerProcess.HasExited } 'portable cancellation'
    $portable.Refresh()
    if ($portable.HasExited -or (Test-Path -LiteralPath (Join-Path $installDirectory ($fixtureName + '.exe')))) { throw 'Cancelled portable detection changed an application.' }
    Write-Output 'Portable startup prompt and cancellation passed for a different target directory.'
    Start-FixtureInstaller
    $confirmation = Wait-InstallerPage 'confirm' -NoAdvance
    [InstallerUI]::Click($confirmation,1)
    Wait-Condition { $portable.Refresh();$portable.HasExited } 'portable app confirmed close'
    $relocatedMarker = Join-Path (Split-Path $installDirectory -Parent) ([IO.Path]::GetFileName($installDirectory) + '.started.txt')
    Complete-RunningInstall $relocatedMarker 1
    $portable.Refresh();$otherProcess.Refresh()
    if (!$portable.HasExited -or $otherProcess.HasExited) { throw 'Portable close or unrelated-process protection failed.' }
    Write-Output 'Portable and changed-directory install passed: immediate confirmation, cancel protection, confirmed close and reopen from the new target.'
} catch {
    Write-Host ('Installer lifecycle failure: ' + $_.Exception.Message)
    if (Test-Path -LiteralPath $env:HORNET_INSTALLER_DIAGNOSTICS) { Get-Content -LiteralPath $env:HORNET_INSTALLER_DIAGNOSTICS | Write-Host }
    throw
} finally {
    Remove-Item -LiteralPath ($fixtureRoot + '.probe.log') -ErrorAction SilentlyContinue
    $env:HORNET_INSTALLER_DIAGNOSTICS = $previousDiagnostics
    if (Test-Path -LiteralPath $startupPath) { Remove-ItemProperty -LiteralPath $startupPath -Name $startupName -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $oldRunOncePath) { Remove-ItemProperty -LiteralPath $oldRunOncePath -Name $oldRunOnceName -ErrorAction SilentlyContinue }
    $pendingState='HKCU:\Software\'+$fixtureGuid+'\PendingInstall'
    if (Test-Path -LiteralPath $pendingState) { Remove-Item -LiteralPath $pendingState -Force }
    foreach ($window in [InstallerUI]::Windows($fixtureName)) { [InstallerUI]::Click($window,2) }
    $fixturePaths = @((Join-Path $installDirectory ($fixtureName + '.exe')), (Join-Path $unrelatedDirectory ($fixtureName + '.exe')))
    if ($portableApp) { $fixturePaths += $portableApp }
    if ($originalInstallDirectory) { $fixturePaths += Join-Path $originalInstallDirectory ($fixtureName + '.exe') }
    Get-CimInstance Win32_Process -Filter "Name='$fixtureName.exe'" | Where-Object { $_.ExecutablePath -and $fixturePaths -contains $_.ExecutablePath } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($process in $fixtureProcesses) {
        $process.Refresh()
        if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    }
    # Remove only this isolated fixture's uninstall registration and files.
    $uninstaller = Join-Path $installDirectory ('Uninstall ' + $fixtureName + '.exe')
    if (Test-Path -LiteralPath $uninstaller) {
        $cleanup = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru
        if (!$cleanup.WaitForExit(30000)) { throw "Fixture uninstall timed out; retained $fixtureRoot" }
    }
    # Cache cleanup is limited to this test's unique NSIS GUID directory.
    $cacheBase=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA ($fixtureName+'\Installer'))).TrimEnd('\')+'\'
    $cacheAbsolute=[IO.Path]::GetFullPath($fixtureCache)
    if (!$cacheAbsolute.StartsWith($cacheBase,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($cacheAbsolute) -ne $fixtureGuid) { throw 'Refusing cache cleanup outside the fixture GUID.' }
    $cachedFile=Join-Path $cacheAbsolute 'pending.exe'
    if (Test-Path -LiteralPath $cachedFile) { Remove-Item -LiteralPath $cachedFile -Force }
    if ((Test-Path -LiteralPath $cacheAbsolute) -and @(Get-ChildItem -LiteralPath $cacheAbsolute -Force).Count -eq 0) { Remove-Item -LiteralPath $cacheAbsolute -Force }
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$resolvedFixture.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or ([IO.Path]::GetFileName($resolvedFixture) -notmatch '^hornet-installer-[a-f0-9]{32}$')) { throw 'Refusing cleanup outside fixture directory.' }
    for ($attempt=0;$attempt -lt 10;$attempt++) {
        try { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force; break }
        catch { if ($attempt -eq 9) { Write-Warning "Fixture cleanup pending at $resolvedFixture" } else { Start-Sleep -Milliseconds 300 } }
    }
}
