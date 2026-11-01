# Import from Arc scenario: the app reads a sidebar file in Arc's format and the extension's dry
# run counts what it would add. ARCLIKE_ARC_DIR points the app at the fixture. Chrome passes the
# environment to the app it starts.
. C:\arclike\src\native-host-windows\test\lib.ps1
$Scenario = "arc-import"

try {
    $env:ARCLIKE_ARC_DIR = "C:\arclike\src\native-host-windows\test\fixtures\arc"
    Start-ArclikeSession
    $result = Invoke-Extension "handleArcImport({dryRun: true})"
    $result | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $ResultsRoot "arc-import.json")
    Assert ($result.ok) "the dry run succeeds ($($result.error))"
    $s = $result.summary
    Assert ($s.spaces -eq 1 -and $s.pages -eq 2 -and $s.folders -eq 1 -and $s.tabs -eq 1 -and $s.favorites -eq 1) `
        "the dry run counts 1 space, 2 pinned pages, 1 folder, 1 tab and 1 favorite (got $($s | ConvertTo-Json -Compress -Depth 1))"
    Write-Output "arc-import passed"
}
finally {
    Remove-Item Env:ARCLIKE_ARC_DIR -ErrorAction SilentlyContinue
    Stop-TestChrome
}
