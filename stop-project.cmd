@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\project-service.ps1" -Mode Stop
if errorlevel 1 pause
endlocal
