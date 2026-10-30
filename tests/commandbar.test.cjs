const test = require('node:test');
const assert = require('node:assert');
const { load, win, tab } = require('./harness.cjs');

const DAY = 24 * 60 * 60 * 1000;

function browser(opts = {}) {
  return load(Object.assign({ windows: [win(1, [
    tab(10, { active: true, url: 'https://news.ycombinator.com/', title: 'Hacker News' }),
    tab(11, { url: 'https://www.netflix.com/browse', title: 'Home - Netflix' }),
    tab(12, { url: 'https://leetcode.com/problemset/', title: 'Problems - LeetCode' }),
  ], true)] }, opts));
}

// Calls recorded inside the worker's realm; copy them out before deepStrictEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));
const kinds = (results) => results.map(r => r.kind + ':' + (r.url || r.text));

async function query(h, text) {
  await h.call(`commandBarQuery(${JSON.stringify({ query: text, seq: 7 })})`);
  h.call('commandBarLatestSeq = 0');
  const reply = h.lastSent('command_bar_results');
  assert.strictEqual(reply.seq, 7, 'the reply carries the query it answers');
  return reply.results;
}

test('typed text is recognised as an address or a search', () => {
  const h = load();
  const typed = (t) => h.call(`commandBarTypedUrl(${JSON.stringify(t)})`);
  assert.strictEqual(typed('github.com'), 'https://github.com');
  assert.strictEqual(typed('github.com/anthropics'), 'https://github.com/anthropics');
  assert.strictEqual(typed('localhost:3000'), 'http://localhost:3000');
  assert.strictEqual(typed('192.168.1.1/admin'), 'http://192.168.1.1/admin');
  assert.strictEqual(typed('chrome://settings'), 'chrome://settings');
  assert.strictEqual(typed('how to cook rice'), null);
  assert.strictEqual(typed('netflix'), null);
  assert.strictEqual(typed('javascript:alert(1)'), null);
});

test('Cmd+T opens an empty bar over the focused window', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  assert.deepStrictEqual(h.lastSent('show_command_bar'), { action: 'show_command_bar', mode: 'new_tab', text: '' });
  assert.deepStrictEqual(h.g('commandBarTarget'),
    { mode: 'new_tab', windowId: 1, tabId: 10, pinned: false, muted: false, groupId: -1, splitViewId: -1 });
});

test('Cmd+L opens the bar holding the current address', async () => {
  const h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  assert.strictEqual(h.lastSent('show_command_bar').text, 'https://news.ycombinator.com/');
});

test('Cmd+L on the New Tab page starts empty', async () => {
  const h = load({ windows: [win(1, [tab(10, { active: true, url: 'chrome://newtab/' })], true)] });
  await h.call(`commandBarOpen("current_tab")`);
  assert.strictEqual(h.lastSent('show_command_bar').text, '');
});

test('a profile without the focused window stays quiet', async () => {
  const h = load({ windows: [win(1, [tab(10, { active: true })], false)] });
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual(h.lastSent('show_command_bar'), undefined);
});

test('an empty bar lists the top sites with their favicons', async () => {
  const h = browser({ topSites: [
    { url: 'https://www.netflix.com/browse', title: 'Home - Netflix' },
    { url: 'https://youtube.com/', title: 'YouTube' },
  ] });
  const results = await query(h, '');
  assert.deepStrictEqual(kinds(results), ['top:https://www.netflix.com/browse', 'top:https://youtube.com/']);
  assert.strictEqual(results[1].detail, 'youtube.com');
  assert.strictEqual(results[0].favicon, 'data:image/png;base64,AQID');
});

test('a tab whose site starts with the query comes before the search row', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'netf');
  assert.deepStrictEqual(kinds(results).slice(0, 2), ['tab:https://www.netflix.com/browse', 'search:netf']);
  assert.strictEqual(results[0].tabId, 11);
  assert.strictEqual(results[0].hint, 'Switch to Tab');
});

test('a tab whose title starts with the query comes first too', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'problems');
  assert.strictEqual(results[0].tabId, 12);
});

