param([object[]]$Processes=@(),[ValidateSet('Prompt','DeferredNotice','ScheduleFailed')][string]$Action='Prompt')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HornetInstallerWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
$catalog = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'installer-files-in-use.json'),[Text.Encoding]::UTF8) | ConvertFrom-Json
$languages = @{'2052'='zh-CN';'1028'='zh-TW';'1041'='ja';'1042'='ko';'1031'='de';'1036'='fr';'3082'='es';'1034'='es'}
$language = $languages[$env:HORNET_INSTALL_LANGUAGE]
if (!$language) { $language='en' }
$text = $catalog.$language
$title = $text.title -f $env:HORNET_INSTALL_PRODUCT
if ($Action -ne 'Prompt') {
    $message = if ($Action -eq 'DeferredNotice') { $text.scheduled } else { $text.failed }
    [void][Windows.Forms.MessageBox]::Show($message,$title,[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Information)
    return 0
}
$form = New-Object Windows.Forms.Form
$form.Text=$title
$form.ClientSize=New-Object Drawing.Size(640,440)
$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false;$form.MinimizeBox=$false
$form.StartPosition='CenterScreen';$form.ShowInTaskbar=$true;$form.TopMost=$true
$form.AutoScaleMode='Dpi';$form.Font=New-Object Drawing.Font('Segoe UI',9)
$showTimer=New-Object Windows.Forms.Timer
$showTimer.Interval=100
$showTimer.add_Tick({
    # nsExec starts PowerShell with SW_HIDE. Explicitly show the native window
    # after its first ShowDialog call has consumed that startup flag.
    $showTimer.Stop()
    [void][HornetInstallerWindow]::ShowWindow($form.Handle,5)
    [void][HornetInstallerWindow]::SetForegroundWindow($form.Handle)
})
$iconPath=Join-Path $PSScriptRoot 'hornet-installer.ico'
$imagePath=Join-Path $PSScriptRoot 'hornet-installer.png'
$icon=$null;$bitmap=$null
if (Test-Path -LiteralPath $iconPath) { $icon=New-Object Drawing.Icon($iconPath);$form.Icon=$icon }
try {
    $header=New-Object Windows.Forms.Panel
    $header.SetBounds(0,0,640,83);$header.BackColor=[Drawing.Color]::White
    $form.Controls.Add($header)
    $heading=New-Object Windows.Forms.Label
    $heading.Text=$text.heading;$heading.SetBounds(18,15,540,24)
    $heading.Font=New-Object Drawing.Font($form.Font,[Drawing.FontStyle]::Bold)
    $header.Controls.Add($heading)
    $summary=New-Object Windows.Forms.Label
    $summary.Text=$text.summary;$summary.SetBounds(18,43,540,32);$header.Controls.Add($summary)
    if (Test-Path -LiteralPath $imagePath) {
        $picture=New-Object Windows.Forms.PictureBox
        $picture.SetBounds(566,10,60,60);$picture.SizeMode='Zoom';$bitmap=[Drawing.Image]::FromFile($imagePath);$picture.Image=$bitmap;$header.Controls.Add($picture)
    }
    $instructions=New-Object Windows.Forms.Label
    $instructions.Text=$text.instructions;$instructions.SetBounds(18,96,602,34);$form.Controls.Add($instructions)
    $list=New-Object Windows.Forms.ListView
    $list.SetBounds(18,134,604,142);$list.View='Details';$list.FullRowSelect=$true;$list.HideSelection=$false;$list.MultiSelect=$false
    [void]$list.Columns.Add($text.application,185);[void]$list.Columns.Add($text.process,95);[void]$list.Columns.Add($text.path,310)
    foreach ($group in @($Processes | Group-Object ExecutablePath)) {
        $first=$group.Group[0]
        $name=if ($first.Name -ieq 'NativeHost.exe') { $env:HORNET_INSTALL_PRODUCT+' - NativeHost' } else { $env:HORNET_INSTALL_PRODUCT }
        $item=New-Object Windows.Forms.ListViewItem($name)
        [void]$item.SubItems.Add(($group.Group.ProcessId -join ', '));[void]$item.SubItems.Add($first.ExecutablePath)
        [void]$list.Items.Add($item)
    }
    if ($list.Items.Count) { $list.Items[0].Selected=$true }
    $form.Controls.Add($list)
    $automatic=New-Object Windows.Forms.RadioButton
    $automatic.Text=$text.automatic;$automatic.SetBounds(18,286,604,32);$automatic.Checked=$true;$form.Controls.Add($automatic)
    $deferred=New-Object Windows.Forms.RadioButton
    $deferred.Text=$text.deferred;$deferred.SetBounds(18,320,604,34);$form.Controls.Add($deferred)
    $notice=New-Object Windows.Forms.Label
    $notice.Text=$text.notice;$notice.SetBounds(18,362,604,28);$notice.ForeColor=[Drawing.SystemColors]::GrayText;$form.Controls.Add($notice)
    $ok=New-Object Windows.Forms.Button
    $ok.Text=$text.ok;$ok.SetBounds(414,400,98,28);$ok.DialogResult='OK';$form.Controls.Add($ok)
    $cancel=New-Object Windows.Forms.Button
    $cancel.Text=$text.cancel;$cancel.SetBounds(524,400,98,28);$cancel.DialogResult='Cancel';$form.Controls.Add($cancel)
    $form.AcceptButton=$ok;$form.CancelButton=$cancel
    $form.add_Shown({$form.Activate();$form.BringToFront()})
    $showTimer.Start()
    $result=$form.ShowDialog()
    if ($result -ne [Windows.Forms.DialogResult]::OK) { return 12 }
    if ($deferred.Checked) { return 11 }
    return 10
} finally {
    $form.Dispose()
    $showTimer.Dispose()
    if ($bitmap) { $bitmap.Dispose() }
    if ($icon) { $icon.Dispose() }
}
