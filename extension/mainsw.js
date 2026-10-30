/**
 * Arclike - Chrome Extension Service Worker
 * Arc-style tab switching and command bar for Chrome. A fork of Tab Switcher
 * (github.com/nechemyaspitz/tab-switcher).
 */

importScripts("ranking.js");
importScripts("commandbar.js");
importScripts("littlearc.js");
importScripts("arcimport.js");

// Version checking
var EXTENSION_VERSION = chrome.runtime.getManifest().version;
// Upstream's version file describes Tab Switcher releases, so Arclike does not check it.
var VERSION_CHECK_URL = null;
var NATIVE_HOST_NAME = "com.amitrahman1026.arclike";

// MRU (Most Recently Used) tab tracking
var mru = [];
var initialized = false;

// Ctrl+Tab switcher contents (Arc/Zen-style): only the tabs visited during this browser
// session, most recent first. After a restart that is just the tab you land on, and the list
// grows as you visit more. The full MRU is still tracked underneath.
// Upper bound on the switcher's contents, set from the popup. 0 means no limit.
var DEFAULT_MAX_SWITCHER_TABS = 5;
var maxSwitcherTabs = DEFAULT_MAX_SWITCHER_TABS;
var visitedTabs = {};        // tabId -> true once the tab has been on screen this session
var visitedTabsLoaded = false;
var activeTabByWindow = {};  // windowId -> tabId currently active in that window

// Switch state
var slowSwitchOngoing = false;
var fastSwitchOngoing = false;
var nativeSwitchOngoing = false;
var intSwitchCount = 0;
var lastIntSwitchIndex = 0;
var slowswitchForward = false;

// Timer for legacy Alt shortcuts
var slowtimerValue = 1500;
var fasttimerValue = 200;
var timer;

// Debug logging (enabled for troubleshooting)
var loggingOn = true;

// Native messaging for Ctrl+Tab interception
var nativePort = null;
var nativeHostConnected = false;

// Thumbnail caching for visual tab switcher
var tabThumbnails = {}; // Map of tabId -> base64 thumbnail data
var tabThumbnailOrder = []; // Track order for LRU eviction
var MAX_THUMBNAILS = 20; // Limit memory usage - keep only 20 most recent thumbnails
var MAX_THUMBNAIL_CHARS = 1024 * 1024; // and at most ~2 MiB of UTF-16 string contents
var THUMBNAIL_MAX_PIXELS = 440; // cards are at most 220 CSS px wide, so this covers Retina
var thumbnailTimer;
var thumbnailCaptureInFlight = false;
var thumbnailGeneration = 0;
var lastThumbnailCapture = 0;

var log = function(str) {
	if(loggingOn) {
		console.log(str);
	}
}

// Opened on first install, when set. Upstream's page describes Tab Switcher's setup.
var SETUP_PAGE_URL = null;

// Initialize on install/update
chrome.runtime.onInstalled.addListener((details) => {
	log("Extension " + details.reason);
	
	// Open setup page on first install
	if (details.reason === "install" && SETUP_PAGE_URL) {
		chrome.tabs.create({ url: SETUP_PAGE_URL });
	}
	
	initialize();
});

var processCommand = function(command) {
	log('Command recd:' + command);
	var fastswitch = true;
	slowswitchForward = false;
	if(command == "alt_switch_fast") {
		fastswitch = true;
	} else if(command == "alt_switch_slow_backward") {
		fastswitch = false;
		slowswitchForward = false;
	} else if(command == "alt_switch_slow_forward") {
		fastswitch = false;
		slowswitchForward = true;
	}

	if(!slowSwitchOngoing && !fastSwitchOngoing) {

		if(fastswitch) {
			fastSwitchOngoing = true;
		} else {
			slowSwitchOngoing = true;
		}
			log("TabSwitch::START_SWITCH");
			intSwitchCount = 0;
			doIntSwitch();

	} else if((slowSwitchOngoing && !fastswitch) || (fastSwitchOngoing && fastswitch)){
		log("TabSwitch::DO_INT_SWITCH");
		doIntSwitch();

	} else if(slowSwitchOngoing && fastswitch) {
		endSwitch();
		fastSwitchOngoing = true;
		log("TabSwitch::START_SWITCH");
		intSwitchCount = 0;
		doIntSwitch();

	} else if(fastSwitchOngoing && !fastswitch) {
		endSwitch();
		slowSwitchOngoing = true;
		log("TabSwitch::START_SWITCH");
		intSwitchCount = 0;
		doIntSwitch();
	}

	if(timer) {
		if(fastSwitchOngoing || slowSwitchOngoing) {
			clearTimeout(timer);
		}
	}
	if(fastswitch) {
		timer = setTimeout(function() {endSwitch()},fasttimerValue);
	} else {
		timer = setTimeout(function() {endSwitch()},slowtimerValue);
	}

};

