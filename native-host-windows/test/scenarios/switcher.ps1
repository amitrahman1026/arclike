# Switcher scenario: Ctrl+Tab goes to the last tab, Ctrl+Esc cancels without a change or the
# Start menu, and the card under the mouse is the one chosen on release.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "switcher"

try {
    Start-ArclikeSession
    Assert ((Get-ActiveUrl) -like "https://www.mozilla.org/*") "the last tab visited is active"

    Probe keys down:ctrl tab wait:400 up:ctrl | Out-Null
    Wait-Until { (Get-ActiveUrl) -like "https://www.wikipedia.org/*" } -What "Ctrl+Tab to go back one tab"
    Write-Output "ok - Ctrl+Tab goes to the tab used before"

    Probe keys down:ctrl tab wait:150 tab wait:300 | Out-Null
    Probe wait ArclikeSwitcher --timeout 2000 | Out-Null
    Probe keys esc wait:200 up:ctrl | Out-Null
    Probe wait ArclikeSwitcher --gone --timeout 2000 | Out-Null
    Start-Sleep -Milliseconds 300
    Assert ((Get-ActiveUrl) -like "https://www.wikipedia.org/*") "Ctrl+Esc cancels the switch"
    Assert ((Get-Foreground).process -eq "chrome") "Ctrl+Esc does not open the Start menu"

    # Recent order is now Wikipedia, Mozilla, IANA, example.com. Card 3 is example.com.
    Probe keys down:ctrl tab wait:400 | Out-Null
    Probe wait SwitcherCard --timeout 2000 | Out-Null
    Probe hover SwitcherCard 3 | Out-Null
    Start-Sleep -Milliseconds 300
    Save-Evidence $Scenario "01-hover"
    Probe keys up:ctrl | Out-Null
    Wait-Until { (Get-ActiveUrl) -like "https://example.com/*" } -What "the hovered card's tab"
    Write-Output "ok - releasing Ctrl chooses the card under the mouse"

    Write-Output "switcher passed"
}
finally { Stop-TestChrome }
