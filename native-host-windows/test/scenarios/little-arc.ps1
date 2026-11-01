# Little Arc scenario: the command moves the tab into a small window, and Ctrl+O there moves it
# back to the main window.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "little-arc"

function Get-PopupCount { return @(Invoke-Extension "chrome.windows.getAll({windowTypes: ['popup']})").Count }

try {
    Start-ArclikeSession
    Open-CommandBar "ctrl+t" "open in little"
    Probe keys enter | Out-Null
    Wait-Until { (Get-PopupCount) -eq 1 } -What "a Little Arc window"
    Start-Sleep -Milliseconds 800
    Save-Evidence $Scenario "01-little-arc"
    Assert ((Get-TabUrls).Count -eq 4) "the tab moved and none was opened"

    Probe keys ctrl+o | Out-Null
    Wait-Until { (Get-PopupCount) -eq 0 } -What "Ctrl+O to move the tab back"
    Assert ((Get-TabUrls).Count -eq 4) "Ctrl+O moves the tab to the main window"
    Assert ((Get-Foreground).process -eq "chrome") "Chrome keeps the foreground, with no Open File dialog"
    Write-Output "little-arc passed"
}
finally { Stop-TestChrome }
