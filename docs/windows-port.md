# Arclike on Windows: port plan

Status, 2026-11-01: the code for phases 1 to 3 and the test tools of phase 0 (section 9) is written. It builds on macOS. On a real Windows 11 box, the protocol test and the smoke scenario pass. Section 10 lists what was and was not verified.

## 1. Summary

- The port is feasible. Upstream's C#/WPF/.NET 8 port is a usable base for the hook, the native messaging host, leader election and the overlay windows.
- `git merge origin/windows` does nothing. `arclike` already contains every commit of `origin/windows`, and also the upstream commit that reverted it (section 2). Restore the folder with `git checkout c4d5366 -- native-host-windows` instead.
- The extension stays shared. It needs one small change: platform-aware shortcut hints and icon names in the command bar rows.
- The command bar is the main new work. On macOS it is a non-activating panel. On Windows it must take keyboard focus from Chrome, and Windows restricts which process can take the foreground (section 4.3).
- Windows needs no Accessibility-style permission. A low-level keyboard hook (`WH_KEYBOARD_LL`) works for any non-elevated process in the user's desktop session.
- All testing can run over SSH. Build, install and registry work run directly in the SSH session. Work that needs the desktop runs through a scheduled task in the auto-logged-on user's session (section 7). That covers Chrome, the hook, windows, screenshots, injected keys and UI Automation.

## 2. What `origin/windows` is

`origin/windows` ends at `9b990c4` (2026-02-07). It adds `native-host-windows/`, about 3,770 lines:

| Area | Files | Notes |
|---|---|---|
| Entry and launch mode | `App.xaml.cs` | Treats a `chrome-extension://` argument as a native messaging launch. Otherwise shows the setup window. |
| Native messaging | `NativeMessaging/NativeMessagingHost.cs` | 4-byte length prefix, JSON, reader thread, exits on stdin EOF. |
| Keyboard | `Keyboard/KeyboardHook.cs` | `SetWindowsHookEx(WH_KEYBOARD_LL)`. Ctrl+Tab, Ctrl+Shift+Tab, copy-URL shortcut. |
| Instances | `IPC/LeaderElection.cs`, `IPC/InstanceCommunication.cs` | Named mutex picks the hook owner. Named pipes replace `DistributedNotificationCenter`. |
| Windows | `Views/TabSwitcherOverlay`, `ToastOverlay`, `SetupWindow` | Overlay is `WindowStyle=None`, `AllowsTransparency`, `Topmost`, `ShowActivated=False`. |
| Registration | `Services/BrowserConfigManager.cs` | Writes a manifest JSON and an HKCU registry key per enabled browser. |
| Packaging | `build.ps1`, `installer/setup.iss` | Self-contained single-file publish, optional Authenticode, Inno Setup per-user installer. |
| Updates | `Services/UpdateService.cs` | NetSparkle against tabswitcher.app. Arclike has no update feed, so remove it. |

The history matters for the merge:

1. Upstream merged the port into `main` through PR #2 (`cc4cced`, 2026-02-08). That PR also carried `c4d5366`, a launch fix that is not on `origin/windows`.
2. Upstream reverted that merge in `8dd0e25` (2026-02-10). The revert removes `native-host-windows/` and undoes small website edits in `docs/`.
3. `arclike` descends from upstream `main` after the revert. So `git log arclike..origin/windows` is empty, and `git merge-base arclike origin/windows` is `9b990c4` itself.

The revert message gives no reason. The code does not show an obvious one, so treat the port as untested on real hardware.

## 3. Merge feasibility

### 3.1 How to bring the code in

A merge, a rebase or a cherry-pick of the port commits all do nothing, because Git sees them as already applied. Use one of these:

```bash
# Recommended: take the folder as it was after the launch fix, as one new commit.
git checkout c4d5366 -- native-host-windows
git commit -m "Restore upstream's Windows port as the base for Arclike on Windows"
```

```bash
# Alternative: revert the revert. It also restores upstream's docs/ edits, which Arclike does not want.
git revert 8dd0e25
```

The path `native-host-windows/` does not exist on `arclike`, so the checkout has no conflicts. The real work is the delta between upstream 3.7.4 and Arclike, which a merge would not solve anyway. The Swift side of that delta is about 1,230 changed lines in `native-host/Sources/arclike/main.swift`.

### 3.2 Rebrand

