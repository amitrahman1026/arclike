/**
 * Command bar: the Arc/Zen-style search bar that the native app draws over the browser on Cmd+T
 * and Cmd+L. The app owns the window and the keyboard. This side answers its queries with open
 * tabs, bookmarks and history, and opens whatever is chosen.
 */

var COMMAND_BAR_MAX_RESULTS = 8;
var COMMAND_BAR_TOP_SITES = 6;
var COMMAND_BAR_MAX_FAVICONS = 500;
// A command whose name starts with the query scores this, and leads when no page does.
var COMMAND_BAR_STRONG_COMMAND_MATCH = 60;

// The bar on screen: the window it opened over, the tab Cmd+L would replace, and whether the
// choice opens in a new tab ("new_tab") or in that tab ("current_tab").
var commandBarTarget = null;
var commandBarFavicons = new Map();  // origin -> data URL, "" when Chrome had none

// History is matched in memory. chrome.history.search with text scans the whole history
// database, which takes over a second on a large profile, far too slow to run per keystroke.
// So the recent history is read once and kept current as pages are visited.
var COMMAND_BAR_HISTORY_DAYS = 90;
var COMMAND_BAR_HISTORY_LIMIT = 20000;
var COMMAND_BAR_HISTORY_WAIT_MS = 150;
var commandBarHistory = null;         // url -> HistoryItem, oldest visit first
var commandBarHistoryLoading = null;
var commandBarHistoryWaited = false;
// The newest query the app sent. An older one still in flight is dropped rather than answered.
var commandBarLatestSeq = 0;
var commandBarClosedCount = 0;   // recently closed tabs seen by the last search, for the trace
var commandBarLastQuery = "";    // what was typed for the newest answer, remembered with the choice

var COMMAND_BAR_SCHEMES = /^(https?|file|ftp|chrome|chrome-extension|about|view-source):/i;

