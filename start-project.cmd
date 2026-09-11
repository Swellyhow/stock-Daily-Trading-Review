@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%PROJECT_ROOT%start-project.ps1"
if errorlevel 1 pause
endlocal
