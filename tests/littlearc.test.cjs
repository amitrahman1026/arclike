const test = require('node:test');
const assert = require('node:assert');
const { load, win, tab } = require('./harness.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

function browser(opts = {}) {
  return load(Object.assign({ windows: [
    win(1, [tab(10, { active: true, index: 0, groupId: -1, splitViewId: -1 })], true),
  ] }, opts));
}

// A Little Arc in front of the main window.
function inLittleArc() {
  const little = Object.assign(win(2, [tab(20, { active: true, url: 'https://docs.rs/' })], true), { type: 'popup' });
  const h = load({ windows: [win(1, [tab(10, { active: true })]), little] });
  h.chrome.windows.getLastFocused = async (q) =>
    h.state.windows.find(w => (q.windowTypes || ['normal']).includes(w.type) && (w.type === 'popup' || !q.windowTypes.includes('popup')));
  return h;
}

async function commands(h, text) {
  await h.call(`commandBarQuery(${JSON.stringify({ query: text, seq: 7 })})`);
  h.call('commandBarLatestSeq = 0');
  return h.lastSent('command_bar_results').results.filter(r => r.kind === 'command').map(r => r.command);
}

test('Open in Little Arc moves the tab into a popup window', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  assert.ok((await commands(h, 'little arc')).includes('open-in-little-arc'));
  await h.call(`commandBarChoose({ item: { kind: "command", command: "open-in-little-arc" }, text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [['windows.create', { tabId: 10, type: 'popup', focused: true, width: 900, height: 700 }]]);
});

test('a Little Arc is centred over the window it opens from', () => {
  const h = load();
  assert.deepStrictEqual(h.g('littleArcBounds({ left: 0, top: 0, width: 2000, height: 1200 })'),
    { width: 1000, height: 800, left: 500, top: 200 });
});

test('New Little Arc opens an empty popup and the bar over it', async () => {
  const h = browser();
  h.chrome.windows.create = async (props) => { h.ran.push(['windows.create', props]);
    return { id: 3, type: 'popup', tabs: [{ id: 30, url: 'about:blank' }] }; };
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "new-little-arc" }, text: "" })`);
  assert.deepStrictEqual(plain(h.ran)[0][1].url, 'about:blank');
  assert.deepStrictEqual(h.lastSent('show_command_bar'), { action: 'show_command_bar', mode: 'current_tab', text: '' });
  const target = h.g('commandBarTarget');
  assert.deepStrictEqual([target.windowId, target.tabId, target.littleArc], [3, 30, true]);
});

test('in a Little Arc the bar opens choices in place and offers Move to Main Window', async () => {
  const h = inLittleArc();
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual(h.g('commandBarTarget').mode, 'current_tab');
  const found = await commands(h, 'main window');
  assert.ok(found.includes('move-to-main-window'));
  assert.ok(!(await commands(h, 'little arc')).includes('open-in-little-arc'));
  assert.ok(!(await commands(h, 'group')).some(c => c === 'new-tab-group' || c === 'add-tab-to-group'));
  assert.ok(!(await commands(h, 'split')).includes('split-view'));

  await h.call(`commandBarChoose({ item: { kind: "url", url: "https://example.org/" }, text: "" })`);
  assert.deepStrictEqual(plain(h.activated), [{ id: 20, props: { url: 'https://example.org/' } }]);
  assert.deepStrictEqual(plain(h.created), []);
});

test('Move to Main Window puts the tab at the end of the last used normal window', async () => {
  const h = inLittleArc();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "move-to-main-window" }, text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [['tabs.move', 20, { windowId: 1, index: -1 }]]);
  assert.deepStrictEqual(plain(h.windowsFocused).pop(), { id: 1, props: { focused: true } });
});

test('with the option on, a link from another app opens in Little Arc', async () => {
  const h = browser({ storage: { littleArcForLinks: true } });
  h.chrome.windows.onFocusChanged.emit(-1);
  h.chrome.tabs.onCreated.emit({ id: 50, windowId: 1, pendingUrl: 'https://example.org/from-slack' });
  await settle();
  assert.deepStrictEqual(plain(h.ran), [['windows.create', { tabId: 50, type: 'popup', focused: true, width: 900, height: 700 }]]);
});

