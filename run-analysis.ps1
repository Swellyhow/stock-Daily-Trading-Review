param(
  [ValidateSet('daily-json','daily-md','history-summary','report','auto-live','intraday','intraday-live')]
  [string]$Mode = 'daily-md',
  [string]$InputPath = 'inputs/daily/latest.md',
  [string]$TradeDate = ''
)

Set-Location $PSScriptRoot
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

switch ($Mode) {
  'daily-json' {
    node src/index.js --mode daily --format text --input $InputPath
  }
  'daily-md' {
    node src/index.js --mode daily-markdown --format text --input $InputPath
  }
  'history-summary' {
    node src/index.js --mode history-summary --format text
  }
  'report' {
    node src/index.js --mode analyze-raw --format text --input $InputPath
  }
  'auto-live' {
    if ([string]::IsNullOrWhiteSpace($TradeDate)) {
      node src/index.js --mode auto-live --format text
    } else {
      node src/index.js --mode auto-live --format text --date $TradeDate
    }
  }
  'intraday' {
    node src/index.js --mode intraday --format text --input $InputPath
  }
  'intraday-live' {
    if ([string]::IsNullOrWhiteSpace($TradeDate)) {
      node src/index.js --mode intraday-live --format text
    } else {
      node src/index.js --mode intraday-live --format text --date $TradeDate
    }
  }
}
