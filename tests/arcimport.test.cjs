// Import from Arc: the mapping from Arc's sidebar to bookmarks, tab groups and pinned tabs, the merge that
// keeps a second import from duplicating the first, and the service worker's exchange with the
// app. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness.cjs');

// The trimmed sidebar the app sends (ArcImport.swift), shaped like a real Arc file.
function sidebar(extra = {}) {
  const items = [
    { id: 'pinA', kind: 'itemContainer', containerType: 'spaceItems', childrenIds: ['t1', 'f1', 'split', 'nourl'] },
    { id: 't1', kind: 'tab', title: 'My name', savedTitle: 'Page title', url: 'https://one.example/', childrenIds: [] },
    { id: 'f1', kind: 'list', title: 'Folder', childrenIds: ['t2', 'f2'] },
    { id: 't2', kind: 'tab', savedTitle: 'Two', url: 'https://two.example/', childrenIds: [] },
    { id: 'f2', kind: 'list', title: 'Inner', childrenIds: ['t3'] },
    { id: 't3', kind: 'tab', savedTitle: 'Three', url: 'javascript:void(0)', childrenIds: [] },
    { id: 'split', kind: 'splitView', childrenIds: ['s1', 's2'] },
    { id: 's1', kind: 'tab', savedTitle: 'Left', url: 'https://left.example/', childrenIds: [] },
    { id: 's2', kind: 'tab', savedTitle: 'Right', url: 'https://right.example/', childrenIds: [] },
    { id: 'nourl', kind: 'tab', savedTitle: 'Lost', childrenIds: [] },
    { id: 'unpinA', kind: 'itemContainer', containerType: 'spaceItems', childrenIds: ['open1', 'openSplit', 'openNoUrl'] },
    { id: 'open1', kind: 'tab', savedTitle: 'Open tab', url: 'https://open.example/', childrenIds: [] },
    { id: 'openSplit', kind: 'splitView', childrenIds: ['o2', 'o3'] },
    { id: 'o2', kind: 'tab', savedTitle: 'Open left', url: 'https://open-left.example/', childrenIds: [] },
    { id: 'o3', kind: 'tab', savedTitle: 'Open right', url: 'https://open-right.example/', childrenIds: [] },
    { id: 'openNoUrl', kind: 'tab', savedTitle: 'Never loaded', childrenIds: [] },
    { id: 'unpinD', kind: 'itemContainer', containerType: 'spaceItems', childrenIds: ['d1'] },
    { id: 'd1', kind: 'tab', savedTitle: 'Article', url: 'https://read.example/a', childrenIds: [] },
    { id: 'pinB', kind: 'itemContainer', containerType: 'spaceItems', childrenIds: ['t4'] },
    { id: 't4', kind: 'tab', savedTitle: 'Four', url: 'https://four.example/', childrenIds: [] },
    { id: 'pinEmpty', kind: 'itemContainer', containerType: 'spaceItems', childrenIds: [] },
    { id: 'fav', kind: 'itemContainer', containerType: 'topApps', childrenIds: ['fa', 'fb'] },
    { id: 'fa', kind: 'tab', savedTitle: 'Mail', url: 'https://mail.example/u/0/#inbox/123', childrenIds: [] },
    { id: 'fb', kind: 'tab', savedTitle: 'Code', url: 'https://code.example/', childrenIds: [] },
    { id: 'favOther', kind: 'itemContainer', containerType: 'topApps', childrenIds: ['fo'] },
    { id: 'fo', kind: 'tab', savedTitle: 'Work', url: 'https://work.example/', childrenIds: [] },
  ];
  return Object.assign({
    spaces: [
      { id: 'A', title: 'Daily', containerIDs: ['unpinned', 'unpinA', 'pinned', 'pinA'] },
      { id: 'B', title: 'jobs', containerIDs: ['pinned', 'pinB', 'unpinned', 'x'] },
      { id: 'C', title: 'Empty', containerIDs: ['pinned', 'pinEmpty'] },
      { id: 'D', title: 'Reading', containerIDs: ['unpinned', 'unpinD', 'pinned', 'pinEmpty'] },
    ],
    items,
    topAppsContainerIDs: [{ custom: { _0: 'Work' } }, 'favOther', { default: true }, 'fav'],
  }, extra);
}