| Item | Upstream port | Arclike |
|---|---|---|
| Native host name | `com.tabswitcher.native` | `com.amitrahman1026.arclike` |
| Extension ID | `chrome-extension://*/` (installer) or per-browser setting | `jlmidbafifiahhcpahkcejphlibhjapo` (fixed by the manifest `key`) |
| Exe and assembly | `TabSwitcher.exe`, namespace `TabSwitcher` | `Arclike.exe`. Keep the namespace rename for a later commit to keep the diff readable. |
| App data | `%APPDATA%\TabSwitcher` | `%LOCALAPPDATA%\Arclike` |
| Log | `%USERPROFILE%\tabswitcher_debug.log` | `%LOCALAPPDATA%\Arclike\Arclike.log` |
| Mutex and pipe | `Global\TabSwitcherEventTap`, pipe `TabSwitcherIPC` | `Local\com.amitrahman1026.arclike.hook`, pipe name with the session ID in it |
| Version | 3.7.4 | 0.1.0, from one place shared with `native-host/Info.plist` if practical |
| Remote browser list, update feed | tabswitcher.app | None. Arclike sets both URLs to `nil` on macOS. |

The mutex and pipe change is a fix, not only a rename. `Global\` spans all sessions. An `Arclike.exe` started from SSH (session 0) could win leadership and install a hook that sees no keys. `Local\` and a per-session pipe keep election inside one desktop session.

### 3.3 Feature gap

"Native" means work in the C# app. "Extension" means `extension/` already does it for both platforms.

| Arclike feature | Where | Windows work |
|---|---|---|
| Visited-tabs list, MRU insert behind opener, 5-preview cap, activity window | Extension | None. |
| Show on the first press (Swift sends `show_ui: true` every press, 10 ms target) | Native | Remove the 150 ms `DispatcherTimer` and `request_show_ui` path. |
| Hover to select (sends `select_tab` with the tab ID) | Native | `MouseMove` on each card, with the "cursor must move first" guard. |
| Ctrl+Esc cancels the switch (`cancel_switch`) | Native | Handle `VK_ESCAPE` in the hook while a switch runs. Swallow it, because Ctrl+Esc opens the Start menu on Windows. |
| Two-row card layout, scaling (`SwitcherLayout`) | Native | Port `SwitcherLayout.compute` as is. Replace the single `ItemsControl` row. |
| Place over the focused browser window, clamp to its monitor | Native | `GetForegroundWindow` is already the focused window. Add monitor clamping and DPI handling (section 4.5). |
| Thumbnail and favicon downsampling | Native | `BitmapImage.DecodePixelWidth` (440 px previews, 72 px favicons). |
| Command bar (`show_command_bar`, `command_bar_results`, `command_bar_query`, `command_bar_choose`, `command_bar_closed`, `command_bar_open`) | Native | New window. Section 4. |
| `register` with `features: ["command_bar"]`, ready and roll-call between instances | Native | Port `announceCommandBar`, `commandBarAvailable` and the roll call over the pipe IPC. |
| `log` action | Native | Write `message` to the log with an `Extension:` prefix. |
| `url_copied` | Native | Exists. Add a retry: `Clipboard.SetText` throws when another process holds the clipboard. |
| Command bar hints (`⌘W`) and icons (SF Symbol names) | Extension and native | Extension: send Windows hints (`Ctrl+W`) when `chrome.runtime.getPlatformInfo` returns `os: "win"`. Native: map each symbol name to a Segoe Fluent Icons glyph. |

### 3.4 Defects in the upstream port to fix while porting

- `installer/setup.iss` writes `"allowed_origins": ["chrome-extension://*/"]`. Chrome rejects wildcards in `allowed_origins`, so the installed host never connects. Write the exact Arclike origin.
- `KeyboardHook.GetFrontmostBrowserId` calls `Process.GetProcessById` on every key event. A slow hook callback can pass `LowLevelHooksTimeout`, and Windows can then remove the hook without notice. Cache the process name per foreground window handle, and use `QueryFullProcessImageName`.
- `NativeMessagingHost.ReadMessage` returns on a bad length without reading the payload. The next read then starts in the middle of a message. Read and discard the payload, or exit.
- `BrowserConfigManager.UpdateManifests` writes one manifest file for every browser in a loop, each time with a different extension ID. Arclike has one ID, so write one manifest.
- The project has no application manifest. Add one with `PerMonitorV2` DPI awareness. Otherwise window rectangles from Win32 (physical pixels) and WPF positions (device-independent units) disagree at any scale above 100%.
- Ctrl+Shift+C, the port's copy-URL default, is the DevTools "inspect element" shortcut in Chrome on Windows. Pick another default, or leave copy-URL to the command bar's Copy URL command.

## 4. The command bar as a WPF window

### 4.1 Trigger

The leader's hook handles key-down for `T` and `L` when all of these are true:

1. The foreground window belongs to a known browser process (`chrome.exe` and the others in `KeyboardHook`).
2. The modifiers are exactly Ctrl. Ctrl+Shift+T (reopen closed tab) must pass through.
3. `commandBarAvailable(browser)` is true: a live host for that browser announced `command_bar` support. Otherwise Chrome keeps its own Ctrl+T and Ctrl+L.

The hook then swallows the key (returns 1) and posts `commandBar` with mode `new_tab` (T) or `current_tab` (L) to all instances. Low-level hooks carry no auto-repeat flag, so the hook tracks which of the two keys is down and ignores repeats until key-up. The owning instance sends `command_bar_open` to its extension. The extension answers `show_command_bar` only from the profile that owns the focused window. This flow is the same as on macOS.

Alt+D and F6 also focus Chrome's address bar on Windows. Leave them to Chrome, as macOS leaves its other address-bar shortcuts.

### 4.2 Window

- A `Window` with `WindowStyle=None`, `ResizeMode=NoResize`, `ShowInTaskbar=False`, `Topmost=True`.
- Avoid `AllowsTransparency=True` for this window. It makes a layered window, which costs rendering speed and can complicate screen capture (section 7.4). Use DWM instead: `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` for corners, and `DWMWA_SYSTEMBACKDROP_TYPE` (Windows 11 22H2 or later) for an acrylic backdrop. On Windows 10, use a solid dark background.
- Add `WS_EX_TOOLWINDOW` in `SourceInitialized` so Alt+Tab does not list the bar.
- Create the window once and hide it between uses. The macOS app does the same, and the first show then has no layout delay.
- Content: a `TextBox` (18 pt, placeholder "Search with Google or enter address"), a separator and a virtualized `ListBox` of rows. Each row has a favicon or icon glyph, a title with the query words in bold (`Run` elements), a detail line and a right-aligned hint.
- Height follows `CommandBarLayout.height(rows:)` from the Swift code. The top edge stays fixed when the row count changes.

### 4.3 Focus

On macOS the panel becomes key without activating the app, so Chrome stays the active app. Windows has no equivalent for a window that takes typed text. The bar must become the foreground window, and Chrome loses focus while the bar is open.

`SetForegroundWindow` succeeds only under conditions that Microsoft documents. Examples are: the caller is the foreground process, or it received the last input event, or no window is in the foreground. The host is a background process started by Chrome through `cmd.exe`, so a plain call can fail. The failure is silent: the taskbar button flashes and the bar shows without focus. Use this order, and log which step worked:

1. Save the Chrome window handle from `GetForegroundWindow`.
2. Call `Show()`, then `SetForegroundWindow(bar)`. Check `GetForegroundWindow() == bar`.
3. If the check fails, call `AttachThreadInput` from the bar's thread to Chrome's input thread. Then call `BringWindowToTop`, `SetForegroundWindow` and `SetFocus`, and detach.
4. If that also fails, fall back to a hotkey. Register Ctrl+T and Ctrl+L with `RegisterHotKey` only while a browser is in the foreground, tracked with `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`. A `WM_HOTKEY` message is input to the app, which can give it foreground rights. This option needs the most code, so build it only if the tests in section 7 show that steps 2 and 3 fail.

Do not use the "send a lone Alt key" workaround. In Chrome, a lone Alt press can move focus to the app menu.

After focus works:

- `TextBox.Focus()` and `SelectAll()` after the window is active, so typing replaces pre-filled text (the Ctrl+L URL).
- `Deactivated` closes the bar without opening anything, and sends `command_bar_closed`. This matches `windowDidResignKey` on macOS and covers clicks outside the bar and Alt+Tab.
- On close or choose, hide the bar and then call `SetForegroundWindow(savedChromeHwnd)`. The bar is the foreground window at that moment, so the call is allowed. Without it, Windows activates whichever window is next in z-order, which may not be Chrome. The Swift comment "Hide first, so the browser window has the keyboard back before the tab opens" applies here too.

A fallback design exists: a non-activating bar (`WS_EX_NOACTIVATE`) that receives every key through the hook while it is open. Chrome then keeps focus, as on macOS. It needs a hand-written text editor with no IME, no clipboard shortcuts and no caret handling from WPF. Use it only if every focus method above fails.

### 4.4 Keys inside the bar

Handle these in `PreviewKeyDown` on the `TextBox`:

| Key | Action | Swift equivalent |
|---|---|---|
| Down, Tab | Select the next row, put its `fill` in the field, caret at end | `move(1)` |
| Up, Shift+Tab | Select the previous row | `move(-1)` |
| Enter | `command_bar_choose` with `text` and the selected row's payload | `choose(index:)` |
| Esc | Close, send `command_bar_closed` | `dismiss()` |

Ctrl+A, Ctrl+C, Ctrl+V and Ctrl+X work in a WPF `TextBox` without extra code. The macOS app needed `CommandBarTextField` only because it has no Edit menu. On `TextChanged`, apply the same `completing` rule and send `command_bar_query` with an increasing `seq`. Show the inline completion with `SelectionStart` and `SelectionLength`, under the same guards as `showCompletion`. Drop results whose `seq` is not the latest. Accept a `refresh` only if the row count is unchanged.

### 4.5 Position

1. Get Chrome's frame from `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`. `GetWindowRect` includes the invisible resize borders, about 7 px on each side on Windows 10 and 11.
2. Width: `clamp(frame.width - 48, 360, 720)`, in device-independent units.
3. Top: `frame.top + max(70, frame.height * 0.22)`, which matches the Swift code ("a little above the middle of the window").
4. Clamp to the work area of `MonitorFromWindow(chromeHwnd, MONITOR_DEFAULTTONEAREST)`.
5. Convert with the DPI of that monitor (`GetDpiForWindow`), or place the window with `SetWindowPos` in physical pixels after `SourceInitialized`. With `PerMonitorV2` in the app manifest, WPF rescales the content when the bar opens on a monitor with a different scale.

The switcher overlay needs the same steps 1, 4 and 5.

### 4.6 Rows

- Favicons arrive as data URLs. Decode them with `BitmapImage` and `DecodePixelWidth = 32 * dpiScale`, then freeze them so the UI thread can use images from the reader thread.
- Map SF Symbol names to Segoe Fluent Icons (Windows 11) or Segoe MDL2 Assets (Windows 10). The current set is small: `xmark`, `arrow.clockwise`, `link`, `arrow.uturn.backward`, `macwindow`, `eyeglasses`, `arrow.up.left.and.arrow.down.right`, `gearshape`, `clock`, `arrow.down.circle`, `book`, `trash`, and the few others in `extension/commandbar.js`. Show a neutral glyph for an unknown name.
- Hover selects a row only after the cursor moved since the bar opened, as in `hoverSelect`.
- Set `AutomationProperties.AutomationId` on the window (`ArclikeCommandBar`), the field (`CommandBarField`) and each row (`CommandBarRow`, with the title as `Name`). The headless tests read these through UI Automation. Do the same for the switcher (`ArclikeSwitcher`, `SwitcherCard`).

## 5. Native host registration

Chrome on Windows finds a host through the registry, not through a folder of manifests:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\Arclike"
$manifest = "$dir\com.amitrahman1026.arclike.json"
@{
  name = "com.amitrahman1026.arclike"
  description = "Arclike native helper"
  path = "Arclike.exe"
  type = "stdio"
  allowed_origins = @("chrome-extension://jlmidbafifiahhcpahkcejphlibhjapo/")
} | ConvertTo-Json | Set-Content -Encoding utf8 $manifest
New-Item -Force "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.amitrahman1026.arclike" |
  Set-ItemProperty -Name "(default)" -Value $manifest
```