chrome.commands.onCommand.addListener(processCommand);

// Handle messages from popup
var pendingPingCallback = null;
var pingTimeout = null;

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	if (request.action === "get_connection_status") {
		sendResponse({ connected: nativeHostConnected && nativePort !== null });
		return true;
	}
	
	if (request.action === "arc_import") {
		handleArcImport(request).then(sendResponse);
		return true;
	}

	if (request.action === "get_version_info") {
		chrome.storage.local.get(["versionInfo"], function(result) {
			sendResponse(result.versionInfo || null);
		});
		return true;
	}

	if (request.action === "ping_native_host") {
		// Clear any previous pending ping
		if (pingTimeout) {
			clearTimeout(pingTimeout);
			pingTimeout = null;
		}
		if (pendingPingCallback) {
			pendingPingCallback = null;
		}
		
		// If no port or not connected, try to connect first
		if (!nativePort) {
			connectNativeHost();
		}
		
		if (!nativePort) {
			sendResponse({ connected: false });
			return true;
		}
		
		// Set up callback for pong response
		pendingPingCallback = function(success) {
			sendResponse({ connected: success });
		};
		
		// Set timeout for ping response
		pingTimeout = setTimeout(function() {
			if (pendingPingCallback) {
				pendingPingCallback(false);
				pendingPingCallback = null;
			}
		}, 2000);
		
		// Send ping
		try {
			sendToNativeHost({ action: "ping" });
		} catch (e) {
			log("Ping failed: " + e.message);
			if (pendingPingCallback) {
				pendingPingCallback(false);
				pendingPingCallback = null;
			}
			clearTimeout(pingTimeout);
		}
		
		return true; // Keep channel open for async response
	}
});

chrome.runtime.onStartup.addListener(function () {
	log("Extension startup");
	initialize();
});

// ============================================
// Version Checking
// ============================================

var VERSION_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

function checkForUpdates() {
	if (!VERSION_CHECK_URL) {
		return;
	}
	log("Checking for updates...");
	fetch(VERSION_CHECK_URL, { cache: "no-cache" })
		.then(function(response) { return response.json(); })
		.then(function(data) {
			var isManualInstall = chrome.runtime.getManifest().update_url === undefined;
			var versionInfo = {
				currentVersion: EXTENSION_VERSION,
				latestExtensionVersion: data.extension ? data.extension.version : null,
				latestExtensionNotes: data.extension ? data.extension.releaseNotes : null,
				chromeWebStoreUrl: data.extension ? data.extension.chromeWebStoreUrl : null,
				latestAppVersion: data.app ? data.app.version : null,
				latestAppNotes: data.app ? data.app.releaseNotes : null,
				appDownloadUrl: data.app ? data.app.downloadUrl : null,
				isManualInstall: isManualInstall,
				lastChecked: Date.now()
			};
			chrome.storage.local.set({ versionInfo: versionInfo });
			log("Version check complete: current=" + EXTENSION_VERSION + ", latest=" + versionInfo.latestExtensionVersion + ", manual=" + isManualInstall);
		})
		.catch(function(err) {
			log("Version check failed: " + err.message);
		});
}

// Check on startup and every 6 hours
checkForUpdates();
setInterval(checkForUpdates, VERSION_CHECK_INTERVAL);


var doIntSwitch = function() {
	log("TabSwitch:: in int switch, intSwitchCount: "+intSwitchCount+", mru.length: "+mru.length);
	if (intSwitchCount < mru.length && intSwitchCount >= 0) {
		var tabIdToMakeActive;
		//check if tab is still present
		//sometimes tabs have gone missing
		var invalidTab = true;
		var thisWindowId;
		if(slowswitchForward) {
			decrementSwitchCounter();	
		} else {
			incrementSwitchCounter();	
		}
		tabIdToMakeActive = mru[intSwitchCount];
		chrome.tabs.get(tabIdToMakeActive, function(tab) {
			if(tab) {
				thisWindowId = tab.windowId;
				invalidTab = false;

				chrome.windows.update(thisWindowId, {"focused":true});
				chrome.tabs.update(tabIdToMakeActive, {active:true, highlighted: true});
				lastIntSwitchIndex = intSwitchCount;
				//break;
			} else {
				log("TabSwitch:: in int switch, >>invalid tab found.intSwitchCount: "+intSwitchCount+", mru.length: "+mru.length);
				removeItemAtIndexFromMRU(intSwitchCount);
				if(intSwitchCount >= mru.length) {
					intSwitchCount = 0;
				}
				doIntSwitch();
			}
		});	

		
	}
}

