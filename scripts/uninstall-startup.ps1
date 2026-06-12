$ErrorActionPreference = "Stop"

$TaskName = "GXZN Electric Dashboard"
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Startup task removed: $TaskName" -ForegroundColor Green
} else {
  Write-Host "Startup task was not found: $TaskName" -ForegroundColor Yellow
}
