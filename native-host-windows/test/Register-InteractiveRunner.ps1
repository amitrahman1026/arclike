# One-time setup on the Windows box, run over SSH. Builds the probe and registers the
# ArclikeInteractive task, which runs C:\arclike\test\job.ps1 in the logged-on user's desktop
# session. SSH sessions run in session 0, which has no desktop to capture, type into or read.
$ErrorActionPreference = "Stop"
$Root = "C:\arclike\test"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "out") | Out-Null

dotnet publish (Join-Path $PSScriptRoot "Probe\Probe.csproj") -c Release -o (Join-Path $Root "probe")
if ($LASTEXITCODE -ne 0) { throw "dotnet publish of the probe failed" }

# load-extension.mjs starts the test Chrome with the extension, and cdp.mjs reads its tabs
# (lib.ps1). Both need puppeteer-core next to them.
$NodeDir = Join-Path $Root "node"
New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot "*.mjs") $NodeDir -Force
npm install --prefix $NodeDir --no-audit --no-fund puppeteer-core@24.10.0
if ($LASTEXITCODE -ne 0) { throw "npm install of puppeteer-core failed" }

# The probe is a WinExe and starts PowerShell with no window, so nothing takes the foreground.
$action = New-ScheduledTaskAction -Execute (Join-Path $Root "probe\Probe.exe") -Argument "run-job `"$Root`""
# Interactive: run only while the user is logged on, in that session. No password is stored.
# Take the account from the token. In an SSH session USERDOMAIN can be WORKGROUP.
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "ArclikeInteractive" -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered the ArclikeInteractive task for $user"
