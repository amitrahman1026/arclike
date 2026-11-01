// Evaluate JavaScript in the Arclike extension's service worker of a test browser, and print
// the result as JSON. The tests use it to read what the screen does not show: the tabs, which one
// is active, and the import result. load-extension.mjs opens DevTools on ARCLIKE_CDP_PORT
// (default 9333).
//   node cdp.mjs <base64 of an expression>
// The expression is base64, so PowerShell's argument quoting cannot change it. It may be a
// promise, such as chrome.tabs.query({}).
import puppeteer from "puppeteer-core";

const EXTENSION_ID = "jlmidbafifiahhcpahkcejphlibhjapo";
const expression = Buffer.from(process.argv[2], "base64").toString("utf8");

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.ARCLIKE_CDP_PORT || 9333}`, defaultViewport: null });
try {
    const target = await browser.waitForTarget(
        t => t.type() === "service_worker" && t.url().startsWith(`chrome-extension://${EXTENSION_ID}/`),
        { timeout: 10000 });
    const worker = await target.worker();
    const result = await worker.evaluate(`(async () => (${expression}))()`);
    console.log(JSON.stringify(result ?? null));
} finally {
    await browser.disconnect();
}