// An in-memory bookmarks tree and tab list with the Chrome calls the import makes.
function fakeChrome(opts = {}) {
  let nextId = 100;
  const nodes = {
    0: { id: '0', title: '', children: [] },
    1: { id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar', parentId: '0', children: [] },
    2: { id: '2', title: 'Other bookmarks', folderType: 'other', parentId: '0', children: [] },
  };
  nodes[0].children = [nodes[1], nodes[2]];
  const tabs = (opts.pinned || []).map((url, i) => ({ id: i + 1, url, pinned: true, groupId: -1 }));
  const groups = (opts.groups || []).map(g => Object.assign({ collapsed: false }, g));
  (opts.groups || []).forEach(g => (g.urls || []).forEach(url => tabs.push({ id: tabs.length + 1, url, pinned: false, groupId: g.id })));
  const createdTabs = [];
  const copy = (n) => { const { children, ...rest } = n; return Object.assign({}, rest); };
  const bookmarks = {
    getTree: async () => [nodes[0]],
    get: async (id) => { if (!nodes[id]) throw new Error("Can't find bookmark for id."); return [copy(nodes[id])]; },
    getChildren: async (id) => {
      if (!nodes[id]) throw new Error("Can't find parent bookmark for id.");
      return nodes[id].children.map(copy);
    },
    create: async ({ parentId, title, url }) => {
      if (opts.rejectUrl && url === opts.rejectUrl) throw new Error('Invalid URL.');
      const node = { id: String(nextId++), parentId, title };
      if (url) node.url = url; else node.children = [];
      nodes[parentId].children.push(node);
      nodes[node.id] = node;
      return copy(node);
    },
    move: (id, parentId) => {
      const node = nodes[id];
      nodes[node.parentId].children = nodes[node.parentId].children.filter(n => n !== node);
      node.parentId = parentId;
      nodes[parentId].children.push(node);
    },
    remove: (id) => {
      const node = nodes[id];
      nodes[node.parentId].children = nodes[node.parentId].children.filter(n => n !== node);
      delete nodes[id];
    },
  };
  return {
    bookmarks,
    tabs: {
      query: async (q) => tabs.filter(t => (!q.pinned || t.pinned) && (q.groupId === undefined || t.groupId === q.groupId)),
      create: async (props) => {
        const t = Object.assign({ id: 50 + createdTabs.length, groupId: -1 }, props);
        createdTabs.push(props); tabs.push(t); return Object.assign({}, t);
      },
      group: async ({ groupId, tabIds, createProperties }) => {
        if (groupId === undefined) {
          groupId = 900 + groups.length;
          groups.push({ id: groupId, windowId: createProperties.windowId, title: '', collapsed: false });
        }
        tabIds.forEach(id => { tabs.find(t => t.id === id).groupId = groupId; });
        return groupId;
      },
    },
    tabGroups: {
      query: async () => groups.map(g => Object.assign({}, g)),
      update: async (id, props) => Object.assign(groups.find(g => g.id === id), props),
    },
    windows: { getLastFocused: async () => ({ id: 7 }) },
    nodes, createdTabs, tabList: tabs, groups,
    // Each tab group as [title, collapsed, [urls]].
    groupShape() {
      return groups.map(g => [g.title, g.collapsed, tabs.filter(t => t.groupId === g.id).map(t => t.url)]);
    },
    // The bookmarks under a folder as plain [title, url] / [title, [...]] pairs.
    shape(id) {
      return nodes[id].children.map(n => (n.url ? [n.title, n.url] : [n.title, this.shape(n.id)]));
    },
  };
}

function loadArcImport() {
  const h = load();
  return { h, ArcImport: h.call('ArcImport') };
}

const DAILY = ['Daily', [
  ['My name', 'https://one.example/'],
  ['Folder', [['Two', 'https://two.example/'], ['Inner', [['Three', 'javascript:void(0)']]]]],
  ['Left', 'https://left.example/'],
  ['Right', 'https://right.example/'],
]];
const JOBS = ['jobs', [['Four', 'https://four.example/']]];

test('buildTree maps pinned tabs and folders per space, and default-profile favorites', () => {
  const { ArcImport } = loadArcImport();
  const tree = JSON.parse(JSON.stringify(ArcImport.buildTree(sidebar())));
  assert.deepStrictEqual(tree.spaces.map(s => s.title), ['Daily', 'jobs', 'Reading'], 'empty spaces are left out');
  assert.deepStrictEqual(tree.spaces[0].children, [
    { title: 'My name', url: 'https://one.example/' },
    { title: 'Folder', children: [
      { title: 'Two', url: 'https://two.example/' },
      { title: 'Inner', children: [{ title: 'Three', url: 'javascript:void(0)' }] },
    ] },
    { title: 'Left', url: 'https://left.example/' },
    { title: 'Right', url: 'https://right.example/' },
  ], 'a renamed tab keeps its name, a split view joins its folder, URL-less tabs are dropped');
  assert.deepStrictEqual(tree.spaces[0].tabs.map(t => t.url),
    ['https://open.example/', 'https://open-left.example/', 'https://open-right.example/'],
    'open tabs are a flat list, split views included');
  assert.deepStrictEqual(tree.spaces[2].children, [], 'a space with only open tabs has no bookmarks');
  assert.strictEqual(tree.dropped, 2, 'one pinned and one open tab had no saved address');
  assert.deepStrictEqual(tree.favorites, [
    { title: 'Mail', url: 'https://mail.example/u/0/#inbox/123' },
    { title: 'Code', url: 'https://code.example/' },
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ArcImport.summarize(tree))),
    { spaces: 3, pages: 6, folders: 2, tabs: 4, favorites: 2, dropped: 2,
      bySpace: [{ title: 'Daily', pages: 5, tabs: 3 }, { title: 'jobs', pages: 1, tabs: 0 }, { title: 'Reading', pages: 0, tabs: 1 }],
      favoriteSites: ['mail.example', 'code.example'] });
});

