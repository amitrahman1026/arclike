# Build Arclike for Windows and install it for the current user, the Windows counterpart of
# native-host/install-local.sh. Runs fine over SSH: nothing here needs the desktop.
#
#   .\install-local.ps1                      # Chrome
#   .\install-local.ps1 -Browsers Chrome,Edge
param(
    [string[]]$Browsers = @("Chrome"),
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\Arclike")
)

$ErrorActionPreference = "Stop"
# powershell -File passes "Chrome,Edge" as one string.
$Browsers = $Browsers | ForEach-Object { $_ -split "," } | Where-Object { $_ }
$HostName = "com.amitrahman1026.arclike"
$ExtensionId = "jlmidbafifiahhcpahkcejphlibhjapo"
$RegistryKeys = @{
    Chrome   = "HKCU:\Software\Google\Chrome\NativeMessagingHosts"
    Edge     = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
    Brave    = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"
    Vivaldi  = "HKCU:\Software\Vivaldi\NativeMessagingHosts"
    Chromium = "HKCU:\Software\Chromium\NativeMessagingHosts"
}

$Project = Join-Path $PSScriptRoot "Arclike\Arclike.csproj"
$PublishDir = Join-Path $PSScriptRoot "dist\publish"

Write-Host "Publishing Arclike..."
dotnet publish $Project -c Release -r win-x64 --self-contained `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $PublishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

# Windows locks a running exe, so stop it before the copy. The extension reconnects about a
# second later, and Chrome then starts the new build.
Get-Process -Name Arclike -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item (Join-Path $PublishDir "Arclike.exe") $InstallDir -Force

# Chrome rejects wildcards in allowed_origins, and a relative path is relative to the manifest.
$ManifestPath = Join-Path $InstallDir "$HostName.json"
$Manifest = [ordered]@{
    name            = $HostName
    description     = "Arclike native helper"
    path            = "Arclike.exe"
    type            = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
# UTF-8 without a BOM. Windows PowerShell's -Encoding utf8 would add one.
[System.IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))

foreach ($browser in $Browsers) {
    if (-not $RegistryKeys.ContainsKey($browser)) { throw "Unknown browser '$browser'. Use one of: $($RegistryKeys.Keys -join ', ')" }
    $key = Join-Path $RegistryKeys[$browser] $HostName
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $ManifestPath
    Write-Host "Registered $HostName for $browser at $key"
}

Write-Host "Installed $(Join-Path $InstallDir 'Arclike.exe')"
Write-Host "Load the extension/ folder unpacked in chrome://extensions if it is not loaded yet."
