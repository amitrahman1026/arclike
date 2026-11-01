# Arclike

Arc-style tab switching and a command bar for Chrome on macOS and Windows. A fork of [Tab Switcher](https://github.com/nechemyaspitz/tab-switcher).

> I built this for my own workflow. Feel free to fork it, or send a patch if something could be better.

<!-- Demo video goes here. -->

| macOS | Windows | Action |
|-------|---------|--------|
| **Ctrl+Tab** | **Ctrl+Tab** | Switch between the tabs you visited recently. Release Ctrl to switch, press Esc to cancel. |
| **Cmd+T** | **Ctrl+T** | Command bar: open tabs, history, bookmarks and commands. Opens the result in a new tab. |
| **Cmd+L** | **Ctrl+L** | Command bar. Opens the result in the current tab. |
| **Cmd+Shift+C** | **Alt+Shift+C** | Copy the URL of the current tab. |

## Install

### macOS

You need macOS 14 or later and Xcode.

```bash
./native-host/create-signing-identity.sh   # once
./native-host/install-local.sh
```

Then:

1. In `chrome://extensions`, turn on **Developer mode** and load the `extension` folder with **Load unpacked**.
2. Open `/Applications/Arclike.app` once and allow Accessibility.

### Windows

You need Windows 10 or 11 and the .NET 8 SDK. In PowerShell:

```powershell
.\native-host-windows\install-local.ps1                  # Chrome
.\native-host-windows\install-local.ps1 -Browsers Chrome,Edge
```

Then load the `extension` folder in `chrome://extensions` with **Load unpacked**, as on macOS. Windows asks for no permission.

Coming from Arc? Click the Arclike icon in Chrome and choose **Import from Arc**: favorites become pinned tabs, each space's pinned tabs become bookmarks, and its open tabs become a tab group. Limits:

- The app sends Arc's sidebar to Chrome in one message, and Chrome takes at most 1 MB at a time. If the sidebar is larger, the import stops and says so. Archive or delete tabs in Arc, then import again.
- A tab that Arc never loaded has no saved address, so the import leaves it out and counts it.
- Arc's command bar choices come along only when they fit in the same message.

Incognito windows: Chrome keeps extensions out of them unless you turn on **Allow in Incognito** for Arclike in `chrome://extensions`. Until then, Arclike still takes its keys in an incognito window and cannot answer them, so Ctrl+Tab, Cmd+T and Cmd+L do nothing there.

<details>
<summary>After a change</summary>

- `extension/`: reload Arclike in `chrome://extensions`.
- `native-host/`: run `./native-host/install-local.sh`, then reload the extension.
- `native-host-windows/`: run `install-local.ps1` again. The extension starts the new build about a second later.

The signing identity keeps the Accessibility permission across rebuilds. Without it, the script signs the app ad hoc, and you must allow Accessibility again after each install.

</details>

<details>
<summary>Development</summary>

- Tests: `node --test tests/*.test.cjs`
- Ranking: [docs/ranking.md](docs/ranking.md) explains how the command bar orders its rows, and how to test the ranking.
- App log: `~/Library/Logs/Arclike.log` on macOS, `%LOCALAPPDATA%\Arclike\Arclike.log` on Windows.
- Windows: `dotnet test native-host-windows/Arclike.Tests` runs on macOS too. `native-host-windows/test/remote-test.sh` builds and tests on a Windows machine over SSH. [docs/windows-port.md](docs/windows-port.md), section 7, explains it.
- Upstream fixes: `git fetch origin && git merge origin/main`. The `origin` remote is Tab Switcher.
- The extension ID is always `jlmidbafifiahhcpahkcejphlibhjapo`, because the manifest contains a fixed key.

</details>

<details>
<summary>Privacy</summary>

Arclike works only on your computer and sends nothing. Site icons come from Chrome's own cache. Arclike does not check for updates. [PRIVACY.md](PRIVACY.md) lists what it reads and keeps.

</details>

## License

MIT. See [LICENSE](LICENSE).
