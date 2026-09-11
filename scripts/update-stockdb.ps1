param([Parameter(Mandatory = $true)][ValidatePattern('^\d{8}$')][string]$Date)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StockDbRoot = Join-Path (Split-Path -Parent $ProjectRoot) 'free-stockdb-windows-v0.3.2\stockdb'
if ($env:STOCKDB_ROOT) { $StockDbRoot = $env:STOCKDB_ROOT }
$StockDbRoot = [IO.Path]::GetFullPath($StockDbRoot)
$RuntimeRoot = Join-Path $ProjectRoot 'data\runtime'
$null = New-Item -ItemType Directory -Path $RuntimeRoot -Force
$now = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time')
if ($now.DayOfWeek -notin @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday) -and $now.TimeOfDay.TotalMinutes -ge 540 -and $now.TimeOfDay.TotalMinutes -lt 950) { throw 'Public database updates are deferred during the trading session (09:00-15:50 Shanghai).' }
$updaterName = ([char]0x6570).ToString() + [char]0x636E + [char]0x66F4 + [char]0x65B0 + '.exe'
$updaterPath = Join-Path $StockDbRoot $updaterName
$mutex = New-Object Threading.Mutex($false, 'Local\HotMoneyStockDbUpdate')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Another public data update is running.' }
  # The official updater is single-instance and may already be running from a
  # previous retry or a manual launch. Reuse it without starting a second writer.
  $existing = @(Get-CimInstance Win32_Process -Filter "Name = '$updaterName'" | Where-Object {
    $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq $updaterPath)
  })
  $process = $null
  if ($existing.Count) {
    $existingPid = [int]$existing[0].ProcessId
    $process = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($process) { Write-Output "Official updater is already running (PID $existingPid); checking queryable data." }
  }
  if (-not $process) {
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $process = Start-Process -FilePath $updaterPath -WorkingDirectory $StockDbRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeRoot "stockdb-update-$stamp.out.log") -RedirectStandardError (Join-Path $RuntimeRoot "stockdb-update-$stamp.err.log") -PassThru
  }
  # An updater can remain alive after writing data. The scheduler verifies the
  # requested day's bars and retries missing data; process lifetime is not proof
  # of completion. Leave any running writer untouched across those retries.
  if ($process.HasExited -and $process.ExitCode -ne 0) { throw "Official updater exited with code $($process.ExitCode)." }
  Write-Output "Public updater dispatched (PID $($process.Id)); scheduler must verify $Date data."
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
