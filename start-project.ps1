param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts\project-service.ps1') -Mode Start -NoBrowser:$NoBrowser
