/**
 * Import from Arc. The Arclike app reads Arc's StorableSidebar.json and sends a trimmed copy
 * (native-host/Sources/arclike/ArcImport.swift). This file turns it into Chrome's own things:
 * Arc favorites become pinned tabs, each space's pinned tabs and folders become bookmarks in
 * one "Imported from Arc" folder on the bookmarks bar, and each space's open tabs become tabs
 * in a collapsed tab group named after the space. Running it again adds only what is missing,
 * so a second import never duplicates the first.
 */

var ArcImport = (function() {
	var ROOT_TITLE = "Imported from Arc";

	// Arc stores containerIDs as alternating ["pinned", id, "unpinned", id] entries.
	function containerId(space, name) {
		var ids = space.containerIDs || [];
		for (var i = 0; i + 1 < ids.length; i += 2) {
			if (ids[i] === name) return ids[i + 1];
		}
		return null;
	}

	function itemTitle(item) {
		return item.title || item.savedTitle || item.url || "Untitled";
	}

	// Children of an Arc item as bookmark nodes. Folders ("list") keep their structure. A split
	// view has no name of its own in Chrome, so its tabs join the folder it sits in. Tabs without
	// a saved address (never loaded in Arc) are left out and counted in `dropped`.
	function nodes(id, items, seen, dropped) {
		var parent = items[id];
		if (!parent || seen[id]) return [];
		seen[id] = true;
		var out = [];
		(parent.childrenIds || []).forEach(function(childId) {
			var item = items[childId];
			if (!item) return;
			if (item.kind === "tab") {
				if (item.url) out.push({ title: itemTitle(item), url: item.url });
				else if (dropped) dropped.n++;
			} else if (item.kind === "list") {
				out.push({ title: item.title || "Untitled folder", children: nodes(childId, items, seen, dropped) });
			} else if (item.kind === "splitView") {
				out = out.concat(nodes(childId, items, seen, dropped));
			}
		});
		return out;
	}

	function flatten(list) {
		return list.reduce(function(out, node) { return out.concat(node.url ? [node] : flatten(node.children)); }, []);
	}

	// The trimmed sidebar the app sends ->
	// { spaces: [{title, children, tabs}], favorites: [{title, url}], dropped }. `children` are the
	// pinned tabs and folders, `tabs` the open (unpinned) tabs, `dropped` the tabs left out.
	function buildTree(sidebar) {
		if (!sidebar || !Array.isArray(sidebar.spaces) || !Array.isArray(sidebar.items)) {
			throw new Error("Arc's sidebar has no spaces or items");
		}
		var items = {};
		sidebar.items.forEach(function(item) { if (item && item.id) items[item.id] = item; });

		var spaces = [];
		var dropped = { n: 0 };
		sidebar.spaces.forEach(function(space) {
			var pinned = containerId(space, "pinned");
			var unpinned = containerId(space, "unpinned");
			var children = pinned ? nodes(pinned, items, {}, dropped) : [];
			var tabs = unpinned ? flatten(nodes(unpinned, items, {}, dropped)) : [];
			if (children.length || tabs.length) {
				spaces.push({ title: space.title || "Untitled space", children: children, tabs: tabs });
			}
		});

		// topAppsContainerIDs alternates a profile and a container ID. Favorites come from the
		// default profile, which is where Chrome is importing into.
		var favorites = [];
		var top = sidebar.topAppsContainerIDs || [];
		for (var i = 0; i + 1 < top.length; i += 2) {
			if (top[i] && top[i].default) {
				favorites = nodes(top[i + 1], items, {}).filter(function(node) { return node.url; });
				break;
			}
		}
		return { spaces: spaces, favorites: favorites, dropped: dropped.n };
	}

	function countPages(list) {
		return list.reduce(function(sum, node) {
			return sum + (node.url ? 1 : countPages(node.children));
		}, 0);
	}

	function countFolders(list) {
		return list.reduce(function(sum, node) {
			return sum + (node.url ? 0 : 1 + countFolders(node.children));
		}, 0);
	}

	function summarize(tree) {
		return {
			spaces: tree.spaces.length,
			pages: tree.spaces.reduce(function(sum, s) { return sum + countPages(s.children); }, 0),
			folders: tree.spaces.reduce(function(sum, s) { return sum + countFolders(s.children); }, 0),
			tabs: tree.spaces.reduce(function(sum, s) { return sum + s.tabs.length; }, 0),
			favorites: tree.favorites.length,
			dropped: tree.dropped || 0,
			// For the preview: where each space's things go, and the favorites by site.
			bySpace: tree.spaces.map(function(s) {
				return { title: s.title, pages: countPages(s.children), tabs: s.tabs.length };
			}),
			favoriteSites: tree.favorites.map(function(f) { return siteKey(f.url).replace(/^www\./, ""); }),
		};
	}

	// Favorites are web apps, and a pinned tab drifts from the saved URL as it is used (Gmail
	// moves to another message). So a pinned tab on the same site counts as the favorite.
	function siteKey(url) {
		var match = /^https?:\/\/([^\/?#]+)/i.exec(url);
		return match ? match[1].toLowerCase() : url;
	}

	async function findBookmarksBar(chrome) {
		var tree = await chrome.bookmarks.getTree();
		var roots = (tree[0] && tree[0].children) || [];
		return roots.find(function(n) { return n.folderType === "bookmarks-bar"; }) || roots[0];
	}

	// The folder of an earlier import: the one we saved, if it still exists, else one with the
	// same title on the bookmarks bar.
	async function findRoot(chrome, bar, savedId) {
		if (savedId) {
			try {
				var found = await chrome.bookmarks.get(savedId);
				if (found && found[0] && !found[0].url) return found[0];
			} catch (e) { /* deleted since */ }
		}
		var children = await chrome.bookmarks.getChildren(bar.id);
		return children.find(function(n) { return !n.url && n.title === ROOT_TITLE; }) || null;
	}

	// Add the nodes under parentId that are not there yet. A folder matches by title, a page by
	// URL. In a dry run nothing is created, and a missing folder's contents all count as new.
	async function merge(chrome, parentId, list, result, dryRun) {
		var existing = parentId ? await chrome.bookmarks.getChildren(parentId) : [];
		for (var i = 0; i < list.length; i++) {
			var node = list[i];
			if (node.url) {
				if (existing.some(function(n) { return n.url === node.url; })) { result.pagesSkipped++; continue; }
				if (!dryRun) {
					try {
						var made = await chrome.bookmarks.create({ parentId: parentId, title: node.title, url: node.url });
						existing.push(made);
					} catch (e) {
						result.failed.push({ title: node.title, url: node.url, error: e.message });
						continue;
					}
				}
				result.pagesAdded++;
			} else {
				var folder = existing.find(function(n) { return !n.url && n.title === node.title; });
				if (!folder) {
					result.foldersAdded++;
					if (!dryRun) {
						folder = await chrome.bookmarks.create({ parentId: parentId, title: node.title });
						existing.push(folder);
					}
				}
				await merge(chrome, folder ? folder.id : null, node.children, result, dryRun);
			}
		}
	}

	// Open each space's tabs in a collapsed group titled after the space, reusing a group of
	// that title. A tab is new unless that group already has its URL, or an earlier import
	// opened it (a page can redirect once loaded, or the tab was closed on purpose).
	async function openGroups(chrome, spaces, result, dryRun, opened, windowId) {
		var groups = await chrome.tabGroups.query({});
		for (var i = 0; i < spaces.length; i++) {
			var space = spaces[i];
			if (!space.tabs.length) continue;
			var group = groups.find(function(g) { return g.title === space.title; });
			var present = {};
			if (group) {
				var inGroup = await chrome.tabs.query({ groupId: group.id });
				inGroup.forEach(function(t) { present[t.url] = true; present[t.pendingUrl] = true; });
			}
			var tabIds = [];
			for (var j = 0; j < space.tabs.length; j++) {
				var tab = space.tabs[j];
				var key = space.title + "\n" + tab.url;
				if (present[tab.url] || opened.indexOf(key) !== -1) { result.tabsSkipped++; continue; }
				present[tab.url] = true;
				if (!dryRun) {
					try {
						var made = await chrome.tabs.create({ url: tab.url, active: false, windowId: group ? group.windowId : windowId });
						tabIds.push(made.id);
					} catch (e) {
						result.failed.push({ title: tab.title, url: tab.url, error: e.message });
						continue;
					}
					opened.push(key);
				}
				result.tabsAdded++;
				result.bySpace[space.title].tabsAdded++;
			}
			if (!tabIds.length) continue;
			if (group) {
				await chrome.tabs.group({ groupId: group.id, tabIds: tabIds });
			} else {
				var groupId = await chrome.tabs.group({ tabIds: tabIds, createProperties: { windowId: windowId } });
				await chrome.tabGroups.update(groupId, { title: space.title, collapsed: true });
				result.groupsAdded++;
			}
		}
	}

	// Import `tree`, or with dryRun only count what an import would add. `saved` is what the
	// last import stored ({folderId, openedTabs}); the result carries what to store next time.
	async function run(chrome, tree, options) {
		var dryRun = !!(options && options.dryRun);
		var saved = (options && options.saved) || {};
		var result = { pagesAdded: 0, pagesSkipped: 0, foldersAdded: 0, favoritesAdded: 0, favoritesSkipped: 0,
			tabsAdded: 0, tabsSkipped: 0, groupsAdded: 0, failed: [], alreadyImported: false, folderId: null,
			bySpace: {}, favoriteSitesPresent: [],
			openedTabs: (saved.openedTabs || []).slice() };

		var step = "bookmarks";
		try {
			var bar = await findBookmarksBar(chrome);
			var root = await findRoot(chrome, bar, saved.folderId);
			result.alreadyImported = !!root;
			if (!root && !dryRun) root = await chrome.bookmarks.create({ parentId: bar.id, title: ROOT_TITLE });
			result.folderId = root ? root.id : null;
			for (var k = 0; k < tree.spaces.length; k++) {
				var space = tree.spaces[k];
				var before = result.pagesAdded;
				if (space.children.length) {
					await merge(chrome, result.folderId, [{ title: space.title, children: space.children }], result, dryRun);
				}
				var counts = result.bySpace[space.title] || (result.bySpace[space.title] = { pagesAdded: 0, tabsAdded: 0 });
				counts.pagesAdded += result.pagesAdded - before;
			}

			step = "pinned tabs";
			var pinned = await chrome.tabs.query({ pinned: true });
			var sites = {};
			pinned.forEach(function(t) { sites[siteKey(t.pendingUrl || t.url || "")] = true; });
			var windowId;
			if (!dryRun) {
				var win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
				windowId = win && win.id;
			}
			for (var i = 0; i < tree.favorites.length; i++) {
				var fav = tree.favorites[i];
				var key = siteKey(fav.url);
				if (sites[key]) { result.favoritesSkipped++; result.favoriteSitesPresent.push(key.replace(/^www\./, "")); continue; }
				if (!dryRun) {
					try {
						await chrome.tabs.create({ url: fav.url, pinned: true, active: false, windowId: windowId });
					} catch (e) {
						result.failed.push({ title: fav.title, url: fav.url, error: e.message });
						continue;
					}
				}
				sites[key] = true;
				result.favoritesAdded++;
			}

			step = "tab groups";
			await openGroups(chrome, tree.spaces, result, dryRun, result.openedTabs, windowId);
		} catch (e) {
			e.step = step;
			throw e;
		}
		return result;
	}

	return { ROOT_TITLE: ROOT_TITLE, buildTree: buildTree, summarize: summarize, run: run };
})();

// Service worker side: ask the app for Arc's sidebar, then import it. The popup sends
// {action: "arc_import", dryRun} and shows what comes back.

var ARC_READ_TIMEOUT_MS = 10000;
var arcRequests = {};
var arcRequestSeq = 0;

function arcError(code, detail) {
	var e = new Error(detail);
	e.code = code;
	return e;
}

function readArcFromApp() {
	return new Promise(function(resolve, reject) {
		if (!nativePort) connectNativeHost();
		if (!nativePort) return reject(arcError("app_not_connected", "connectNative did not return a port"));
		var id = ++arcRequestSeq;
		var timer = setTimeout(function() {
			delete arcRequests[id];
			reject(arcError("app_no_answer", "No arc_data reply to read_arc within " + ARC_READ_TIMEOUT_MS / 1000 + " s"));
		}, ARC_READ_TIMEOUT_MS);
		arcRequests[id] = function(message) { clearTimeout(timer); resolve(message); };
		sendToNativeHost({ action: "read_arc", requestId: id });
	});
}

function arcDataReceived(message) {
	var callback = arcRequests[message.requestId];
	if (!callback) return;
	delete arcRequests[message.requestId];
	callback(message);
}

// A short plain-text report to paste into Claude Code.
function arcImportReport(heading, context, error, failed) {
	var lines = [
		"Arclike: " + heading,
		"Paste this into Claude Code and ask it to fix the Arc import.",
		"",
		"Step: " + context.step,
	];
	if (error) lines.push("Error: " + error.code, "Detail: " + error.detail);
	lines.push(
		"Extension: " + context.extension,
		"App: " + (context.app || "unknown (no reply from the app)"),
		"Chrome: " + context.chrome,
		"macOS: " + (context.macos || "unknown"));
	if (context.path) {
		lines.push("Arc file: " + context.path + (context.bytes ? " (" + context.bytes + " bytes, modified " + context.modified + ")" : ""));
		lines.push("Arc format version: " + context.formatVersion);
	}
	(failed || []).slice(0, 10).forEach(function(f) {
		lines.push("Not added: " + f.url + " (" + f.error + ")");
	});
	if (failed && failed.length > 10) lines.push("... and " + (failed.length - 10) + " more");
	lines.push(
		"Time: " + new Date().toISOString(),
		"Code: extension/arcimport.js, native-host/Sources/arclike/ArcImport.swift",
		"App log: ~/Library/Logs/Arclike.log");
	return lines.join("\n");
}

async function handleArcImport(request) {
	var dryRun = !!request.dryRun;
	var chromeVersion = (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || "unknown";
	var context = { step: "reading Arc data through the Arclike app", extension: EXTENSION_VERSION, chrome: chromeVersion };
	try {
		var data = await readArcFromApp();
		["app", "macos", "path", "bytes", "modified", "formatVersion"].forEach(function(k) {
			if (k in data) context[k] = data[k];
		});
		if (!data.ok) throw arcError(data.error, data.detail);

		context.step = "reading Arc's sidebar";
		var tree;
		try { tree = ArcImport.buildTree(data.sidebar); } catch (e) { throw arcError("arc_bad_format", e.message); }
		var summary = ArcImport.summarize(tree);
		if (!summary.pages && !summary.favorites) throw arcError("arc_empty", "No pinned tabs or favorites in Arc's sidebar");

		context.step = dryRun ? "checking what Chrome already has" : "adding to Chrome";
		var stored = await new Promise(function(resolve) { chrome.storage.local.get("arcImport", resolve); });
		var result = await ArcImport.run(chrome, tree, { dryRun: dryRun, saved: (stored && stored.arcImport) || {} });
		if (!dryRun) {
			chrome.storage.local.set({ arcImport: { folderId: result.folderId, openedTabs: result.openedTabs,
				importedAt: new Date().toISOString() } });
			log("Arc import: " + JSON.stringify(Object.assign({}, result, { openedTabs: result.openedTabs.length })));
		}
		// What Arc's command bar learned, so Arclike's bar ranks the same pages first.
		await rankMemoryLoaded;
		var choices = rankFromArcPicks(data.rankingPicks || []);
		result.choicesAdded = rankImport(choices, dryRun);
		var response = { ok: true, dryRun: dryRun, summary: summary, result: result, extensions: data.extensions || [] };
		if (result.failed.length) {
			context.step = "adding single pages to Chrome";
			response.report = arcImportReport("Import from Arc skipped " + result.failed.length + " pages", context, null, result.failed);
		}
		return response;
	} catch (e) {
		if (e.step) context.step = "adding " + e.step + " to Chrome";
		var error = { code: e.code || "unexpected", detail: e.message };
		log("Arc import failed at " + context.step + ": " + error.code + ": " + error.detail);
		return { ok: false, error: error.code, report: arcImportReport("Import from Arc failed", context, error) };
	}
}