// The URL that typed text stands for, or null when the text reads as a search.
var commandBarTypedUrl = function(text) {
	text = text.trim();
	if (!text || /\s/.test(text)) {
		return null;
	}
	if (COMMAND_BAR_SCHEMES.test(text)) {
		return text;
	}
	if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([\/?#]|$)/i.test(text)) {
		return "http://" + text;
	}
	if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}(:\d+)?([\/?#]|$)/i.test(text)) {
		return "https://" + text;
	}
	return null;
};

var commandBarDisplayUrl = function(url) {
	return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
};

var commandBarHost = function(url) {
	var match = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#:]+)/i.exec(url);
	return match ? match[1].toLowerCase().replace(/^www\./, "") : "";
};

// Two URLs that differ only in a fragment or a trailing slash are the same page.
var commandBarUrlKey = function(url) {
	return url.replace(/#.*$/, "").replace(/\/$/, "");
};

// The index of the first place `word` starts a word in `text`, or -1.
var commandBarWordStart = function(text, word) {
	var index = text.indexOf(word);
	while (index > 0 && /[a-z0-9]/.test(text[index - 1])) {
		index = text.indexOf(word, index + 1);
	}
	return index;
};

// How well a page matches the query, or -1 when a word of the query is in neither its title
// nor its URL. A host that starts with the query beats a title that starts with it, which
// beats a word inside the title.
var commandBarMatchScore = function(query, title, url) {
	var q = query.trim().toLowerCase();
	title = (title || "").toLowerCase();
	var lowerUrl = url.toLowerCase();
	var words = q.split(/\s+/);
	for (var i = 0; i < words.length; i++) {
		if (title.indexOf(words[i]) === -1 && lowerUrl.indexOf(words[i]) === -1) {
			return -1;
		}
	}
	var host = commandBarHost(url);
	var score = 10;
	if (host.indexOf(q) === 0) {
		score += 100;
	} else if (host.indexOf("." + q) !== -1) {
		score += 40;
	}
	var titleIndex = commandBarWordStart(title, q);
	if (titleIndex === 0) {
		score += 60;
	} else if (titleIndex > 0) {
		score += 30;
	}
	return score;
};

// Damerau-Levenshtein distance between a and b, or max + 1 as soon as it must exceed max.
var commandBarEditDistance = function(a, b, max) {
	if (Math.abs(a.length - b.length) > max) {
		return max + 1;
	}
	var before = null;
	var previous = [];
	for (var j = 0; j <= b.length; j++) {
		previous[j] = j;
	}
	for (var i = 1; i <= a.length; i++) {
		var current = [i];
		var rowMin = i;
		for (j = 1; j <= b.length; j++) {
			var value = Math.min(previous[j] + 1, current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, before[j - 2] + 1);
			}
			current[j] = value;
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > max) {
			return max + 1;
		}
		before = previous;
		previous = current;
	}
	return previous[b.length];
};

// The words of a page's title and URL, kept on the item so each is split once.
var commandBarTokens = function(item, title, url) {
	if (!item.commandBarTokens) {
		item.commandBarTokens = ((title || "") + " " + url).toLowerCase().split(/[^a-z0-9]+/)
			.filter(function(token) { return token.length >= 3; });
	}
	return item.commandBarTokens;
};

// Whether `word` is the start of one of `tokens` with a typo or two: one for a word of 4 to 7
// letters, two from 8. A shorter word must match exactly.
var commandBarFuzzyWord = function(word, tokens) {
	var allowed = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
	if (allowed === 0) {
		return false;
	}
	for (var i = 0; i < tokens.length; i++) {
		// A typo almost never changes the first letter, short of swapping the first two. Checking
		// that first skips nearly every token, which keeps a pass over 10,000 pages fast.
		var token = tokens[i];
		if (token[0] !== word[0] && !(token[0] === word[1] && token[1] === word[0])) {
			continue;
		}
		for (var length = word.length - allowed; length <= word.length + allowed; length++) {
			if (length >= 3 && length <= tokens[i].length &&
				commandBarEditDistance(word, tokens[i].slice(0, length), allowed) <= allowed) {
				return true;
			}
		}
	}
	return false;
};

// The score of a page that matches the query only with typos, or -1. It ranks below every exact
// match and never leads the list, so a misspelled search still searches.
var COMMAND_BAR_FUZZY_SCORE = 5;
var commandBarFuzzyScore = function(query, item, title, url) {
	var words = query.trim().toLowerCase().split(/\s+/);
	var lowerTitle = (title || "").toLowerCase();
	var lowerUrl = url.toLowerCase();
	var tokens = null;
	for (var i = 0; i < words.length; i++) {
		if (lowerTitle.indexOf(words[i]) !== -1 || lowerUrl.indexOf(words[i]) !== -1) {
			continue;
		}
		tokens = tokens || commandBarTokens(item, title, url);
		if (!commandBarFuzzyWord(words[i], tokens)) {
			return -1;
		}
	}
	return COMMAND_BAR_FUZZY_SCORE;
};

// A tab closed this recently is what you are most likely after, so it comes before every other
// page that matches, whatever their titles score.
var COMMAND_BAR_FRESH_CLOSED_MINUTES = 10;

var commandBarFreshlyClosed = function(candidate) {
	return candidate.kind === "closed" &&
		Date.now() / 1000 - (candidate.lastModified || 0) < COMMAND_BAR_FRESH_CLOSED_MINUTES * 60;
};

var commandBarSearchRow = function(text) {
	return { kind: "search", title: text, detail: "Search with Google", hint: "", text: text };
};

// The row Enter falls back to for typed text: visit it as a URL, or search for it.
var commandBarDefaultRow = function(text) {
	var url = commandBarTypedUrl(text);
	if (url) {
		return { kind: "url", title: commandBarDisplayUrl(url), detail: "Visit", hint: "", url: url };
	}
	return commandBarSearchRow(text);
};

// A row that visits the site a page belongs to, for a query that is the start of its host.
var commandBarSiteRow = function(url) {
	var origin = url.split("/").slice(0, 3).join("/");
	return { kind: "url", title: commandBarHost(url), detail: "Visit", hint: "", url: origin + "/" };
};

// The field's inline completion for the query, the way Arc, Zen and Chrome complete a site as
// you type its name: "you" becomes "youtube.com/", with the added part selected. Only offered
// when the first row is that site, so Enter goes where the field says.
var commandBarAutocomplete = function(query, lead) {
	var text = query.trim();
	if (!lead || !lead.url || ["url", "tab", "closed"].indexOf(lead.kind) === -1 || /[\s\/]/.test(text)) {
		return "";
	}
	var host = commandBarHost(lead.url);
	if (!host) {
		return "";
	}
	var site = (/^www\./i.test(text) ? "www." : "") + host + "/";
	if (site.indexOf(text.toLowerCase()) !== 0 || site.length - text.length < 2) {
		return "";
	}
	return text + site.slice(text.length);
};

// Commands the bar can run, like Chrome Palette's. Tab commands act on the tab the bar opened
// over. Pages open like any other address. A command that closes several tabs at once is left
// out on purpose: one stray Enter must not cost you your tabs.
var COMMAND_BAR_COMMANDS = [
	{ command: "close-tab", title: "Close Tab", hint: "⌘W", symbol: "xmark", tab: true },
	{ command: "pin-tab", title: "Pin Tab", unTitle: "Unpin Tab", state: "pinned", symbol: "pin", tab: true },
	{ command: "duplicate-tab", title: "Duplicate Tab", symbol: "plus.square.on.square", tab: true },
	{ command: "mute-tab", title: "Mute Tab", unTitle: "Unmute Tab", state: "muted", symbol: "speaker.slash", tab: true },
	{ command: "reload-tab", title: "Reload Tab", hint: "⌘R", symbol: "arrow.clockwise", tab: true },
	{ command: "move-tab-to-new-window", title: "Move Tab to New Window", symbol: "macwindow.badge.plus", tab: true },
	{ command: "open-in-little-arc", title: "Open in Little Arc", symbol: "macwindow.on.rectangle", tab: true, when: "mainWindow" },
	{ command: "move-to-main-window", title: "Move to Main Window", hint: "⌘O", symbol: "macwindow", tab: true, when: "littleArc" },
	{ command: "new-little-arc", title: "New Little Arc", symbol: "plus.rectangle.on.rectangle" },
	{ command: "copy-url", title: "Copy URL", hint: "⇧⌘C", symbol: "link", tab: true },
	{ command: "site-settings", title: "Site Settings", symbol: "slider.horizontal.3", tab: true },
	{ command: "split-view", title: "Split View with…", symbol: "rectangle.split.2x1", tab: true, when: "canSplit",
		pick: "split", placeholder: "Split View with a tab, an address or a search" },
	{ command: "exit-split-view", title: "Exit Split View", symbol: "rectangle", tab: true, when: "split" },
	{ command: "new-tab-group", title: "New Tab Group…", symbol: "folder.badge.plus", tab: true, when: "mainWindow",
		pick: "new-group", placeholder: "Name the new group" },
	{ command: "add-tab-to-group", title: "Add Tab to Group…", symbol: "folder", tab: true, when: "mainWindow",
		pick: "group", placeholder: "Add Tab to a group" },
	{ command: "ungroup-tab", title: "Ungroup Tab", symbol: "folder.badge.minus", tab: true, when: "grouped" },
	{ command: "reopen-closed-tab", title: "Reopen Closed Tab", hint: "⇧⌘T", symbol: "arrow.uturn.backward" },
	{ command: "new-window", title: "New Window", hint: "⌘N", symbol: "macwindow" },
	{ command: "new-incognito-window", title: "New Incognito Window", hint: "⇧⌘N", symbol: "eyeglasses" },
	{ command: "full-screen", title: "Toggle Full Screen", hint: "⌃⌘F", symbol: "arrow.up.left.and.arrow.down.right" },
	{ url: "chrome://settings/", title: "Settings", hint: "⌘,", symbol: "gearshape" },
	{ url: "chrome://history/", title: "History", hint: "⌘Y", symbol: "clock" },
	{ url: "chrome://downloads/", title: "Downloads", hint: "⇧⌘J", symbol: "arrow.down.circle" },
	{ url: "chrome://extensions/", title: "Extensions", symbol: "puzzlepiece.extension" },
	{ url: "chrome://bookmarks/", title: "Bookmarks", hint: "⌥⌘B", symbol: "book" },
	{ url: "chrome://password-manager/", title: "Passwords", symbol: "key" },
	{ url: "chrome://settings/clearBrowserData", title: "Clear Browsing Data", hint: "⇧⌘⌫", symbol: "trash" }
];

// Chrome's own shortcuts for the same commands on Windows, where the macOS hints above would
// be wrong. Copy URL is the Windows app's Alt+Shift+C, since Ctrl+Shift+C opens DevTools there.
// Settings has no shortcut on Windows, and the Windows app does not take Ctrl+O for Move to Main
// Window.
var COMMAND_BAR_WINDOWS_HINTS = {
	"⌘W": "Ctrl+W", "⌘R": "Ctrl+R", "⇧⌘C": "Alt+Shift+C", "⇧⌘T": "Ctrl+Shift+T", "⌘N": "Ctrl+N",
	"⇧⌘N": "Ctrl+Shift+N", "⌃⌘F": "F11", "⌘,": "", "⌘Y": "Ctrl+H", "⇧⌘J": "Ctrl+J", "⌥⌘B": "Ctrl+Shift+O",
	"⇧⌘⌫": "Ctrl+Shift+Del", "⌘O": ""
};

var commandBarOnWindows = /Windows/.test(navigator.userAgent);

// A command's shortcut hint for this platform.
var commandBarHint = function(hint) {
	if (!hint || !commandBarOnWindows) {
		return hint || "";
	}
	return hint in COMMAND_BAR_WINDOWS_HINTS ? COMMAND_BAR_WINDOWS_HINTS[hint] : hint;
};

// Conditions a command can name in `when`, checked against the bar's target. Split View needs
// Chrome 155 or later.
var COMMAND_BAR_WHEN = {
	canSplit: function(target) { return typeof chrome.tabs.createSplit === "function" && !target.littleArc; },
	mainWindow: function(target) { return !target.littleArc; },
	littleArc: function(target) { return Boolean(target.littleArc); },
	split: function(target) {
		return typeof chrome.tabs.unsplit === "function" && target.splitViewId !== undefined && target.splitViewId !== -1;
	},
	grouped: function(target) { return target.groupId !== undefined && target.groupId !== -1; }
};

// Tips: one line at the foot of an empty bar, about a feature you would not find alone. Each
// time the bar opens empty it shows the next tip. A tip goes for good when you dismiss it or
// choose what it teaches: a command, or a kind of row. Text between backticks is what to type.
var COMMAND_BAR_TIPS = [
	{ id: "site-settings", text: "Type `site sett` to open this site's permissions, like automatic picture-in-picture",
		uses: ["site-settings"] },
	{ id: "split-view", text: "Type `split` to put this tab beside another one in Split View", when: "canSplit",
		uses: ["split-view"] },
	{ id: "closed-tabs", text: "Type part of a closed tab's title to bring it back", uses: ["closed"] },
	{ id: "tab-groups", text: "Type `group` to add this tab to a tab group", uses: ["new-tab-group", "add-tab-to-group"] },
	{ id: "tab-commands", text: "Type `pin` or `mute` to act on this tab", uses: ["pin-tab", "mute-tab"] },
	{ id: "tab-switcher", text: "Ctrl+Tab switches between the tabs you visited recently", uses: [] }
];
var commandBarTips = { next: 0, retired: [] };  // kept in chrome.storage.local
var commandBarTip = null;                       // the tip on the bar now
// The worker can wake for a Cmd+T before the saved tips are read, and must not save over them.
var commandBarTipsLoaded = new Promise(function(resolve) {
	chrome.storage.local.get("commandBarTips", function(result) {
		var saved = result && result.commandBarTips;
		if (saved && Array.isArray(saved.retired)) {
			commandBarTips = { next: saved.next || 0, retired: saved.retired };
		}
		resolve();
	});
});

var commandBarSaveTips = function() {
	chrome.storage.local.set({ commandBarTips: commandBarTips });
};

// The next tip that is not retired and applies here, or null when none is left.
var commandBarNextTip = function(target) {
	for (var i = 0; i < COMMAND_BAR_TIPS.length; i++) {
		var index = (commandBarTips.next + i) % COMMAND_BAR_TIPS.length;
		var tip = COMMAND_BAR_TIPS[index];
		if (commandBarTips.retired.indexOf(tip.id) === -1 && (!tip.when || COMMAND_BAR_WHEN[tip.when](target))) {
			commandBarTips.next = index + 1;
			commandBarSaveTips();
			return { id: tip.id, text: tip.text };
		}
	}
	return null;
};

var commandBarRetireTip = function(id) {
	if (commandBarTips.retired.indexOf(id) === -1) {
		commandBarTips.retired.push(id);
		commandBarSaveTips();
	}
};

// A chosen row retires the tip that teaches it.
var commandBarRetireUsedTip = function(item) {
	var use = item && (item.kind === "command" ? item.command : item.kind);
	COMMAND_BAR_TIPS.forEach(function(tip) {
		if (use && tip.uses.indexOf(use) !== -1) {
			commandBarRetireTip(tip.id);
		}
	});
};

var commandBarDismissTip = function(id) {
	commandBarRetireTip(id);
	commandBarTip = null;
};

// The commands whose name has a word starting with each word of the query, best first. `target`
// is the bar's target: without a tab, the tab commands are left out. A command with `pick` asks
// for a second choice in the bar, such as the tab to split with.
var commandBarMatchingCommands = function(text, target) {
	var words = text.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) {
		return [];
	}
	var hasTab = Boolean(target) && target.tabId !== null && target.tabId !== undefined;
	var matches = [];
	COMMAND_BAR_COMMANDS.forEach(function(definition) {
		if ((definition.tab && !hasTab) || (definition.when && !COMMAND_BAR_WHEN[definition.when](target))) {
			return;
		}
		var title = definition.state && target && target[definition.state] ? definition.unTitle : definition.title;
		var lowerTitle = title.toLowerCase();
		var allWords = words.every(function(word) { return commandBarWordStart(lowerTitle, word) !== -1; });
		if (!allWords) {
			return;
		}
		var match = commandBarWordStart(lowerTitle, text.toLowerCase()) === 0 ? COMMAND_BAR_STRONG_COMMAND_MATCH : 30;
		var row = { kind: "command", title: title, detail: "", hint: commandBarHint(definition.hint),
			symbol: definition.symbol, match: match };
		if (definition.url) {
			row.url = definition.url;
		} else {
			row.command = definition.command;
		}
		if (definition.pick) {
			row.pick = definition.pick;
		}
		matches.push(row);
	});
	matches.sort(function(a, b) { return b.match - a.match; });
	return matches;
};