test('buildTree rejects a sidebar without spaces', () => {
  const { ArcImport } = loadArcImport();
  assert.throws(() => ArcImport.buildTree({ items: [] }), /no spaces or items/);
});

test('buildTree survives a folder that contains itself', () => {
  const { ArcImport } = loadArcImport();
  const s = sidebar();
  s.items.find(i => i.id === 'f2').childrenIds.push('f1');
  const tree = ArcImport.buildTree(s);
  assert.strictEqual(ArcImport.summarize(tree).pages, 6);
});

const plain = (v) => JSON.parse(JSON.stringify(v));
const DAILY_TABS = ['https://open.example/', 'https://open-left.example/', 'https://open-right.example/'];
const GROUPS = [['Daily', true, DAILY_TABS], ['Reading', true, ['https://read.example/a']]];

test('the first import makes bookmarks, collapsed tab groups of open tabs, and pinned favorites', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome();
  const result = await ArcImport.run(chrome, ArcImport.buildTree(sidebar()), {});
  assert.deepStrictEqual(chrome.shape('1'), [['Imported from Arc', [DAILY, JOBS]]]);
  assert.deepStrictEqual(plain(chrome.createdTabs.filter(t => t.pinned)), [
    { url: 'https://mail.example/u/0/#inbox/123', pinned: true, active: false, windowId: 7 },
    { url: 'https://code.example/', pinned: true, active: false, windowId: 7 },
  ]);
  assert.deepStrictEqual(chrome.groupShape(), GROUPS);
  assert.ok(chrome.createdTabs.every(t => t.active === false && t.windowId === 7), 'tabs open in the background');
  assert.strictEqual(result.folderId, chrome.nodes[1].children[0].id);
  assert.deepStrictEqual(
    [result.pagesAdded, result.foldersAdded, result.favoritesAdded, result.tabsAdded, result.groupsAdded, result.alreadyImported],
    [6, 4, 2, 4, 2, false]);
});

test('a dry run counts what would be added and changes nothing', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome();
  const result = await ArcImport.run(chrome, ArcImport.buildTree(sidebar()), { dryRun: true });
  assert.deepStrictEqual(chrome.shape('1'), []);
  assert.deepStrictEqual(chrome.createdTabs, []);
  assert.deepStrictEqual(chrome.groupShape(), []);
  assert.deepStrictEqual([result.pagesAdded, result.foldersAdded, result.favoritesAdded, result.tabsAdded], [6, 4, 2, 4]);
});

