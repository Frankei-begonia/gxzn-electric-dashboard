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
  Write-Host "没有检测到 Node.js。" -ForegroundColor Yellow
  Write-Host "请安装 Node.js 18 或更高版本，然后重新双击启动文件。"
  Write-Host "官方下载地址：https://nodejs.org/zh-cn/download"
  Start-Process "https://nodejs.org/zh-cn/download"
  Read-Host "安装完成后按回车关闭窗口"
  exit 1
}

$Port = Read-Port
$Url = "http://localhost:$Port"

try {
  $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 1
  if ($health.ok) {
    Write-Host "电费状态屏已经在运行，正在打开网页：$Url" -ForegroundColor Green
    Start-Process $Url
    Read-Host "按回车关闭这个窗口"
    exit 0
  }
} catch {
}

Start-Job -ScriptBlock {
  param($OpenUrl)
  Start-Sleep -Seconds 2
  Start-Process $OpenUrl
} -ArgumentList $Url | Out-Null

Write-Host "正在启动电费状态屏：$Url" -ForegroundColor Green
Write-Host "首次使用会进入配置页；配置完成后可以打开状态屏。"
Write-Host "这个窗口不要关闭，关闭后网页服务也会停止。"
Write-Host ""

node src/server.js

if ($LASTEXITCODE -ne 0) {
  Read-Host "服务已停止，按回车关闭窗口"
}
