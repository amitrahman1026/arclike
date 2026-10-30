/**
 * How the command bar ranks pages, modelled on Arc's command bar. Each page gets features
 * between 0 and 1. Its score is the weighted average of how it matches and how much it is used,
 * plus bonuses for where it is: an open tab, a closed tab, a bookmark, or a page chosen before for
 * this text. The weights were tuned against the choices Arc recorded in its own command bar
 * (tools/rank-eval.cjs).
 *
 * The bar also remembers what you chose for what you typed, as Arc and Chrome's omnibox do. A
 * page chosen for "gi" ranks high the next time you type "gi", or "g".
 */

var RANK_WEIGHTS = {
	host: 3,          // the site's name starts with the query (half for a subdomain)
	title: 1,         // the title starts with the query (half for a later word)
	coverage: 1,      // how much of the site's name or the title the query covers
	exact: 1.6,       // matched without typos
	frequency: 1.5,   // visits, on a log scale up to 100
	typed: 1,         // times the address was typed
	// Halves every day since the last visit. Arc's data favours how often over how lately, so
	// this only breaks ties.
	recency: 0.02
};
// Added to the average. A bonus does not dilute the others the way a weight would.
var RANK_BONUSES = {
	tab: 0.3,
	closed: 0.1,
	bookmark: 0.05,
	switched: 0.1,    // open tabs you switched to lately, by Ctrl+Tab order
	remembered: 1.25  // chosen before for this text
};
// A page that scores at least this goes above the search row, so Enter opens it.
var RANK_LEAD = 0.5;
var RANK_RECENCY_HALF_LIFE_HOURS = 24;

// The features of a page for `query`. `fuzzy` says the page matched only with typos. `context`
// holds what the page alone does not say: `switched(tabId)` and `remembered` (url key ->
// strength).
var rankFeatures = function(query, kind, item, title, url, fuzzy, context) {
	var q = query.trim().toLowerCase();
	var lowerTitle = (title || "").toLowerCase();
	var host = commandBarHost(url);
	// "youtube.com" is "youtube" to someone typing it.
	var siteName = host.replace(/\.[a-z]{2,63}$/, "") || host;
	var hostStart = host.indexOf(q) === 0;
	var titleIndex = commandBarWordStart(lowerTitle, q);
	var coverage = Math.max(hostStart ? q.length / siteName.length : 0,
		titleIndex !== -1 && lowerTitle ? q.length / lowerTitle.length : 0);
	var now = context && context.now || Date.now();
	var ageHours = Math.max(0, (now - (item.lastVisitTime || 0)) / (60 * 60 * 1000));
	return {
		host: hostStart ? 1 : host.indexOf("." + q) !== -1 ? 0.5 : 0,
		title: titleIndex === 0 ? 1 : titleIndex > 0 ? 0.5 : 0,
		coverage: Math.min(1, coverage),
		exact: fuzzy ? 0 : 1,
		frequency: Math.min(1, Math.log1p(item.visitCount || 0) / Math.log1p(100)),
		typed: Math.min(1, (item.typedCount || 0) / 5),
		recency: item.lastVisitTime ? Math.pow(0.5, ageHours / RANK_RECENCY_HALF_LIFE_HOURS) : 0,
		tab: kind === "tab" ? 1 : 0,
		closed: kind === "closed" ? 1 : 0,
		bookmark: kind === "bookmark" ? 1 : 0,
		switched: kind === "tab" && context && context.switched ? context.switched(item.id) : 0,
		remembered: context && context.remembered ? context.remembered.get(commandBarUrlKey(url)) || 0 : 0
	};
};

// A page found in several sources, such as an open tab that is also in history, keeps the best
// of each feature.
var rankMergeFeatures = function(into, from) {
	Object.keys(from).forEach(function(name) {
		into[name] = Math.max(into[name] || 0, from[name]);
	});
	return into;
};

var rankScore = function(features) {
	var total = 0;
	var sum = 0;
	Object.keys(RANK_WEIGHTS).forEach(function(name) {
		total += RANK_WEIGHTS[name];
		sum += RANK_WEIGHTS[name] * (features[name] || 0);
	});
	var score = total > 0 ? sum / total : 0;
	Object.keys(RANK_BONUSES).forEach(function(name) {
		score += RANK_BONUSES[name] * (features[name] || 0);
	});
	return score;
};

// What was chosen for what was typed: { text, url, title } for a page, { text, search } for a
// search, with `at` (ms) and `count`. Oldest first. Kept in chrome.storage.local.
var RANK_MEMORY_LIMIT = 2000;
var RANK_MEMORY_HALF_LIFE_DAYS = 14;
var rankMemory = [];
var rankMemoryLoaded = new Promise(function(resolve) {
	chrome.storage.local.get("commandBarMemory", function(result) {
		var saved = result && result.commandBarMemory;
		if (Array.isArray(saved)) {
			rankMemory = saved;
		}
		resolve();
	});
});