// When the exact pass finds fewer pages than this, a second pass allows typos.
var COMMAND_BAR_FUZZY_BELOW = 3;

// Rank open tabs, recently closed tabs, bookmarks and history for the query and put the typed
// text's own row (open the URL, or search) among them. A page that is in several sources is
// listed once, as an open tab first, then as a closed tab, then as a bookmark. `sources.context`
// is what ranking.js needs beyond the pages: `switched`, `recalled` (from rankRecall) and `now`.
var COMMAND_BAR_HINTS = { tab: "Switch to Tab", closed: "Closed", bookmark: "Bookmark" };
// A search you made before that starts with the query, listed after the search row.
var COMMAND_BAR_PAST_SEARCHES = 1;

var commandBarRank = function(query, sources) {
	var text = query.trim();
	var context = sources.context || {};
	var recalled = context.recalled || { pages: new Map(), searches: [], searchHere: 0 };
	context = Object.assign({}, context, { remembered: new Map(Array.from(recalled.pages, function(entry) {
		return [entry[0], entry[1].strength];
	})) });
	var candidates = [];
	var byKey = new Map();
	var fuzzy = false;
	var add = function(kind, item, title, url, extra, always) {
		if (!url || /^javascript:/i.test(url)) {
			return;
		}
		var key = commandBarUrlKey(url);
		var match = always ? 0 :
			fuzzy ? commandBarFuzzyScore(text, item, title, url) : commandBarMatchScore(text, title, url);
		if (match < 0 && !context.remembered.has(key)) {
			return;
		}
		var features = rankFeatures(text, kind, item, title, url, fuzzy && match >= 0, context);
		var existing = byKey.get(key);
		if (existing) {
			rankMergeFeatures(existing.features, features);
			existing.score = rankScore(existing.features);
			return;
		}
		var candidate = Object.assign({
			kind: kind,
			title: title || commandBarDisplayUrl(url),
			detail: commandBarDisplayUrl(url),
			hint: COMMAND_BAR_HINTS[kind] || "",
			url: url,
			key: key,
			features: features,
			score: rankScore(features)
		}, extra);
		byKey.set(key, candidate);
		candidates.push(candidate);
	};
	var addAll = function() {
		(sources.tabs || []).forEach(function(tab) {
			add("tab", tab, tab.title, tab.url, { tabId: tab.id });
		});
		(sources.closed || []).forEach(function(tab) {
			add("closed", tab, tab.title, tab.url, { sessionId: tab.sessionId, lastModified: tab.lastModified });
		});
		(sources.bookmarks || []).forEach(function(bookmark) {
			add("bookmark", bookmark, bookmark.title, bookmark.url);
		});
		(sources.history || []).forEach(function(item) {
			add("history", item, item.title, item.url);
		});
	};
	addAll();
	if (candidates.length < COMMAND_BAR_FUZZY_BELOW && text.length >= 4) {
		fuzzy = true;
		addAll();
	}
	// A page chosen before for this text is offered even when history no longer has it.
	recalled.pages.forEach(function(page) {
		if (!byKey.has(commandBarUrlKey(page.url))) {
			add("history", {}, page.title, page.url, {}, true);
		}
	});
	candidates.sort(function(a, b) {
		return commandBarFreshlyClosed(b) - commandBarFreshlyClosed(a) || b.score - a.score;
	});
	var commands = commandBarMatchingCommands(text, sources.target);

	var results = [];
	var typedUrl = commandBarTypedUrl(text);
	if (typedUrl) {
		// The typed address itself first, unless a tab already has it open.
		var same = byKey.get(commandBarUrlKey(typedUrl));
		var lead = same && same.kind === "tab" ? same : commandBarDefaultRow(text);
		results.push(lead);
		if (!COMMAND_BAR_SCHEMES.test(text)) {
			results.push(commandBarSearchRow(text));
		}
	} else {
		var best = candidates[0];
		// A page leads when it scores high enough and the query starts its site's name or a word of
		// its title, or it was chosen for this text before. Not when searching this very text was
		// chosen more strongly before. A tab closed a moment ago leads when its site or title starts
		// with the query.
		var named = best && (best.features.host || best.features.title || best.features.remembered);
		var strong = best && text.length >= 2 && recalled.searchHere <= best.features.remembered &&
			((named && best.score >= RANK_LEAD) ||
				(commandBarFreshlyClosed(best) && Math.max(best.features.host, best.features.title) >= 1));
		// A command whose name starts with the query leads when no page does: "set" is Settings.
		if (!strong && commands.length && commands[0].match >= COMMAND_BAR_STRONG_COMMAND_MATCH && text.length >= 3) {
			results.push(commands.shift());
		}
		if (strong) {
			// A site name leads with the site itself, unless a tab, open or just closed, has a page
			// of it, or this very page was chosen for the text before.
			var site = best.kind !== "tab" && best.kind !== "closed" && !best.features.remembered &&
				commandBarHost(best.url).indexOf(text.toLowerCase()) === 0 ?
				commandBarSiteRow(best.url) : best;
			results.push(site);
			var siteKey = commandBarUrlKey(site.url);
			candidates = candidates.filter(function(c) { return c === site || c.key !== siteKey; });
		}
		results.push(commandBarSearchRow(text));
		recalled.searches.slice(0, COMMAND_BAR_PAST_SEARCHES).forEach(function(search) {
			results.push(commandBarSearchRow(search.text));
		});
	}
	// Other commands come right after the typed text's own rows, at most two of them.
	commands.slice(0, 2).forEach(function(command) {
		results.push(command);
	});
	for (var i = 0; i < candidates.length && results.length < COMMAND_BAR_MAX_RESULTS; i++) {
		if (results.indexOf(candidates[i]) === -1) {
			results.push(candidates[i]);
		}
	}
	return results.slice(0, COMMAND_BAR_MAX_RESULTS).map(function(result) {
		var row = { kind: result.kind, title: result.title, detail: result.detail, hint: result.hint };
		["url", "tabId", "text", "command", "symbol", "pick", "sessionId"].forEach(function(field) {
			if (result[field] !== undefined) {
				row[field] = result[field];
			}
		});
		return row;
	});
};