var endSwitch = function() {
	log("TabSwitch::END_SWITCH");
	slowSwitchOngoing = false;
	fastSwitchOngoing = false;
	nativeSwitchOngoing = false;
	var tabId = mru[lastIntSwitchIndex];
	putExistingTabToTop(tabId);
	printMRUSimple();
}

// chrome.storage.session lasts as long as the browser session, so the visited list survives
// the service worker restarting but starts over when the browser does.
var saveVisitedTabs = function() {
	if (visitedTabsLoaded) {
		chrome.storage.session.set({ visitedTabs: Object.keys(visitedTabs).map(Number) });
	}
};

// Record that a tab is on screen now, which puts it in the switcher for the rest of the session.
var markTabVisited = function(tabId, windowId) {
	activeTabByWindow[windowId] = tabId;
	if (!visitedTabs[tabId]) {
		visitedTabs[tabId] = true;
		saveVisitedTabs();
	}
};

chrome.tabs.onActivated.addListener(function(activeInfo){
	// Note: By the time this fires, the new tab is already visible
	// So we capture the NEW tab's thumbnail (the one we just switched to)
	// This ensures each tab's thumbnail is captured while it's visible
	markTabVisited(activeInfo.tabId, activeInfo.windowId);

	if(!slowSwitchOngoing && !fastSwitchOngoing && !nativeSwitchOngoing) {
		var index = mru.indexOf(activeInfo.tabId);

		//probably should not happen since tab created gets called first than activated for new tabs,
		// but added as a backup behavior to avoid orphan tabs
		if(index == -1) {
			log("Unexpected scenario hit with tab("+activeInfo.tabId+").")
			addTabToMRUAtFront(activeInfo.tabId)
		} else {
			putExistingTabToTop(activeInfo.tabId);	
		}
		
		// Capture thumbnail of the tab we just switched TO (after a brief delay for render)
		scheduleThumbnailCapture(activeInfo.tabId, activeInfo.windowId);
	}
});

// Update thumbnail when page finishes loading
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	if (changeInfo.status === 'complete' && tab.active) {
		// Page finished loading, capture a fresh thumbnail after a short delay
		scheduleThumbnailCapture(tabId, tab.windowId);
	}
});

chrome.tabs.onCreated.addListener(function(tab) {
	log("Tab create event fired with tab("+tab.id+")");
	addTabToMRUAfterCurrent(tab);
});

chrome.tabs.onRemoved.addListener(function(tabId, removedInfo) {
	log("Tab remove event fired from tab("+tabId+")");
	removeTabFromMRU(tabId);
	if (visitedTabs[tabId]) {
		delete visitedTabs[tabId];
		saveVisitedTabs();
	}
	for (var winId in activeTabByWindow) {
		if (activeTabByWindow[winId] === tabId) {
			delete activeTabByWindow[winId];
		}
	}
	// Clean up thumbnail when tab is closed
	delete tabThumbnails[tabId];
	var thumbIndex = tabThumbnailOrder.indexOf(tabId);
	if (thumbIndex !== -1) {
		tabThumbnailOrder.splice(thumbIndex, 1);
	}
});


// Insert a newly created tab directly behind the tab it was opened from, so with MRU
// [1, 2, 3] a Cmd+click on tab 1 that opens tab 4 gives [1, 4, 2, 3]. The opener is
// preferred; failing that, the active tab of the new tab's window, then the MRU head. If
// the tab is opened in the foreground, onActivated then moves it to the front as usual. A tab
// opened in the background joins the switcher only once it is visited.
var addTabToMRUAfterCurrent = function(tab) {
	if (mru.indexOf(tab.id) !== -1) {
		return;
	}
	var anchors = [tab.openerTabId, activeTabByWindow[tab.windowId], mru[0]];
	var insertAt = mru.length;
	for (var i = 0; i < anchors.length; i++) {
		if (anchors[i] === undefined) {
			continue;
		}
		var anchorIndex = mru.indexOf(anchors[i]);
		if (anchorIndex !== -1) {
			insertAt = anchorIndex + 1;
			break;
		}
	}
	mru.splice(insertAt, 0, tab.id);
	log("Tab(" + tab.id + ") inserted into MRU at " + insertAt + ": " + mru);
}
	
