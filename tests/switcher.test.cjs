const test = require('node:test');
const assert = require('node:assert');
const { load, win, tab } = require('./harness.cjs');

const NOW = Date.now();
const fresh = (n) => NOW - n * 1000;
const stale = () => NOW - 10 * 60 * 1000;   // accessed ten minutes ago

function fourFresh() {
  return [win(1, [
    tab(10, { active: true, lastAccessed: fresh(1) }),
    tab(11, { lastAccessed: fresh(2) }),
    tab(12, { lastAccessed: fresh(3) }),
    tab(13, { lastAccessed: fresh(4) }),
  ], true)];
}

test('MRU starts in last-accessed order', () => {
  const h = load({ windows: [win(1, [
    tab(10, { active: true, lastAccessed: fresh(1) }),
    tab(11, { lastAccessed: fresh(0.5) }),
    tab(12, { lastAccessed: stale() }),
  ], true)] });
  assert.deepStrictEqual(h.g('mru'), [11, 10, 12]);
});

test('a fresh browser session offers only the tab you landed on', async () => {
  const h = load({ windows: fourFresh(), visited: [] });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.deepStrictEqual(h.lastSent('show_switcher').tabs.map(t => t.id), [10]);
});

test('visiting tabs adds them, and they do not expire', async () => {
  const h = load({ windows: fourFresh(), visited: [] });
  h.chrome.tabs.onActivated.emit({ tabId: 12, windowId: 1 });
  h.chrome.tabs.onActivated.emit({ tabId: 10, windowId: 1 });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.deepStrictEqual(h.lastSent('show_switcher').tabs.map(t => t.id), [10, 12]);
  assert.deepStrictEqual(h.session.visitedTabs.sort(), [10, 12], 'kept for the browser session');
});

test('the visited list survives a service worker restart', async () => {
  const h = load({ windows: fourFresh(), visited: [12, 13] });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.deepStrictEqual(h.lastSent('show_switcher').tabs.map(t => t.id), [10, 12, 13]);
});

test('a tab opened in the background is the next one the switcher offers', async () => {
  const h = load({ windows: fourFresh(), visited: [12] });
  h.state.windows[0].tabs.push(tab(14));
  h.chrome.tabs.onCreated.emit({ id: 14, windowId: 1, openerTabId: 10 });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  const reply = h.lastSent('show_switcher');
  assert.deepStrictEqual(reply.tabs.map(t => t.id), [10, 14, 12]);
  assert.strictEqual(reply.selectedIndex, 1);
});

test('tabs Chrome restores as it starts join only once visited', async () => {
  const h = load({ windows: fourFresh(), visited: [] });
  h.chrome.runtime.onStartup.emit();
  h.state.windows[0].tabs.push(tab(14));
  h.chrome.tabs.onCreated.emit({ id: 14, windowId: 1 });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.deepStrictEqual(h.lastSent('show_switcher').tabs.map(t => t.id), [10]);
});

test('every fresh tab is shown, not just the minimum', async () => {
  const tabs = [tab(10, { active: true, lastAccessed: fresh(1) })];
  for (let i = 1; i < 7; i++) tabs.push(tab(10 + i, { lastAccessed: fresh(i + 1) }));
  const h = load({ windows: [win(1, tabs, true)], storage: { maxSwitcherTabs: 0 } });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.lastSent('show_switcher').tabs.length, 7);
});

test('the switcher shows at most maxSwitcherTabs, in MRU order', async () => {
  const tabs = [tab(10, { active: true, lastAccessed: fresh(1) })];
  for (let i = 1; i < 7; i++) tabs.push(tab(10 + i, { lastAccessed: fresh(i + 1) }));
  const h = load({ windows: [win(1, tabs, true)] });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  const shown = h.lastSent('show_switcher').tabs.map(t => t.id);
  assert.deepStrictEqual(shown, [10, 11, 12, 13, 14], 'defaults to 5');

  h.chrome.storage.onChanged.emit({ maxSwitcherTabs: { newValue: 3 } }, 'local');
  await h.deliver({ action: 'cancel_switch' });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.lastSent('show_switcher').tabs.length, 3, 'follows the popup setting');
});

test('current-window-only scoping excludes other windows', async () => {
  const h = load({ windows: [
    win(1, [tab(10, { active: true, lastAccessed: fresh(1) }), tab(11, { lastAccessed: fresh(2) })], true),
    win(2, [tab(20, { active: true, lastAccessed: fresh(3) }), tab(21, { lastAccessed: fresh(4) })]),
  ] });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  const shown = h.lastSent('show_switcher').tabs.map(t => t.id);
  assert.deepStrictEqual(shown.sort(), [10, 11], 'only the focused window');

  const h2 = load({ windows: [
    win(1, [tab(10, { active: true, lastAccessed: fresh(1) }), tab(11, { lastAccessed: fresh(2) })], true),
    win(2, [tab(20, { active: true, lastAccessed: fresh(3) }), tab(21, { lastAccessed: fresh(4) })]),
  ] });
  await h2.deliver({ action: 'cycle_next', current_window_only: false });
  assert.strictEqual(h2.lastSent('show_switcher').tabs.length, 4, 'all windows when asked');
});