// Chrome's own favicon for a page, as a data URL the app can draw. Read from Chrome's favicon
// cache through the extension's _favicon endpoint, so nothing goes over the network.
var commandBarFaviconKey = function(url) {
	return commandBarHost(url) ? url.split("/").slice(0, 3).join("/") : url;
};

var commandBarFavicon = async function(url) {
	var key = commandBarFaviconKey(url);
	if (commandBarFavicons.has(key)) {
		return commandBarFavicons.get(key);
	}
	var dataUrl = "";
	try {
		var response = await fetch(chrome.runtime.getURL("/_favicon/?pageUrl=" +
			encodeURIComponent(url) + "&size=32"));
		var bytes = new Uint8Array(await response.arrayBuffer());
		var binary = "";
		for (var i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		dataUrl = "data:" + (response.headers.get("content-type") || "image/png") + ";base64," + btoa(binary);
	} catch (e) {
		log("CommandBar::Favicon failed for " + url + ": " + e.message);
	}
	commandBarFavicons.set(key, dataUrl);
	if (commandBarFavicons.size > COMMAND_BAR_MAX_FAVICONS) {
		commandBarFavicons.delete(commandBarFavicons.keys().next().value);
	}
	return dataUrl;
};

var commandBarLoadHistory = function() {
	if (!commandBarHistoryLoading) {
		var startedAt = Date.now();
		commandBarHistoryLoading = chrome.history.search({
			text: "",
			startTime: Date.now() - COMMAND_BAR_HISTORY_DAYS * 24 * 60 * 60 * 1000,
			maxResults: COMMAND_BAR_HISTORY_LIMIT
		}).then(function(items) {
			commandBarTrace("history loaded: " + items.length + " entries in " + (Date.now() - startedAt) + " ms");
			var history = new Map();
			items.sort(function(a, b) { return (a.lastVisitTime || 0) - (b.lastVisitTime || 0); });
			items.forEach(function(item) { history.set(item.url, item); });
			commandBarHistory = history;
		}).catch(function(e) {
			log("CommandBar::Could not load history: " + e.message);
			commandBarHistoryLoading = null;
		});
	}
	return commandBarHistoryLoading;
};

chrome.history.onVisited.addListener(function(item) {
	if (!commandBarHistory) {
		return;
	}
	commandBarHistory.delete(item.url);
	commandBarHistory.set(item.url, item);
	if (commandBarHistory.size > COMMAND_BAR_HISTORY_LIMIT) {
		commandBarHistory.delete(commandBarHistory.keys().next().value);
	}
});

// Deleted history must not be suggested, so read it again.
chrome.history.onVisitRemoved.addListener(function() {
	commandBarHistory = null;
	commandBarHistoryLoading = null;
	commandBarLoadHistory();
});

// Recently closed tabs, newest first. Closed windows are left out: Reopen Closed Tab brings
// those back.
var commandBarClosedTabs = async function() {
	try {
		var sessions = await chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS || 25 });
		return sessions.filter(function(session) {
			return session.tab && session.tab.url && session.tab.sessionId;
		}).map(function(session) {
			return Object.assign({ lastModified: session.lastModified }, session.tab);
		});
	} catch (e) {
		log("CommandBar::Could not read recently closed tabs: " + e.message);
		return [];
	}
};

