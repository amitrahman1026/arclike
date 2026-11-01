# Command bar scenario: Enter on an open tab's row switches to it, a query that ends in a space
# searches in a new tab, and Ctrl+L opens an address in the current tab.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "command-bar"

try {
    Start-ArclikeSession

    Open-CommandBar "ctrl+t" "wikipedia"
    Save-Evidence $Scenario "01-tab-row"
    Probe keys enter | Out-Null
    Probe wait ArclikeCommandBar --gone --timeout 3000 | Out-Null
    Wait-Until { (Get-ActiveUrl) -like "https://www.wikipedia.org/*" } -What "the Wikipedia tab to be active"
    Assert ((Get-TabUrls).Count -eq 4) "Enter on an open tab's row switches to it and opens no tab"
    Assert ((Get-Foreground).process -eq "chrome") "Chrome has the foreground after Enter"

    Open-CommandBar "ctrl+t" "arclike windows test "
    Save-Evidence $Scenario "02-search"
    Probe keys enter | Out-Null
    # Google may answer an automated Chrome with its unusual-traffic page, which carries the
    # search in its continue= link. Either way the search was opened.
    Wait-Until { [Uri]::UnescapeDataString((Get-ActiveUrl)) -match "google\.[a-z.]+/search\?q=arclike\+windows\+test" } -What "a Google search tab"
    Assert ((Get-TabUrls).Count -eq 5) "Enter on a query that ends in a space opens one search tab"

    Open-CommandBar "ctrl+l" "example.org"
    Save-Evidence $Scenario "03-address"
    Probe keys enter | Out-Null
    Wait-Until { (Get-ActiveUrl) -like "https://example.org/*" } -What "example.org in the current tab"
    Assert ((Get-TabUrls).Count -eq 5) "Ctrl+L opens the address in the current tab"

    Save-Evidence $Scenario "04-done"
    Write-Output "command-bar passed"
}
finally { Stop-TestChrome }