var addTabToMRUAtFront = function(tabId) {

	var index = mru.indexOf(tabId);
	if(index == -1) {
		//add to the front of mru
		mru.splice(0, 0,tabId);
	}
	
}
var putExistingTabToTop = function(tabId){
	var index = mru.indexOf(tabId);
	if(index != -1) {
		mru.splice(index, 1);
		mru.unshift(tabId);
	}
}

var removeTabFromMRU = function(tabId) {
	var index = mru.indexOf(tabId);
	if(index != -1) {
		mru.splice(index, 1);
	}
}

var removeItemAtIndexFromMRU = function(index) {
	if(index < mru.length) {
		mru.splice(index, 1);
	}
}

var incrementSwitchCounter = function() {
	intSwitchCount = (intSwitchCount+1)%mru.length;
}

var decrementSwitchCounter = function() {
	if(intSwitchCount == 0) {
		intSwitchCount = mru.length - 1;
	} else {
		intSwitchCount = intSwitchCount - 1;
	}
}

var initialize = function() {

	if(!initialized) {
		initialized = true;
		chrome.windows.getAll({populate:true},function(windows){
			var tabs = [];
			windows.forEach(function(window){
				window.tabs.forEach(function(tab){
					tabs.push(tab);
					if (tab.active) {
						markTabVisited(tab.id, window.id);
					}
				});
			});
			// Chrome records when each tab was last looked at, so the MRU starts out correct
			// instead of guessing after a restart.
			mru = tabs
				.sort(function(a, b){ return (b.lastAccessed || 0) - (a.lastAccessed || 0); })
				.map(function(tab){ return tab.id; });
			log("MRU after init: "+mru);
		});
	}
}	

var printMRUSimple = function() {
	log("mru: " + mru);
}

// ============================================
// Thumbnail Capture for Visual Tab Switcher
// ============================================

// Coalesce activation and load bursts into a single capture, and stay under Chrome's
// captureVisibleTab rate limit.
var scheduleThumbnailCapture = function(tabId, windowId) {
	clearTimeout(thumbnailTimer);
	var generation = ++thumbnailGeneration;
	thumbnailTimer = setTimeout(function() {
		captureThumbnail(tabId, windowId, generation);
	}, Math.max(500, 1000 - (Date.now() - lastThumbnailCapture)));
};

// Capture the visible tab and downsample it before caching. The raw screenshot is the size of
// the display, so keeping it is what made both this worker and the native app grow unbounded.
var captureThumbnail = async function(tabId, windowId, generation) {
	if (generation === undefined) {
		generation = thumbnailGeneration;
	}
	if (thumbnailCaptureInFlight) {
		// Chrome serialises captures anyway; queue behind the one in flight.
		scheduleThumbnailCapture(tabId, windowId);
		return;
	}
	thumbnailCaptureInFlight = true;
	var bitmap = null;
	var canvas = null;
	try {
		var tab = await chrome.tabs.get(tabId);
		var win = await chrome.windows.get(windowId);
		// Only an active tab in a focused, unminimised window can actually be captured, and
		// restricted URLs never yield an image.
		if (generation !== thumbnailGeneration || !tab.active || tab.windowId !== windowId ||
			!win.focused || win.state === 'minimized' || !/^https?:/.test(tab.url || '')) {
			return;
		}

		lastThumbnailCapture = Date.now();
		var dataUrl = await chrome.tabs.captureVisibleTab(windowId, {format: 'jpeg', quality: 40});
		var blob = await (await fetch(dataUrl)).blob();
		bitmap = await createImageBitmap(blob);
		dataUrl = null;
		blob = null;

		var scale = Math.min(1, THUMBNAIL_MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
		canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)),
			Math.max(1, Math.round(bitmap.height * scale)));
		canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		bitmap = null;

		var resized = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.6});
		var bytes = new Uint8Array(await resized.arrayBuffer());
		var encoded = 'data:image/jpeg;base64,' + btoa(Array.from(bytes, function(byte) {
			return String.fromCharCode(byte);
		}).join(''));

		// The tab can be switched away from, navigated or closed while the capture and the
		// encode are in flight, which would cache one tab's picture under another tab's id.
		var current = await chrome.tabs.get(tabId);
		if (generation !== thumbnailGeneration || !current.active ||
			current.url !== tab.url || current.windowId !== windowId) {
			log("Discarding stale thumbnail for tab " + tabId);
			return;
		}

		var existingIndex = tabThumbnailOrder.indexOf(tabId);
		if (existingIndex !== -1) {
			tabThumbnailOrder.splice(existingIndex, 1);
		}
		tabThumbnailOrder.unshift(tabId);
		tabThumbnails[tabId] = encoded;

		var totalChars = 0;
		for (var id in tabThumbnails) {
			totalChars += tabThumbnails[id].length;
		}
		// Always keep the newest preview: a single image larger than the whole budget would
		// otherwise empty the cache on every capture.
		while (tabThumbnailOrder.length > 1 &&
			(tabThumbnailOrder.length > MAX_THUMBNAILS || totalChars > MAX_THUMBNAIL_CHARS)) {
			var oldest = tabThumbnailOrder.pop();
			totalChars -= tabThumbnails[oldest] ? tabThumbnails[oldest].length : 0;
			delete tabThumbnails[oldest];
			log("Evicted old thumbnail for tab " + oldest);
		}

		log("Captured thumbnail for tab " + tabId + " (" + encoded.length + " chars, " +
			tabThumbnailOrder.length + " cached)");
	} catch (e) {
		log("Thumbnail capture failed: " + e.message);
	} finally {
		if (bitmap) {
			bitmap.close();
		}
		if (canvas) {
			// Drop the canvas backing store rather than waiting for collection.
			canvas.width = 1;
			canvas.height = 1;
		}
		thumbnailCaptureInFlight = false;
	}
};