Facts from Chrome's native messaging documentation:

- The key goes under `HKCU` or `HKLM` at `Software\Google\Chrome\NativeMessagingHosts\<name>`. Its default value is the full path of the manifest. Chrome reads the 32-bit registry view first, then the 64-bit view. HKCU needs no admin rights.
- On Windows, `path` can be relative to the folder of the manifest.
- `allowed_origins` cannot contain wildcards.
- Chrome passes the caller's origin as the first argument. On Windows it also passes `--parent-window=<handle>`. The handle is 0 when the caller is a service worker, which is the case for Arclike.
- stdin and stdout must be binary. `Console.OpenStandardInput()` and `OpenStandardOutput()` give raw streams, so the port is correct here.

Chrome starts the host through `cmd.exe /d /c` unless the `NativeHostsExecutablesLaunchDirectly` policy is on (Chrome 120 and later). So the parent of `Arclike.exe` is `cmd.exe`, and Chrome is the grandparent. `BrowserDetector.DetectParentBrowser` walks up to 10 levels, so it handles both cases.

Other Chromium browsers use other keys, which `BrowserConfigManager` already lists: `Software\BraveSoftware\Brave-Browser\...`, `Software\Microsoft\Edge\...`, `Software\Vivaldi\...`, `Software\Chromium\...`.

