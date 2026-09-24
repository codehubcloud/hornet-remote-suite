@echo off
setlocal
rem Invoke PowerShell explicitly; do not rely on the .ps1 file association.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0src\run.ps1" -Action start
set "hornetExitCode=%ERRORLEVEL%"
if not "%hornetExitCode%"=="0" (
    echo.
    echo Hornet failed to start. See the error above.
    pause
)
exit /b %hornetExitCode%
