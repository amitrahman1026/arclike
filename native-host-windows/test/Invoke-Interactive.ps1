# Run a PowerShell script in the logged-on user's desktop session and wait for it, from SSH.
#   Invoke-Interactive.ps1 -ScriptPath C:\arclike\src\native-host-windows\test\scenarios\smoke.ps1
#   Invoke-Interactive.ps1 -Command "& C:\arclike\test\probe\Probe.exe foreground"
# Prints the job's output and exits with its exit code. Needs Register-InteractiveRunner.ps1 first.
param(
    [string]$ScriptPath,
    [string]$Command,
    [int]$TimeoutSeconds = 300
)
$ErrorActionPreference = "Stop"
$Root = "C:\arclike\test"
$Out = Join-Path $Root "out"

# The console session must be logged on and unlocked (auto-logon, no lock screen).
$sessions = (query user 2>$null) -join "`n"
if ($sessions -notmatch "console\s+\d+\s+Active") {
    Write-Error "No active console session. Check auto-logon, and do not leave an RDP session connected.`n$sessions"
    exit 3
}

$job = Join-Path $Root "job.ps1"
if ($ScriptPath) { Copy-Item $ScriptPath $job -Force }
elseif ($Command) { Set-Content -Path $job -Value $Command -Encoding utf8 }
else { throw "Pass -ScriptPath or -Command" }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
Remove-Item (Join-Path $Out "stdout.txt"), (Join-Path $Out "stderr.txt"), (Join-Path $Out "exitcode.txt") -ErrorAction SilentlyContinue

# The task ignores a start while an instance runs. A job that timed out can leave one behind.
if ((Get-ScheduledTask -TaskName "ArclikeInteractive").State -eq "Running") {
    Stop-ScheduledTask -TaskName "ArclikeInteractive"
}
Start-ScheduledTask -TaskName "ArclikeInteractive"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path (Join-Path $Out "exitcode.txt"))) {
    if ((Get-Date) -gt $deadline) { Write-Error "Job timed out after $TimeoutSeconds s"; exit 124 }
    Start-Sleep -Milliseconds 250
}

Get-Content (Join-Path $Out "stdout.txt") -ErrorAction SilentlyContinue
$stderr = Get-Content (Join-Path $Out "stderr.txt") -Raw -ErrorAction SilentlyContinue
if ($stderr) { [Console]::Error.Write($stderr) }
exit [int](Get-Content (Join-Path $Out "exitcode.txt"))
