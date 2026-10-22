; Reuse electron-builder's localized messages and standard uninstall flow.
; A successful interactive install which found the app running skips Finish
; and reopens it automatically. A stopped app retains the standard Finish UI.
!ifndef BUILD_UNINSTALLER
  Var HornetWasRunning
  Var HornetCloseAttempts
  Var HornetPowerShell
  Var HornetDidStart
  Var HornetDeferredDirectory
  Var HornetDeferredCommand

  !macro customInit
    StrCpy $HornetWasRunning "0"
    StrCpy $HornetDidStart "0"
    StrCpy $HornetPowerShell "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    ${StdUtils.TestParameter} $R0 "hornet-restart-after-install"
    ${If} $R0 == "true"
      StrCpy $HornetWasRunning "1"
      ; Clear the retrying logon entry only after the deferred installer starts.
      ; A persistent entry permits another sign-in attempt if startup is blocked.
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HornetSetup-${APP_GUID}"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "!HornetSetup-${APP_GUID}"
      ReadRegStr $R1 HKCU "Software\${APP_GUID}\PendingInstall" InstallMode
      ${If} $R1 == "all"
        !insertmacro setInstallModePerAllUsers
      ${EndIf}
      ReadRegStr $R1 HKCU "Software\${APP_GUID}\PendingInstall" InstallLocation
      ${If} $R1 != ""
        StrCpy $INSTDIR $R1
      ${EndIf}
    ${EndIf}
    InitPluginsDir
    File /oname=$PLUGINSDIR\hornet-installer-processes.ps1 "${BUILD_RESOURCES_DIR}\installer-processes.ps1"
    File /oname=$PLUGINSDIR\installer-files-in-use.ps1 "${BUILD_RESOURCES_DIR}\installer-files-in-use.ps1"
    File /oname=$PLUGINSDIR\installer-files-in-use.json "${BUILD_RESOURCES_DIR}\installer-files-in-use.json"
    File /oname=$PLUGINSDIR\hornet-installer.ico "${BUILD_RESOURCES_DIR}\icons\icon.ico"
    File /oname=$PLUGINSDIR\hornet-installer.png "${BUILD_RESOURCES_DIR}\icons\icon.png"
    ; Ask as soon as setup opens, rather than waiting until file replacement.
    Call HornetCheckAppRunning
  !macroend

  !macro customCheckAppRunning
    ; Check again after directory/mode selection in case the app was restarted.
    Call HornetCheckAppRunning
  !macroend

  !macro customInstall
    ; A successful manual or resumed installation supersedes any pending setup.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HornetSetup-${APP_GUID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "!HornetSetup-${APP_GUID}"
    DeleteRegKey HKCU "Software\${APP_GUID}\PendingInstall"
  !macroend

  !macro customHeader
  Function HornetCheckAppRunning
    ; Environment variables pass literal paths, including apostrophes, without
    ; interpolating the directory into PowerShell source. Do not kill by name.
    System::Call 'kernel32::SetEnvironmentVariable(t "HORNET_INSTALL_DIRECTORY", t "$INSTDIR")'
    System::Call 'kernel32::SetEnvironmentVariable(t "HORNET_INSTALL_EXECUTABLE", t "${APP_EXECUTABLE_FILENAME}")'
    System::Call 'kernel32::SetEnvironmentVariable(t "HORNET_INSTALL_PRODUCT", t "${PRODUCT_NAME}")'
    System::Call 'kernel32::SetEnvironmentVariable(t "HORNET_INSTALL_COMPANY", t "${COMPANY_NAME}")'
    System::Call 'kernel32::SetEnvironmentVariable(t "HORNET_INSTALL_LANGUAGE", t "$LANGUAGE")'
    StrCpy $R1 ""
    ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    System::Call 'kernel32::SetEnvironmentVariable(t "HORNET_INSTALL_PREVIOUS_USER", t "$R1")'
    StrCpy $R1 ""
    ReadRegStr $R1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    System::Call 'kernel32::SetEnvironmentVariable(t "HORNET_INSTALL_PREVIOUS_MACHINE", t "$R1")'
    hornet_detect:
    Call HornetFindRunning
    ${If} $R0 != 0
    ${AndIf} $R0 != 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY hornet_detect
      SetErrorLevel 2
      Quit
    ${EndIf}
    ${If} $R0 == 0
      ; Silent deployment must not close a running app without confirmation.
      ${If} ${Silent}
        SetErrorLevel 2
        Quit
      ${EndIf}
      nsExec::Exec `"$HornetPowerShell" -STA -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\hornet-installer-processes.ps1" -Mode Prompt`
      Pop $R0
      ${If} $R0 == 1
        Goto hornet_ready
      ${ElseIf} $R0 == 11
        Call HornetScheduleInstall
        SetErrorLevel 3010
        Quit
      ${ElseIf} $R0 != 10
        Goto hornet_cancel
      ${EndIf}
      StrCpy $HornetWasRunning "1"
      StrCpy $HornetCloseAttempts 0
      hornet_close:
      DetailPrint "$(appClosing)"
      Call HornetCloseRunning
      Sleep 300
      Call HornetFindRunning
      ${If} $R0 != 1
        IntOp $HornetCloseAttempts $HornetCloseAttempts + 1
        ${If} $HornetCloseAttempts < 3
          Sleep 1000
          Goto hornet_close
        ${EndIf}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" IDRETRY hornet_close
        Goto hornet_cancel
      ${EndIf}
    ${EndIf}
    Goto hornet_ready
    hornet_cancel:
      SetErrorLevel 2
      Quit
    hornet_ready:
  FunctionEnd

  Function HornetScheduleInstall
    StrCpy $HornetDeferredDirectory "$LOCALAPPDATA\${APP_FILENAME}\Installer\${APP_GUID}"
    ClearErrors
    CreateDirectory "$HornetDeferredDirectory"
    ${If} ${Errors}
      Goto hornet_schedule_failed
    ${EndIf}
    ${If} $EXEPATH != "$HornetDeferredDirectory\pending.exe"
      CopyFiles /SILENT "$EXEPATH" "$HornetDeferredDirectory\pending.exe"
      ${If} ${Errors}
        Goto hornet_schedule_failed
      ${EndIf}
    ${EndIf}
    ; Keep the logon command under Windows' 260-character limit. The chosen
    ; directory/mode live in product-specific setup state, not command text.
    StrCpy $HornetDeferredCommand '$\"$HornetDeferredDirectory\pending.exe$\" --hornet-restart-after-install'
    StrLen $R1 $HornetDeferredCommand
    ${If} $R1 > 260
      Goto hornet_schedule_failed
    ${EndIf}
    ClearErrors
    WriteRegStr HKCU "Software\${APP_GUID}\PendingInstall" InstallLocation "$INSTDIR"
    WriteRegStr HKCU "Software\${APP_GUID}\PendingInstall" InstallMode "$installMode"
    ; Keep retrying at sign-in until resumed setup reaches customInit.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "!HornetSetup-${APP_GUID}"
    ClearErrors
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HornetSetup-${APP_GUID}" "$HornetDeferredCommand"
    ${If} ${Errors}
      Goto hornet_schedule_failed
    ${EndIf}
    nsExec::Exec `"$HornetPowerShell" -STA -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\hornet-installer-processes.ps1" -Mode DeferredNotice`
    Pop $R0
    Return
    hornet_schedule_failed:
      nsExec::Exec `"$HornetPowerShell" -STA -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\hornet-installer-processes.ps1" -Mode ScheduleFailed`
      Pop $R0
      SetErrorLevel 2
      Quit
  FunctionEnd

  Function HornetFindRunning
    nsExec::Exec /TIMEOUT=15000 `"$HornetPowerShell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\hornet-installer-processes.ps1" -Mode Detect`
    Pop $R0
  FunctionEnd

  Function HornetCloseRunning
    nsExec::Exec /TIMEOUT=15000 `"$HornetPowerShell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\hornet-installer-processes.ps1" -Mode Close`
    Pop $R0
  FunctionEnd

  Function HornetStartApp
    ${If} $HornetDidStart == "1"
      Return
    ${EndIf}
    StrCpy $HornetDidStart "1"
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ; Use the original user's desktop token even after an elevated install.
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function HornetFinishPagePre
    ${If} $HornetWasRunning == "1"
      Call HornetStartApp
      Abort ; Installation succeeded: skip Finish, so no second click is needed.
    ${EndIf}
  FunctionEnd
  !macroend

  !macro customFinishPage
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "HornetStartApp"
    !define MUI_PAGE_CUSTOMFUNCTION_PRE HornetFinishPagePre
    !insertmacro MUI_PAGE_FINISH
  !macroend
!endif
