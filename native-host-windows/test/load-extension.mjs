// Start a test browser (Chrome, or Edge) with the unpacked extension loaded. Chrome 137 and later ignore
// --load-extension, and an extension loaded with the DevTools method Extensions.loadUnpacked does
// not stay in the profile after a restart. So every test run starts Chrome here, over a pipe, and
// loads the extension again. Register-InteractiveRunner.ps1 copies this file next to its
// puppeteer-core install. lib.ps1 (Start-TestChrome) runs it.
//   node load-extension.mjs <browser exe> <profile dir> <extension dir> <ready file> [url...]
// ARCLIKE_CDP_PORT sets the DevTools port (default 9333), so two browsers can run at once.
// It writes the extension ID to the ready file when the tabs are open, and exits when Chrome exits.
import { writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const [chrome, profile, extension, readyFile, ...urls] = process.argv.slice(2);
const browser = await puppeteer.launch({
    executablePath: chrome,
    userDataDir: profile,
    pipe: true,
    enableExtensions: true,
    headless: false,
    defaultViewport: null,
    // The DevTools port is for cdp.mjs, which reads the tabs while the test runs. The window
    // always starts on the primary monitor.
    args: ["--no-first-run", "--no-default-browser-check", "--hide-crash-restore-bubble", "--start-maximized",
        "--window-position=0,0", `--remote-debugging-port=${process.env.ARCLIKE_CDP_PORT || 9333}`],
});
const id = await browser.installExtension(extension);

// Open the URLs as the tabs of the first window, in order.
const [first] = await browser.pages();
for (const [index, url] of (urls.length ? urls : ["about:blank"]).entries()) {
    const page = index === 0 ? first : await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
}
await first.bringToFront();
writeFileSync(readyFile, id);
await new Promise(resolve => browser.on("disconnected", resolve));
