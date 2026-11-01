/**
 * Little Arc: a small popup window for a quick look at one page, the way Arc opens links from
 * other apps. Command bar commands move a tab into one and back. With the option on, a link
 * opened from another app goes into one too.
 */

var LITTLE_ARC_MAX_WIDTH = 1000;
var LITTLE_ARC_MAX_HEIGHT = 800;
// A tab that appears this soon after Chrome comes to the front was most likely opened by the
// app you were in, such as a link clicked in Slack or Mail.
var LITTLE_ARC_ACTIVATION_MS = 1500;
// Tabs the command bar opens are never taken for links from other apps. Its panel takes the
// keyboard from Chrome, so Chrome counts as coming back to the front when the bar closes.
var LITTLE_ARC_COMMAND_BAR_MS = 2000;

var littleArcForLinks = false;
var littleArcChromeActive = true;
var littleArcActivatedAt = 0;
var littleArcCommandBarAt = 0;
var littleArcInFront = false;   // a Little Arc of this profile has focus, as last told to the app

var littleArcOptionLoaded = new Promise(function(resolve) {
	chrome.storage.local.get("littleArcForLinks", function(data) {
		littleArcForLinks = Boolean(data && data.littleArcForLinks);
		resolve();
	});
});

// Written to the app's log too, where the decisions on links are easier to read.
var littleArcTrace = function(text) {
	log("LittleArc::" + text);
	sendToNativeHost({ action: "log", message: "LittleArc: " + text });
};

chrome.storage.onChanged.addListener(function(changes, area) {
	if (area === "local" && changes.littleArcForLinks) {
		littleArcForLinks = Boolean(changes.littleArcForLinks.newValue);
	}
});

chrome.windows.onFocusChanged.addListener(function(windowId) {
	if (littleArcForLinks) {
		littleArcTrace("focus " + (windowId === chrome.windows.WINDOW_ID_NONE ? "left Chrome" : "on window " + windowId));
	}
	littleArcTellFocus(windowId);
	if (windowId === chrome.windows.WINDOW_ID_NONE) {
		littleArcChromeActive = false;
	} else {
		if (!littleArcChromeActive) {
			littleArcActivatedAt = Date.now();
		}
		littleArcChromeActive = true;
	}
});

// Tell the app whether a Little Arc is in front, so it takes Cmd+O (Ctrl+O on Windows) only
// then. Chrome keeps Cmd+O for Open File everywhere else.
var littleArcTellFocus = async function(windowId) {
	var inFront = false;
	if (windowId !== chrome.windows.WINDOW_ID_NONE) {
		var win = await chrome.windows.get(windowId).catch(function() { return null; });
		inFront = Boolean(win && win.type === "popup");
	}
	if (inFront !== littleArcInFront) {
		littleArcInFront = inFront;
		sendToNativeHost({ action: "little_arc_focus", focused: inFront });
	}
};

// Cmd+O (Ctrl+O on Windows), sent by the app while a Little Arc is in front: move its tab to the main window.
var littleArcToMainFromKey = async function() {
	try {
		var win = await chrome.windows.getLastFocused({ windowTypes: ["popup"], populate: true });
		var tab = win && win.focused && win.type === "popup" && win.tabs.find(function(t) { return t.active; });
		if (tab) {
			await littleArcMoveToMain(tab.id);
		}
	} catch (e) {
		log("LittleArc::Could not move to the main window: " + e.message);
	}
};

// Called by the command bar just before it opens a choice.
var littleArcCommandBarOpening = function() {
	littleArcCommandBarAt = Date.now();
};

// Whether a new tab looks like a link opened from another app: no tab opened it, it is a web
// page, and Chrome was in the background or came to the front a moment ago.
var littleArcFromOtherApp = function(tab, now) {
	var url = tab.pendingUrl || tab.url || "";
	if (tab.openerTabId !== undefined || !/^https?:/i.test(url)) {
		return false;
	}
	if (now - littleArcCommandBarAt < LITTLE_ARC_COMMAND_BAR_MS) {
		return false;
	}
	return !littleArcChromeActive || now - littleArcActivatedAt < LITTLE_ARC_ACTIVATION_MS;
};