// Capture thumbnail of the current active tab (for initial capture)
var captureCurrentTabThumbnail = function() {
	chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
		if (tabs && tabs.length > 0) {
			scheduleThumbnailCapture(tabs[0].id, tabs[0].windowId);
		}
	});
};

// ============================================
// Native Messaging for Ctrl+Tab interception
// ============================================

// Detect which browser we're running in and return its bundle ID
var detectBrowserBundleId = function() {
	var ua = navigator.userAgent;
	
	// Check for specific browsers (order matters - check more specific first)
	if (ua.includes("Edg/")) {
		return "com.microsoft.edgemac";
	} else if (ua.includes("Brave")) {
		return "com.brave.Browser";
	} else if (ua.includes("Vivaldi")) {
		return "com.vivaldi.Vivaldi";
	} else if (ua.includes("OPR/") || ua.includes("Opera")) {
		// Check for Opera GX vs regular Opera
		if (ua.includes("OPGX")) {
			return "com.operasoftware.OperaGX";
		}
		return "com.operasoftware.Opera";
	} else if (ua.includes("Arc/")) {
		return "company.thebrowser.Browser";
	} else if (ua.includes("Helium")) {
		return "net.imput.helium";
	} else if (ua.includes("Chromium")) {
		return "org.chromium.Chromium";
	} else if (ua.includes("Chrome")) {
		// Generic Chrome - could be Google Chrome or other Chromium-based
		return "com.google.Chrome";
	}
	
	// Fallback - assume Chrome
	return "com.google.Chrome";
};

var browserBundleId = detectBrowserBundleId();
log("Detected browser: " + browserBundleId);

var connectNativeHost = function() {
	if (nativePort) {
		log("Native host already connected");
		return;
	}

	try {
		nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
		log("Connected to native host");

		nativePort.onMessage.addListener(function(message) {
			log("Native message received: " + JSON.stringify(message));
			
			// Mark connection as alive on any message
			nativeHostConnected = true;
			
			if (message.action === "ready") {
				log("Native host is ready, registering browser: " + browserBundleId);
				// Register this extension with its browser's bundle ID
				sendToNativeHost({ action: "register", bundleId: browserBundleId, extensionVersion: EXTENSION_VERSION,
					features: ["command_bar"] });
			} else if (message.action === "registered") {
				log("Successfully registered with native host for browser: " + message.bundleId);
				if (message.shortcuts) {
					chrome.storage.local.set({ shortcuts: message.shortcuts });
				}
			} else if (message.action === "pong") {
				// Ping response - connection is alive
				log("Received pong - connection alive");
				if (pendingPingCallback) {
					clearTimeout(pingTimeout);
					pendingPingCallback(true);
					pendingPingCallback = null;
					pingTimeout = null;
				}
			} else if (message.action === "cycle_next") {
				queueNativeSwitch(function() { return handleNativeCycle(1, message.current_window_only); });
			} else if (message.action === "cycle_prev") {
				queueNativeSwitch(function() { return handleNativeCycle(-1, message.current_window_only); });
			} else if (message.action === "end_switch") {
				queueNativeSwitch(handleNativeEndSwitch);
			} else if (message.action === "cancel_switch") {
				queueNativeSwitch(handleNativeCancelSwitch);
			} else if (message.action === "select_tab") {
				queueNativeSwitch(function() { return handleNativeSelectTab(message.tabId); });
			} else if (message.action === "copy_url") {
				handleCopyUrl();
			} else if (message.action === "command_bar_open") {
				commandBarOpen(message.mode);
			} else if (message.action === "command_bar_query") {
				commandBarQuery(message);
			} else if (message.action === "command_bar_choose") {
				commandBarChoose(message);
			} else if (message.action === "little_arc_to_main") {
				littleArcToMainFromKey();
			} else if (message.action === "command_bar_closed") {
				commandBarClosed();
			} else if (message.action === "command_bar_dismiss_tip") {
				commandBarDismissTip(message.id);
			} else if (message.action === "arc_data") {
				arcDataReceived(message);
			} else if (message.action === "error_no_accessibility") {
				log("Native host error: No accessibility permissions");
				nativeHostConnected = false;
			}
		});

		nativePort.onDisconnect.addListener(function() {
			log("Native host disconnected");
			if (chrome.runtime.lastError) {
				log("Native host error: " + chrome.runtime.lastError.message);
			}
			nativePort = null;
			nativeHostConnected = false;
			
			// Try to reconnect after a short delay
			setTimeout(connectNativeHost, 1000);
		});

	} catch (e) {
		log("Failed to connect to native host: " + e.message);
		nativePort = null;
		nativeHostConnected = false;
	}
};

