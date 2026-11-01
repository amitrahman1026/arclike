# Two browsers scenario: Chrome and Edge both run Arclike, so two hosts share one keyboard hook.
# The command bar opens for the browser in front, and when the host that holds the hook is
# killed, the other host takes the hook over. Needs the host registered for Edge too.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "multi-browser"
$EdgeProfile = "C:\arclike\test\edge-profile"
$Edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"

# The Arclike.exe that Chrome started for the test profile: Chrome, then cmd.exe, then Arclike.
function Get-ChromeHostId {
    $all = Get-CimInstance Win32_Process
    $chrome = @($all | Where-Object { $_.Name -eq "chrome.exe" -and $_.CommandLine -like "*$TestProfile*" } | ForEach-Object { $_.ProcessId })
    $cmd = @($all | Where-Object { $_.Name -eq "cmd.exe" -and $chrome -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId })
    return ($all | Where-Object { $_.Name -eq "Arclike.exe" -and $cmd -contains $_.ParentProcessId } | Select-Object -First 1).ProcessId
}

function Test-EdgeCommandBar([string]$Step) {
    Probe activate msedge | Out-Null
    Open-CommandBar "ctrl+t" "example"
    Save-Evidence $Scenario $Step
    Probe keys esc | Out-Null
    Probe wait ArclikeCommandBar --gone --timeout 3000 | Out-Null
    Start-Sleep -Milliseconds 300
    return (Get-Foreground).process
}

try {
    Start-ArclikeSession
    Start-TestBrowser $Edge $EdgeProfile 9334 @("https://example.com/", "https://www.iana.org/") "msedge"
    Wait-Until { @(Get-Process Arclike -ErrorAction SilentlyContinue).Count -ge 2 } -What "a second Arclike host, for Edge"
    Start-Sleep -Seconds 2

    Assert ((Test-EdgeCommandBar "01-edge") -eq "msedge") "Ctrl+T in Edge opens the bar, and Esc gives Edge the foreground back"

    $leader = Get-ChromeHostId
    Assert ($null -ne $leader) "found Chrome's host (PID $leader)"
    Stop-Process -Id $leader -Force
    # Edge's host checks for an abandoned hook every 2 s. Chrome starts a new host as well.
    Start-Sleep -Seconds 4
    Assert ((Test-EdgeCommandBar "02-after-kill") -eq "msedge") "after Chrome's host is killed, Ctrl+T in Edge still opens the bar"

    Probe activate chrome | Out-Null
    Open-CommandBar "ctrl+t" "wiki"
    Save-Evidence $Scenario "03-chrome"
    Probe keys esc | Out-Null
    Probe wait ArclikeCommandBar --gone --timeout 3000 | Out-Null
    Write-Output "ok - Chrome's new host answers Ctrl+T in Chrome"
    Write-Output "multi-browser passed"
}
finally {
    Stop-TestBrowser $EdgeProfile
    Stop-TestChrome
}
