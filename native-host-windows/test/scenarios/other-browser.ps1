# Other browser scenario: Edge has no Arclike extension, so it keeps Ctrl+T and Ctrl+Tab while
# Arclike runs for Chrome.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "other-browser"
$EdgeProfile = "C:\arclike\test\edge-profile"

function Stop-TestEdge {
    Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
        Where-Object { $_.CommandLine -like "*$EdgeProfile*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
    Start-ArclikeSession
    $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    Start-Process -FilePath $edge -ArgumentList (Join-Arguments @("--user-data-dir=$EdgeProfile", "--no-first-run",
        "--no-default-browser-check", "--hide-crash-restore-bubble", "https://example.com/"))
    Wait-Until { Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } } -What "Edge's window"
    Start-Sleep -Seconds 3
    Probe activate msedge | Out-Null
    $before = (Get-Foreground).title

    Probe keys ctrl+t | Out-Null
    Start-Sleep -Milliseconds 1500
    Save-Evidence $Scenario "01-edge-ctrl-t"
    $fg = Get-Foreground
    Assert ($fg.process -eq "msedge") "Edge keeps the foreground after Ctrl+T (got $($fg.process))"
    Assert ($fg.title -ne $before) "Edge opened its own new tab ('$before' to '$($fg.title)')"

    # With two tabs Edge's title adds "and 1 more page", so compare the page title only.
    Probe keys ctrl+tab | Out-Null
    Start-Sleep -Milliseconds 800
    $title = (Get-Foreground).title
    Assert ($title -like "Example Domain*") "Ctrl+Tab switches Edge's tabs itself (got '$title')"
    Write-Output "other-browser passed"
}
finally {
    Stop-TestEdge
    Stop-TestChrome
}
