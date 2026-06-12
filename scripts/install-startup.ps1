$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TaskName = "GXZN Electric Dashboard"
$StartScript = Join-Path $ProjectRoot "scripts\start.ps1"
$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$StartScript`" -NoPause"

if (-not (Test-Path $StartScript)) {
  throw "Start script was not found: $StartScript"
}

$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Start GXZN electricity dashboard after Windows logon" `
  -Force | Out-Null

Write-Host "Startup task installed: $TaskName" -ForegroundColor Green
Write-Host "The dashboard will start automatically after the next Windows logon."