// How lately you switched to a tab: 1 for the tab you were on before this one, then 1/2, 1/3...
// by Ctrl+Tab order (`mru` in mainsw.js). The tab you are on is first in that order.
var commandBarSwitched = function(tabId) {
	var index = typeof mru === "undefined" ? -1 : mru.indexOf(tabId);
	return index > 0 ? 1 / index : 0;
};

var commandBarSearch = async function(query) {
	var results;
	if (commandBarTarget && commandBarTarget.pick) {
		results = await commandBarPickResults(query, commandBarTarget);
	} else if (!query.trim()) {
		var sites = await chrome.topSites.get();
		results = sites.slice(0, COMMAND_BAR_TOP_SITES).map(function(site) {
			return {
				kind: "top",
				title: site.title || commandBarDisplayUrl(site.url),
				detail: commandBarDisplayUrl(site.url),
				hint: "",
				url: site.url
			};
		});
	} else {
		// Right after the worker starts, give the history a moment to load, once. After that
		// the bar is answered with whatever is loaded rather than kept waiting.
		if (!commandBarHistory && !commandBarHistoryWaited) {
			commandBarHistoryWaited = true;
			await Promise.race([commandBarLoadHistory(), new Promise(function(resolve) {
				setTimeout(resolve, COMMAND_BAR_HISTORY_WAIT_MS);
			})]);
		}
		var found = await Promise.all([
			chrome.tabs.query({ windowType: "normal" }),
			chrome.bookmarks.search(query).catch(function() { return []; }),
			commandBarClosedTabs()
		]);
		commandBarClosedCount = found[2].length;
		// The tab the bar opened over is where you already are.
		var hereTabId = commandBarTarget ? commandBarTarget.tabId : null;
		results = commandBarRank(query, {
			context: { now: Date.now(), recalled: rankRecall(query), switched: commandBarSwitched },
			tabs: found[0].filter(function(tab) { return tab.id !== hereTabId; }),
			closed: found[2],
			bookmarks: found[1].filter(function(bookmark) { return bookmark.url; }),
			history: commandBarHistory ? Array.from(commandBarHistory.values()) : [],
			target: commandBarTarget
		});
	}
	results.forEach(function(result) {
		result.fill = commandBarFill(result);
		var cached = commandBarWantsFavicon(result) ? commandBarFavicons.get(commandBarFaviconKey(result.url)) : undefined;
		if (cached !== undefined) {
			result.favicon = cached;
		}
	});
	return results;
};