test('a second import duplicates nothing', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome();
  const tree = ArcImport.buildTree(sidebar());
  const first = await ArcImport.run(chrome, tree, {});
  const saved = { folderId: first.folderId, openedTabs: first.openedTabs };
  const preview = await ArcImport.run(chrome, tree, { dryRun: true, saved });
  const second = await ArcImport.run(chrome, tree, { saved });
  const again = await ArcImport.run(chrome, tree, {});
  for (const r of [preview, second, again]) {
    assert.deepStrictEqual(
      [r.pagesAdded, r.foldersAdded, r.favoritesAdded, r.tabsAdded, r.groupsAdded,
        r.pagesSkipped, r.favoritesSkipped, r.tabsSkipped, r.alreadyImported],
      [0, 0, 0, 0, 0, 6, 2, 4, true]);
  }
  assert.deepStrictEqual(chrome.shape('1'), [['Imported from Arc', [DAILY, JOBS]]]);
  assert.deepStrictEqual(chrome.groupShape(), GROUPS);
  assert.strictEqual(chrome.createdTabs.length, 6);
});

test('an imported tab that redirected or was closed is not opened again', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome();
  const tree = ArcImport.buildTree(sidebar());
  const first = await ArcImport.run(chrome, tree, {});
  chrome.tabList.find(t => t.url === 'https://open.example/').url = 'https://open.example/home';
  chrome.tabList.splice(chrome.tabList.findIndex(t => t.url === 'https://read.example/a'), 1);
  const result = await ArcImport.run(chrome, tree, { saved: { folderId: first.folderId, openedTabs: first.openedTabs } });
  assert.deepStrictEqual([result.tabsAdded, result.tabsSkipped], [0, 4]);
});

test('open tabs join an existing group of the same title, in its window', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome({ groups: [{ id: 5, windowId: 3, title: 'Daily', urls: ['https://open.example/'] }] });
  const result = await ArcImport.run(chrome, ArcImport.buildTree(sidebar()), {});
  assert.deepStrictEqual(chrome.groupShape(), [
    ['Daily', false, DAILY_TABS],
    ['Reading', true, ['https://read.example/a']],
  ], 'the existing group keeps its state and gains only the missing tabs');
  assert.deepStrictEqual(chrome.createdTabs.filter(t => !t.pinned).map(t => t.windowId), [3, 3, 7]);
  assert.deepStrictEqual([result.tabsAdded, result.tabsSkipped, result.groupsAdded], [3, 1, 1]);
});

test('a later import adds only what Arc gained since', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome();
  const first = await ArcImport.run(chrome, ArcImport.buildTree(sidebar()), {});
  const s = sidebar();
  s.items.push({ id: 't5', kind: 'tab', savedTitle: 'Five', url: 'https://five.example/', childrenIds: [] });
  s.items.find(i => i.id === 'f2').childrenIds.push('t5');
  const result = await ArcImport.run(chrome, ArcImport.buildTree(s), { saved: { folderId: first.folderId } });
  assert.deepStrictEqual([result.pagesAdded, result.foldersAdded], [1, 0]);
  const inner = chrome.shape('1')[0][1][0][1][1][1][1][1];
  assert.deepStrictEqual(inner, [['Three', 'javascript:void(0)'], ['Five', 'https://five.example/']]);
});

test('each space reports what it adds, and pinned favorites are named', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome({ pinned: ['https://code.example/x'] });
  const tree = ArcImport.buildTree(sidebar());
  const first = await ArcImport.run(chrome, tree, { dryRun: true });
  assert.deepStrictEqual(plain(first.bySpace), {
    Daily: { pagesAdded: 5, tabsAdded: 3 }, jobs: { pagesAdded: 1, tabsAdded: 0 }, Reading: { pagesAdded: 0, tabsAdded: 1 },
  });
  assert.deepStrictEqual(plain(first.favoriteSitesPresent), ['code.example']);
  const done = await ArcImport.run(chrome, tree, {});
  const s = sidebar();
  s.items.push({ id: 't5', kind: 'tab', savedTitle: 'Five', url: 'https://five.example/', childrenIds: [] });
  s.items.find(i => i.id === 'pinB').childrenIds.push('t5');
  const later = await ArcImport.run(chrome, ArcImport.buildTree(s), { dryRun: true, saved: { folderId: done.folderId, openedTabs: done.openedTabs } });
  assert.deepStrictEqual(plain(later.bySpace), {
    Daily: { pagesAdded: 0, tabsAdded: 0 }, jobs: { pagesAdded: 1, tabsAdded: 0 }, Reading: { pagesAdded: 0, tabsAdded: 0 },
  });
});

