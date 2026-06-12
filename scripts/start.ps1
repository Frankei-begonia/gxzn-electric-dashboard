param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Read-Port {
  foreach ($file in @("config.local.json", "config.example.json")) {
    $path = Join-Path $ProjectRoot $file
    if (Test-Path $path) {
      try {
        $json = Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json
        if ($json.port) {
          return [int]$json.port
        }
      } catch {
      }
    }
  }
  return 8787
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js was not found." -ForegroundColor Yellow
  Write-Host "Please install Node.js 18 or newer, then run this launcher again."
  Write-Host "Download: https://nodejs.org/zh-cn/download"
  Start-Process "https://nodejs.org/zh-cn/download"
  if (-not $NoPause) {
    Read-Host "Press Enter to close this window after installation"
  }
  exit 1
}

$Port = Read-Port
$Url = "http://localhost:$Port"

try {
  $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 1
  if ($health.ok) {
    Write-Host "Dashboard is already running. Opening $Url" -ForegroundColor Green
    Start-Process $Url
    if (-not $NoPause) {
      Read-Host "Press Enter to close this window"
    }
    exit 0
  }
} catch {
}

Start-Job -ScriptBlock {
  param($OpenUrl)
  Start-Sleep -Seconds 2
  Start-Process $OpenUrl
} -ArgumentList $Url | Out-Null

Write-Host "Starting electricity dashboard: $Url" -ForegroundColor Green
Write-Host "First run opens the setup page. After setup, open the dashboard page."
Write-Host "Keep this window open. Closing it stops the local web service."
Write-Host ""

node src/server.js

if ($LASTEXITCODE -ne 0 -and -not $NoPause) {
  Read-Host "Service stopped. Press Enter to close this window"
}