// What the field shows while a row is selected with the arrow keys, as in Arc and Zen: the
// row's address, or the query of a search. A command leaves the field as typed.
var commandBarFill = function(result) {
	if (result.kind === "search") {
		return result.text;
	}
	if (result.kind === "command" || !result.url) {
		return "";
	}
	return commandBarDisplayUrl(result.url);
};

// Commands draw their own symbol.
var commandBarWantsFavicon = function(result) {
	return Boolean(result.url) && result.kind !== "command";
};

// Fill in the favicons that were not cached. Returns whether any was added.
var commandBarAddFavicons = async function(results) {
	var added = false;
	await Promise.all(results.map(async function(result) {
		if (commandBarWantsFavicon(result) && result.favicon === undefined) {
			result.favicon = await commandBarFavicon(result.url);
			added = added || result.favicon !== "";
		}
	}));
	return added;
};

// Cmd+T or Cmd+L was pressed. Only the profile that owns the focused window answers, so with
// several profiles open the bar opens once, over the right window.
var commandBarOpen = async function(mode) {
	var win = await chrome.windows.getLastFocused({ windowTypes: ["normal", "popup"] });
	await commandBarTipsLoaded;
	if (!win || !win.focused) {
		log("CommandBar::No focused window in this profile - ignoring");
		return;
	}
	await rankMemoryLoaded;
	var tabs = await chrome.tabs.query({ active: true, windowId: win.id });
	commandBarShowFor(mode, win, tabs[0]);
};

// Show the bar over window `win`, whose active tab is `active`. A popup window, such as a Little
// Arc, holds one page, so there the bar always opens the choice in place.
var commandBarShowFor = function(mode, win, active) {
	if (win.type === "popup") {
		mode = "current_tab";
	}
	commandBarTarget = { mode: mode, windowId: win.id, tabId: active ? active.id : null,
		pinned: Boolean(active && active.pinned), muted: Boolean(active && active.mutedInfo && active.mutedInfo.muted),
		groupId: active && active.groupId !== undefined ? active.groupId : -1,
		splitViewId: active && active.splitViewId !== undefined ? active.splitViewId : -1 };
	if (win.type === "popup") {
		commandBarTarget.littleArc = true;
	}
	commandBarLastQuery = "";
	var text = "";
	if (mode === "current_tab" && active && !/^(chrome:\/\/newtab\/?|about:blank)$/.test(active.url || "")) {
		text = active.url || "";
	}
	commandBarTip = text ? null : commandBarNextTip(commandBarTarget);
	sendToNativeHost({ action: "show_command_bar", mode: mode, text: text });
	commandBarLoadHistory();
};

// Answer a query at once, then again with its favicons. Chrome reads favicons on its history
// thread, which a large history can keep busy, so the rows must not wait for them.
var commandBarQuery = async function(message) {
	commandBarLatestSeq = Math.max(commandBarLatestSeq, message.seq);
	var query = message.query || "";
	var startedAt = Date.now();
	var results = [];
	try {
		results = await commandBarSearch(query);
	} catch (e) {
		commandBarTrace("query failed: " + e.message);
	}
	if (message.seq < commandBarLatestSeq) {
		return;
	}
	commandBarLastQuery = query;
	var picking = Boolean(commandBarTarget && commandBarTarget.pick);
	var autocomplete = query.trim() && !picking ? commandBarAutocomplete(query, results[0]) : "";
	var reply = { action: "command_bar_results", seq: message.seq, results: results, autocomplete: autocomplete };
	// The tip shows only while nothing is typed, below the rows.
	if (!query.trim() && !picking && commandBarTip) {
		reply.tip = commandBarTip;
	}
	sendToNativeHost(reply);
	commandBarTrace("answered \"" + query + "\" with " + results.length + " rows (" +
		results.map(function(result) { return result.kind; }).join(" ") + "), " +
		commandBarClosedCount + " closed tabs, in " + (Date.now() - startedAt) + " ms");
	if (await commandBarAddFavicons(results) && message.seq === commandBarLatestSeq) {
		sendToNativeHost(Object.assign({}, reply, { refresh: true }));
	}
};

// Written to the app's debug log, which is easier to reach than the worker's console.
var commandBarTrace = function(text) {
	log("CommandBar::" + text);
	sendToNativeHost({ action: "log", message: "CommandBar: " + text });
};