test('the earlier folder is found by its saved ID after a move, or by title without one', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome();
  const tree = ArcImport.buildTree(sidebar());
  const first = await ArcImport.run(chrome, tree, {});

  const byTitle = await ArcImport.run(chrome, tree, {});
  assert.strictEqual(byTitle.pagesAdded, 0, 'found by title on the bookmarks bar');

  chrome.bookmarks.move(first.folderId, '2');
  const moved = await ArcImport.run(chrome, tree, { saved: { folderId: first.folderId } });
  assert.strictEqual(moved.pagesAdded, 0, 'found by saved ID in Other bookmarks');
  assert.deepStrictEqual(chrome.shape('1'), []);

  chrome.bookmarks.remove(first.folderId);
  const deleted = await ArcImport.run(chrome, tree, { saved: { folderId: first.folderId } });
  assert.strictEqual(deleted.pagesAdded, 6, 'a deleted folder is made again');
  assert.deepStrictEqual(chrome.shape('1'), [['Imported from Arc', [DAILY, JOBS]]]);

});

test('a favorite whose site is already a pinned tab is not pinned again', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome({ pinned: ['https://MAIL.example/u/0/#inbox'] });
  const result = await ArcImport.run(chrome, ArcImport.buildTree(sidebar()), {});
  assert.deepStrictEqual(chrome.createdTabs.filter(t => t.pinned).map(t => t.url), ['https://code.example/']);
  assert.deepStrictEqual([result.favoritesAdded, result.favoritesSkipped], [1, 1]);
});

test('a page Chrome refuses is reported, and the rest still import', async () => {
  const { ArcImport } = loadArcImport();
  const chrome = fakeChrome({ rejectUrl: 'javascript:void(0)' });
  const result = await ArcImport.run(chrome, ArcImport.buildTree(sidebar()), {});
  assert.strictEqual(result.pagesAdded, 5);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.failed)),
    [{ title: 'Three', url: 'javascript:void(0)', error: 'Invalid URL.' }]);
});

// The service worker asks the app for the sidebar over the native port, then imports it.
function popupRequest(h, request) {
  return new Promise(resolve => h.chrome.runtime.onMessage.emit(request, {}, resolve));
}

function withFakes(h, fake) {
  h.chrome.bookmarks = fake.bookmarks;
  h.chrome.tabs.query = fake.tabs.query;
  h.chrome.tabs.create = fake.tabs.create;
  h.chrome.tabs.group = fake.tabs.group;
  h.chrome.tabGroups = fake.tabGroups;
  h.chrome.windows.getLastFocused = fake.windows.getLastFocused;
}

async function untilSent(h, action) {
  for (let i = 0; i < 20 && !h.lastSent(action); i++) await new Promise(r => setImmediate(r));
  return h.lastSent(action);
}

const APP_INFO = { app: '0.1.0', macos: '26.5.2', path: '/Users/x/Library/Application Support/Arc/StorableSidebar.json',
  bytes: 1286350, modified: '2026-10-25T12:00:00Z', formatVersion: 1 };

test('the popup preview asks the app for Arc data and returns counts', async () => {
  const h = load();
  const fake = fakeChrome();
  withFakes(h, fake);
  const reply = popupRequest(h, { action: 'arc_import', dryRun: true });
  const asked = await untilSent(h, 'read_arc');
  await h.deliver(Object.assign({ action: 'arc_data', requestId: asked.requestId, ok: true, sidebar: sidebar(),
    extensions: [{ id: 'hoombieeljmmljlkjmnheibnpciblicm', name: 'Language Reactor' }] }, APP_INFO));
  const response = await reply;
  assert.strictEqual(response.ok, true);
  assert.deepStrictEqual(plain(response.extensions), [{ id: 'hoombieeljmmljlkjmnheibnpciblicm', name: 'Language Reactor' }],
    'Arc extensions missing from Chrome pass through to the popup');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(response.summary)), { spaces: 3, pages: 6, folders: 2, tabs: 4, favorites: 2, dropped: 2,
      bySpace: [{ title: 'Daily', pages: 5, tabs: 3 }, { title: 'jobs', pages: 1, tabs: 0 }, { title: 'Reading', pages: 0, tabs: 1 }],
      favoriteSites: ['mail.example', 'code.example'] });
  assert.deepStrictEqual(fake.shape('1'), []);
});