// Send a message to the native host
var sendToNativeHost = function(message) {
	if (nativePort) {
		try {
			nativePort.postMessage(message);
			log("Sent to native host: " + JSON.stringify(message).substring(0, 200));
		} catch (e) {
			log("Error sending to native host: " + e.message);
		}
	} else {
		log("Cannot send to native host - not connected");
	}
};

// Track if UI has been shown during current switch
var uiShownDuringSwitch = false;

// The tabs offered by the switcher for the current switch, in the order they are shown
var filteredMru = [];
var currentWindowOnly = false;
var nativeSwitchWindowId = null;
// Bumped on every window focus change, so a switch that is still being set up can tell that
// the focus it was started for is gone.
var nativeSwitchFocusVersion = 0;

// Key presses, hover selections and the modifier release all mutate the same switch state, and
// starting a switch awaits a browser query, so they run one at a time in arrival order.
var nativeSwitchQueue = Promise.resolve();
var queueNativeSwitch = function(action) {
	nativeSwitchQueue = nativeSwitchQueue.then(action).catch(function(error) {
		log("TabSwitch::Native switch step failed: " + error.message);
		sendToNativeHost({action: "hide_switcher"});
		resetNativeSwitch();
	});
	return nativeSwitchQueue;
};

var resetNativeSwitch = function() {
	nativeSwitchOngoing = false;
	uiShownDuringSwitch = false;
	filteredMru = [];
	currentWindowOnly = false;
	nativeSwitchWindowId = null;
};

// Build the switcher's contents from one populated windows query: MRU order, trimmed to the
// visited tabs, with the cards assembled from the same tab objects. This replaces a
// per-tab window lookup plus a per-tab metadata lookup, so a switch costs one query in total.
var buildSwitcherTabs = function(windows, focusedWindow) {
	// Whatever is on screen in any window of this profile counts as visited.
	windows.forEach(function(win) {
		win.tabs.forEach(function(tab) {
			if (tab.active) {
				markTabVisited(tab.id, win.id);
			}
		});
	});

	var scope = currentWindowOnly ? [focusedWindow] : windows;
	var tabsById = new Map();
	scope.forEach(function(win) {
		win.tabs.forEach(function(tab) {
			tabsById.set(tab.id, tab);
		});
	});

	// MRU order first, then any tab whose create event has not reached the MRU yet.
	var ordered = mru.filter(function(id) { return tabsById.has(id); });
	tabsById.forEach(function(tab, id) {
		if (ordered.indexOf(id) === -1) {
			ordered.push(id);
		}
	});

	// Keep the visited tabs, never more than maxSwitcherTabs.
	var shown = [];
	for (var i = 0; i < ordered.length; i++) {
		if (maxSwitcherTabs > 0 && shown.length >= maxSwitcherTabs) {
			break;
		}
		if (visitedTabs[ordered[i]]) {
			shown.push(ordered[i]);
		}
	}
	log("TabSwitch::Showing " + shown.length + " visited of " + ordered.length + " tabs");

	return shown.map(function(id) {
		var tab = tabsById.get(id);
		return {
			id: id,
			title: tab.title || 'Untitled',
			favIconUrl: tab.favIconUrl || '',
			thumbnail: tabThumbnails[id] || null,
			url: tab.url || ''
		};
	});
};