// Open what was chosen. With no row chosen, typed text is opened or searched as typed, and an
// empty Cmd+T bar opens a plain new tab.
var commandBarChoose = async function(message) {
	var target = commandBarTarget;
	commandBarTarget = null;
	commandBarTip = null;
	if (!target) {
		return;
	}
	var text = (message.text || "").trim();
	var item = message.item || (text ? commandBarDefaultRow(text) : null);
	commandBarRetireUsedTip(item);
	if (!target.pick) {
		rankRemember(commandBarLastQuery, item);
	}
	var newTab = target.mode === "new_tab";
	littleArcCommandBarOpening();
	try {
		if (target.pick) {
			await commandBarChoosePick(target, item, text);
		} else if (item && item.kind === "command" && item.pick) {
			commandBarAskPick(target, item.pick);
		} else if (!item) {
			if (newTab) {
				await chrome.tabs.create({ windowId: target.windowId });
			}
		} else if (item.kind === "command" && item.command) {
			await commandBarRunCommand(item.command, target);
		} else if (item.kind === "tab") {
			var tab = await chrome.tabs.get(item.tabId);
			await chrome.windows.update(tab.windowId, { focused: true });
			await chrome.tabs.update(tab.id, { active: true });
		} else if (item.kind === "closed") {
			await chrome.sessions.restore(item.sessionId);
		} else if (item.kind === "search") {
			if (newTab || target.tabId === null) {
				await chrome.search.query({ text: item.text, disposition: "NEW_TAB" });
			} else {
				await chrome.search.query({ text: item.text, tabId: target.tabId });
			}
		} else if (newTab || target.tabId === null) {
			await chrome.tabs.create({ windowId: target.windowId, url: item.url });
		} else {
			await chrome.tabs.update(target.tabId, { url: item.url });
		}
	} catch (e) {
		log("CommandBar::Could not open the choice: " + e.message);
	}
};

var commandBarRunCommand = async function(command, target) {
	var tabId = target.tabId;
	switch (command) {
	case "close-tab":
		await chrome.tabs.remove(tabId);
		break;
	case "pin-tab":
		await chrome.tabs.update(tabId, { pinned: !target.pinned });
		break;
	case "duplicate-tab":
		await chrome.tabs.duplicate(tabId);
		break;
	case "mute-tab":
		await chrome.tabs.update(tabId, { muted: !target.muted });
		break;
	case "reload-tab":
		await chrome.tabs.reload(tabId);
		break;
	case "move-tab-to-new-window":
		await chrome.windows.create({ tabId: tabId });
		break;
	case "copy-url":
		// The app owns the clipboard and shows the same toast as Cmd+Shift+C.
		var tab = await chrome.tabs.get(tabId);
		sendToNativeHost({ action: "url_copied", url: tab.url, title: tab.title || "" });
		break;
	case "site-settings":
		// The page where Chrome keeps this site's permissions, such as automatic picture-in-picture.
		var site = await chrome.tabs.get(tabId);
		var origin = /^https?:\/\/[^\/?#]+/i.exec(site.url || "");
		await chrome.tabs.create({ windowId: target.windowId, openerTabId: tabId, url: origin ?
			"chrome://settings/content/siteDetails?site=" + encodeURIComponent(origin[0]) : "chrome://settings/content" });
		break;
	case "open-in-little-arc":
		await littleArcOpen(tabId, target.windowId);
		break;
	case "move-to-main-window":
		await littleArcMoveToMain(tabId);
		break;
	case "new-little-arc":
		await littleArcNew(target.windowId);
		break;
	case "exit-split-view":
		await chrome.tabs.unsplit(target.splitViewId);
		break;
	case "ungroup-tab":
		await chrome.tabs.ungroup(tabId);
		break;
	case "reopen-closed-tab":
		await chrome.sessions.restore();
		break;
	case "new-window":
		await chrome.windows.create({});
		break;
	case "new-incognito-window":
		await chrome.windows.create({ incognito: true });
		break;
	case "full-screen":
		var win = await chrome.windows.get(target.windowId);
		await chrome.windows.update(target.windowId, { state: win.state === "fullscreen" ? "normal" : "fullscreen" });
		break;
	default:
		log("CommandBar::Unknown command " + command);
	}
};

// A command that needs a second choice keeps the bar open and asks for it: the tab to split
// with, or the group to add the tab to. The next queries are answered from `pick`.
var commandBarAskPick = function(target, pick) {
	var definition = COMMAND_BAR_COMMANDS.find(function(command) { return command.pick === pick; });
	commandBarTarget = Object.assign({}, target, { pick: pick });
	sendToNativeHost({ action: "show_command_bar", mode: target.mode, text: "", placeholder: definition.placeholder });
};

// The rows of a second choice.
var commandBarPickResults = async function(query, target) {
	var text = query.trim();
	var rows;
	if (target.pick === "split") {
		rows = await commandBarSplitRows(text, target);
	} else if (target.pick === "group") {
		rows = await commandBarGroupRows(text, target);
	} else {
		rows = [];
	}
	if (target.pick === "group" || target.pick === "new-group") {
		rows.push({ kind: "new-group", title: text || "Unnamed group", detail: "New Tab Group", hint: "",
			text: text, symbol: "folder.badge.plus" });
	}
	return rows.slice(0, COMMAND_BAR_MAX_RESULTS);
};

// The tabs to split with, this window's first, and a row that opens the typed text beside the
// tab instead. With nothing typed, the first row opens a new tab beside it.
var commandBarSplitRows = async function(text, target) {
	var here = await chrome.tabs.get(target.tabId);
	var tabs = (await chrome.tabs.query({ windowType: "normal" })).filter(function(tab) {
		return tab.id !== here.id && Boolean(tab.incognito) === Boolean(here.incognito);
	});
	var scored = tabs.map(function(tab) {
		var match = text ? commandBarMatchScore(text, tab.title, tab.url || "") : 0;
		return { tab: tab, score: match + (tab.windowId === here.windowId ? 1 : 0) };
	}).filter(function(entry) { return entry.score >= 0 && (!text || entry.score > 1); });
	scored.sort(function(a, b) {
		return b.score - a.score || a.tab.windowId - b.tab.windowId || a.tab.index - b.tab.index;
	});
	var rows = [];
	if (!text) {
		rows.push({ kind: "new-tab", title: "New Tab", detail: "Beside this tab", hint: "", symbol: "plus" });
	}
	scored.forEach(function(entry) {
		var tab = entry.tab;
		rows.push({ kind: "tab", title: tab.title || commandBarDisplayUrl(tab.url || ""),
			detail: commandBarDisplayUrl(tab.url || ""), hint: tab.windowId === here.windowId ? "Split" : "Other Window",
			url: tab.url, tabId: tab.id });
	});
	if (text) {
		rows.splice(Math.min(rows.length, COMMAND_BAR_MAX_RESULTS - 1), 0, commandBarDefaultRow(text));
	}
	return rows;
};

// The groups the tab can join, this window's first, matched against the typed name.
var commandBarGroupRows = async function(text, target) {
	if (!chrome.tabGroups) {
		return [];
	}
	var found = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({ windowType: "normal" })]);
	var counts = new Map();
	found[1].forEach(function(tab) {
		if (tab.groupId !== undefined && tab.groupId !== -1) {
			counts.set(tab.groupId, (counts.get(tab.groupId) || 0) + 1);
		}
	});
	var words = text.toLowerCase().split(/\s+/).filter(Boolean);
	var groups = found[0].filter(function(group) {
		var title = (group.title || "").toLowerCase();
		return group.id !== target.groupId && counts.has(group.id) &&
			words.every(function(word) { return commandBarWordStart(title, word) !== -1; });
	});
	groups.sort(function(a, b) {
		return (b.windowId === target.windowId) - (a.windowId === target.windowId);
	});
	return groups.map(function(group) {
		var count = counts.get(group.id);
		var color = group.color ? group.color[0].toUpperCase() + group.color.slice(1) : "";
		return { kind: "group", title: group.title || "Unnamed group",
			detail: (color ? color + ", " : "") + count + (count === 1 ? " tab" : " tabs"),
			hint: group.windowId === target.windowId ? "Group" : "Other Window", groupId: group.id, symbol: "folder" };
	});
};