test('all windows means the windows of the same kind: normal or incognito', async () => {
  const windows = () => [
    win(1, [tab(10, { active: true, lastAccessed: fresh(1) })], true),
    win(2, [tab(20, { active: true, lastAccessed: fresh(2) })]),
    Object.assign(win(3, [tab(30, { active: true, incognito: true, lastAccessed: fresh(3) })]), { incognito: true }),
  ];
  const h = load({ windows: windows() });
  await h.deliver({ action: 'cycle_next', current_window_only: false });
  assert.deepStrictEqual(h.lastSent('show_switcher').tabs.map(t => t.id).sort(), [10, 20]);

  const incognito = windows();
  incognito[0].focused = false;
  incognito[2].focused = true;
  const h2 = load({ windows: incognito });
  await h2.deliver({ action: 'cycle_next', current_window_only: false });
  assert.deepStrictEqual(h2.lastSent('show_switcher').tabs.map(t => t.id), [30]);
});

test('a tab missing from the MRU is still offered', async () => {
  const h = load({ windows: fourFresh() });
  h.set('mru', [10, 11]);                                  // 12 and 13 never got a create event
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  const shown = h.lastSent('show_switcher').tabs.map(t => t.id);
  assert.ok(shown.includes(12) && shown.includes(13), 'appended after the known MRU');
  assert.deepStrictEqual(shown.slice(0, 2), [10, 11], 'MRU order still leads');
});

test('cards carry the cached preview', async () => {
  const h = load({ windows: fourFresh() });
  h.set('tabThumbnails', { 11: 'data:image/jpeg;base64,ZZZ' });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  const cards = h.lastSent('show_switcher').tabs;
  assert.strictEqual(cards.find(c => c.id === 11).thumbnail, 'data:image/jpeg;base64,ZZZ');
  assert.strictEqual(cards.find(c => c.id === 10).thumbnail, null);
});

test('one populated query serves the whole switch', async () => {
  const h = load({ windows: fourFresh() });
  let queries = 0;
  const original = h.chrome.windows.getAll;
  h.chrome.windows.getAll = (q, cb) => { queries++; return original(q, cb); };
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(queries, 1, 'later presses only move the selection');
});

test('selection advances, wraps, and reverses', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.lastSent('show_switcher').selectedIndex, 1);
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.lastSent('update_selection').selectedIndex, 2);
  await h.deliver({ action: 'cycle_prev', current_window_only: true });
  assert.strictEqual(h.lastSent('update_selection').selectedIndex, 1);
  await h.deliver({ action: 'cycle_prev', current_window_only: true });
  await h.deliver({ action: 'cycle_prev', current_window_only: true });
  assert.strictEqual(h.lastSent('update_selection').selectedIndex, 3, 'wraps past the front');
});

test('shift on the first press selects the last tab', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_prev', current_window_only: true });
  assert.strictEqual(h.lastSent('show_switcher').selectedIndex, 3);
});

test('hover names a tab and moves the selection to it', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'select_tab', tabId: 13 });
  assert.strictEqual(h.g('lastIntSwitchIndex'), 3);
  await h.deliver({ action: 'end_switch' });
  assert.deepStrictEqual(h.activated.map(a => a.id), [13], 'release activates the hovered tab');
});

test('hover keeps cycling from where it left off', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'select_tab', tabId: 12 });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.lastSent('update_selection').selectedIndex, 3);
});

test('hover for a tab outside the switcher is ignored', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'select_tab', tabId: 999 });
  assert.strictEqual(h.g('lastIntSwitchIndex'), 1, 'selection untouched');
});

test('release promotes exactly the tab it activated', async () => {
  // The switcher list and the full MRU differ here, which is what the old index-into-MRU
  // promotion got wrong: it moved an unrelated tab to the front.
  const h = load({ windows: [
    win(1, [tab(10, { active: true, lastAccessed: fresh(1) }), tab(12, { lastAccessed: fresh(3) })], true),
    win(2, [tab(11, { active: true, lastAccessed: fresh(2) })]),
  ] });
  assert.deepStrictEqual(h.g('mru'), [10, 11, 12]);
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.deepStrictEqual(h.lastSent('show_switcher').tabs.map(t => t.id), [10, 12]);
  await h.deliver({ action: 'end_switch' });
  assert.deepStrictEqual(h.activated.map(a => a.id), [12]);
  assert.deepStrictEqual(h.g('mru'), [12, 10, 11], 'the activated tab, and only it, moved up');
});