// Check if any window from this profile is currently focused
// This is critical for multi-profile support - only the focused profile should respond
var isThisProfileFocused = async function() {
	try {
		// Get all windows in this profile
		var allWindows = await chrome.windows.getAll({windowTypes: ['normal']});
		log("TabSwitch::Profile has " + allWindows.length + " windows");
		
		for (var win of allWindows) {
			log("TabSwitch::  Window id=" + win.id + " focused=" + win.focused + " state=" + win.state);
			if (win.focused) {
				log("TabSwitch::This profile has a focused window (id=" + win.id + ")");
				return true;
			}
		}
		log("TabSwitch::This profile has NO focused windows - ignoring command");
		return false;
	} catch (e) {
		log("TabSwitch::Error checking focused windows: " + e.message);
		// If we can't check, assume we're not focused to avoid conflicts
		return false;
	}
};

// Handle cycle in either direction
// direction: 1 for next, -1 for prev
// The switcher is shown on the first press; there is no second phase to wait for.
var handleNativeCycle = async function(direction, windowOnly) {
	log("TabSwitch::NATIVE_CYCLE direction=" + direction + " currentWindowOnly=" + windowOnly);

	if (!nativeSwitchOngoing) {
		currentWindowOnly = windowOnly !== false; // Default to true (current window only)
		var focusVersion = nativeSwitchFocusVersion;
		// The focused flag on this query also tells us whether this profile owns the keypress,
		// which is what keeps several profiles from all reacting to the same Ctrl+Tab.
		var windows = await chrome.windows.getAll({populate: true, windowTypes: ['normal']});
		if (focusVersion !== nativeSwitchFocusVersion) {
			log("TabSwitch::Window focus changed while starting - ignoring cycle");
			return;
		}
		var focusedWindow = windows.find(function(win) { return win.focused; });
		if (!focusedWindow) {
			log("TabSwitch::This profile has NO focused window - ignoring command");
			return;
		}

		var tabs = buildSwitcherTabs(windows, focusedWindow);
		if (tabs.length === 0) {
			log("TabSwitch::No tabs to show");
			return;
		}

		nativeSwitchOngoing = true;
		uiShownDuringSwitch = true;
		nativeSwitchWindowId = focusedWindow.id;
		filteredMru = tabs.map(function(tab) { return tab.id; });
		intSwitchCount = (direction + filteredMru.length) % filteredMru.length;
		lastIntSwitchIndex = intSwitchCount;
		log("TabSwitch::Using " + (currentWindowOnly ? "current window" : "all windows") +
			", showing " + filteredMru.length + " tabs");
		sendToNativeHost({
			action: "show_switcher",
			tabs: tabs,
			selectedIndex: intSwitchCount
		});
		return;
	}

	if (filteredMru.length === 0) {
		return;
	}

	// Move the selection only; the tab is activated when the modifier is released.
	intSwitchCount = (intSwitchCount + direction + filteredMru.length) % filteredMru.length;
	lastIntSwitchIndex = intSwitchCount;
	sendToNativeHost({
		action: "update_selection",
		selectedIndex: intSwitchCount
	});
};

// Handle hover selection from the native switcher UI. Moves the current selection so that
// releasing the modifier (end_switch) activates the hovered tab, and further Tab presses
// continue cycling from there. The app names the tab rather than its position, so a list that
// changed since it was sent cannot select the wrong one.
var handleNativeSelectTab = function(tabId) {
	if (!nativeSwitchOngoing || !uiShownDuringSwitch) {
		log("TabSwitch::Ignoring select_tab - no switch in progress");
		return;
	}
	var index = filteredMru.indexOf(tabId);
	if (index === -1) {
		log("TabSwitch::Ignoring select_tab - tab is not in the switcher: " + tabId);
		return;
	}
	intSwitchCount = index;
	lastIntSwitchIndex = index;
	log("TabSwitch::SELECT_TAB from hover: tab " + tabId + " at index " + index);
};

