# Arclike privacy policy

Last updated: 1 November 2026

Arclike is a Chrome extension and a companion app for macOS or Windows that work together. Both run only on your computer. Arclike has no server, no account, no analytics, and no ads. It does not sell or share your data.

## What Arclike reads

The extension reads this data from Chrome:

- Your open tabs and tab groups: titles, URLs, and favicons. Favicons come from Chrome's own cache.
- A small, low-quality screenshot of the visible tab, for the tab thumbnails in the Ctrl+Tab switcher.
- Your browsing history from the last 90 days, your bookmarks, your most visited sites, and your recently closed tabs. The command bar searches them when you type.
- What you choose in the command bar: the text you typed, and the page (its address and title) or the search that you chose for it. The command bar puts that choice first the next time you type the same text.
- Site icons, from Chrome's own favicon cache.

When you choose **Import from Arc**, the app reads the Arc browser's sidebar file, the choices that Arc's command bar saved (what you typed and the page or search you chose), and the list of extensions installed in Arc. The extension then makes bookmarks, pinned tabs, and tab groups in Chrome, and adds Arc's command bar choices to its own.

## Where the data goes

- The extension sends tab, history, and bookmark data to the Arclike app on the same computer through Chrome native messaging. Nothing goes to another computer.
- The extension keeps your settings, the list of recently visited tabs, and up to 2000 command bar choices in Chrome's local extension storage.
- Arclike does not keep the choices that you make in an incognito window.
- When you delete pages from Chrome's history, Arclike forgets the command bar choices for those pages. When you delete all of your history, it forgets every choice.
- The Mac app keeps its settings in `~/Library/Application Support/Arclike`. The Windows app keeps them in `%LOCALAPPDATA%\Arclike`.
- The app writes a diagnostic log: `~/Library/Logs/Arclike.log` on macOS, `%LOCALAPPDATA%\Arclike\Arclike.log` on Windows. At 2 MB, the app renames it to `Arclike.old.log` and starts a new one. The log can contain text that you typed in the command bar. You can delete the files at any time.

## Network use

Arclike itself makes no network requests and does not check for updates. Site icons come from Chrome's own cache, not from the sites. Chrome loads the pages that you open from the command bar. When you search from the command bar, Chrome sends the search to your default search engine, as it does from the address bar.

## Removing your data

Remove the extension in `chrome://extensions` to delete its stored data, the command bar choices included. To remove the Mac app, delete `/Applications/Arclike.app`, the folder `~/Library/Application Support/Arclike`, the files `~/Library/Logs/Arclike.log` and `~/Library/Logs/Arclike.old.log`, and the file `com.amitrahman1026.arclike.json` in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`. Other browsers that you enabled in the app have the same file in their own `NativeMessagingHosts` folder. To remove the Windows app, uninstall it in Settings > Apps > Installed apps, then delete the folder `%LOCALAPPDATA%\Arclike`.

## Contact

Open an issue at <https://github.com/amitrahman1026/arclike/issues>.
