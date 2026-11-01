# Smoke scenario, run in the desktop session: Chrome starts the host, Ctrl+T opens the command
# bar with focus, typing reaches it, Esc closes it and gives the foreground back to Chrome, and
# Ctrl+Tab shows the switcher. Run through Invoke-Interactive.ps1.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "smoke"

Stop-TestChrome
Start-TestChrome @("https://example.com", "https://example.org", "https://example.net", "https://www.iana.org")
Wait-Until { Get-Process -Name Arclike -ErrorAction SilentlyContinue } -What "Chrome to start Arclike.exe"
Wait-Until { (Get-Foreground).process -eq "chrome" } -What "Chrome in the foreground"
Start-Sleep -Seconds 2
Save-Evidence $Scenario "01-started"

# Visit the tabs, so the switcher has history to show.
Probe keys ctrl+1 wait:300 ctrl+2 wait:300 ctrl+3 wait:300 ctrl+4 wait:300 | Out-Null

# Ctrl+T opens the command bar and gives it the keyboard.
Probe keys ctrl+t | Out-Null
Probe wait ArclikeCommandBar --timeout 3000 | Out-Null
$fg = Get-Foreground
Assert ($fg.process -eq "Arclike") "Ctrl+T puts the command bar in the foreground (got $($fg.process))"
Probe type example | Out-Null
Probe wait CommandBarRow --timeout 3000 | Out-Null
Save-Evidence $Scenario "02-command-bar"

Probe keys esc | Out-Null
Probe wait ArclikeCommandBar --gone --timeout 3000 | Out-Null
Start-Sleep -Milliseconds 300
Assert ((Get-Foreground).process -eq "chrome") "Esc closes the bar and Chrome has the foreground again"

# Ctrl+Tab with Ctrl held shows the switcher, and releasing Ctrl hides it.
Probe keys down:ctrl tab wait:150 tab wait:300 | Out-Null
Probe wait ArclikeSwitcher --timeout 2000 | Out-Null
Save-Evidence $Scenario "03-switcher"
Probe keys up:ctrl | Out-Null
Probe wait ArclikeSwitcher --gone --timeout 2000 | Out-Null
Assert ((Get-Foreground).process -eq "chrome") "the switcher never takes the foreground"

Save-Evidence $Scenario "04-done"
Stop-TestChrome
Write-Output "smoke passed"