test('release hides the switcher and clears the switch', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'end_switch' });
  assert.ok(h.lastSent('hide_switcher'), 'the panel is dismissed');
  assert.strictEqual(h.g('nativeSwitchOngoing'), false);
  assert.deepStrictEqual(h.g('filteredMru'), []);
});

test('release survives the selected tab being closed', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  h.state.windows[0].tabs = h.state.windows[0].tabs.filter(t => t.id !== 11);
  await h.deliver({ action: 'end_switch' });
  assert.deepStrictEqual(h.activated, [], 'nothing is activated');
  assert.strictEqual(h.g('nativeSwitchOngoing'), false, 'and the switch still ends');
});

test('escape cancels without touching the tab or the MRU', async () => {
  const h = load({ windows: fourFresh() });
  const before = h.g('mru').slice();
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'cancel_switch' });
  assert.ok(h.lastSent('hide_switcher'));
  assert.deepStrictEqual(h.activated, [], 'no tab was activated');
  assert.deepStrictEqual(h.g('mru'), before, 'the MRU is unchanged');
  // A release arriving afterwards must not resurrect the switch.
  await h.deliver({ action: 'end_switch' });
  assert.deepStrictEqual(h.activated, []);
});

test('a cancelled switch starts clean on the next press', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  await h.deliver({ action: 'cancel_switch' });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.lastSent('show_switcher').selectedIndex, 1, 'back to the first neighbour');
});

test('a press and an immediate release stay in order', async () => {
  // The release used to be able to run before the press had finished building the list,
  // which activated nothing at all.
  const h = load({ windows: fourFresh() });
  await h.deliverBurst([
    { action: 'cycle_next', current_window_only: true },
    { action: 'end_switch' },
  ]);
  assert.deepStrictEqual(h.activated.map(a => a.id), [11], 'the neighbour is activated');
  assert.strictEqual(h.g('nativeSwitchOngoing'), false);
});

test('a burst of presses lands on the right tab', async () => {
  const h = load({ windows: fourFresh() });
  await h.deliverBurst([
    { action: 'cycle_next', current_window_only: true },
    { action: 'cycle_next', current_window_only: true },
    { action: 'cycle_next', current_window_only: true },
    { action: 'end_switch' },
  ]);
  assert.deepStrictEqual(h.activated.map(a => a.id), [13], 'three presses forward from 10');
});

test('a failing step clears the switch instead of wedging it', async () => {
  const h = load({ windows: fourFresh() });
  h.chrome.windows.getAll = () => Promise.reject(new Error('browser went away'));
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.g('nativeSwitchOngoing'), false, 'no switch is left half-started');
  assert.ok(h.lastSent('hide_switcher'), 'and the panel is dismissed');
  // The queue must still accept later work.
  h.chrome.windows.getAll = (q, cb) => {
    const copy = JSON.parse(JSON.stringify(h.state.windows));
    if (typeof cb === 'function') { cb(copy); return undefined; }
    return Promise.resolve(copy);
  };
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.ok(h.lastSent('show_switcher'), 'the next press works');
});

test('a profile with no focused window ignores the keypress', async () => {
  const h = load({ windows: [win(1, [tab(10, { active: true, lastAccessed: fresh(1) }), tab(11)], false)] });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.lastSent('show_switcher'), undefined, 'nothing is shown');
  assert.strictEqual(h.g('nativeSwitchOngoing'), false);
});

test('focus moving to another window drops the switch', async () => {
  const h = load({ windows: [
    win(1, [tab(10, { active: true, lastAccessed: fresh(1) }), tab(11, { lastAccessed: fresh(2) })], true),
    win(2, [tab(20, { active: true, lastAccessed: fresh(3) })]),
  ] });
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  assert.strictEqual(h.g('nativeSwitchOngoing'), true);
  h.focusWindow(2);
  assert.strictEqual(h.g('nativeSwitchOngoing'), false, 'the stale switch is dropped');
  assert.ok(h.lastSent('hide_switcher'));
  await h.deliver({ action: 'end_switch' });
  assert.deepStrictEqual(h.activated, [], 'the stale release changes nothing');
});

test('a new tab is inserted directly behind its opener', () => {
  const h = load({ windows: fourFresh() });
  h.set('mru', [10, 11, 12]);
  h.chrome.tabs.onCreated.emit({ id: 14, windowId: 1, openerTabId: 10 });
  assert.deepStrictEqual(h.g('mru'), [10, 14, 11, 12]);
});

test('a new tab with no opener falls back to the active tab of its window', () => {
  const h = load({ windows: fourFresh() });
  h.set('mru', [11, 10, 12]);
  h.chrome.tabs.onActivated.emit({ tabId: 10, windowId: 1 });
  h.chrome.tabs.onCreated.emit({ id: 15, windowId: 1 });
  assert.deepStrictEqual(h.g('mru').slice(0, 2), [10, 15]);
});