Add `native-host-windows/install-local.ps1`, the Windows counterpart of `native-host/install-local.sh`:

1. `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true`.
2. Stop any running `Arclike.exe`. The extension reconnects after one second (`setTimeout(connectNativeHost, 1000)`), so Chrome starts the new build without a restart.
3. Copy the exe to `%LOCALAPPDATA%\Programs\Arclike`.
4. Write the manifest and the HKCU key as shown above.

A replace while the exe runs fails because Windows locks a running exe. Step 2 must come before step 3.

## 6. Signing on Windows

Signing has a smaller job on Windows than on macOS. macOS ties the Accessibility permission to the code signature, which is why Arclike signs every local build with the "Arclike Local Signing" identity. Windows has no such permission for keyboard hooks. An unsigned exe installs and runs the hook the same way as a signed one.

Signing affects only SmartScreen and antivirus reputation:

| Option | Cost | Effect | Fit |
|---|---|---|---|
| Unsigned | None | A file built on the machine has no Mark of the Web, so SmartScreen does not prompt. A downloaded exe or installer gets "Windows protected your PC". | Personal use, and all testing. |
| Self-signed (`New-SelfSignedCertificate -Type CodeSigningCert`) | None | Trusted only on machines that import the certificate into Trusted Root and Trusted Publishers. No SmartScreen benefit elsewhere. | Little value. Signing does not change permissions on Windows. |
| Azure Artifact Signing (formerly Trusted Signing) | Monthly fee. Basic tier: 5,000 signatures per month. Check the current price and identity-validation rules for individuals before you choose it. | Microsoft-issued certificate, SignTool or GitHub Actions integration. Reputation builds per publisher identity. | Best fit for a public release. |
| OV certificate from a CA | Yearly fee. The key must be on a hardware token or cloud HSM. | Same SmartScreen result as above. EV certificates no longer skip the SmartScreen reputation step. | Works, but costs more than Artifact Signing for one person. |

