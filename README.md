# Arclike

Arc-style tab switching and a command bar for Chrome on macOS. A fork of [Tab Switcher](https://github.com/nechemyaspitz/tab-switcher).

> I built this for my own workflow. Feel free to fork it, or send a patch if something could be better.

<!-- Demo video goes here. -->

| Shortcut | Action |
|----------|--------|
| **Ctrl+Tab** | Switch between the tabs you visited recently. Release Ctrl to switch, press Esc to cancel. |
| **Cmd+T** | Command bar: open tabs, history, bookmarks and commands. Opens the result in a new tab. |
| **Cmd+L** | Command bar. Opens the result in the current tab. |
| **Cmd+Shift+C** | Copy the URL of the current tab. |

## Install

You need macOS 14 or later and Xcode.

```bash
./native-host/create-signing-identity.sh   # once
./native-host/install-local.sh
```

Then:

1. In `chrome://extensions`, turn on **Developer mode** and load the `extension` folder with **Load unpacked**.
2. Open `/Applications/Arclike.app` once and allow Accessibility.

Coming from Arc? Click the Arclike icon in Chrome and choose **Import from Arc**: favorites become pinned tabs, each space's pinned tabs become bookmarks, and its open tabs become a tab group.

<details>
<summary>After a change</summary>

- `extension/`: reload Arclike in `chrome://extensions`.
- `native-host/`: run `./native-host/install-local.sh`, then reload the extension.

The signing identity keeps the Accessibility permission across rebuilds. Without it, the script signs the app ad hoc, and you must allow Accessibility again after each install.

</details>

<details>
<summary>Development</summary>

- Tests: `node --test tests/*.test.cjs`
- Ranking: `node tools/rank-eval.cjs prepare|run|tune <dir>` scores the command bar against the choices in Arc's command bar. Keep `<dir>` outside the repository: it holds copies of your history.
- App log: `~/Library/Logs/Arclike.log`
- Upstream fixes: `git fetch origin && git merge origin/main`. The `origin` remote is Tab Switcher.
- The extension ID is always `jlmidbafifiahhcpahkcejphlibhjapo`, because the manifest contains a fixed key.

</details>

<details>
<summary>Privacy</summary>

Arclike works only on your Mac and sends nothing. Favicons come from Chrome's own cache. Arclike does not check for updates.

</details>

## License

MIT. See [LICENSE](LICENSE).
