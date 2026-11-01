# Two windows scenario: with a tab moved into its own window, as a tab dragged out of the tab
# strip, Ctrl+T in that window opens its search and its address in that window, not the first one.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "two-windows"

# The IDs of the windows that have a tab with a URL that matches the pattern.
function Get-WindowsWith([string]$Pattern) {
    return @(Invoke-Extension "chrome.tabs.query({})" |
        Where-Object { [Uri]::UnescapeDataString($_.url) -match $Pattern } |
        ForEach-Object { $_.windowId })
}

try {
    Start-ArclikeSession
    $first = (Invoke-Extension "chrome.windows.getLastFocused()").id

    # Move the active tab (mozilla.org) into a new window on the right half of the screen.
    $second = (Invoke-Extension 'chrome.tabs.query({active: true, lastFocusedWindow: true}).then(t => chrome.windows.create({tabId: t[0].id, focused: true, state: "normal", left: 960, top: 0, width: 960, height: 1000}))').id
    Wait-Until { (Invoke-Extension "chrome.windows.getLastFocused()").id -eq $second } -What "the new window to have the focus"
    Assert ($second -ne $first) "The tab is in a new window"
    Start-Sleep -Seconds 1
    Save-Evidence $Scenario "01-second-window"

    Open-CommandBar "ctrl+t" "arclike two windows "
    Save-Evidence $Scenario "02-search"
    Probe keys enter | Out-Null
    Wait-Until { (Get-WindowsWith "google\.[a-z.]+/search\?q=arclike\+two\+windows").Count -gt 0 } -What "a Google search tab"
    $searchWindows = Get-WindowsWith "google\.[a-z.]+/search\?q=arclike\+two\+windows"
    Assert ($searchWindows[0] -eq $second) "Ctrl+T opens the search in the window it was pressed in"

    Open-CommandBar "ctrl+t" "example.org"
    Save-Evidence $Scenario "03-address"
    Probe keys enter | Out-Null
    Wait-Until { (Get-WindowsWith "^https://example\.org/").Count -gt 0 } -What "an example.org tab"
    $addressWindows = Get-WindowsWith "^https://example\.org/"
    Assert ($addressWindows[0] -eq $second) "Ctrl+T opens the address in the window it was pressed in"

    Save-Evidence $Scenario "04-done"
    Write-Output "two-windows passed"
}
finally { Stop-TestChrome }