chrome.tabs.onCreated.addListener(async function(tab) {
	var now = Date.now();
	await littleArcOptionLoaded;
	if (!littleArcForLinks) {
		return;
	}
	var fromOtherApp = littleArcFromOtherApp(tab, now);
	littleArcTrace("tab " + tab.id + " created: opener " + tab.openerTabId + ", web page " +
		/^https?:/i.test(tab.pendingUrl || tab.url || "") + ", Chrome in front " + littleArcChromeActive +
		", " + (now - littleArcActivatedAt) + " ms since it came to the front, " +
		(now - littleArcCommandBarAt) + " ms since the command bar -> " + (fromOtherApp ? "Little Arc" : "stays"));
	if (!fromOtherApp) {
		return;
	}
	try {
		var win = await chrome.windows.get(tab.windowId);
		if (win.type !== "normal") {
			return;
		}
		log("LittleArc::Opening a link from another app in Little Arc: tab " + tab.id);
		await littleArcOpen(tab.id, tab.windowId);
	} catch (e) {
		log("LittleArc::Could not move the tab: " + e.message);
	}
});

// Chrome reopens a closed tab in the kind of window it closed in, so Reopen Closed Tab (Cmd+Shift+T)
// brings a tab closed in a Little Arc back in a new popup. Move it to the main window, as Arc
// does. A popup that a page opened with window.open has an opener, and the popups Little Arc
// opens get their tab moved in, not created, so neither comes here.
chrome.tabs.onCreated.addListener(async function(tab) {
	var url = tab.pendingUrl || tab.url || "";
	if (tab.openerTabId !== undefined || !/^https?:/i.test(url) ||
		Date.now() - littleArcCommandBarAt < LITTLE_ARC_COMMAND_BAR_MS) {
		return;
	}
	try {
		var win = await chrome.windows.get(tab.windowId);
		if (win.type !== "popup") {
			return;
		}
		log("LittleArc::Moving reopened tab " + tab.id + " from a popup to the main window");
		await littleArcMoveToMain(tab.id);
	} catch (e) {
		log("LittleArc::Could not move the reopened tab: " + e.message);
	}
});

// The size and place of a Little Arc: centred over `near`, the window it opens from.
var littleArcBounds = function(near) {
	if (!near || near.width === undefined) {
		return { width: 900, height: 700 };
	}
	var width = Math.round(Math.min(LITTLE_ARC_MAX_WIDTH, Math.max(600, near.width * 0.6)));
	var height = Math.round(Math.min(LITTLE_ARC_MAX_HEIGHT, Math.max(500, near.height * 0.75)));
	return {
		width: width,
		height: height,
		left: Math.round(near.left + (near.width - width) / 2),
		top: Math.round(near.top + (near.height - height) / 2)
	};
};

// Move tab `tabId` into a new Little Arc over window `nearWindowId`.
var littleArcOpen = async function(tabId, nearWindowId) {
	var near = await chrome.windows.get(nearWindowId).catch(function() { return null; });
	return chrome.windows.create(Object.assign({ tabId: tabId, type: "popup", focused: true }, littleArcBounds(near)));
};

// Open an empty Little Arc and the command bar over it, to type where to go.
var littleArcNew = async function(nearWindowId) {
	var near = await chrome.windows.get(nearWindowId).catch(function() { return null; });
	var win = await chrome.windows.create(Object.assign({ url: "about:blank", type: "popup", focused: true },
		littleArcBounds(near)));
	// The bar opens over the focused window, so give the new one a moment to take focus.
	await new Promise(function(resolve) { setTimeout(resolve, 150); });
	var tab = win.tabs && win.tabs[0];
	commandBarShowFor("current_tab", win, tab);
};

// Put a Little Arc's tab in the last used normal window, or in a new one when there is none.
var littleArcMoveToMain = async function(tabId) {
	var main = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(function() { return null; });
	if (!main || main.type !== "normal") {
		await chrome.windows.create({ tabId: tabId, focused: true });
		return;
	}
	await chrome.tabs.move(tabId, { windowId: main.id, index: -1 });
	await chrome.tabs.update(tabId, { active: true });
	await chrome.windows.update(main.id, { focused: true });
};