test('a loose match stays below the search row', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'code');
  assert.deepStrictEqual(kinds(results), ['search:code', 'tab:https://leetcode.com/problemset/']);
});

test('the tab the bar opened over is not offered', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'hacker');
  assert.deepStrictEqual(kinds(results), ['search:hacker']);
});

test('a page open in a tab and in history is listed once, as the tab', async () => {
  const h = browser({ history: [
    { url: 'https://www.netflix.com/browse', title: 'Netflix', visitCount: 50, lastVisitTime: Date.now() },
    { url: 'https://www.netflix.com/title/123', title: 'Some show - Netflix', visitCount: 1, lastVisitTime: Date.now() - 30 * DAY },
  ] });
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'netflix');
  assert.deepStrictEqual(kinds(results), [
    'tab:https://www.netflix.com/browse', 'search:netflix', 'history:https://www.netflix.com/title/123',
  ]);
});

test('frequently visited history outranks a bookmark', async () => {
  const h = browser({
    history: [{ url: 'https://docs.python.org/3/', title: 'Python docs', visitCount: 40, typedCount: 10, lastVisitTime: Date.now() }],
    bookmarks: [{ url: 'https://example.com/python-old', title: 'Old python notes' }],
  });
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'python');
  assert.deepStrictEqual(kinds(results),
    ['history:https://docs.python.org/3/', 'search:python', 'bookmark:https://example.com/python-old']);
});

test('an address leads with opening it, then searching for it', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'example.org/page');
  assert.deepStrictEqual(kinds(results), ['url:https://example.org/page', 'search:example.org/page']);
});

test('an address that is already open in a tab switches to it', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'leetcode.com/problemset');
  assert.strictEqual(results[0].tabId, 12);
});

test('history visited after the bar first loaded is found', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  h.chrome.history.onVisited.emit({ url: 'https://zed.dev/', title: 'Zed', visitCount: 1, lastVisitTime: Date.now() });
  const results = await query(h, 'zed');
  assert.strictEqual(results[0].url, 'https://zed.dev/');
});

test('a query overtaken by a newer one is not answered', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const older = h.call(`commandBarQuery({ query: "ne", seq: 1 })`);
  const newer = h.call(`commandBarQuery({ query: "net", seq: 2 })`);
  await Promise.all([older, newer]);
  assert.deepStrictEqual(h.sent.filter(m => m.action === 'command_bar_results' && !m.refresh).map(m => m.seq), [2]);
});

test('the start of a site name leads with the site and completes it in the field', async () => {
  const h = browser({ history: [
    { url: 'https://www.youtube.com/watch?v=1', title: 'A video - YouTube', visitCount: 3, lastVisitTime: Date.now() },
    { url: 'https://www.youtube.com/', title: 'YouTube', visitCount: 30, lastVisitTime: Date.now() },
  ] });
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'You');
  assert.deepStrictEqual(kinds(results), ['url:https://www.youtube.com/', 'search:You', 'history:https://www.youtube.com/watch?v=1']);
  assert.strictEqual(results[0].title, 'youtube.com');
  assert.strictEqual(results[0].detail, 'Visit');
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, 'Youtube.com/');
});

test('an open tab of the site is offered as the completion instead', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, 'net');
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, 'netflix.com/');
});

test('a search is not completed', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, 'code');
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, '');
});