An unsigned exe that installs a keyboard hook can look like a keylogger to antivirus heuristics. If Microsoft Defender flags a build, submit the file to Microsoft as a false positive. For the test box, a Defender exclusion for the build folder is an option (section 8, step 9).

Recommendation: ship unsigned builds for personal use and testing. Choose Artifact Signing before any public release, and sign both `Arclike.exe` and the installer. The GPG-signed Git commits are not affected.

## 7. Headless test plan

### 7.1 Sessions

An SSH login on Windows runs in session 0, the non-interactive services session. Processes there have no visible desktop and get no keyboard or mouse input. The auto-logged-on user owns the console session, usually session 1.

| Task | SSH session (0) | Console session (1) |
|---|---|---|
| `git`, `dotnet build`, `dotnet publish`, `node --test` | Yes | Yes |
| Write HKCU keys, files in `%LOCALAPPDATA%` | Yes, same user hive | Yes |
| Start Chrome so it shows and has focus | No | Yes |
| Keyboard hook receives keys | No | Yes |
| Screenshot of the desktop | No (black or error) | Yes |
| `SendInput` into Chrome | No | Yes |
| UI Automation of Chrome and Arclike windows | No | Yes |

SSH logins with a key and no password have no stored credentials. Tools that need DPAPI or network credentials (for example a Git credential manager) can fail in session 0. Clone over HTTPS without credentials, or use SSH remotes.

### 7.2 Run a command in the console session

A scheduled task with an interactive principal runs in the session of the logged-on user and needs no stored password. Register it once:

```powershell
# native-host-windows/test/Register-InteractiveRunner.ps1
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\arclike\test\run-job.ps1'
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName "ArclikeInteractive" -Action $action -Principal $principal -Force
```

