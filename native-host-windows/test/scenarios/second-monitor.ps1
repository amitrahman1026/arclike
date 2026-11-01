# Second monitor scenario: with Chrome on the right monitor, the command bar and the switcher
# open there. Needs two monitors side by side, the second to the right.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "second-monitor"

function Get-Rect([string]$AutomationId) {
    $windows = Probe uia --depth 0 | ConvertFrom-Json
    return ($windows | Where-Object { $_.automationId -eq $AutomationId } | Select-Object -First 1).rect
}

try {
    Start-ArclikeSession
    $left = (Get-Foreground).rect.x
    Probe keys win+shift+right | Out-Null
    Wait-Until { (Get-Foreground).rect.x -ge ($left + 1000) } -What "Chrome on the second monitor"
    $chrome = (Get-Foreground).rect
    Start-Sleep -Milliseconds 500

    Open-CommandBar "ctrl+t"
    $bar = Get-Rect "ArclikeCommandBar"
    Save-Evidence $Scenario "01-command-bar"
    Assert ($bar.x -ge $chrome.x -and ($bar.x + $bar.width) -le ($chrome.x + $chrome.width)) "the command bar opens over Chrome on the second monitor (bar x=$($bar.x), Chrome x=$($chrome.x))"
    Probe keys esc | Out-Null
    Probe wait ArclikeCommandBar --gone --timeout 3000 | Out-Null

    Probe keys down:ctrl tab wait:400 | Out-Null
    Probe wait ArclikeSwitcher --timeout 2000 | Out-Null
    $switcher = Get-Rect "ArclikeSwitcher"
    Save-Evidence $Scenario "02-switcher"
    Probe keys up:ctrl | Out-Null
    Assert ($switcher.x -ge $chrome.x) "the switcher opens on the second monitor (x=$($switcher.x))"

    Probe keys win+shift+left | Out-Null
    Write-Output "second-monitor passed"
}
finally { Stop-TestChrome }