test('rows are sent before their favicons, which follow', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarQuery({ query: "netf", seq: 3 })`);
  const replies = h.sent.filter(m => m.action === 'command_bar_results').map(m => JSON.parse(JSON.stringify(m)));
  assert.strictEqual(replies.length, 2);
  assert.strictEqual(replies[0].results[0].favicon, undefined);
  assert.strictEqual(replies[1].refresh, true);
  assert.strictEqual(replies[1].results[0].favicon, 'data:image/png;base64,AQID');
});

test('each row says what the field shows while it is selected', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'netf');
  assert.deepStrictEqual(results.map(r => r.fill), ['netflix.com/browse', 'netf']);
});

// The score of a page for `query`, as the bar ranks it.
function score(h, query, kind, item) {
  h.set('__item', item);
  return h.call(`rankScore(rankFeatures(${JSON.stringify(query)}, "${kind}", __item, __item.title, __item.url, false, {}))`);
}

test('a page visited an hour ago outranks one visited a week ago', () => {
  const h = load();
  const page = { url: 'https://example.com/a', title: 'Example', visitCount: 5 };
  const hour = score(h, 'exa', 'history', Object.assign({ lastVisitTime: Date.now() - 3600000 }, page));
  const week = score(h, 'exa', 'history', Object.assign({ lastVisitTime: Date.now() - 7 * DAY }, page));
  assert.ok(hour > week, hour + ' vs ' + week);
});

test('a page visited thousands of times does not outrank an open tab that matches as well', () => {
  const h = load();
  const most = score(h, 'exa', 'history', { url: 'https://example.com/a', title: 'Example',
    visitCount: 100000, typedCount: 100, lastVisitTime: Date.now() });
  const tab = score(h, 'exa', 'tab', { url: 'https://example.com/b', title: 'Example' });
  assert.ok(most < tab, most + ' vs ' + tab);
});

// Choose `item` for the typed `text`, the way the app reports a choice.
async function choose(h, text, item) {
  await query(h, text);
  await h.call(`commandBarChoose(${JSON.stringify({ text, item })})`);
  await h.call('commandBarOpen("new_tab")');
}

test('a page chosen for some text leads the next time that text is typed, and is saved', async () => {
  const h = browser({ history: [
    { url: 'https://github.com/me/arclike', title: 'me/arclike', visitCount: 2, lastVisitTime: Date.now() - DAY },
    { url: 'https://github.com/', title: 'GitHub', visitCount: 90, lastVisitTime: Date.now() },
  ] });
  await h.call('commandBarOpen("new_tab")');
  assert.strictEqual((await query(h, 'gi'))[0].url, 'https://github.com/', 'the site leads at first');
  await choose(h, 'gi', { kind: 'history', title: 'me/arclike', url: 'https://github.com/me/arclike' });
  assert.strictEqual((await query(h, 'gi'))[0].url, 'https://github.com/me/arclike');
  assert.deepStrictEqual(h.local.commandBarMemory.map(e => [e.text, e.url]), [['gi', 'https://github.com/me/arclike']]);
});

test('searching the typed text, once chosen, keeps the search row first', async () => {
  const h = browser();
  await h.call('commandBarOpen("new_tab")');
  assert.strictEqual((await query(h, 'netf'))[0].kind, 'tab');
  await choose(h, 'netf', { kind: 'search', title: 'netf', text: 'netf' });
  assert.deepStrictEqual(kinds(await query(h, 'netf')).slice(0, 2), ['search:netf', 'tab:https://www.netflix.com/browse']);
});

test('a past search that starts with the query is offered after the search row', async () => {
  const h = browser();
  await h.call('commandBarOpen("new_tab")');
  await choose(h, 'black vs', { kind: 'search', title: 'black vs green cardamom', text: 'black vs green cardamom' });
  assert.deepStrictEqual(kinds(await query(h, 'black')), ['search:black', 'search:black vs green cardamom']);
});

// Arc counts time in seconds from 2001.
const APPLE_EPOCH = Date.UTC(2001, 0, 1);

test('a page chosen in Arc is remembered with its time, and Arc\'s own commands are not', () => {
  const h = load();
  const entries = h.call(`rankFromArcPicks(${JSON.stringify([
    { query: 'Trans', type: 'chromiumHistory', url: 'https://translate.google.com/', title: 'Google Translate', selectedAt: 814004476 },
    { query: 'black vs green ca', type: 'chromiumSearchSuggestion', search: 'black vs green cardamom', selectedAt: 813583485 },
    { query: 'github.com', type: 'chromiumNavigateWhatYouTyped', url: 'https://github.com/', selectedAt: 813583485 },
    { query: 'shortcu', type: 'typeTravel', selectedAt: 813583485 },
  ])})`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(entries)), [
    { text: 'trans', at: APPLE_EPOCH + 814004476000, count: 1, url: 'https://translate.google.com/', title: 'Google Translate' },
    { text: 'black vs green ca', at: APPLE_EPOCH + 813583485000, count: 1, search: 'black vs green cardamom' },
  ]);
});

test('of two tabs that match alike, the one switched to more lately ranks first', async () => {
  const h = load({ windows: [win(1, [
    tab(1, { active: true }),
    tab(2, { url: 'https://docs.example/a', title: 'Notes A' }),
    tab(3, { url: 'https://docs.example/b', title: 'Notes B' }),
  ], true)] });
  h.set('mru', [1, 3, 2]);
  await h.call('commandBarOpen("new_tab")');
  assert.deepStrictEqual((await query(h, 'notes')).filter(r => r.kind === 'tab').map(r => r.tabId), [3, 2]);
  h.set('mru', [1, 2, 3]);
  assert.deepStrictEqual((await query(h, 'notes')).filter(r => r.kind === 'tab').map(r => r.tabId), [2, 3]);
});

test('a typo still finds the page, below the search row', async () => {
  const h = browser({ history: [{ url: 'https://www.youtube.com/', title: 'YouTube', visitCount: 30, lastVisitTime: Date.now() }] });
  await h.call(`commandBarOpen("new_tab")`);
  assert.deepStrictEqual(kinds(await query(h, 'youtbue')), ['search:youtbue', 'history:https://www.youtube.com/']);
  assert.deepStrictEqual(kinds(await query(h, 'netlfix')).slice(0, 2), ['search:netlfix', 'tab:https://www.netflix.com/browse']);
});

test('short words and unrelated words do not match by typo', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  assert.deepStrictEqual(kinds(await query(h, 'nef')), ['search:nef']);
  assert.deepStrictEqual(kinds(await query(h, 'zebra')), ['search:zebra']);
});

test('the start of a command name leads with the command', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'sett');
  assert.deepStrictEqual(results[0], { kind: 'command', title: 'Settings', detail: '', hint: '⌘,',
    url: 'chrome://settings/', symbol: 'gearshape', fill: '' });
  assert.strictEqual(results[1].kind, 'search');
});

test('a command can follow the search row without leading', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'tab');
  assert.strictEqual(results[0].kind, 'search');
  assert.ok(results.slice(1, 3).every(r => r.kind === 'command'), JSON.stringify(results.slice(1, 3)));
});

test('the pin command says Unpin on a pinned tab', async () => {
  const h = load({ windows: [win(1, [tab(10, { active: true, pinned: true })], true)] });
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual((await query(h, 'unpin'))[0].title, 'Unpin Tab');
});

test('tab commands run on the tab the bar opened over', async () => {
  const h = browser();
  for (const [command, expected] of [
    ['close-tab', ['tabs.remove', 10]],
    ['duplicate-tab', ['tabs.duplicate', 10]],
    ['reload-tab', ['tabs.reload', 10]],
    ['move-tab-to-new-window', ['windows.create', { tabId: 10 }]],
    ['reopen-closed-tab', ['sessions.restore']],
    ['new-incognito-window', ['windows.create', { incognito: true }]],
  ]) {
    h.ran.length = 0;
    await h.call(`commandBarOpen("new_tab")`);
    await h.call(`commandBarChoose({ item: { kind: "command", command: "${command}" }, text: "" })`);
    assert.deepStrictEqual(plain(h.ran), [expected], command);
  }
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "pin-tab" }, text: "" })`);
  assert.deepStrictEqual(plain(h.activated).pop(), { id: 10, props: { pinned: true } });
});

