# Copy URL scenario: Alt+Shift+C puts the active tab's address on the clipboard.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "copy-url"

try {
    Start-ArclikeSession
    Set-Clipboard -Value "before"
    Probe keys ctrl+1 wait:300 alt+shift+c | Out-Null
    Wait-Until { (Get-Clipboard) -eq "https://example.com/" } -What "the address on the clipboard"
    Save-Evidence $Scenario "01-copied"
    Assert ((Get-Foreground).process -eq "chrome") "the toast does not take the foreground"
    Write-Output "copy-url passed"
}
finally { Stop-TestChrome }