// The capture pipeline itself, driven through the real function rather than a copy of it.
function captureWindows() {
  return [win(1, [
    tab(10, { active: true, lastAccessed: fresh(1) }),
    tab(11, { lastAccessed: fresh(2) }),
    tab(12, { url: 'chrome://settings', lastAccessed: fresh(3) }),
  ], true)];
}

async function capture(h, tabId) {
  h.state.windows[0].tabs.forEach(t => { t.active = (t.id === tabId); });
  await h.call(`captureThumbnail(${tabId}, 1)`);
}

test('a captured preview is downsampled and cached', async () => {
  const h = load({ windows: captureWindows() });
  await capture(h, 10);
  const cached = h.g('tabThumbnails')[10];
  assert.ok(cached && cached.startsWith('data:image/jpeg;base64,'), 'stored as an encoded JPEG');
  assert.deepStrictEqual(h.g('tabThumbnailOrder'), [10]);
});

test('a restricted URL is never captured', async () => {
  const h = load({ windows: captureWindows() });
  await capture(h, 12);
  assert.strictEqual(h.g('tabThumbnails')[12], undefined);
});

test('an inactive or unfocused tab is never captured', async () => {
  const h = load({ windows: captureWindows() });
  await h.call('captureThumbnail(11, 1)');           // tab 11 is not the active tab
  assert.strictEqual(h.g('tabThumbnails')[11], undefined, 'inactive tab skipped');

  h.state.windows[0].focused = false;
  await capture(h, 10);
  assert.strictEqual(h.g('tabThumbnails')[10], undefined, 'unfocused window skipped');
});

test('the preview cache is bounded by count', async () => {
  const h = load({ windows: captureWindows() });
  h.set('MAX_THUMBNAILS', 1);
  await capture(h, 10);
  await capture(h, 11);
  assert.deepStrictEqual(h.g('tabThumbnailOrder'), [11], 'only the newest is kept');
  assert.strictEqual(h.g('tabThumbnails')[10], undefined, 'the evicted image is released');
});

test('the preview cache is bounded by encoded size', async () => {
  const h = load({ windows: captureWindows() });
  h.set('MAX_THUMBNAIL_CHARS', 1);   // any single image already exceeds this
  await capture(h, 10);
  await capture(h, 11);
  assert.deepStrictEqual(h.g('tabThumbnailOrder'), [11], 'trimmed to the newest preview');
  const total = Object.values(h.g('tabThumbnails')).reduce((sum, v) => sum + v.length, 0);
  assert.ok(total > 0, 'the cache never empties itself completely');
});

test('a preview captured for a tab that then navigates is discarded', async () => {
  const h = load({ windows: captureWindows() });
  const realGet = h.chrome.tabs.get;
  let calls = 0;
  h.chrome.tabs.get = async (id) => {
    calls++;
    const t = await realGet(id);
    // The second read is the post-encode recheck; report that the tab moved on.
    if (calls > 1 && id === 10) return Object.assign({}, t, { url: 'https://elsewhere.test/' });
    return t;
  };
  await capture(h, 10);
  assert.strictEqual(h.g('tabThumbnails')[10], undefined, 'the stale image is not cached');
});

test('closing a tab forgets its preview and its visit', () => {
  const h = load({ windows: fourFresh() });
  h.set('tabThumbnails', { 11: 'data:image/jpeg;base64,ZZZ' });
  h.set('tabThumbnailOrder', [11]);
  h.chrome.tabs.onRemoved.emit(11, {});
  assert.strictEqual(h.g('tabThumbnails')[11], undefined);
  assert.strictEqual(h.g('visitedTabs')[11], undefined);
  assert.ok(!h.g('mru').includes(11));
});

test('switcher cards carry Chrome\'s cached favicon as a data URL, never the site\'s own address', async () => {
  const h = load({ windows: [win(1, [
    tab(10, { active: true, lastAccessed: fresh(1), favIconUrl: 'https://example.com/favicon.ico' }),
    tab(11, { lastAccessed: fresh(2), url: 'https://other.example/', favIconUrl: 'https://other.example/f.ico' }),
  ], true)] });
  h.chrome.tabs.onActivated.emit({ tabId: 10, windowId: 1 });
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
  await h.deliver({ action: 'cycle_next', current_window_only: true });
  const tabs = h.lastSent('show_switcher').tabs;
  assert.strictEqual(tabs.find(t => t.id === 10).favIconUrl, 'data:image/png;base64,AQID');
  assert.strictEqual(tabs.find(t => t.id === 11).favIconUrl, '', 'not cached yet, so none rather than a web address');
});