var rankSaveMemory = function() {
	chrome.storage.local.set({ commandBarMemory: rankMemory });
};

var rankSameChoice = function(a, b) {
	return a.text === b.text && (a.url ? Boolean(b.url) && commandBarUrlKey(a.url) === commandBarUrlKey(b.url) :
		a.search === b.search);
};

// Add `entries` to the memory. One already there is counted again, and keeps its newest time.
var rankRememberAll = function(entries) {
	entries.forEach(function(entry) {
		var index = rankMemory.findIndex(function(old) { return rankSameChoice(old, entry); });
		if (index !== -1) {
			var old = rankMemory.splice(index, 1)[0];
			entry = Object.assign({}, old, entry, { count: (old.count || 1) + (entry.count || 1),
				at: Math.max(old.at || 0, entry.at || 0) });
		}
		rankMemory.push(entry);
	});
	rankMemory.sort(function(a, b) { return (a.at || 0) - (b.at || 0); });
	if (rankMemory.length > RANK_MEMORY_LIMIT) {
		rankMemory = rankMemory.slice(rankMemory.length - RANK_MEMORY_LIMIT);
	}
	rankSaveMemory();
};

// Add the `entries` the memory does not hold yet, such as Arc's choices on a second import.
// Returns how many are new. `dryRun` only counts them.
var rankImport = function(entries, dryRun) {
	var fresh = entries.filter(function(entry) {
		return !rankMemory.some(function(old) { return rankSameChoice(old, entry); });
	});
	if (!dryRun && fresh.length) {
		rankRememberAll(fresh);
	}
	return fresh.length;
};

// Remember that `item` was chosen for the typed `text`. Commands and typed addresses are not
// remembered: they are found the same way every time.
var rankRemember = function(text, item, now) {
	text = (text || "").trim().toLowerCase();
	if (!text || !item || commandBarTypedUrl(text)) {
		return;
	}
	var entry = { text: text, at: now || Date.now(), count: 1 };
	if (item.kind === "search" && item.text) {
		entry.search = item.text;
	} else if (item.url && item.kind !== "command") {
		entry.url = item.url;
		entry.title = item.title || "";
	} else {
		return;
	}
	rankRememberAll([entry]);
};

// How strongly the memory suggests each choice for `text`: an entry counts when what was typed
// then starts with `text`. It counts far more when `text` is all or nearly all of it, and more
// the more often it was chosen and the more recently. Returns { pages: url key -> {strength, url, title},
// searches: [{text, strength}], searchHere: strength of searching `text` itself }.
var rankRecall = function(text, now) {
	var q = (text || "").trim().toLowerCase();
	var recalled = { pages: new Map(), searches: [], searchHere: 0 };
	if (!q) {
		return recalled;
	}
	now = now || Date.now();
	var searches = new Map();
	rankMemory.forEach(function(entry) {
		if (!entry.text || entry.text.indexOf(q) !== 0) {
			return;
		}
		var ageDays = Math.max(0, (now - (entry.at || 0)) / (24 * 60 * 60 * 1000));
		var strength = Math.pow(q.length / entry.text.length, 3) *
			Math.min(1, 0.6 + 0.2 * ((entry.count || 1) - 1)) *
			Math.pow(0.5, ageDays / RANK_MEMORY_HALF_LIFE_DAYS);
		if (entry.url) {
			var key = commandBarUrlKey(entry.url);
			var page = recalled.pages.get(key);
			if (!page || page.strength < strength) {
				recalled.pages.set(key, { strength: strength, url: entry.url, title: entry.title });
			}
		} else if (entry.search) {
			var search = entry.search.trim();
			if (search.toLowerCase() === q) {
				recalled.searchHere = Math.max(recalled.searchHere, strength);
			} else {
				searches.set(search, Math.max(searches.get(search) || 0, strength));
			}
		}
	});
	searches.forEach(function(strength, search) {
		recalled.searches.push({ text: search, strength: strength });
	});
	recalled.searches.sort(function(a, b) { return b.strength - a.strength; });
	return recalled;
};

// Arc keeps the last choice for each text typed into its command bar in
// StorableCommandBarAdditionalRanking.json. The app sends them as {query, type, url, title,
// search, selectedAt}, with selectedAt in seconds since 2001 (Apple's reference date).
var RANK_APPLE_EPOCH_MS = 978307200000;
var rankFromArcPicks = function(picks) {
	var entries = [];
	(picks || []).forEach(function(pick) {
		var text = (pick.query || "").trim().toLowerCase();
		if (!text || commandBarTypedUrl(text)) {
			return;
		}
		var entry = { text: text, at: RANK_APPLE_EPOCH_MS + (pick.selectedAt || 0) * 1000, count: 1 };
		if (pick.url && !/search/i.test(pick.type || "")) {
			entry.url = pick.url;
			entry.title = pick.title || "";
		} else if (pick.search) {
			entry.search = pick.search;
		} else {
			return;
		}
		entries.push(entry);
	});
	return entries;
};