test('Copy URL hands the address to the app', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "copy-url" }, text: "" })`);
  assert.strictEqual(h.lastSent('url_copied').url, 'https://news.ycombinator.com/');
});

test('a Chrome page command opens like an address', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", url: "chrome://settings/" }, text: "set" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1, url: 'chrome://settings/' }]);
});

test('results are capped', async () => {
  const history = [];
  for (let i = 0; i < 20; i++) history.push({ url: 'https://wiki.example/' + i, title: 'Wiki ' + i });
  const h = browser({ history });
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual((await query(h, 'wiki')).length, 8);
});

test('choosing a tab switches to it', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "tab", tabId: 12 }, text: "prob" })`);
  assert.deepStrictEqual(plain(h.activated).map(a => a.id), [12]);
  assert.deepStrictEqual(plain(h.created), []);
});

test('Cmd+T opens the choice in a new tab of the same window', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "history", url: "https://example.org/" }, text: "exa" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1, url: 'https://example.org/' }]);
});

test('Cmd+L opens the choice in the current tab', async () => {
  const h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "url", url: "https://example.org/" }, text: "example.org" })`);
  assert.deepStrictEqual(plain(h.activated), [{ id: 10, props: { url: 'https://example.org/' } }]);
  assert.deepStrictEqual(plain(h.created), []);
});

test('a search runs in a new tab or in the current one', async () => {
  let h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "search", text: "rice" }, text: "rice" })`);
  assert.deepStrictEqual(plain(h.searched), [{ text: 'rice', disposition: 'NEW_TAB' }]);

  h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "search", text: "rice" }, text: "rice" })`);
  assert.deepStrictEqual(plain(h.searched), [{ text: 'rice', tabId: 10 }]);
});

test('Enter with nothing chosen opens the typed text, or a blank new tab', async () => {
  let h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ text: "github.com" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1, url: 'https://github.com' }]);

  h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ text: "" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1 }]);

  h = browser();
  await h.call(`commandBarOpen("current_tab")`);
  await h.call(`commandBarChoose({ text: "" })`);
  assert.deepStrictEqual(plain(h.created), []);
  assert.deepStrictEqual(plain(h.activated), []);
});

test('a dismissed bar opens nothing', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  h.call(`commandBarClosed()`);
  await h.call(`commandBarChoose({ text: "github.com" })`);
  assert.deepStrictEqual(plain(h.created), []);
});

test('the extension tells the app it can answer the command bar', async () => {
  const h = browser();
  await h.deliver({ action: 'ready' });
  assert.deepStrictEqual(h.lastSent('register').features, ['command_bar']);
});

test('a recently closed tab is found, above its history, and Enter restores it', async () => {
  const h = browser({
    closed: [
      { lastModified: 1, tab: { sessionId: 's1', url: 'https://zed.dev/docs', title: 'Zed docs' } },
      { lastModified: 2, window: { sessionId: 'w1', tabs: [] } },
    ],
    history: [{ url: 'https://zed.dev/docs', title: 'Zed docs', visitCount: 2, lastVisitTime: Date.now() }],
  });
  await h.call(`commandBarOpen("new_tab")`);
  const results = await query(h, 'zed docs');
  const closed = results.find(r => r.url === 'https://zed.dev/docs');
  assert.strictEqual(closed.kind, 'closed');
  assert.strictEqual(closed.hint, 'Closed');
  assert.strictEqual(results.filter(r => r.url === 'https://zed.dev/docs').length, 1);
  await h.call(`commandBarChoose({ item: ${JSON.stringify(closed)}, text: "zed docs" })`);
  assert.deepStrictEqual(plain(h.ran), [['sessions.restore', 's1']]);
  assert.deepStrictEqual(plain(h.created), []);
});

function splitBrowser(opts = {}) {
  return load(Object.assign({ windows: [win(1, [
    tab(10, { index: 0, active: true, groupId: -1, splitViewId: -1, title: 'Here' }),
    tab(11, { index: 1, groupId: -1, splitViewId: -1, url: 'https://docs.rs/', title: 'Docs.rs' }),
    tab(12, { index: 2, groupId: -1, splitViewId: -1, url: 'https://leetcode.com/', title: 'LeetCode' }),
  ], true)] }, opts));
}

test('Split View with… asks for the tab in the bar, which stays open', async () => {
  const h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  const command = (await query(h, 'split'))[0];
  assert.deepStrictEqual([command.title, command.pick], ['Split View with…', 'split']);
  await h.call(`commandBarChoose({ item: ${JSON.stringify(command)}, text: "split" })`);
  assert.strictEqual(h.lastSent('show_command_bar').placeholder, 'Split View with a tab, an address or a search');
  assert.strictEqual(h.g('commandBarTarget').pick, 'split');
  const rows = await query(h, '');
  assert.deepStrictEqual(rows.map(r => r.kind + ':' + r.title), ['new-tab:New Tab', 'tab:Docs.rs', 'tab:LeetCode']);
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, '');
  assert.deepStrictEqual(kinds(await query(h, 'leet')), ['tab:https://leetcode.com/', 'search:leet']);
});

test('Split View is not offered before Chrome 155', async () => {
  const h = splitBrowser();
  delete h.chrome.tabs.createSplit;
  await h.call(`commandBarOpen("new_tab")`);
  assert.ok(!(await query(h, 'split')).some(r => r.kind === 'command'));
});

test('a neighbouring tab is split with at once', async () => {
  const h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  h.set('commandBarTarget', Object.assign(h.g('commandBarTarget'), { pick: 'split' }));
  await h.call(`commandBarChoose({ item: { kind: "tab", tabId: 11 }, text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [['tabs.createSplit', [10, 11]]]);
  assert.strictEqual(h.g('commandBarTarget'), null);
});

