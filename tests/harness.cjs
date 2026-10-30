// Loads mainsw.js in a VM with stubbed browser APIs and hands back its globals, so the
// service worker's switch logic can be exercised without a browser.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const EXTENSION = path.join(__dirname, '..', 'extension');

function makeEvent() {
  const listeners = [];
  return { addListener: (fn) => listeners.push(fn), emit: (...a) => listeners.forEach(fn => fn(...a)), listeners };
}

// `opts.dir` loads the extension from another folder, such as an older copy to compare with.
function load(opts = {}) {
  const dir = opts.dir || EXTENSION;
  let port = null;               // the native messaging port the worker opened
  const sent = [];               // messages sent to the native host
  const activated = [];          // chrome.tabs.update calls
  const windowsFocused = [];
  const created = [];            // chrome.tabs.create calls
  const searched = [];           // chrome.search.query calls
  const ran = [];                // other tab, window and session calls, as [name, ...args]
  const record = (name, result) => async (...args) => { ran.push([name, ...args]); return result; };
  let state = { windows: opts.windows || [] };
  const session = {};            // what the worker saved to chrome.storage.session
  const local = {};              // what the worker saved to chrome.storage.local

  const tabsById = () => {
    const m = new Map();
    state.windows.forEach(w => w.tabs.forEach(t => m.set(t.id, Object.assign({windowId: w.id}, t))));
    return m;
  };

  const chrome = {
    runtime: {
      getManifest: () => ({ version: '3.7.5' }),
      getURL: (p) => 'chrome-extension://test' + p,
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      onMessage: makeEvent(),
      lastError: null,
      connectNative: () => {
        // Copied as it is posted, the way the real port serialises it.
        port = { onMessage: makeEvent(), onDisconnect: makeEvent(), postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
        return port;
      },
      connect: () => ({ onDisconnect: makeEvent(), postMessage: () => {} }),
    },
    commands: { onCommand: makeEvent() },
    tabs: {
      onActivated: makeEvent(), onUpdated: makeEvent(), onCreated: makeEvent(), onRemoved: makeEvent(),
      get: async (id) => { const t = tabsById().get(id); if (!t) throw new Error('No tab with id ' + id); return t; },
      query: async (q, cb) => {
        let all = [...tabsById().values()];
        if (q.active) all = all.filter(t => t.active);
        if (q.windowId !== undefined) all = all.filter(t => t.windowId === q.windowId);
        return all;
      },
      update: async (id, props) => { activated.push({ id, props }); return tabsById().get(id); },
      create: async (props) => { created.push(props); return Object.assign({ id: 999 }, props); },
      remove: record('tabs.remove'), duplicate: record('tabs.duplicate'), reload: record('tabs.reload'),
      move: record('tabs.move'), ungroup: record('tabs.ungroup'), unsplit: record('tabs.unsplit'),
      group: record('tabs.group', 77), createSplit: record('tabs.createSplit', 5),
      captureVisibleTab: async () => 'data:image/jpeg;base64,AAAA',
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: makeEvent(),
      // Chrome supports both the callback and the promise form; so must the stub.
      getAll: (q, cb) => {
        const copy = JSON.parse(JSON.stringify(state.windows));
        if (typeof cb === 'function') { cb(copy); return undefined; }
        return Promise.resolve(copy);
      },
      get: async (id) => state.windows.find(w => w.id === id),
      getCurrent: async () => state.windows.find(w => w.focused) || state.windows[0],
      getLastFocused: async () => state.windows.find(w => w.focused) || state.windows[0],
      update: async (id, props) => { windowsFocused.push({ id, props }); return state.windows.find(w => w.id === id); },
      create: record('windows.create', {}),
    },
    history: { search: async () => opts.history || [], onVisited: makeEvent(), onVisitRemoved: makeEvent() },
    bookmarks: { search: async () => opts.bookmarks || [] },
    topSites: { get: async () => opts.topSites || [] },
    search: { query: async (q) => { searched.push(q); } },
    tabGroups: {
      query: async () => opts.groups || [],
      get: async (id) => (opts.groups || []).find(g => g.id === id),
      update: record('tabGroups.update'),
    },
    sessions: { restore: record('sessions.restore'), MAX_SESSION_RESULTS: 25,
      getRecentlyClosed: async () => opts.closed || [] },
    storage: {
      local: { get: (k, cb) => cb && cb(opts.storage || {}),
        set: (items) => { Object.assign(local, JSON.parse(JSON.stringify(items))); } },
      // Every tab counts as visited this session unless a test says otherwise.
      session: {
        get: (k, cb) => cb && cb({ visitedTabs: opts.visited ||
          (opts.windows || []).flatMap(w => w.tabs.map(t => t.id)) }),
        set: (items) => { Object.assign(session, items); },
      },
      onChanged: makeEvent(),
    },
  };

  const sandbox = {
    chrome,
    console: { log: opts.verbose ? console.log : () => {} },
    fetch: async () => ({ json: async () => ({}), blob: async () => ({}),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'image/png' } }),
    // Scripts the worker imports run in its own context, as they do in a service worker.
    importScripts: (...files) => files.forEach(f =>
      vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f })),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    Date, Math, JSON, Map, Set, Promise, Object, Array, String, Number, RegExp, Error, undefined,
    createImageBitmap: async () => ({ width: 2000, height: 1200, close: () => {} }),
    OffscreenCanvas: class { constructor(w, h) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { return { arrayBuffer: async () => new ArrayBuffer(8) }; } },
    Uint8Array, ArrayBuffer,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    navigator: { userAgent: opts.userAgent || 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, 'mainsw.js'), 'utf8'), ctx, { filename: 'mainsw.js' });

  const h = {
    ctx, sandbox, chrome, sent, activated, windowsFocused, created, searched, ran, state, session, local,
    // Values cross a realm boundary, so objects arrive with the VM's own prototypes. Copy
    // them into this realm before any deepStrictEqual comparison.
    g: (name) => {
      const value = vm.runInContext(name, ctx);
      return (value && typeof value === 'object') ? JSON.parse(JSON.stringify(value)) : value;
    },
    set: (name, value) => { sandbox.__v = value; vm.runInContext(`${name} = __v`, ctx); },
    call: (expr) => vm.runInContext(expr, ctx),
    // Deliver a message from the native app, then wait for the switch queue to drain.
    async deliver(message) {
      port.onMessage.emit(message);
      for (let i = 0; i < 8; i++) { await vm.runInContext('nativeSwitchQueue', ctx); }
      return h;
    },
    // Deliver several messages without draining between them, the way a fast Ctrl+Tab flip
    // arrives while the first press is still awaiting its browser query.
    async deliverBurst(messages) {
      messages.forEach(m => port.onMessage.emit(m));
      for (let i = 0; i < 12; i++) { await vm.runInContext('nativeSwitchQueue', ctx); }
      return h;
    },
    focusWindow(id) {
      state.windows.forEach(w => { w.focused = (w.id === id); });
      chrome.windows.onFocusChanged.emit(id);
    },
    lastSent: (action) => {
      const found = [...sent].reverse().find(m => m.action === action);
      return found ? JSON.parse(JSON.stringify(found)) : undefined;
    },
  };
  return h;
}

function win(id, tabs, focused = false) {
  return { id, focused, state: 'normal', type: 'normal', tabs };
}
function tab(id, extra = {}) {
  return Object.assign({ id, title: 'Tab ' + id, url: 'https://example.com/' + id, favIconUrl: '', active: false }, extra);
}

module.exports = { load, win, tab };