// Act on the second choice. Enter with no row chosen takes the typed text: a new split tab that
// opens it, or a new group named after it.
var commandBarChoosePick = async function(target, item, text) {
	if (target.pick === "split") {
		if (!item || item.kind === "new-tab") {
			await commandBarSplitWithNew(target, null);
		} else if (item.kind === "tab") {
			await commandBarSplitWith(target, item.tabId);
		} else {
			await commandBarSplitWithNew(target, item);
		}
	} else if (item && item.kind === "group") {
		var group = await chrome.tabGroups.get(item.groupId);
		if (group.windowId !== target.windowId) {
			await chrome.tabs.move(target.tabId, { windowId: group.windowId, index: -1 });
		}
		await chrome.tabs.group({ groupId: item.groupId, tabIds: target.tabId });
		await commandBarShowTab(target.tabId);
	} else {
		var name = item && item.kind === "new-group" ? item.text : text;
		var groupId = await chrome.tabs.group({ tabIds: target.tabId });
		if (name) {
			await chrome.tabGroups.update(groupId, { title: name });
		}
	}
};

var commandBarShowTab = async function(tabId) {
	var tab = await chrome.tabs.update(tabId, { active: true });
	await chrome.windows.update(tab.windowId, { focused: true });
};

// A tab already in a split view must leave it before it can join another.
var commandBarLeaveSplit = async function(tab) {
	if (tab.splitViewId !== undefined && tab.splitViewId !== -1) {
		await chrome.tabs.unsplit(tab.splitViewId);
	}
};

// Split the bar's tab with another open tab. Chrome splits only neighbouring tabs of one window
// with the same pinned state and group, so the other tab is moved next to it and matched first.
var commandBarSplitWith = async function(target, otherId) {
	var here = await chrome.tabs.get(target.tabId);
	var other = await chrome.tabs.get(otherId);
	await commandBarLeaveSplit(here);
	if (other.splitViewId !== here.splitViewId) {
		await commandBarLeaveSplit(other);
	}
	if (other.pinned !== here.pinned) {
		await chrome.tabs.update(other.id, { pinned: here.pinned });
	}
	other = await commandBarMoveBeside(here.id, other.id);
	if (other.groupId !== here.groupId) {
		if (here.groupId === -1) {
			await chrome.tabs.ungroup(other.id);
		} else {
			await chrome.tabs.group({ groupId: here.groupId, tabIds: other.id });
		}
		await commandBarMoveBeside(here.id, other.id);
	}
	await chrome.tabs.createSplit([here.id, other.id]);
	await commandBarShowTab(here.id);
};

// Move tab `otherId` right after tab `hereId`, unless it is already next to it. Returns it.
var commandBarMoveBeside = async function(hereId, otherId) {
	var here = await chrome.tabs.get(hereId);
	var other = await chrome.tabs.get(otherId);
	if (other.windowId === here.windowId && Math.abs(other.index - here.index) === 1) {
		return other;
	}
	// The index is where the tab ends up, counted after it leaves its old place.
	var index = other.windowId === here.windowId && other.index < here.index ? here.index : here.index + 1;
	await chrome.tabs.move(other.id, { windowId: here.windowId, index: index });
	return chrome.tabs.get(other.id);
};

// Split the bar's tab with a new tab, which opens `item` (an address or a search) or nothing.
var commandBarSplitWithNew = async function(target, item) {
	await commandBarLeaveSplit(await chrome.tabs.get(target.tabId));
	var properties = { splitWithTabId: target.tabId };
	if (item && item.url) {
		properties.url = item.url;
	}
	var tab = await chrome.tabs.create(properties);
	if (item && item.kind === "search") {
		await chrome.search.query({ text: item.text, tabId: tab.id });
	}
};

var commandBarClosed = function() {
	commandBarTarget = null;
	commandBarTip = null;
};

commandBarLoadHistory();