test('a tab further away is moved beside this one, then split', async () => {
  const h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  h.set('commandBarTarget', Object.assign(h.g('commandBarTarget'), { pick: 'split' }));
  await h.call(`commandBarChoose({ item: { kind: "tab", tabId: 12 }, text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [['tabs.move', 12, { windowId: 1, index: 1 }], ['tabs.createSplit', [10, 12]]]);
});

test('a tab in another group joins this tab\'s group, and a split tab leaves its split', async () => {
  const h = splitBrowser({ windows: [win(1, [
    tab(10, { index: 0, active: true, groupId: 3, splitViewId: -1 }),
    tab(11, { index: 1, groupId: -1, splitViewId: 8 }),
  ], true)] });
  await h.call(`commandBarOpen("new_tab")`);
  h.set('commandBarTarget', Object.assign(h.g('commandBarTarget'), { pick: 'split' }));
  await h.call(`commandBarChoose({ item: { kind: "tab", tabId: 11 }, text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [
    ['tabs.unsplit', 8], ['tabs.group', { groupId: 3, tabIds: 11 }], ['tabs.createSplit', [10, 11]],
  ]);
});

test('Enter in the split picker opens a new tab, an address or a search beside this one', async () => {
  let h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  h.set('commandBarTarget', Object.assign(h.g('commandBarTarget'), { pick: 'split' }));
  await h.call(`commandBarChoose({ text: "" })`);
  assert.deepStrictEqual(plain(h.created), [{ splitWithTabId: 10 }]);

  h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  h.set('commandBarTarget', Object.assign(h.g('commandBarTarget'), { pick: 'split' }));
  await h.call(`commandBarChoose({ text: "github.com" })`);
  assert.deepStrictEqual(plain(h.created), [{ splitWithTabId: 10, url: 'https://github.com' }]);

  h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  h.set('commandBarTarget', Object.assign(h.g('commandBarTarget'), { pick: 'split' }));
  await h.call(`commandBarChoose({ text: "rust traits" })`);
  assert.deepStrictEqual(plain(h.searched), [{ text: 'rust traits', tabId: 999 }]);
});

test('Exit Split View and Ungroup Tab are offered only when they apply', async () => {
  let h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  assert.ok(!(await query(h, 'exit split')).some(r => r.kind === 'command'));
  assert.ok(!(await query(h, 'ungroup')).some(r => r.kind === 'command'));

  h = splitBrowser({ windows: [win(1, [tab(10, { index: 0, active: true, groupId: 3, splitViewId: 8 })], true)] });
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual((await query(h, 'exit split'))[0].command, 'exit-split-view');
  assert.strictEqual((await query(h, 'ungroup'))[0].command, 'ungroup-tab');
  await h.call(`commandBarChoose({ item: { kind: "command", command: "exit-split-view" }, text: "" })`);
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "ungroup-tab" }, text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [['tabs.unsplit', 8], ['tabs.ungroup', 10]]);
});