`schtasks /Create ... /IT` gives the same result ("run only when the user is logged on"). `run-job.ps1` runs `C:\arclike\test\job.ps1` and writes its output and exit code to `C:\arclike\test\out\`. A wrapper that SSH calls does this:

1. Write the job script to `C:\arclike\test\job.ps1`.
2. Delete the old output files.
3. `Start-ScheduledTask ArclikeInteractive`.
4. Wait until the exit-code file exists, with a timeout.
5. Print the output and exit with the job's exit code.

From the Mac:

```bash
ssh arclike-win 'powershell -File C:\arclike\test\Invoke-Interactive.ps1 -Command "C:\arclike\test\probe.exe screenshot C:\arclike\test\out\shot.png"'
```

```bash
scp arclike-win:C:/arclike/test/out/shot.png ./shot.png
```

An agent on the Mac can then read the PNG.

If the task approach fails, Sysinternals `PsExec -i 1` from an elevated SSH session is a second option. It needs admin rights, and the process can run with a different token than the logged-on user. So prefer the scheduled task.

### 7.3 Chrome under test

- Use a separate profile: `chrome.exe --user-data-dir=C:\arclike\test\profile --no-first-run --no-default-browser-check`. Since Chrome 136, `--remote-debugging-port` and `--remote-debugging-pipe` are ignored for the default profile. A test profile also keeps tests away from the user's own tabs.
- Google Chrome 137 and later ignore `--load-extension`. Two ways remain:
  - Load the extension with the DevTools Protocol method `Extensions.loadUnpacked` (parameter `path`). Puppeteer exposes it as `browser.installExtension(path)`. It needs `pipe: true` and `enableExtensions: true` (puppeteer-core 24.10.0 or later). The extension does not stay in the profile: after a normal restart it is gone, also with developer mode on. So `test/load-extension.mjs` starts the test Chrome and loads the extension on every start. This is what the tests use.
  - Use Chrome for Testing, which still accepts `--load-extension`. Check which registry key it reads for native hosts before you rely on it. This was not verified.
- The extension ID stays `jlmidbafifiahhcpahkcejphlibhjapo` in every case, because the manifest `key` fixes it. The `allowed_origins` entry needs no change.
- Chrome that a scheduled task starts does not get the foreground. `Start-TestChrome` calls `probe activate chrome` after the start.
- Use the same DevTools connection to read state that the screen does not show: the active tab, the tab count and the tab order. A test then checks that Enter in the command bar opened one new tab with the expected URL.

### 7.4 Probe tool

Add a small console app, `native-host-windows/test/Probe` (`net8.0-windows`, `PerMonitorV2`). It always runs in the console session through 7.2. Commands:

| Command | What it does |
|---|---|
| `screenshot <file> [--window <automationId>]` | Captures the virtual screen, or one window's rectangle, to PNG. |
| `keys <chord>...` | Sends key chords with `SendInput`, for example `ctrl+t`, `ctrl down`, `tab`, `ctrl up`. |
| `type <text>` | Sends Unicode text with `KEYEVENTF_UNICODE`. |
| `foreground` | Prints the foreground window's handle, process name, title and rectangle as JSON. |
| `activate <process>` | Brings the process's main window to the foreground. A tap of Alt first gives the probe the last input, which `SetForegroundWindow` needs. |
| `uia [--process Arclike]` | Prints the UI Automation tree (control type, `AutomationId`, `Name`, rectangle) as JSON. |
| `wait <automationId> [--gone] [--timeout ms]` | Waits until an element appears or disappears. |

Implementation notes:

- Capture with `BitBlt` and `CAPTUREBLT`, or with `Graphics.CopyFromScreen` and `CopyPixelOperation.SourceCopy | CaptureBlt`. Without `CAPTUREBLT`, layered windows can be missing from the image, and the switcher overlay is a layered window. Call `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` first, or the capture is scaled. If GDI capture still misses windows, use `Windows.Graphics.Capture` instead.
- A low-level hook receives injected input. Windows marks it with `LLKHF_INJECTED`. Arclike must not ignore injected keys, or the probe cannot test it. Upstream's hook does not check the flag, so keep it that way.
- Send real modifier events: `ctrl down`, then `tab` twice, a pause, then `ctrl up`. The release of Ctrl ends the switch, so the test must hold Ctrl through the whole sequence.
- `SendInput` cannot send to a window of a higher integrity level, and nothing can send input to the secure desktop (UAC, lock screen). Run Chrome, Arclike and the probe all non-elevated.

Arclike itself should log structured lines for the tests to check, for example `commandbar shown rect=... focused=true method=attach`. The log is the cheapest check and works when a screenshot is hard to judge.

### 7.5 Test levels

1. Extension logic. `node --test tests/*.test.cjs`. This already runs on macOS and needs no Windows box.
2. Protocol, in the SSH session. Start `Arclike.exe chrome-extension://jlmidbafifiahhcpahkcejphlibhjapo/` with redirected stdin and stdout. Send framed `ping`, `register` (with `features: ["command_bar"]`), `log` and a bad length. Expect `ready`, `pong`, `registered`, a log line and a clean exit on EOF. WPF should start in session 0 with no visible windows. Check this on the box. If it fails, run this level through 7.2.
3. End to end, in the console session through 7.2:

| # | Scenario | Pass when |
|---|---|---|
| 1 | Install | Registry default value points to the manifest. The manifest parses and has the exact origin. |
| 2 | Chrome starts the host | `Arclike.exe` runs in session 1 under `cmd.exe` or `chrome.exe`. The log shows `register` with `command_bar`. |
| 3 | Ctrl+Tab | With 5 visited tabs, hold Ctrl and press Tab twice. `ArclikeSwitcher` appears with the expected card count within 200 ms. Release Ctrl. The active tab (from DevTools) changes as expected. Foreground is still Chrome. |
| 4 | Ctrl+Esc during a switch | The switcher closes, the active tab does not change and the Start menu does not open. |
| 5 | Hover select | Move the cursor over a card while Ctrl is held, then release Ctrl. The hovered tab becomes active. |
| 6 | Ctrl+T | `ArclikeCommandBar` appears over the Chrome window. `foreground` reports the bar. Typed text arrives in `CommandBarField`. Rows appear. Enter opens one new tab. Foreground returns to Chrome. |
| 7 | Ctrl+L | The field holds the active tab's URL, selected. Enter replaces the current tab and opens no new tab. |
| 8 | Close paths | Esc, a click outside the bar and Alt+Tab each close the bar and send `command_bar_closed`. Foreground returns to Chrome after Esc. |
| 9 | Ctrl+Shift+T | Chrome reopens the last closed tab. Arclike does not take the chord. |
| 10 | Pass-through | With Notepad in the foreground, Ctrl+T and Ctrl+Tab reach Notepad. |
| 11 | Two instances | Two profiles, two hosts. Kill the leader. The other host takes the hook within one second, and Ctrl+Tab still works. |
| 12 | Scale and position | At 150% scale, the bar is centered on the Chrome window and inside the monitor work area. Needs a sign-out to change scale, so run it last. |

Each scenario script saves a screenshot, the UIA dump and the Arclike log to `C:\arclike\test\out\<scenario>\`, so a failed run can be studied from the Mac.

### 7.6 Loop from the Mac

1. Copy the tree: `git archive --format=tar HEAD | ssh arclike-win "tar -x -f - -C C:/arclike/src"`. Windows 10 and later include `tar.exe`. For uncommitted changes, archive `$(git stash create)` instead of `HEAD`. Check once that a binary pipe through SSH arrives intact.
2. Build and install: `ssh arclike-win "powershell -File C:\arclike\src\native-host-windows\install-local.ps1"`.
3. Run the scenarios through `Invoke-Interactive.ps1`.
4. Copy `C:\arclike\test\out` back with `scp -r`.

Put the four steps in one script, for example `native-host-windows/test/remote-test.sh`.

### 7.7 Things that break a headless box

- No monitor. Without a display, Windows can run at a low resolution or capture black frames. Use an HDMI or DisplayPort dummy plug, a virtual display driver, or a VM with a virtual display. Fix the resolution at 1920x1080 and 100% scale.
- RDP. Disconnecting an RDP session leaves the user's session disconnected, and capture and input then fail. Do not use RDP on this box. If you must, run `tscon <session id> /dest:console` as admin before you disconnect.
- Lock and sleep. The lock screen is a secure desktop that blocks input and capture. Turn off the screen saver, sign-in on wake, sleep and the display timeout.
- Updates. A Windows Update restart is fine if auto-logon is on. Each test run should first check that `query user` shows the console session as Active.
- Chrome dialogs. First-run, restore-pages and default-browser prompts steal focus. The flags in 7.3 and a dedicated profile remove most of them.

## 8. Setup checklist for the Windows box

Do these once, at the machine or through an existing remote tool. Windows 10 22H2 or Windows 11, x64, Pro or Home.

1. Create a local account that is an administrator, for example `arclike`. A Microsoft account works, but auto-logon is simpler with a local account. On Windows 11, turn off "For improved security, only allow Windows Hello sign-in" in Settings > Accounts > Sign-in options, or auto-logon cannot use a password.
2. Install OpenSSH Server, in an elevated PowerShell:

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Set-Service sshd -StartupType Automatic
   Start-Service sshd
   New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force
   Get-NetFirewallRule -Name OpenSSH-Server-In-TCP
   ```

3. Add the Mac's public key. For an administrator account, OpenSSH reads `C:\ProgramData\ssh\administrators_authorized_keys`, not the file in the user profile:

   ```powershell
   Add-Content -Path C:\ProgramData\ssh\administrators_authorized_keys -Value "<contents of ~/.ssh/id_ed25519.pub>"
   icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
   ```

4. Install the tools:

   ```powershell
   winget install --id Google.Chrome -e
   winget install --id Microsoft.DotNet.SDK.8 -e
   winget install --id Git.Git -e
   winget install --id OpenJS.NodeJS.LTS -e
   ```

   If winget reports that the Chrome installer hash does not match, Google has shipped a newer MSI than the winget manifest names. Download `https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi`, check that `Get-AuthenticodeSignature` shows a valid Google LLC signature, and run `msiexec /i <file> /qn`.

5. Turn on auto-logon with Sysinternals Autologon (`learn.microsoft.com/sysinternals/downloads/autologon`). It stores the password as an LSA secret. The registry method (`AutoAdminLogon` and `DefaultPassword` under `Winlogon`) stores it in plain text. Type the password yourself. Do not send it to an agent.
6. Turn off sleep, the display timeout and the screen saver:

   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change monitor-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```

   Also set Settings > Accounts > Sign-in options > "If you've been away, when should Windows require you to sign in again?" to Never, and turn off the screen saver.
7. Give the box a display: a dummy plug, a virtual display driver, or a VM display. Set 1920x1080 at 100% scale.
8. Restart once. Check that the desktop appears without a sign-in.
9. Optional: exclude the work folder from Defender scans, for faster builds and no quarantine of unsigned hook builds: `Add-MpPreference -ExclusionPath C:\arclike`. This weakens protection for that folder, so decide yourself.
10. Create `C:\arclike` and give the account full control (the default for a folder an admin creates).
11. On the Mac, add an SSH host entry and test it:

    ```
    Host arclike-win
      HostName <ip or name>
      User arclike
      IdentityFile ~/.ssh/id_ed25519
    ```

    ```bash
    ssh arclike-win "query user"
    ```

    The output must show the console session as Active.
12. Send the host name and user name to the agent that runs the port. Nothing else is needed. No permission dialog exists for the keyboard hook.

## 9. Port phases

| Phase | Work | Done when |
|---|---|---|
| 0 | Box setup (section 8). Register the interactive runner. Write the probe. | `screenshot` over SSH returns the desktop, and `foreground` names the active window. |
| 1 | Restore `native-host-windows/` from `c4d5366`. Rebrand (3.2). Remove updates and the remote browser list. Fix the defects in 3.4. Add `install-local.ps1`. | Test levels 1 and 2 pass. Scenarios 1 and 2 pass. |
| 2 | Switcher parity: show on first press, two-row layout, hover select, Ctrl+Esc, DPI and monitor placement, downsampled images. | Scenarios 3, 4, 5, 9, 10 and 11 pass. |
| 3 | Command bar window, focus strategy, keys, rows and icons. Platform-aware hints in `extension/commandbar.js`. | Scenarios 6, 7 and 8 pass, and the log names the focus method that worked. |
| 4 | Polish: scale test, toast, Windows 10 fallback styling. | Scenario 12 passes. |
| 5 | Release: Inno Setup with the exact origin, signing choice, README section, a GitHub release asset. | A fresh Windows user can install from the release and pass scenarios 2, 3 and 6. |

Phases 2 and 3 touch different files after phase 1 lands, so they can run in parallel.

## 10. What was verified

Verified on 2026-10-25, on macOS:

- Git history: `origin/windows` (`9b990c4`) is an ancestor of `arclike`. Upstream merged it in `cc4cced` and reverted it in `8dd0e25`. `c4d5366` holds the launch fix. `git checkout c4d5366 -- native-host-windows` restores 28 files.
- Every statement about the upstream C# code in sections 2, 3.3 and 3.4 comes from reading that code. Every statement about the macOS app comes from `native-host/Sources/arclike/main.swift` and `extension/` at `0af95a3`.
- Chrome native messaging rules in section 5 come from Chrome's documentation. The `cmd.exe` launch comes from Chromium sources and the `NativeHostsExecutablesLaunchDirectly` policy notes.
- The `--load-extension` removal (Chrome 137) and the remote debugging change (Chrome 136) come from Chromium's announcements. `Extensions.loadUnpacked` exists in the current DevTools Protocol definition, with parameters `path` and `enableInIncognito`.
- The build. With the .NET 8 SDK (8.0.426, installed user-local in `~/.dotnet8`), `dotnet build native-host-windows/Arclike.sln -p:EnableWindowsTargeting=true` builds the app, the probe and the tests with 0 warnings. With only SDK 3.1.300 it fails at restore ("Invalid target framework 'unsupported'").
- `dotnet test native-host-windows/Arclike.Tests` passes 19 tests on macOS (switcher layout, command bar row parsing, highlighting, tips, glyphs, shortcut defaults).

Verified on 2026-11-01, on Windows 11 Pro 24H2 (build 26100), Chrome 156, two 1920x1080 monitors at 100%, over SSH through Tailscale:

- `install-local.ps1` publishes the app, writes the manifest and sets the HKCU key. Chrome then starts `Arclike.exe` through `cmd.exe` with the origin and `--parent-window=0`. Parent detection finds Chrome one level up.
- `Test-Protocol.ps1` passes 7 of 7 over SSH. WPF starts in session 0.
- The scheduled-task runner runs jobs in the console session. Screenshots, `SendInput` and UI Automation work from it.
- The smoke scenario passes. The hook sees injected keys. Ctrl+T opens the command bar, and the first focus step fails but `AttachThreadInput` works (`focused=True method=attach`). Typed text reaches the extension as queries. Esc closes the bar and Chrome gets the foreground back. Ctrl+Tab shows the switcher with thumbnails and never takes the foreground.
- Bugs that the first run found and that are fixed: a stack overflow at start in `ShortcutsConfiguration` (it came from upstream, so upstream's build never started), and command bar rows and switcher cards that UI Automation could not see (a `Border` has no automation peer).

Not verified:

- Per-monitor DPI at a scale other than 100%, and the switcher or bar on the second monitor.
- Enter in the command bar, the hover selection in the switcher, copy URL, and leader handover between two browsers.
- The hook in an elevated window, and Chrome as an installed user (not a test profile started by Puppeteer).
- The Chrome for Testing registry key, and Artifact Signing prices and eligibility.
- Why upstream reverted the port.
