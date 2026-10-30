// Query connection status from service worker with actual ping test
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");

// Set initial checking state
statusEl.className = "status disconnected";
statusTextEl.textContent = "Checking connection...";

// Request a real ping test from the service worker
chrome.runtime.sendMessage({ action: "ping_native_host" }, function(response) {
  if (chrome.runtime.lastError) {
    statusEl.className = "status disconnected";
    statusTextEl.textContent = "Extension not responding";
    return;
  }

  if (response && response.connected) {
    statusEl.className = "status connected";
    statusTextEl.textContent = "Connected to the Arclike app";
  } else {
    statusEl.className = "status disconnected";
    statusTextEl.textContent = "Not connected — is the app running?";
  }
});

// Version info and update banner
function compareVersions(a, b) {
  var partsA = a.split(".").map(Number);
  var partsB = b.split(".").map(Number);
  for (var i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    var numA = partsA[i] || 0;
    var numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

var versionLabel = document.getElementById("version-label");
var currentVersion = chrome.runtime.getManifest().version;
versionLabel.textContent = "v" + currentVersion;

// Load custom shortcut display from storage
chrome.storage.local.get("shortcuts", function(data) {
  if (data.shortcuts) {
    if (data.shortcuts.tabSwitch) {
      var el = document.getElementById("tab-switch-keys");
      if (el) el.innerHTML = '<span class="key">' + data.shortcuts.tabSwitch + '</span>';
    }
    if (data.shortcuts.copyUrl) {
      var el = document.getElementById("copy-url-keys");
      if (el) el.innerHTML = '<span class="key">' + data.shortcuts.copyUrl + '</span>';
    }
  }
});

// Max tabs shown in the switcher (the service worker defaults to 5 when unset)
var maxTabsEl = document.getElementById("max-tabs");
chrome.storage.local.get("maxSwitcherTabs", function(data) {
  maxTabsEl.value = typeof data.maxSwitcherTabs === "number" ? data.maxSwitcherTabs : 5;
});
maxTabsEl.addEventListener("change", function() {
  var value = parseInt(maxTabsEl.value, 10);
  if (isNaN(value) || value < 0) value = 0;
  maxTabsEl.value = value;
  chrome.storage.local.set({ maxSwitcherTabs: value });
});

// Links from other apps open in a Little Arc (read by littlearc.js in the service worker)
var littleArcLinksEl = document.getElementById("little-arc-links");
chrome.storage.local.get("littleArcForLinks", function(data) {
  littleArcLinksEl.checked = Boolean(data.littleArcForLinks);
});
littleArcLinksEl.addEventListener("change", function() {
  chrome.storage.local.set({ littleArcForLinks: littleArcLinksEl.checked });
});

chrome.runtime.sendMessage({ action: "get_version_info" }, function(info) {
  if (chrome.runtime.lastError || !info) return;

  var banner = document.getElementById("update-banner");

  // Priority 1: CWS migration banner for manual installs
  if (info.isManualInstall && info.chromeWebStoreUrl) {
    banner.className = "update-banner cws";
    banner.innerHTML = 'Now on the Chrome Web Store! <a href="' + info.chromeWebStoreUrl + '" target="_blank">Install for automatic updates</a>';
    banner.style.display = "block";
    return;
  }

  // Priority 2: Update available for manual installs
  if (info.isManualInstall && info.latestExtensionVersion && compareVersions(currentVersion, info.latestExtensionVersion) < 0) {
    banner.className = "update-banner update";
    banner.innerHTML = 'Update available (v' + info.latestExtensionVersion + ') — <a href="https://github.com/amitrahman1026/arclike" target="_blank">Download</a>';
    banner.style.display = "block";
  }
});

// Import from Arc: preview what will be added, then import. The service worker does the work
// (extension/arcimport.js); this only shows the steps.
var arcText = document.getElementById("arc-import-text");
var arcButtons = document.getElementById("arc-import-buttons");
var arcTree = document.getElementById("arc-import-tree");

var ARC_ERRORS = {
  app_not_connected: "Arclike can't reach its Mac app. Open Arclike from Applications, then try again.",
  app_no_answer: "The Arclike Mac app didn't answer. It may be an older version: install the latest app, then try again.",
  arc_not_found: "Arc's data isn't on this Mac. Arc must be installed for this macOS user.",
  arc_unreadable: "Arc's data is on this Mac, but Arclike couldn't open it.",
  arc_bad_format: "Arc saves its data in a format Arclike doesn't recognize. Arc may have changed it.",
  too_large: "Your Arc sidebar is too big to import in one go.",
  arc_empty: "Arc has no pinned tabs or favorites to import.",
};

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

// A main line, and an optional quieter note below it.
function arcShow(text, note, isError) {
  arcText.hidden = false;
  arcText.className = "import-text" + (isError ? " error" : "");
  arcText.textContent = text;
  if (note) {
    var span = document.createElement("span");
    span.className = "muted";
    span.textContent = note;
    arcText.appendChild(document.createElement("br"));
    arcText.appendChild(span);
  }
}

function arcSetButtons(buttons) {
  arcButtons.textContent = "";
  buttons.forEach(function(b) {
    var el = document.createElement("button");
    el.className = "btn" + (b.primary ? " primary" : "");
    el.textContent = b.label;
    el.addEventListener("click", function() { b.onClick(el); });
    arcButtons.appendChild(el);
  });
}

// A titled list of [left, right] rows in the import panel. A row with a third item, a URL,
// shows its left text as a link that opens that URL in a new tab, with an optional tooltip.
function arcSection(label, rows) {
  if (!rows.length) return;
  var el = document.createElement("div");
  el.className = "import-tree-label";
  el.textContent = label;
  arcTree.appendChild(el);
  rows.forEach(function(r) {
    var row = document.createElement("div");
    row.className = "import-tree-row";
    var left = document.createElement(r[2] ? "a" : "span");
    left.textContent = r[0];
    if (r[2]) {
      left.href = "#";
      if (r[3]) left.title = r[3];
      left.addEventListener("click", function(e) { e.preventDefault(); chrome.tabs.create({ url: r[2] }); });
    }
    var right = document.createElement("span");
    right.textContent = r[1];
    row.appendChild(left);
    row.appendChild(right);
    arcTree.appendChild(row);
  });
  arcTree.hidden = false;
}

// Where things will go: bookmark folders, tab groups, pinned tabs. After an earlier import,
// each row also says how much of it is new.
function arcShowTree(summary, result) {
  arcTree.textContent = "";
  var again = result.alreadyImported || result.pagesSkipped || result.tabsSkipped || result.favoritesSkipped;
  function status(total, added, noun) {
    var text = plural(total, noun);
    if (!again) return text;
    return text + " · " + (added ? added + " new" : "imported");
  }
  function added(title, key) { return (result.bySpace[title] || {})[key] || 0; }
  arcSection("Bookmarks: Imported from Arc", summary.bySpace.filter(function(s) { return s.pages; })
    .map(function(s) { return [s.title, status(s.pages, added(s.title, "pagesAdded"), "page")]; }));
  arcSection("Tab groups", summary.bySpace.filter(function(s) { return s.tabs; })
    .map(function(s) { return [s.title, status(s.tabs, added(s.title, "tabsAdded"), "tab")]; }));
  arcSection("Pinned tabs", summary.favoriteSites.map(function(site) {
    return [site, result.favoriteSitesPresent.indexOf(site) !== -1 ? "already pinned" : ""];
  }));
  if (summary.dropped) {
    arcSection("Left out", [[plural(summary.dropped, "tab") + " Arc never loaded", "no address"]]);
  }
}

// Chrome settings an extension cannot change, and Arc extensions Chrome lacks, as links.
function arcShowChecklist(extensions) {
  arcSection("Finish switching", [
    ["Reopen tabs on startup", "", "chrome://settings/onStartup", "Choose \"Continue where you left off\""],
    ["Bookmarks bar on all tabs", "optional", "chrome://settings/appearance", "Turn on \"Show bookmarks bar\""],
    // Chrome's default only asks, and auto PiP then waits for the site's media engagement
    // score. An explicit Allow per site skips that, and no extension API can set it.
    ["Auto picture-in-picture", "video sites", "chrome://settings/content/autoPictureInPicture",
      "Under \"Allowed to enter picture-in-picture automatically\", add youtube.com and netflix.com"],
  ].concat((extensions || []).map(function(ext) {
    return ["Install " + ext.name, "from Arc", "https://chromewebstore.google.com/detail/" + ext.id];
  })));
}

function arcReset() {
  arcText.hidden = true;
  arcTree.hidden = true;
  arcTree.textContent = "";
  arcSetButtons([{ label: "Import from Arc", onClick: arcPreview }]);
}

function arcCopyButton(report) {
  return { label: "Copy details", onClick: function(el) {
    navigator.clipboard.writeText(report).then(function() { el.textContent = "Copied"; });
  } };
}

function arcFailed(response) {
  arcTree.hidden = true;
  arcTree.textContent = "";
  var message = ARC_ERRORS[response && response.error] || "Something went wrong during the import.";
  arcShow(message, "Click Copy details and paste it into Claude Code to get it fixed.", true);
  var buttons = [{ label: "Close", onClick: arcReset }];
  if (response && response.report) buttons.unshift(arcCopyButton(response.report));
  arcSetButtons(buttons);
}

function arcSend(dryRun, callback) {
  chrome.runtime.sendMessage({ action: "arc_import", dryRun: dryRun }, function(response) {
    if (chrome.runtime.lastError || !response) {
      arcFailed({ error: "unexpected", report: "Arclike: Import from Arc failed\nStep: asking the service worker\nError: " +
        ((chrome.runtime.lastError && chrome.runtime.lastError.message) || "no response") +
        "\nExtension: " + currentVersion });
      return;
    }
    if (!response.ok) { arcFailed(response); return; }
    callback(response);
  });
}

function arcPreview() {
  arcShow("Reading Arc…");
  arcSetButtons([]);
  arcSend(true, function(response) {
    var s = response.summary, r = response.result;
    var text = plural(s.spaces, "space") + ": " + plural(s.pages, "pinned page") + ", " +
      plural(s.tabs, "open tab") + ", " + plural(s.favorites, "favorite");
    if (r.choicesAdded) text += ", " + plural(r.choicesAdded, "command bar choice");
    arcShowTree(s, r);
    if (!r.pagesAdded && !r.foldersAdded && !r.favoritesAdded && !r.tabsAdded && !r.choicesAdded) {
      arcShow(text, "Everything from Arc is already in Chrome.");
      arcShowChecklist(response.extensions);
      arcSetButtons([{ label: "Close", onClick: arcReset }]);
      return;
    }
    var note = "";
    if (r.alreadyImported || r.pagesSkipped || r.favoritesSkipped || r.tabsSkipped) {
      note = "Some of it is already in Chrome. Only the new " + plural(r.pagesAdded, "page") + ", " +
        plural(r.tabsAdded, "tab") + " and " + plural(r.favoritesAdded, "favorite") + " will be added.";
    }
    arcShow(text, note);
    arcSetButtons([
      { label: "Import", primary: true, onClick: arcImport },
      { label: "Cancel", onClick: arcReset },
    ]);
  });
}

function arcImport() {
  arcTree.hidden = true;
  arcTree.textContent = "";
  arcShow("Importing…");
  arcSetButtons([]);
  arcSend(false, function(response) {
    var r = response.result;
    var text = "Added " + plural(r.pagesAdded, "bookmark") + ", opened " + plural(r.tabsAdded, "tab") +
      " in " + plural(r.groupsAdded, "new tab group") + ", and pinned " + plural(r.favoritesAdded, "favorite") + ".";
    if (r.choicesAdded) text += " The command bar now knows " + plural(r.choicesAdded, "choice") + " you made in Arc.";
    if (r.failed.length) {
      arcShow(text + " " + plural(r.failed.length, "page") + " could not be added.",
        "Click Copy details and paste it into Claude Code to get it fixed.");
      arcShowChecklist(response.extensions);
      arcSetButtons([arcCopyButton(response.report), { label: "Close", onClick: arcReset }]);
      return;
    }
    arcShow(text, "Find the pages on the bookmarks bar in \"Imported from Arc\".");
    arcShowChecklist(response.extensions);
    arcSetButtons([{ label: "Done", onClick: arcReset }]);
  });
}

arcReset();