test('Add Tab to Group… lists the groups and adds the tab to the chosen one', async () => {
  const h = splitBrowser({
    windows: [win(1, [
      tab(10, { index: 0, active: true, groupId: -1 }),
      tab(11, { index: 1, groupId: 4 }), tab(12, { index: 2, groupId: 4 }), tab(13, { index: 3, groupId: 5 }),
    ], true)],
    groups: [{ id: 4, title: 'Work', color: 'blue', windowId: 1 }, { id: 5, title: '', color: 'red', windowId: 1 },
      { id: 6, title: 'Empty', color: 'red', windowId: 1 }],
  });
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "add-tab-to-group", pick: "group" }, text: "" })`);
  const rows = await query(h, '');
  assert.deepStrictEqual(rows.map(r => r.title + ' / ' + r.detail),
    ['Work / Blue, 2 tabs', 'Unnamed group / Red, 1 tab', 'Unnamed group / New Tab Group']);
  assert.deepStrictEqual((await query(h, 'wo')).map(r => r.title), ['Work', 'wo']);
  await h.call(`commandBarChoose({ item: ${JSON.stringify(rows[0])}, text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [['tabs.group', { groupId: 4, tabIds: 10 }]]);
});

test('New Tab Group… names the group after the typed text', async () => {
  let h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "new-tab-group", pick: "new-group" }, text: "" })`);
  assert.strictEqual(h.lastSent('show_command_bar').placeholder, 'Name the new group');
  const rows = await query(h, 'Reading');
  assert.deepStrictEqual(rows.map(r => r.kind + ':' + r.title), ['new-group:Reading']);
  await h.call(`commandBarChoose({ item: ${JSON.stringify(rows[0])}, text: "Reading" })`);
  assert.deepStrictEqual(plain(h.ran), [['tabs.group', { tabIds: 10 }], ['tabGroups.update', 77, { title: 'Reading' }]]);

  h = splitBrowser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "new-tab-group", pick: "new-group" }, text: "" })`);
  await h.call(`commandBarChoose({ text: "" })`);
  assert.deepStrictEqual(plain(h.ran), [['tabs.group', { tabIds: 10 }]]);
});