test('the import stores the folder and opened tabs so the next one finds them', async () => {
  const h = load();
  const fake = fakeChrome();
  withFakes(h, fake);
  let stored = null;
  h.chrome.storage.local.set = (items) => { stored = items; };
  const reply = popupRequest(h, { action: 'arc_import', dryRun: false });
  const asked = await untilSent(h, 'read_arc');
  await h.deliver(Object.assign({ action: 'arc_data', requestId: asked.requestId, ok: true, sidebar: sidebar() }, APP_INFO));
  const response = await reply;
  assert.strictEqual(response.result.pagesAdded, 6);
  assert.strictEqual(stored.arcImport.folderId, fake.nodes[1].children[0].id);
  assert.deepStrictEqual(plain(stored.arcImport.openedTabs),
    DAILY_TABS.map(u => 'Daily\n' + u).concat(['Reading\nhttps://read.example/a']));
  assert.strictEqual(response.report, undefined, 'no report when nothing failed');
});

test('Arc\'s command bar choices are counted in the preview, remembered by the import, and not twice', async () => {
  const h = load();
  withFakes(h, fakeChrome());
  const picks = [
    { query: 'gi', type: 'chromiumHistory', url: 'https://github.com/me', title: 'me', selectedAt: 800000000 },
    { query: 'juice brands', type: 'chromiumSearchWhatYouTyped', search: 'juice brands', selectedAt: 800000100 },
    { query: 'shortcu', type: 'typeTravel', selectedAt: 800000200 },
  ];
  const run = async (dryRun) => {
    const reply = popupRequest(h, { action: 'arc_import', dryRun });
    const asked = await untilSent(h, 'read_arc');
    h.sent.length = 0;
    await h.deliver(Object.assign({ action: 'arc_data', requestId: asked.requestId, ok: true, sidebar: sidebar(),
      rankingPicks: picks }, APP_INFO));
    return reply;
  };
  assert.strictEqual((await run(true)).result.choicesAdded, 2, 'a choice with no page and no search is left out');
  assert.deepStrictEqual(h.g('rankMemory'), [], 'a preview remembers nothing');
  assert.strictEqual((await run(false)).result.choicesAdded, 2);
  assert.deepStrictEqual(h.g('rankMemory').map(e => [e.text, e.url || e.search]),
    [['gi', 'https://github.com/me'], ['juice brands', 'juice brands']]);
  assert.strictEqual((await run(false)).result.choicesAdded, 0);
  assert.strictEqual(h.g('rankMemory.length'), 2);
});

test('an app error comes back with a report to paste into Claude Code', async () => {
  const h = load();
  const reply = popupRequest(h, { action: 'arc_import', dryRun: true });
  const asked = await untilSent(h, 'read_arc');
  await h.deliver(Object.assign({ action: 'arc_data', requestId: asked.requestId, ok: false,
    error: 'arc_not_found', detail: 'No file at ' + APP_INFO.path }, APP_INFO));
  const response = await reply;
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error, 'arc_not_found');
  for (const part of ['Step: reading Arc data through the Arclike app', 'Error: arc_not_found',
    'Extension: 3.7.5', 'App: 0.1.0', 'Chrome: 140.0.0.0', 'macOS: 26.5.2', 'Arc file: ' + APP_INFO.path,
    'Claude Code']) {
    assert.ok(response.report.includes(part), 'report has ' + part + '\n' + response.report);
  }
});

test('an app that never answers times out with app_no_answer', async () => {
  const h = load();
  h.set('ARC_READ_TIMEOUT_MS', 5);
  const response = await popupRequest(h, { action: 'arc_import', dryRun: true });
  assert.strictEqual(response.error, 'app_no_answer');
  assert.ok(response.report.includes('App: unknown'));
});

test('a sidebar in an unknown shape is reported as arc_bad_format', async () => {
  const h = load();
  const reply = popupRequest(h, { action: 'arc_import', dryRun: true });
  const asked = await untilSent(h, 'read_arc');
  await h.deliver(Object.assign({ action: 'arc_data', requestId: asked.requestId, ok: true, sidebar: {} }, APP_INFO));
  const response = await reply;
  assert.strictEqual(response.error, 'arc_bad_format');
  assert.ok(response.report.includes("Step: reading Arc's sidebar"));
});