var handleNativeEndSwitch = async function() {
	log("TabSwitch::NATIVE_END_SWITCH, switching to index: " + lastIntSwitchIndex);

	// Only handle end switch if we were the one doing the switch
	if (!nativeSwitchOngoing) {
		return;
	}

	if (uiShownDuringSwitch) {
		sendToNativeHost({
			action: "hide_switcher"
		});
	}

	// Read the target before clearing the switch state, and clear it before activating, so the
	// onActivated listener treats the activation as an ordinary tab switch.
	var tabIdToActivate = filteredMru[lastIntSwitchIndex];
	resetNativeSwitch();

	// Double-check we're still the focused profile before activating tabs
	var isFocused = await isThisProfileFocused();
	if (!isFocused) {
		log("TabSwitch::Ignoring end switch - this profile is no longer focused");
		return;
	}

	if (tabIdToActivate === undefined) {
		return;
	}

	// The selected tab may have been closed while the switcher was open.
	try {
		var tab = await chrome.tabs.get(tabIdToActivate);
		await chrome.windows.update(tab.windowId, {"focused": true});
		await chrome.tabs.update(tabIdToActivate, {active: true, highlighted: true});
		// Promote the tab that was actually activated. The old code indexed the full MRU with a
		// position from the switcher's own list, which promoted an unrelated tab whenever the
		// two differed, as they do whenever the list is filtered.
		putExistingTabToTop(tabIdToActivate);
		printMRUSimple();
	} catch (e) {
		log("TabSwitch::Selected tab is no longer available: " + e.message);
	}
};

// Esc was pressed while the modifier was still held. Dismiss the switcher and forget the
// in-progress selection; the active tab and the MRU are left exactly as they were.
var handleNativeCancelSwitch = function() {
	log("TabSwitch::NATIVE_CANCEL_SWITCH");
	if (!nativeSwitchOngoing) {
		return;
	}
	if (uiShownDuringSwitch) {
		sendToNativeHost({
			action: "hide_switcher"
		});
	}
	intSwitchCount = 0;
	lastIntSwitchIndex = 0;
	resetNativeSwitch();
};

var handleCopyUrl = async function() {
	log("TabSwitch::COPY_URL requested");
	var isFocused = await isThisProfileFocused();
	if (!isFocused) {
		log("TabSwitch::Ignoring copy_url - this profile is not focused");
		return;
	}
	try {
		var tabs = await chrome.tabs.query({active: true, currentWindow: true});
		if (tabs && tabs.length > 0) {
			var url = tabs[0].url;
			var title = tabs[0].title || '';
			log("TabSwitch::Sending URL to native host: " + url);
			sendToNativeHost({ action: "url_copied", url: url, title: title });
		}
	} catch (e) {
		log("TabSwitch::Error getting active tab URL: " + e.message);
	}
};

// Keep the service worker alive (Chrome stops a worker after 30 s idle). Any extension API call
// resets the idle timer. The worker used to connect a port to itself for this, which nothing
// listened on, so every attempt logged "Receiving end does not exist".
setInterval(function() {
	chrome.runtime.getPlatformInfo(function() {});
}, 25000);

chrome.storage.session.get(["visitedTabs"], function(result) {
	(result.visitedTabs || []).forEach(function(id) {
		visitedTabs[id] = true;
	});
	visitedTabsLoaded = true;
	saveVisitedTabs();
});

initialize();

chrome.storage.local.get(["maxSwitcherTabs"], function(result) {
	if (typeof result.maxSwitcherTabs === "number") {
		maxSwitcherTabs = result.maxSwitcherTabs;
	}
});
chrome.storage.onChanged.addListener(function(changes, area) {
	if (area === "local" && changes.maxSwitcherTabs) {
		var value = changes.maxSwitcherTabs.newValue;
		maxSwitcherTabs = typeof value === "number" ? value : DEFAULT_MAX_SWITCHER_TABS;
	}
});

// Connect to native host for Ctrl+Tab interception
connectNativeHost();

// Reconnect native host when this profile's window gains focus
// This fixes the issue where the service worker goes dormant when the profile is in the background
chrome.windows.onFocusChanged.addListener(function(windowId) {
	// Invalidate a switch that is still being set up, and drop one whose window lost focus.
	// This replaces the focus check that used to run on every single cycle.
	nativeSwitchFocusVersion++;
	if (nativeSwitchOngoing && windowId !== nativeSwitchWindowId) {
		log("TabSwitch::Focus left the switching window - dropping the switch");
		sendToNativeHost({action: "hide_switcher"});
		resetNativeSwitch();
	}

	if (windowId !== chrome.windows.WINDOW_ID_NONE) {
		log("Window focus changed to: " + windowId);
		// Check if the native host connection is still alive
		if (!nativePort || !nativeHostConnected) {
			log("Native host connection lost, reconnecting...");
			connectNativeHost();
		} else {
			// Send a ping to verify the connection is still working
			try {
				sendToNativeHost({ action: "ping" });
			} catch (e) {
				log("Ping failed, reconnecting: " + e.message);
				nativePort = null;
				nativeHostConnected = false;
				connectNativeHost();
			}
		}
	}
});

// Capture initial thumbnail after a short delay (to let page load)
setTimeout(captureCurrentTabThumbnail, 2000);