test('a tab closed in the last 10 minutes comes before open tabs of the same site, and one closed earlier does not', async () => {
  const now = Date.now() / 1000;
  const open = [10, 11, 12, 13, 14, 15, 16, 17].map(id =>
    tab(id, { active: id === 10, url: 'https://github.com/someone/repo' + id, title: 'GitHub - someone/repo' + id }));
  const closed = (age) => [{ lastModified: now - age,
    tab: { sessionId: 's1', url: 'https://github.com/me/arclike/releases', title: 'Releases · me/arclike' } }];
  let h = load({ windows: [win(1, open, true)], closed: closed(30) });
  await h.call(`commandBarOpen("new_tab")`);
  let results = await query(h, 'github');
  assert.deepStrictEqual([results[0].kind, results[0].url], ['closed', 'https://github.com/me/arclike/releases']);
  assert.strictEqual(h.lastSent('command_bar_results').autocomplete, 'github.com/');

  h = load({ windows: [win(1, open, true)], closed: closed(30 * 60) });
  await h.call(`commandBarOpen("new_tab")`);
  results = await query(h, 'github');
  assert.strictEqual(results[0].kind, 'tab');
});

test('Site Settings opens the settings page of the tab\'s site', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual((await query(h, 'site sett'))[0].command, 'site-settings');
  await h.call(`commandBarChoose({ item: { kind: "command", command: "site-settings" }, text: "" })`);
  assert.deepStrictEqual(plain(h.created), [{ windowId: 1, openerTabId: 10,
    url: 'chrome://settings/content/siteDetails?site=https%3A%2F%2Fnews.ycombinator.com' }]);
});

