param(
  [ValidateSet('Run', 'Start', 'Stop', 'Status', 'Install')][string]$Mode = 'Start',
  [switch]$NoBrowser,
  [switch]$Once
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot 'data\runtime'
$DesiredPath = Join-Path $RuntimeRoot 'service-enabled.json'
$StatePath = Join-Path $RuntimeRoot 'service-state.json'
$TaskName = 'HotMoneyTradingSystem'
$ScriptPath = $PSCommandPath
$PowerShellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$StockDbRoot = Join-Path (Split-Path -Parent $ProjectRoot) 'free-stockdb-windows-v0.3.2\stockdb'
$EnvPath = Join-Path $ProjectRoot '.env'
if (Test-Path -LiteralPath $EnvPath) {
  foreach ($line in Get-Content -LiteralPath $EnvPath -Encoding UTF8) {
    if ($line -match '^\s*(STOCKDB_ROOT|STOCKDB_PYTHON)\s*=\s*(.*?)\s*$') {
      $key = $Matches[1]
      $value = $Matches[2].Trim('"').Trim("'")
      if ($key -eq 'STOCKDB_ROOT' -and $value) { $StockDbRoot = $value }
      if ($key -eq 'STOCKDB_PYTHON' -and $value) { $PythonPath = $value }
    }
  }
}
if ($env:STOCKDB_ROOT) { $StockDbRoot = $env:STOCKDB_ROOT }
$StockDbRoot = [IO.Path]::GetFullPath($StockDbRoot)
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
if (-not $PythonPath) { $PythonPath = (Get-Command python.exe -ErrorAction SilentlyContinue).Source }
$null = New-Item -ItemType Directory -Path $RuntimeRoot -Force

function Read-State([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
  }
  return $null
}
function Write-State([string]$Path, $Value) {
  $temporaryPath = "$Path.$PID.tmp"
  [IO.File]::WriteAllText($temporaryPath, ($Value | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}
function Test-Enabled {
  $desired = Read-State $DesiredPath
  return ($null -ne $desired -and $desired.enabled -eq $true)
}
function Get-MatchingProcess($Service) {
  return Get-CimInstance Win32_Process -Filter "Name = '$($Service.ExecutableName)'" -ErrorAction SilentlyContinue | Where-Object {
    if ($Service.Script) { $_.CommandLine -and $_.CommandLine.Contains($Service.Script) }
    else { $_.ExecutablePath -and $_.ExecutablePath.Equals($Service.Executable, [StringComparison]::OrdinalIgnoreCase) }
  } | Select-Object -First 1
}
function Test-Health([string]$Endpoint) {
  try { return (Invoke-WebRequest -Uri $Endpoint -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { return $false }
}
function Get-ServiceDefinitions {
  $items = @(
    @{ Name = 'stockdb'; Executable = (Join-Path $StockDbRoot 'stockdb.exe'); ExecutableName = 'stockdb.exe'; WorkingDirectory = $StockDbRoot; Port = 7899; Health = 'http://127.0.0.1:7899/?cmd=get&t=%E8%82%A1%E7%A5%A8%E4%BB%A3%E7%A0%81'; Arguments = @() },
    @{ Name = 'web-data'; Executable = $NodePath; ExecutableName = 'node.exe'; Script = (Join-Path $ProjectRoot 'web\search-server.js'); WorkingDirectory = $ProjectRoot; Port = 3000; Health = 'http://127.0.0.1:3000/api/auction-management/status' },
    @{ Name = 'dashboard'; Executable = $NodePath; ExecutableName = 'node.exe'; Script = (Join-Path $ProjectRoot 'src\web-server.js'); WorkingDirectory = $ProjectRoot; Port = 3030; Health = 'http://127.0.0.1:3030/' }
  )
  if ($PythonPath -and (Test-Path -LiteralPath (Join-Path $StockDbRoot 'cmes_bridge.py'))) {
    $items += @{ Name = 'cmes'; Executable = $PythonPath; ExecutableName = 'python.exe'; Script = (Join-Path $StockDbRoot 'cmes_bridge.py'); WorkingDirectory = $StockDbRoot; Port = 7897; Health = 'http://127.0.0.1:7897/health' }
  }
  return $items
}
function Start-Guardian {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $TaskName }
    return
  }
  Start-Process -FilePath $PowerShellPath -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $ScriptPath + '"'), '-Mode', 'Run') -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null
}

if ($Mode -eq 'Status') {
  [pscustomobject]@{ desired = (Read-State $DesiredPath); runtime = (Read-State $StatePath); task = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Select-Object TaskName, State) } | ConvertTo-Json -Depth 10
  exit 0
}
if ($Mode -eq 'Install') {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  # Register one long-running guardian. Task Scheduler restarts it only when
  # the guardian exits unexpectedly; healthy services do not create new
  # PowerShell processes on a timer.
  $action = New-ScheduledTaskAction -Execute $PowerShellPath -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ScriptPath + '" -Mode Run') -WorkingDirectory $ProjectRoot
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logon -Settings $settings -Principal $principal -Description 'Run one long-lived trading project guardian. stop-project.cmd disables automatic restart.' -Force | Out-Null
  Write-Host "Installed $TaskName for $identity."
  exit 0
}
if ($Mode -eq 'Start') {
  Write-State $DesiredPath @{ enabled = $true; changedAt = (Get-Date).ToUniversalTime().ToString('o') }
  Enable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Start-Guardian
  $ready = $false
  for ($attempt = 0; $attempt -lt 30 -and -not $ready; $attempt++) {
    $ready = Test-Health 'http://127.0.0.1:3000/api/auction-management/status'
    if (-not $ready) { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw "Web service is not ready. Check $StatePath and service logs in $RuntimeRoot." }
  if (-not $NoBrowser) { Start-Process 'http://localhost:3000/auction-monitor.html' }
  Write-Host 'Project is running: http://localhost:3000/auction-monitor.html'
  exit 0
}
if ($Mode -eq 'Stop') {
  Write-State $DesiredPath @{ enabled = $false; changedAt = (Get-Date).ToUniversalTime().ToString('o') }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $supervisor = Read-State $StatePath
  if ($supervisor.pid) {
    $runningGuardian = Get-CimInstance Win32_Process -Filter "ProcessId = $($supervisor.pid)" -ErrorAction SilentlyContinue
    if ($runningGuardian -and $runningGuardian.CommandLine.Contains($ScriptPath) -and $runningGuardian.CommandLine -match '-Mode Run') { Stop-Process -Id $runningGuardian.ProcessId -ErrorAction SilentlyContinue }
  }
  foreach ($service in Get-ServiceDefinitions) {
    $process = Get-MatchingProcess $service
    if ($process) { Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
  }
  Write-State $StatePath @{ status = 'stopped'; stoppedAt = (Get-Date).ToUniversalTime().ToString('o'); services = @() }
  Write-Host 'Project stopped. Automatic restart stays disabled until start-project.cmd is used.'
  exit 0
}

if (-not (Test-Enabled)) { exit 0 }
$mutex = New-Object Threading.Mutex($false, 'Local\HotMoneyTradingSystemGuardian')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { exit 0 }
  $records = @{}
  do {
    if (-not (Test-Enabled)) { break }
    foreach ($service in Get-ServiceDefinitions) {
      if (-not $records.ContainsKey($service.Name)) { $records[$service.Name] = @{ name = $service.Name; failures = 0; attempts = 0; retryAt = 0; status = 'starting' } }
      $record = $records[$service.Name]
      try {
        $process = Get-MatchingProcess $service
        $healthy = if ($service.Health) { Test-Health $service.Health } else { $null -ne $process }
        if ($healthy) {
          $record.status = 'running'; $record.failures = 0; $record.attempts = 0
          $record.pid = if ($process) { $process.ProcessId } else { $null }
          $record.error = $null
          continue
        }
        $record.failures++
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        if ($now -lt $record.retryAt) { continue }
        if ($process -and $record.failures -lt 6) { $record.status = 'unhealthy'; continue }
        if ($process) {
          if ($service.Name -eq 'stockdb') { $record.status = 'unhealthy'; $record.error = 'Database process is alive but not responding; automatic termination is disabled to protect active updates.'; continue }
          Stop-Process -Id $process.ProcessId -ErrorAction Stop
        }
        if ($service.Port) {
          $portOwner = Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
          if ($portOwner) { throw "Port $($service.Port) is occupied by another process $($portOwner.OwningProcess)." }
        }
        if (-not (Test-Path -LiteralPath $service.Executable)) { throw "Missing executable: $($service.Executable)" }
        $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
        $parameters = @{ FilePath = $service.Executable; WorkingDirectory = $service.WorkingDirectory; WindowStyle = 'Hidden'; PassThru = $true; RedirectStandardOutput = (Join-Path $RuntimeRoot "$($service.Name)-$stamp.out.log"); RedirectStandardError = (Join-Path $RuntimeRoot "$($service.Name)-$stamp.err.log") }
        if ($service.Script) { $parameters.ArgumentList = @(('"' + $service.Script + '"')) }
        elseif ($service.Arguments.Count) { $parameters.ArgumentList = $service.Arguments }
        $started = Start-Process @parameters
        $record.pid = $started.Id; $record.status = 'starting'; $record.attempts++
        $record.retryAt = $now + [Math]::Min(300, 10 * [Math]::Pow(2, [Math]::Min(5, $record.attempts - 1)))
        $record.error = $null
      } catch { $record.status = 'error'; $record.error = $_.Exception.Message; $record.retryAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 60 }
    }
    Write-State $StatePath @{ pid = $PID; status = 'running'; checkedAt = (Get-Date).ToUniversalTime().ToString('o'); services = @($records.Values) }
    if (-not $Once) { Start-Sleep -Seconds 10 }
  } while (-not $Once)
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