test('a link is also taken when Chrome came to the front a moment before the tab', async () => {
  const h = browser({ storage: { littleArcForLinks: true } });
  h.chrome.windows.onFocusChanged.emit(-1);
  h.chrome.windows.onFocusChanged.emit(1);
  h.chrome.tabs.onCreated.emit({ id: 50, windowId: 1, url: 'https://example.org/' });
  await settle();
  assert.strictEqual(plain(h.ran).length, 1);
});

test('tabs opened inside Chrome stay where they are', async () => {
  const cases = [
    ['option off', {}, (h) => h.chrome.windows.onFocusChanged.emit(-1), { pendingUrl: 'https://example.org/' }],
    ['Chrome in front all along', { littleArcForLinks: true }, () => {}, { pendingUrl: 'https://example.org/' }],
    ['opened by another tab', { littleArcForLinks: true }, (h) => h.chrome.windows.onFocusChanged.emit(-1),
      { pendingUrl: 'https://example.org/', openerTabId: 10 }],
    ['a new tab page', { littleArcForLinks: true }, (h) => h.chrome.windows.onFocusChanged.emit(-1),
      { pendingUrl: 'chrome://newtab/' }],
    ['opened by the command bar', { littleArcForLinks: true }, async (h) => {
      await h.call(`commandBarOpen("new_tab")`);
      h.chrome.windows.onFocusChanged.emit(-1);
      h.chrome.windows.onFocusChanged.emit(1);
      await h.call(`commandBarChoose({ item: { kind: "url", url: "https://example.org/" }, text: "" })`);
    }, { pendingUrl: 'https://example.org/' }],
  ];
  for (const [name, storage, before, extra] of cases) {
    const h = browser({ storage });
    await before(h);
    h.chrome.tabs.onCreated.emit(Object.assign({ id: 50, windowId: 1 }, extra));
    await settle();
    assert.ok(!plain(h.ran).some(c => c[0] === 'windows.create'), name);
  }
});

test('a closed Little Arc tab that Chrome reopens in a popup goes to the main window', async () => {
  const h = inLittleArc();
  h.chrome.tabs.onCreated.emit({ id: 20, windowId: 2, url: 'https://docs.rs/' });
  await settle();
  assert.deepStrictEqual(plain(h.ran), [['tabs.move', 20, { windowId: 1, index: -1 }]]);
  assert.deepStrictEqual(plain(h.windowsFocused).pop(), { id: 1, props: { focused: true } });
});

test('a popup opened by a page, and a new Little Arc, keep their tab', async () => {
  const h = inLittleArc();
  h.chrome.tabs.onCreated.emit({ id: 20, windowId: 2, url: 'https://accounts.example.org/', openerTabId: 10 });
  h.chrome.tabs.onCreated.emit({ id: 21, windowId: 2, url: 'about:blank' });
  h.chrome.tabs.onCreated.emit({ id: 22, windowId: 1, url: 'https://example.org/' });
  await settle();
  assert.deepStrictEqual(plain(h.ran), []);
});

test('turning the option on in the popup takes effect at once', async () => {
  const h = browser();
  h.chrome.storage.onChanged.emit({ littleArcForLinks: { newValue: true } }, 'local');
  h.chrome.windows.onFocusChanged.emit(-1);
  h.chrome.tabs.onCreated.emit({ id: 50, windowId: 1, pendingUrl: 'https://example.org/' });
  await settle();
  assert.strictEqual(plain(h.ran).length, 1);
});

test('the app is told when a Little Arc comes to the front and when it leaves', async () => {
  const h = inLittleArc();
  h.chrome.windows.onFocusChanged.emit(2);
  await settle();
  h.chrome.windows.onFocusChanged.emit(2);
  await settle();
  h.chrome.windows.onFocusChanged.emit(1);
  await settle();
  h.chrome.windows.onFocusChanged.emit(-1);
  await settle();
  assert.deepStrictEqual(h.sent.filter(m => m.action === 'little_arc_focus').map(m => m.focused), [true, false]);
});

test('Cmd+O in a Little Arc moves its tab to the main window', async () => {
  const h = inLittleArc();
  await h.deliver({ action: 'ready' });
  await h.deliver({ action: 'little_arc_to_main' });
  await settle();
  assert.deepStrictEqual(plain(h.ran), [['tabs.move', 20, { windowId: 1, index: -1 }]]);
});