test('an empty bar shows a tip below its rows, and the next bar the next tip', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, '');
  assert.deepStrictEqual(h.lastSent('command_bar_results').tip, { id: 'site-settings',
    text: "Type `site sett` to open this site's permissions, like automatic picture-in-picture" });
  await h.call(`commandBarClosed()`);
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, '');
  assert.strictEqual(h.lastSent('command_bar_results').tip.id, 'split-view');
  assert.strictEqual(h.local.commandBarTips.next, 2, 'the place in the list is saved');
});

test('a tip shows only while nothing is typed', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, 'net');
  assert.strictEqual(h.lastSent('command_bar_results').tip, undefined);
  await h.call(`commandBarOpen("current_tab")`);
  await query(h, '');
  assert.strictEqual(h.lastSent('command_bar_results').tip, undefined, 'Cmd+L holding an address has no tip');
});

test('a second choice, such as the tab to split with, has no tip', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "split-view", pick: "split" }, text: "" })`);
  await query(h, '');
  assert.strictEqual(h.lastSent('command_bar_results').tip, undefined);
});

test('a dismissed tip is not shown again', async () => {
  const h = browser();
  await h.call(`commandBarOpen("new_tab")`);
  await h.deliver({ action: 'command_bar_dismiss_tip', id: 'site-settings' });
  await query(h, '');
  assert.strictEqual(h.lastSent('command_bar_results').tip, undefined, 'the bar on screen loses its tip');
  assert.deepStrictEqual(h.local.commandBarTips.retired, ['site-settings']);
  for (let i = 0; i < 8; i++) {
    await h.call(`commandBarOpen("new_tab")`);
    assert.notStrictEqual(h.g('commandBarTip').id, 'site-settings');
  }
});

test('using what a tip teaches retires it', async () => {
  const h = browser({ closed: [{ lastModified: 1, tab: { sessionId: 's1', url: 'https://a.com/', title: 'A' } }] });
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "site-settings" }, text: "" })`);
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "closed", sessionId: "s1" }, text: "" })`);
  await h.call(`commandBarOpen("new_tab")`);
  await h.call(`commandBarChoose({ item: { kind: "command", command: "mute-tab" }, text: "" })`);
  assert.deepStrictEqual(h.local.commandBarTips.retired, ['site-settings', 'closed-tabs', 'tab-commands']);
});

test('tips saved earlier are read before the first bar, and none shows once all are retired', async () => {
  const h = browser({ storage: { commandBarTips: { next: 0,
    retired: ['site-settings', 'split-view', 'closed-tabs', 'tab-groups', 'tab-commands'] } } });
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual(h.g('commandBarTip').id, 'tab-switcher');
  await h.call(`commandBarDismissTip("tab-switcher")`);
  await h.call(`commandBarOpen("new_tab")`);
  await query(h, '');
  assert.strictEqual(h.lastSent('command_bar_results').tip, undefined);
});

test('the Split View tip is skipped where Chrome cannot split', async () => {
  const h = browser({ storage: { commandBarTips: { next: 1, retired: [] } } });
  h.chrome.tabs.createSplit = undefined;
  await h.call(`commandBarOpen("new_tab")`);
  assert.strictEqual(h.g('commandBarTip').id, 'closed-tabs');
});

test('command hints show Chrome\'s Windows shortcuts on Windows', async () => {
  const h = browser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36' });
  await h.call(`commandBarOpen("new_tab")`);
  const hintFor = async (text, title) => (await query(h, text)).find(r => r.title === title).hint;
  assert.strictEqual(await hintFor('close', 'Close Tab'), 'Ctrl+W');
  assert.strictEqual(await hintFor('copy url', 'Copy URL'), 'Alt+Shift+C');
  assert.strictEqual(await hintFor('history', 'History'), 'Ctrl+H');
  assert.strictEqual(await hintFor('sett', 'Settings'), '');
});

test('every macOS command hint has a Windows counterpart', () => {
  const h = load();
  const windows = h.g('COMMAND_BAR_WINDOWS_HINTS');
  const missing = h.g('COMMAND_BAR_COMMANDS').filter(c => c.hint && !(c.hint in windows)).map(c => c.hint);
  assert.deepStrictEqual(plain(missing), []);
});
