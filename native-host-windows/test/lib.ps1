# Helpers for scenario scripts, which run in the desktop session through Invoke-Interactive.ps1.
# Dot-source it: . C:\arclike\src\native-host-windows\test\lib.ps1
$ErrorActionPreference = "Stop"
$ProbeExe = "C:\arclike\test\probe\Probe.exe"
$ResultsRoot = "C:\arclike\test\out"
$TestProfile = "C:\arclike\test\profile"
$ExtensionId = "jlmidbafifiahhcpahkcejphlibhjapo"
# Four pages with different titles, so the command bar and the window title tell them apart.
$TestPages = @("https://example.com/", "https://www.iana.org/", "https://www.wikipedia.org/", "https://www.mozilla.org/")

# Start-Process joins the arguments with spaces, so quote any that contain one.
function Join-Arguments([object[]]$Arguments) {
    return $Arguments | ForEach-Object { if ("$_" -match '\s') { '"' + $_ + '"' } else { "$_" } }
}

# The probe is a WinExe, so wait for it explicitly and collect its output from a file.
function Probe {
    $tmp = [System.IO.Path]::GetTempFileName()
    $err = [System.IO.Path]::GetTempFileName()
    $p = Start-Process -FilePath $ProbeExe -ArgumentList (Join-Arguments $args) -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $tmp -RedirectStandardError $err
    $output = Get-Content $tmp -Raw
    $errors = Get-Content $err -Raw
    Remove-Item $tmp, $err -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { throw "probe $($args -join ' ') failed ($($p.ExitCode)): $errors" }
    return $output
}

function Get-ChromePath {
    foreach ($path in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
        if (Test-Path $path) { return $path }
    }
    throw "Chrome not found"
}

# Start Chrome on the test profile with the extension loaded and the given URLs as tabs. Chrome
# 137 and later ignore --load-extension, so load-extension.mjs loads it over a DevTools pipe on
# every start. See docs/windows-port.md, 7.3.
function Start-TestChrome([string[]]$Urls = @("about:blank")) {
    Stop-TestChrome
    # A fresh profile every time. A kept one remembers history and the window's place, and keeps
    # the extension's service worker scripts from an earlier run even after they change.
    Start-Sleep -Milliseconds 500
    Remove-Item $TestProfile -Recurse -Force -ErrorAction SilentlyContinue
    $ready = Join-Path $ResultsRoot "chrome-ready.txt"
    Remove-Item $ready -ErrorAction SilentlyContinue
    $nodeArgs = @("C:\arclike\test\node\load-extension.mjs", (Get-ChromePath), $TestProfile, "C:\arclike\src\extension", $ready) + $Urls
    Start-Process -FilePath "node" -ArgumentList (Join-Arguments $nodeArgs) -NoNewWindow `
        -RedirectStandardError (Join-Path $ResultsRoot "chrome-node.log") | Out-Null
    Wait-Until { Test-Path $ready } -TimeoutMs 30000 -What "Chrome to start with the extension"
    $id = Get-Content $ready -Raw
    if ($id.Trim() -ne $ExtensionId) { throw "Chrome loaded the extension as $id, not $ExtensionId" }
    # Chrome started from a scheduled task does not get the foreground by itself.
    Probe activate chrome | Out-Null
}

# Evaluate a JavaScript expression in the extension's service worker and return the result.
# Example: (Invoke-Extension "chrome.tabs.query({active: true, currentWindow: true})")[0].url
function Invoke-Extension([string]$Expression) {
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Expression))
    $json = & node "C:\arclike\test\node\cdp.mjs" $encoded
    if ($LASTEXITCODE -ne 0) { throw "cdp.mjs failed for: $Expression" }
    # Windows PowerShell's ConvertFrom-Json writes an array as one object. Returning it from a
    # variable writes its items, so @(...).Count counts them.
    $result = $json | ConvertFrom-Json
    return $result
}

# The URL of the active tab in the last focused window.
function Get-ActiveUrl {
    return (Invoke-Extension "chrome.tabs.query({active: true, lastFocusedWindow: true})")[0].url
}

function Get-TabUrls { return @(Invoke-Extension "chrome.tabs.query({})" | ForEach-Object { $_.url }) }

function Stop-TestChrome {
    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
        Where-Object { $_.CommandLine -like "*$TestProfile*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutMs = 10000, [string]$What = "condition") {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for $What"
}

function Get-Foreground { return (Probe foreground | ConvertFrom-Json) }

# Save a screenshot, the Arclike UI tree and the Arclike log under out\<scenario>\<step>.
function Save-Evidence([string]$Scenario, [string]$Step) {
    $dir = Join-Path $ResultsRoot (Join-Path $Scenario $Step)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Probe screenshot (Join-Path $dir "screen.png") | Out-Null
    Probe uia | Set-Content (Join-Path $dir "uia.json")
    $log = Join-Path $env:LOCALAPPDATA "Arclike\Arclike.log"
    if (Test-Path $log) { Get-Content $log -Tail 200 | Set-Content (Join-Path $dir "Arclike.log") }
}

# Start the test Chrome on $TestPages, wait for its Arclike host, and visit the tabs in order,
# so the last one is active and the switcher has history to show.
function Start-ArclikeSession {
    Start-TestChrome $TestPages
    Wait-Until { Get-Process -Name Arclike -ErrorAction SilentlyContinue } -What "Chrome to start Arclike.exe"
    Wait-Until { (Get-Foreground).process -eq "chrome" } -What "Chrome in the foreground"
    Start-Sleep -Seconds 2
    Probe keys ctrl+1 wait:300 ctrl+2 wait:300 ctrl+3 wait:300 ctrl+4 wait:300 | Out-Null
}

# Open the command bar with Ctrl+T or Ctrl+L, type the text, and wait for its rows.
function Open-CommandBar([string]$Chord = "ctrl+t", [string]$Text = "") {
    Probe keys $Chord | Out-Null
    Probe wait ArclikeCommandBar --timeout 3000 | Out-Null
    if ($Text) {
        Probe type $Text | Out-Null
        Probe wait CommandBarRow --timeout 3000 | Out-Null
        Start-Sleep -Milliseconds 400
    }
}

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    Write-Output "ok - $Message"
}
