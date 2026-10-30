import Foundation
import AppKit
import SwiftUI
import Carbon.HIToolbox
import ApplicationServices
import Sparkle
import UserNotifications
import ImageIO

let APP_VERSION = "0.3.0"

// MARK: - Branding

/// Arclike is a fork of Tab Switcher (github.com/nechemyaspitz/tab-switcher). Everything that
/// names the app to the system lives here, so it never collides with an installed Tab Switcher.
let APP_NAME = "Arclike"
/// Bundle identifier, native messaging host name, and prefix of the app's notifications.
let APP_ID = "com.amitrahman1026.arclike"
/// Fixed by the "key" in extension/manifest.json, so it is the same wherever the folder lives.
let CWS_EXTENSION_ID = "jlmidbafifiahhcpahkcejphlibhjapo"
let CWS_URL = "https://github.com/amitrahman1026/arclike"
/// Upstream's update and browser-list endpoints describe Tab Switcher releases, not Arclike's, so
/// both are off until Arclike publishes its own.
let VERSION_CHECK_URL: URL? = nil
let REMOTE_BROWSER_LIST_URL: URL? = nil

/// ~/Library/Application Support/Arclike: configuration and lock files.
let appSupportDirectory: URL = {
    let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let directory = appSupport.appendingPathComponent(APP_NAME)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}()

// MARK: - Keyboard Shortcut Configuration

func keyCodeToString(_ keyCode: Int64) -> String {
    switch Int(keyCode) {
    case kVK_Tab: return "⇥"
    case kVK_Return: return "↩"
    case kVK_Space: return "Space"
    case kVK_Delete: return "⌫"
    case kVK_Escape: return "⎋"
    case kVK_UpArrow: return "↑"
    case kVK_DownArrow: return "↓"
    case kVK_LeftArrow: return "←"
    case kVK_RightArrow: return "→"
    case kVK_ANSI_A: return "A"
    case kVK_ANSI_B: return "B"
    case kVK_ANSI_C: return "C"
    case kVK_ANSI_D: return "D"
    case kVK_ANSI_E: return "E"
    case kVK_ANSI_F: return "F"
    case kVK_ANSI_G: return "G"
    case kVK_ANSI_H: return "H"
    case kVK_ANSI_I: return "I"
    case kVK_ANSI_J: return "J"
    case kVK_ANSI_K: return "K"
    case kVK_ANSI_L: return "L"
    case kVK_ANSI_M: return "M"
    case kVK_ANSI_N: return "N"
    case kVK_ANSI_O: return "O"
    case kVK_ANSI_P: return "P"
    case kVK_ANSI_Q: return "Q"
    case kVK_ANSI_R: return "R"
    case kVK_ANSI_S: return "S"
    case kVK_ANSI_T: return "T"
    case kVK_ANSI_U: return "U"
    case kVK_ANSI_V: return "V"
    case kVK_ANSI_W: return "W"
    case kVK_ANSI_X: return "X"
    case kVK_ANSI_Y: return "Y"
    case kVK_ANSI_Z: return "Z"
    case kVK_ANSI_0: return "0"
    case kVK_ANSI_1: return "1"
    case kVK_ANSI_2: return "2"
    case kVK_ANSI_3: return "3"
    case kVK_ANSI_4: return "4"
    case kVK_ANSI_5: return "5"
    case kVK_ANSI_6: return "6"
    case kVK_ANSI_7: return "7"
    case kVK_ANSI_8: return "8"
    case kVK_ANSI_9: return "9"
    case kVK_ANSI_Grave: return "`"
    case kVK_ANSI_Minus: return "-"
    case kVK_ANSI_Equal: return "="
    case kVK_ANSI_LeftBracket: return "["
    case kVK_ANSI_RightBracket: return "]"
    case kVK_ANSI_Backslash: return "\\"
    case kVK_ANSI_Semicolon: return ";"
    case kVK_ANSI_Quote: return "'"
    case kVK_ANSI_Comma: return ","
    case kVK_ANSI_Period: return "."
    case kVK_ANSI_Slash: return "/"
    case kVK_F1: return "F1"
    case kVK_F2: return "F2"
    case kVK_F3: return "F3"
    case kVK_F4: return "F4"
    case kVK_F5: return "F5"
    case kVK_F6: return "F6"
    case kVK_F7: return "F7"
    case kVK_F8: return "F8"
    case kVK_F9: return "F9"
    case kVK_F10: return "F10"
    case kVK_F11: return "F11"
    case kVK_F12: return "F12"
    default: return "Key\(keyCode)"
    }
}

struct ShortcutConfig: Codable, Equatable {
    var keyCode: Int64
    var modifiers: UInt64

    var displayString: String {
        var parts: [String] = []
        let flags = CGEventFlags(rawValue: modifiers)
        if flags.contains(.maskControl) { parts.append("⌃") }
        if flags.contains(.maskAlternate) { parts.append("⌥") }
        if flags.contains(.maskShift) { parts.append("⇧") }
        if flags.contains(.maskCommand) { parts.append("⌘") }
        parts.append(keyCodeToString(keyCode))
        return parts.joined()
    }
}

struct ShortcutsConfiguration: Codable {
    var tabSwitch: ShortcutConfig
    var copyUrl: ShortcutConfig

    static let defaults = ShortcutsConfiguration(
        tabSwitch: ShortcutConfig(
            keyCode: Int64(kVK_Tab),
            modifiers: CGEventFlags.maskControl.rawValue
        ),
        copyUrl: ShortcutConfig(
            keyCode: Int64(kVK_ANSI_C),
            modifiers: CGEventFlags([.maskCommand, .maskShift]).rawValue
        )
    )
}

// Global shortcut config (read by event tap callback — C function pointer can only read globals)
var tabSwitchKeyCode: Int64 = Int64(kVK_Tab)
var tabSwitchModifiers: UInt64 = CGEventFlags.maskControl.rawValue
var copyUrlKeyCode: Int64 = Int64(kVK_ANSI_C)
var copyUrlModifiers: UInt64 = CGEventFlags([.maskCommand, .maskShift]).rawValue

func updateShortcutGlobals(from config: ShortcutsConfiguration) {
    tabSwitchKeyCode = config.tabSwitch.keyCode
    tabSwitchModifiers = config.tabSwitch.modifiers
    copyUrlKeyCode = config.copyUrl.keyCode
    copyUrlModifiers = config.copyUrl.modifiers
}

// MARK: - Browser Configuration

// Minimal browser definition fetched from remote config
struct BrowserDefinition: Codable {
    let id: String
    let name: String
    let appName: String
    let nativeMessagingPath: String
}

struct BrowserInfo: Identifiable, Codable {
    let id: String // bundle identifier
    let name: String
    let nativeMessagingPath: String // relative to ~/Library/Application Support/
    var extensionId: String? // user-provided extension ID
    var isEnabled: Bool
    var combineAllWindows: Bool = false // false = only current window tabs, true = all windows
    var appName: String // display name for .app bundle lookup

    init(id: String, name: String, nativeMessagingPath: String, extensionId: String?, isEnabled: Bool, combineAllWindows: Bool = false, appName: String? = nil) {
        self.id = id
        self.name = name
        self.nativeMessagingPath = nativeMessagingPath
        self.extensionId = extensionId
        self.isEnabled = isEnabled
        self.combineAllWindows = combineAllWindows
        self.appName = appName ?? name
    }

    // Custom Codable decoder: defaults appName to name if missing (backwards compat with v3.6 configs)
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        nativeMessagingPath = try container.decode(String.self, forKey: .nativeMessagingPath)
        extensionId = try container.decodeIfPresent(String.self, forKey: .extensionId)
        isEnabled = try container.decode(Bool.self, forKey: .isEnabled)
        combineAllWindows = try container.decodeIfPresent(Bool.self, forKey: .combineAllWindows) ?? false
        appName = try container.decodeIfPresent(String.self, forKey: .appName) ?? name
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, nativeMessagingPath, extensionId, isEnabled, combineAllWindows, appName
    }

    init(from definition: BrowserDefinition) {
        self.id = definition.id
        self.name = definition.name
        self.nativeMessagingPath = definition.nativeMessagingPath
        self.extensionId = nil
        self.isEnabled = false
        self.combineAllWindows = false
        self.appName = definition.appName
    }

    var fullNativeMessagingPath: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/Application Support/\(nativeMessagingPath)"
    }

    // Check if browser is installed
    var isInstalled: Bool {
        let paths = [
            "/Applications/\(appName).app",
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/Applications/\(appName).app"
        ]
        return paths.contains { FileManager.default.fileExists(atPath: $0) }
    }

    var appPath: String? {
        let paths = [
            "/Applications/\(appName).app",
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/Applications/\(appName).app"
        ]
        return paths.first { FileManager.default.fileExists(atPath: $0) }
    }

    var icon: NSImage? {
        guard let path = appPath else { return nil }
        return NSWorkspace.shared.icon(forFile: path)
    }
}

// Hardcoded fallback browser list — remote browsers.json takes priority
let knownBrowsers: [BrowserInfo] = [
    BrowserInfo(id: "com.google.Chrome", name: "Google Chrome",
                nativeMessagingPath: "Google/Chrome/NativeMessagingHosts",
                extensionId: nil, isEnabled: false, appName: "Google Chrome"),
    BrowserInfo(id: "com.google.Chrome.dev", name: "Google Chrome Dev",
                nativeMessagingPath: "Google/Chrome Dev/NativeMessagingHosts",
                extensionId: nil, isEnabled: false, appName: "Google Chrome Dev"),
    BrowserInfo(id: "com.google.Chrome.canary", name: "Google Chrome Canary",
                nativeMessagingPath: "Google/Chrome Canary/NativeMessagingHosts",
                extensionId: nil, isEnabled: false, appName: "Google Chrome Canary"),
    BrowserInfo(id: "org.chromium.Chromium", name: "Chromium",
                nativeMessagingPath: "Chromium/NativeMessagingHosts",
                extensionId: nil, isEnabled: false, appName: "Chromium"),
]

// MARK: - Browser Configuration Manager

class BrowserConfigManager: ObservableObject {
    static let shared = BrowserConfigManager()
    
    @Published var browsers: [BrowserInfo] = []
    @Published var showingSetup = false
    @Published var shortcuts: ShortcutsConfiguration = .defaults
    @Published var showExtensionUpdateInstructions = false

    private let configURL: URL = {
        appSupportDirectory.appendingPathComponent("browser_config.json")
    }()

    private let cachedBrowserListURL: URL = {
        appSupportDirectory.appendingPathComponent("browser_list_cache.json")
    }()

    private let shortcutsURL: URL = {
        appSupportDirectory.appendingPathComponent("shortcuts.json")
    }()

    init() {
        loadConfig()
        loadShortcuts()
        fetchRemoteBrowserList()
    }

    func loadShortcuts() {
        if let data = try? Data(contentsOf: shortcutsURL),
           let saved = try? JSONDecoder().decode(ShortcutsConfiguration.self, from: data) {
            shortcuts = saved
        }
        updateShortcutGlobals(from: shortcuts)
    }

    func saveShortcuts() {
        if let data = try? JSONEncoder().encode(shortcuts) {
            try? data.write(to: shortcutsURL)
        }
        updateShortcutGlobals(from: shortcuts)
        // Notify other instances
        DistributedNotificationCenter.default().postNotificationName(
            NSNotification.Name(APP_ID + ".shortcutsChanged"),
            object: nil,
            userInfo: nil,
            deliverImmediately: true
        )
    }
    
    /// Returns the base browser list: cached remote list if available, otherwise hardcoded fallback.
    private func baseBrowserList() -> [BrowserInfo] {
        // Try cached remote list first
        if let data = try? Data(contentsOf: cachedBrowserListURL),
           let definitions = try? JSONDecoder().decode([BrowserDefinition].self, from: data) {
            debugLog("Using cached remote browser list (\(definitions.count) browsers)")
            return definitions.map { BrowserInfo(from: $0) }
        }
        // Fall back to hardcoded list
        debugLog("Using hardcoded browser list (\(knownBrowsers.count) browsers)")
        return knownBrowsers
    }

    func loadConfig() {
        // Migrate: if old browsers.json exists, move it to new name
        let oldConfigURL = configURL.deletingLastPathComponent().appendingPathComponent("browsers.json")
        if FileManager.default.fileExists(atPath: oldConfigURL.path),
           !FileManager.default.fileExists(atPath: configURL.path) {
            try? FileManager.default.moveItem(at: oldConfigURL, to: configURL)
            debugLog("Migrated browsers.json to browser_config.json")
        }

        // Start with base browser list (cached remote or hardcoded fallback)
        var loadedBrowsers = baseBrowserList()

        // Try to load saved user config (enabled state, extension IDs)
        if let data = try? Data(contentsOf: configURL),
           let saved = try? JSONDecoder().decode([BrowserInfo].self, from: data) {
            // Merge saved config into browser list
            for (index, browser) in loadedBrowsers.enumerated() {
                if let savedBrowser = saved.first(where: { $0.id == browser.id }) {
                    loadedBrowsers[index].extensionId = savedBrowser.extensionId
                    loadedBrowsers[index].isEnabled = savedBrowser.isEnabled
                    loadedBrowsers[index].combineAllWindows = savedBrowser.combineAllWindows
                }
            }
            // Also include any saved browsers not in the base list (user had configured
            // a browser that was later removed from remote list — keep their config)
            for savedBrowser in saved where savedBrowser.isEnabled {
                if !loadedBrowsers.contains(where: { $0.id == savedBrowser.id }) {
                    loadedBrowsers.append(savedBrowser)
                }
            }
        }

        browsers = loadedBrowsers
    }

    /// Fetches the browser list from the website and caches it locally.
    /// On success, reloads the browser list to pick up any new browsers.
    func fetchRemoteBrowserList() {
        // Upstream's list lives on tabswitcher.app. Arclike keeps to the built-in list.
        guard let url = REMOTE_BROWSER_LIST_URL else { return }

        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let self = self,
                  let data = data,
                  let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                debugLog("Failed to fetch remote browser list: \(error?.localizedDescription ?? "unknown error")")
                return
            }

            // Validate it's a proper browser list
            guard let definitions = try? JSONDecoder().decode([BrowserDefinition].self, from: data),
                  !definitions.isEmpty else {
                debugLog("Remote browser list was empty or invalid")
                return
            }

            // Cache it
            try? data.write(to: self.cachedBrowserListURL)
            debugLog("Cached remote browser list (\(definitions.count) browsers)")

            // Reload config on main thread to pick up new browsers
            DispatchQueue.main.async {
                self.loadConfig()
            }
        }.resume()
    }
    
    func saveConfig() {
        if let data = try? JSONEncoder().encode(browsers) {
            try? data.write(to: configURL)
        }
        updateManifests()
    }
    
    func enableBrowser(id: String) {
        if let index = browsers.firstIndex(where: { $0.id == id }) {
            browsers[index].isEnabled = true
            saveConfig()
        }
    }
    
    func disableBrowser(id: String) {
        if let index = browsers.firstIndex(where: { $0.id == id }) {
            browsers[index].isEnabled = false
            saveConfig()
        }
    }
    
    func setCombineWindows(id: String, combine: Bool) {
        if let index = browsers.firstIndex(where: { $0.id == id }) {
            browsers[index].combineAllWindows = combine
            saveConfig()
        }
    }
    
    func updateManifests() {
        // Use the actual path of the running app binary, not hardcoded path
        let nativeHostPath: String
        if let bundlePath = Bundle.main.executablePath {
            nativeHostPath = bundlePath
            debugLog("Using actual binary path for manifest: \(bundlePath)")
        } else {
            // Fallback to expected installation path
            nativeHostPath = "/Applications/\(APP_NAME).app/Contents/MacOS/arclike"
            debugLog("Using fallback binary path for manifest: \(nativeHostPath)")
        }
        
        for browser in browsers {
            let manifestDir = browser.fullNativeMessagingPath
            let manifestPath = "\(manifestDir)/\(APP_ID).json"

            if browser.isEnabled {
                // Create manifest directory if needed
                try? FileManager.default.createDirectory(atPath: manifestDir, withIntermediateDirectories: true)

                // Always include CWS extension ID; also include legacy manual ID for backward compat
                var origins = ["chrome-extension://\(CWS_EXTENSION_ID)/"]
                if let legacyId = browser.extensionId, !legacyId.isEmpty, legacyId != CWS_EXTENSION_ID {
                    origins.append("chrome-extension://\(legacyId)/")
                }

                // Create manifest
                let manifest: [String: Any] = [
                    "name": APP_ID,
                    "description": "\(APP_NAME) native helper",
                    "path": nativeHostPath,
                    "type": "stdio",
                    "allowed_origins": origins
                ]

                if let data = try? JSONSerialization.data(withJSONObject: manifest, options: .prettyPrinted) {
                    try? data.write(to: URL(fileURLWithPath: manifestPath))
                    debugLog("Created manifest for \(browser.name) at \(manifestPath)")
                }
            } else {
                // Remove manifest if disabled
                try? FileManager.default.removeItem(atPath: manifestPath)
            }
        }
    }
    
    var enabledBundleIds: Set<String> {
        Set(browsers.filter { $0.isEnabled }.map { $0.id })
    }
    
    var installedBrowsers: [BrowserInfo] {
        browsers.filter { $0.isInstalled }
    }
}

// MARK: - Sparkle Updater

final class UpdaterViewModel: ObservableObject {
    let updaterController: SPUStandardUpdaterController
    @Published var canCheckForUpdates = false

    init() {
        updaterController = SPUStandardUpdaterController(
            startingUpdater: false,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
    }

    func startUpdater() {
        updaterController.startUpdater()
        updaterController.updater.publisher(for: \.canCheckForUpdates)
            .assign(to: &$canCheckForUpdates)
    }

    func checkForUpdates() {
        updaterController.checkForUpdates(nil)
    }
}

let updaterViewModel = UpdaterViewModel()

// MARK: - Background Update Checker

class BackgroundUpdateChecker: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = BackgroundUpdateChecker()

    static let appUpdateCategory = "APP_UPDATE"
    static let extensionUpdateCategory = "EXTENSION_UPDATE"
    static let updateAction = "UPDATE_ACTION"

    var skipAppUpdateNotifications = false

    private var isUpdateCheckLeader = false
    private var checkTimer: Timer?
    private var connectedExtensionVersion: String?

    private let updateCheckerLockFile: URL = {
        appSupportDirectory.appendingPathComponent("updatechecker.lock")
    }()

    private let notifiedVersionsURL: URL = {
        appSupportDirectory.appendingPathComponent("notified_versions.json")
    }()

    struct NotifiedVersions: Codable {
        var app: String?
        var ext: String?
    }

    struct VersionInfo: Codable {
        struct AppVersion: Codable {
            let version: String
            let downloadUrl: String
            let releaseNotes: String
        }
        struct ExtVersion: Codable {
            let version: String
            let chromeWebStoreUrl: String?
            let releaseNotes: String
        }
        let app: AppVersion
        let `extension`: ExtVersion
    }

    // MARK: - Setup

    func setupNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            debugLog("Notification permission: \(granted), error: \(error?.localizedDescription ?? "none")")
        }

        let updateAction = UNNotificationAction(
            identifier: BackgroundUpdateChecker.updateAction,
            title: "View Update",
            options: [.foreground]
        )

        let appCategory = UNNotificationCategory(
            identifier: BackgroundUpdateChecker.appUpdateCategory,
            actions: [updateAction],
            intentIdentifiers: []
        )

        let extCategory = UNNotificationCategory(
            identifier: BackgroundUpdateChecker.extensionUpdateCategory,
            actions: [updateAction],
            intentIdentifiers: []
        )

        center.setNotificationCategories([appCategory, extCategory])
    }

    func setExtensionVersion(_ version: String) {
        connectedExtensionVersion = version
    }

    // MARK: - Leader Election

    func tryBecomeUpdateCheckLeader() -> Bool {
        let myPid = getpid()

        if FileManager.default.fileExists(atPath: updateCheckerLockFile.path) {
            if let contents = try? String(contentsOf: updateCheckerLockFile, encoding: .utf8),
               let existingPid = Int32(contents.trimmingCharacters(in: .whitespacesAndNewlines)) {
                if kill(existingPid, 0) == 0 {
                    if let app = NSRunningApplication(processIdentifier: existingPid),
                       app.bundleIdentifier == Bundle.main.bundleIdentifier {
                        return false
                    }
                }
                try? FileManager.default.removeItem(at: updateCheckerLockFile)
            } else {
                try? FileManager.default.removeItem(at: updateCheckerLockFile)
            }
        }

        do {
            try String(myPid).write(to: updateCheckerLockFile, atomically: true, encoding: .utf8)
            debugLog("We (PID \(myPid)) are the update check leader")
            return true
        } catch {
            return false
        }
    }

    func cleanupUpdateCheckLock() {
        if isUpdateCheckLeader {
            try? FileManager.default.removeItem(at: updateCheckerLockFile)
            DistributedNotificationCenter.default().postNotificationName(
                NSNotification.Name(APP_ID + ".updateCheckerResigned"),
                object: nil, userInfo: nil, deliverImmediately: true
            )
        }
    }

    func tryTakeOverLeadership() {
        guard !isUpdateCheckLeader else { return }
        if tryBecomeUpdateCheckLeader() {
            isUpdateCheckLeader = true
            debugLog("Took over as update check leader")
            startPeriodicChecks()
        }
    }

    // MARK: - Periodic Checking

    func startPeriodicChecks() {
        isUpdateCheckLeader = tryBecomeUpdateCheckLeader()
        guard isUpdateCheckLeader else {
            debugLog("Not the update check leader, skipping periodic checks")
            return
        }

        // First check after a short delay (give time for extension to register)
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            self?.checkForUpdates()
        }

        // Then every 4 hours
        checkTimer = Timer.scheduledTimer(withTimeInterval: 4 * 60 * 60, repeats: true) { [weak self] _ in
            self?.checkForUpdates()
        }
    }

    private func checkForUpdates() {
        guard isUpdateCheckLeader else { return }
        guard let url = VERSION_CHECK_URL else { return }

        let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else {
                debugLog("Version check failed: \(error?.localizedDescription ?? "unknown")")
                return
            }
            do {
                let info = try JSONDecoder().decode(VersionInfo.self, from: data)
                self.processVersionInfo(info)
            } catch {
                debugLog("Failed to decode version.json: \(error)")
            }
        }
        task.resume()
    }

    private func processVersionInfo(_ info: VersionInfo) {
        let notified = loadNotifiedVersions()

        // Check app version
        if !skipAppUpdateNotifications && isNewerVersion(info.app.version, than: APP_VERSION) {
            if notified.app != info.app.version {
                sendAppUpdateNotification(newVersion: info.app.version, releaseNotes: info.app.releaseNotes)
                saveNotifiedVersions(NotifiedVersions(app: info.app.version, ext: notified.ext))
            }
        }

        // Check extension version
        if let extVersion = connectedExtensionVersion,
           isNewerVersion(info.extension.version, than: extVersion) {
            if notified.ext != info.extension.version {
                sendExtensionUpdateNotification(newVersion: info.extension.version, currentVersion: extVersion)
                saveNotifiedVersions(NotifiedVersions(app: notified.app, ext: info.extension.version))
            }
        }
    }

    private func isNewerVersion(_ remote: String, than local: String) -> Bool {
        let remoteParts = remote.split(separator: ".").compactMap { Int($0) }
        let localParts = local.split(separator: ".").compactMap { Int($0) }
        for i in 0..<max(remoteParts.count, localParts.count) {
            let r = i < remoteParts.count ? remoteParts[i] : 0
            let l = i < localParts.count ? localParts[i] : 0
            if r > l { return true }
            if r < l { return false }
        }
        return false
    }

    // MARK: - Persistence

    private func loadNotifiedVersions() -> NotifiedVersions {
        guard let data = try? Data(contentsOf: notifiedVersionsURL),
              let versions = try? JSONDecoder().decode(NotifiedVersions.self, from: data) else {
            return NotifiedVersions()
        }
        return versions
    }

    private func saveNotifiedVersions(_ versions: NotifiedVersions) {
        if let data = try? JSONEncoder().encode(versions) {
            try? data.write(to: notifiedVersionsURL)
        }
    }

    // MARK: - Send Notifications

    private func sendAppUpdateNotification(newVersion: String, releaseNotes: String) {
        let content = UNMutableNotificationContent()
        content.title = "\(APP_NAME) Update Available"
        content.body = "Version \(newVersion) is available (you have \(APP_VERSION)). \(releaseNotes)"
        content.sound = .default
        content.categoryIdentifier = BackgroundUpdateChecker.appUpdateCategory
        content.userInfo = ["type": "app", "version": newVersion]

        let request = UNNotificationRequest(identifier: "app-update-\(newVersion)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                debugLog("Failed to send app update notification: \(error)")
            } else {
                debugLog("Sent app update notification for \(newVersion)")
            }
        }
    }

    private func sendExtensionUpdateNotification(newVersion: String, currentVersion: String) {
        let content = UNMutableNotificationContent()
        content.title = "\(APP_NAME) Extension Update"
        content.body = "Extension v\(newVersion) is available (you have v\(currentVersion)). Click to see how to update."
        content.sound = .default
        content.categoryIdentifier = BackgroundUpdateChecker.extensionUpdateCategory
        content.userInfo = ["type": "extension", "version": newVersion]

        let request = UNNotificationRequest(identifier: "ext-update-\(newVersion)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                debugLog("Failed to send extension update notification: \(error)")
            } else {
                debugLog("Sent extension update notification for \(newVersion)")
            }
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        let type = userInfo["type"] as? String

        if type == "app" {
            handleAppUpdateClick()
        } else if type == "extension" {
            handleExtensionUpdateClick()
        }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    private func handleAppUpdateClick() {
        debugLog("User clicked app update notification")

        // Post distributed notification for any directly-launched instance to handle
        DistributedNotificationCenter.default().postNotificationName(
            NSNotification.Name(APP_ID + ".triggerAppUpdate"),
            object: nil, userInfo: nil, deliverImmediately: true
        )

        // Check if a directly-launched instance exists
        let hasDirectInstance = NSWorkspace.shared.runningApplications.contains {
            $0.bundleIdentifier == Bundle.main.bundleIdentifier && $0.activationPolicy == .regular
        }

        if !hasDirectInstance {
            // No direct instance — handle it ourselves
            DispatchQueue.main.async {
                NSApp.setActivationPolicy(.regular)
                allowConfigUI = true
                BrowserConfigManager.shared.showingSetup = true
                updaterViewModel.startUpdater()
                NSApp.activate(ignoringOtherApps: true)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    updaterViewModel.checkForUpdates()
                }
            }
        }
    }

    private func handleExtensionUpdateClick() {
        debugLog("User clicked extension update notification")

        DistributedNotificationCenter.default().postNotificationName(
            NSNotification.Name(APP_ID + ".showExtensionUpdate"),
            object: nil, userInfo: nil, deliverImmediately: true
        )

        DispatchQueue.main.async {
            allowConfigUI = true
            BrowserConfigManager.shared.showingSetup = true
            BrowserConfigManager.shared.showExtensionUpdateInstructions = true
        }
    }
}

// MARK: - Shortcut Recorder

class ShortcutRecorderNSView: NSView {
    var onShortcutRecorded: ((Int64, UInt64) -> Void)?
    var displayString = ""
    var isRecording = false

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        isRecording = true
        displayString = "Press shortcut..."
        needsDisplay = true
        window?.makeFirstResponder(self)
    }

    private func recordEvent(_ event: NSEvent) -> Bool {
        guard isRecording else { return false }
        let keyCode = Int64(event.keyCode)
        let modifiers = event.modifierFlags.intersection([.control, .option, .shift, .command])
        guard !modifiers.isEmpty else { return false }

        var cgFlags: CGEventFlags = []
        if modifiers.contains(.control) { cgFlags.insert(.maskControl) }
        if modifiers.contains(.option) { cgFlags.insert(.maskAlternate) }
        if modifiers.contains(.shift) { cgFlags.insert(.maskShift) }
        if modifiers.contains(.command) { cgFlags.insert(.maskCommand) }

        onShortcutRecorded?(keyCode, cgFlags.rawValue)
        isRecording = false
        needsDisplay = true
        return true
    }

    // performKeyEquivalent catches Tab and other keys that macOS normally intercepts
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if recordEvent(event) { return true }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if recordEvent(event) { return }
        super.keyDown(with: event)
    }

    override func resignFirstResponder() -> Bool {
        if isRecording {
            isRecording = false
            needsDisplay = true
        }
        return super.resignFirstResponder()
    }

    override func draw(_ dirtyRect: NSRect) {
        let bgColor: NSColor = isRecording ? .controlAccentColor.withAlphaComponent(0.15) : .controlBackgroundColor
        bgColor.setFill()
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 6, yRadius: 6)
        path.fill()

        NSColor.separatorColor.setStroke()
        path.stroke()

        let text = isRecording ? "Press shortcut..." : (displayString.isEmpty ? "Click to set" : displayString)
        let textColor: NSColor = isRecording ? .secondaryLabelColor : (displayString.isEmpty ? .tertiaryLabelColor : .labelColor)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .medium),
            .foregroundColor: textColor
        ]
        let str = NSAttributedString(string: text, attributes: attrs)
        let textSize = str.size()
        let textRect = NSRect(
            x: (bounds.width - textSize.width) / 2,
            y: (bounds.height - textSize.height) / 2,
            width: textSize.width,
            height: textSize.height
        )
        str.draw(in: textRect)
    }
}

struct ShortcutRecorderView: NSViewRepresentable {
    @Binding var shortcut: ShortcutConfig
    var onChange: (() -> Void)?

    func makeNSView(context: Context) -> ShortcutRecorderNSView {
        let view = ShortcutRecorderNSView()
        view.displayString = shortcut.displayString
        view.onShortcutRecorded = { keyCode, modifiers in
            shortcut = ShortcutConfig(keyCode: keyCode, modifiers: modifiers)
            onChange?()
        }
        return view
    }

    func updateNSView(_ nsView: ShortcutRecorderNSView, context: Context) {
        nsView.displayString = shortcut.displayString
        nsView.onShortcutRecorded = { keyCode, modifiers in
            shortcut = ShortcutConfig(keyCode: keyCode, modifiers: modifiers)
            onChange?()
        }
        nsView.needsDisplay = true
    }
}

// MARK: - Setup Window View

struct SetupView: View {
    @ObservedObject var configManager = BrowserConfigManager.shared
    @ObservedObject var updater = updaterViewModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 20) {
                    // Header
                    VStack(spacing: 4) {
                        if let icon = NSApp.applicationIconImage {
                            Image(nsImage: icon)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 64, height: 64)
                                .padding(.bottom, 4)
                        }
                        Text(APP_NAME)
                            .font(.system(size: 18, weight: .bold))
                        Text("v\(APP_VERSION)")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 8)

                    // Browsers
                    VStack(alignment: .leading, spacing: 8) {
                        sectionHeader("Browsers")

                        VStack(spacing: 0) {
                            ForEach(Array(configManager.installedBrowsers.enumerated()), id: \.element.id) { index, browser in
                                BrowserRowView(browser: browser)
                                if index < configManager.installedBrowsers.count - 1 {
                                    Divider().padding(.leading, 54)
                                }
                            }
                        }
                        .background(Color.secondary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    // Keyboard Shortcuts
                    VStack(alignment: .leading, spacing: 8) {
                        sectionHeader("Keyboard Shortcuts")

                        VStack(spacing: 1) {
                            shortcutRow("Switch Tabs", shortcut: $configManager.shortcuts.tabSwitch)
                            Divider().padding(.horizontal, 12)
                            shortcutRow("Copy URL", shortcut: $configManager.shortcuts.copyUrl)
                        }
                        .background(Color.secondary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                        Button("Reset to Defaults") {
                            configManager.shortcuts = .defaults
                            configManager.saveShortcuts()
                        }
                        .font(.system(size: 11))
                        .buttonStyle(.link)
                        .padding(.leading, 4)
                    }

                    // Extension update notice
                    if configManager.showExtensionUpdateInstructions {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.orange)
                                    .font(.system(size: 12))
                                Text("Extension Update Available")
                                    .font(.system(size: 12, weight: .semibold))
                                Spacer()
                                Button {
                                    configManager.showExtensionUpdateInstructions = false
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundColor(.secondary)
                                }
                                .buttonStyle(.plain)
                            }

                            Text("Load the latest version of the extension from the project.")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)

                            Button("Open Project Page") {
                                if let url = URL(string: CWS_URL) {
                                    NSWorkspace.shared.open(url)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                        .padding(12)
                        .background(Color.orange.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
            }

            // Footer
            Divider()
            HStack {
                Button("Project Page") {
                    if let url = URL(string: CWS_URL) {
                        NSWorkspace.shared.open(url)
                    }
                }
                .font(.system(size: 12))
                Spacer()
                Button("Done") {
                    configManager.showingSetup = false
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .disabled(!configManager.browsers.contains { $0.isEnabled })
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
        }
        .frame(width: 460, height: 580)
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(.secondary)
            .tracking(0.5)
            .padding(.leading, 4)
    }

    private func shortcutRow(_ label: String, shortcut: Binding<ShortcutConfig>) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 13))
            Spacer()
            ShortcutRecorderView(
                shortcut: shortcut,
                onChange: { configManager.saveShortcuts() }
            )
            .frame(width: 160, height: 28)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

// MARK: - Browser Row View

struct BrowserRowView: View {
    let browser: BrowserInfo
    @ObservedObject var configManager = BrowserConfigManager.shared
    @State private var isExpanded = false

    private var currentBrowser: BrowserInfo? {
        configManager.browsers.first { $0.id == browser.id }
    }

    /// Whether this browser has a legacy (non-CWS) manual extension ID
    private var hasLegacyExtensionId: Bool {
        guard let extId = currentBrowser?.extensionId, !extId.isEmpty else { return false }
        return extId != CWS_EXTENSION_ID
    }

    var body: some View {
        VStack(spacing: 0) {
            // Main row — tap to expand/collapse
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 10) {
                    if let icon = browser.icon {
                        Image(nsImage: icon)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 32, height: 32)
                    } else {
                        Image(systemName: "globe")
                            .font(.system(size: 22))
                            .frame(width: 32, height: 32)
                            .foregroundColor(.secondary)
                    }

                    Text(browser.appName)
                        .font(.system(size: 13))
                        .foregroundColor(.primary)

                    Spacer()

                    if currentBrowser?.isEnabled == true {
                        Text("Enabled")
                            .font(.system(size: 11))
                            .foregroundColor(.green)
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Expanded section
            if isExpanded {
                VStack(alignment: .leading, spacing: 10) {
                    Divider().padding(.leading, 42)

                    if currentBrowser?.isEnabled == true {
                        // Enabled state — show settings + disable
                        if let current = currentBrowser {
                            Toggle(isOn: Binding(
                                get: { current.combineAllWindows },
                                set: { configManager.setCombineWindows(id: browser.id, combine: $0) }
                            )) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Cycle through all windows")
                                        .font(.system(size: 12))
                                    Text("When off, only tabs from the active window are shown")
                                        .font(.system(size: 10))
                                        .foregroundColor(.secondary)
                                }
                            }
                            .toggleStyle(.switch)
                            .controlSize(.small)
                        }

                        // Migration notice for users with manually-loaded extension
                        if hasLegacyExtensionId {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 4) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundColor(.orange)
                                        .font(.system(size: 10))
                                    Text("Using manually loaded extension")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundColor(.orange)
                                }
                                Text("Load the extension from the project's extension folder, then remove this copy.")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                                Button("Open Project Page") {
                                    if let url = URL(string: CWS_URL) {
                                        NSWorkspace.shared.open(url)
                                    }
                                }
                                .controlSize(.small)
                                .font(.system(size: 11))
                            }
                            .padding(8)
                            .background(Color.orange.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }

                        Button("Disable Browser") {
                            configManager.disableBrowser(id: browser.id)
                        }
                        .font(.system(size: 11))
                        .foregroundColor(.red)
                        .buttonStyle(.plain)
                    } else {
                        // Not enabled — simple enable button
                        Text("Enable \(APP_NAME) for \(browser.name)")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)

                        Button("Enable") {
                            configManager.enableBrowser(id: browser.id)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
                .transition(.opacity)
            }
        }
    }
}

// Custom NSTextField that properly handles paste
class PastableNSTextField: NSTextField {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.contains(.command) {
            switch event.charactersIgnoringModifiers {
            case "v":
                if NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: self) { return true }
            case "c":
                if NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: self) { return true }
            case "x":
                if NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: self) { return true }
            case "a":
                if NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: self) { return true }
            default:
                break
            }
        }
        return super.performKeyEquivalent(with: event)
    }
}

// AppKit TextField wrapper for proper paste support
struct PastableTextField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    
    func makeNSView(context: Context) -> PastableNSTextField {
        let textField = PastableNSTextField()
        textField.placeholderString = placeholder
        textField.delegate = context.coordinator
        textField.bezelStyle = .roundedBezel
        textField.font = .systemFont(ofSize: 13)
        textField.focusRingType = .exterior
        return textField
    }
    
    func updateNSView(_ nsView: PastableNSTextField, context: Context) {
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }
    
    class Coordinator: NSObject, NSTextFieldDelegate {
        var text: Binding<String>
        
        init(text: Binding<String>) {
            self.text = text
        }
        
        func controlTextDidChange(_ obj: Notification) {
            if let textField = obj.object as? NSTextField {
                text.wrappedValue = textField.stringValue
            }
        }
    }
}

// BrowserRowView removed — replaced by BrowserTileView in SetupView

// MARK: - Tab Data Model

struct TabInfo: Identifiable {
    let id: Int
    let title: String
    let favIconUrl: String
    let thumbnail: NSImage?
    let url: String
}

// MARK: - Switcher Layout

/// Card arrangement for a given tab count. Up to 5 tabs sit in one row; from 6 on, cards split
/// into two rows with the extra card on top (6 → 3+3, 7 → 4+3, 8 → 4+4, 9 → 5+4, …).
/// Cards shrink proportionally when a row would be wider than the space available.
struct SwitcherLayout: Equatable {
    static let baseCardWidth: CGFloat = 220
    static let baseCardHeight: CGFloat = 146
    static let spacing: CGFloat = 12
    static let padding: CGFloat = 16
    static let minScale: CGFloat = 0.6
    
    static let empty = SwitcherLayout(rowSizes: [], cardWidth: baseCardWidth, cardHeight: baseCardHeight)
    
    let rowSizes: [Int]
    let cardWidth: CGFloat
    let cardHeight: CGFloat
    
    static func compute(tabCount: Int, maxWidth: CGFloat) -> SwitcherLayout {
        guard tabCount > 0 else { return .empty }
        let rows: [Int]
        if tabCount >= 6 {
            let top = (tabCount + 1) / 2
            rows = [top, tabCount - top]
        } else {
            rows = [tabCount]
        }
        let columns = rows.max() ?? 1
        let available = maxWidth - padding * 2 - CGFloat(columns - 1) * spacing
        let scale = min(1, max(minScale, available / (CGFloat(columns) * baseCardWidth)))
        return SwitcherLayout(
            rowSizes: rows,
            cardWidth: floor(baseCardWidth * scale),
            cardHeight: floor(baseCardHeight * scale)
        )
    }
    
    var columns: Int { rowSizes.max() ?? 0 }
    
    var contentWidth: CGFloat {
        guard columns > 0 else { return 0 }
        return CGFloat(columns) * cardWidth + CGFloat(columns - 1) * Self.spacing + Self.padding * 2
    }
    
    var contentHeight: CGFloat {
        let rows = rowSizes.filter { $0 > 0 }.count
        guard rows > 0 else { return 0 }
        return CGFloat(rows) * cardHeight + CGFloat(rows - 1) * Self.spacing + Self.padding * 2
    }
    
    /// Tab index range of each row, in reading order (left to right, top to bottom).
    var rowRanges: [Range<Int>] {
        var ranges: [Range<Int>] = []
        var start = 0
        for size in rowSizes {
            ranges.append(start..<(start + size))
            start += size
        }
        return ranges
    }
}

// MARK: - Tab Switcher State

class TabSwitcherState: ObservableObject {
    static let shared = TabSwitcherState()
    
    @Published var isVisible = false
    @Published var tabs: [TabInfo] = []
    @Published var selectedIndex: Int = 0
    @Published var layout: SwitcherLayout = .empty
    
    /// Set when the selection was changed by hovering, so the view skips auto-scroll.
    /// Scrolling under a stationary cursor would re-trigger hover on a different card.
    var selectionChangedByHover = false
    /// Cursor position when the switcher appeared. Hover is ignored until the cursor moves,
    /// so a card that happens to sit under the cursor isn't selected by accident.
    private var mouseLocationAtShow: NSPoint = .zero
    
    func showSwitcher(tabs: [TabInfo], selectedIndex: Int) {
        DispatchQueue.main.async {
            self.mouseLocationAtShow = NSEvent.mouseLocation
            self.selectionChangedByHover = false
            self.tabs = tabs
            self.selectedIndex = selectedIndex
            self.isVisible = true
        }
    }
    
    func updateSelection(index: Int) {
        DispatchQueue.main.async {
            self.selectionChangedByHover = false
            self.selectedIndex = index
        }
    }
    
    /// Called from a tab card's hover tracker (main thread). Selects the hovered card and
    /// tells the extension, so releasing the modifier switches to that tab.
    func hoverSelect(index: Int) {
        guard isVisible, index >= 0, index < tabs.count else { return }
        let location = NSEvent.mouseLocation
        if abs(location.x - mouseLocationAtShow.x) < 2 && abs(location.y - mouseLocationAtShow.y) < 2 {
            return
        }
        guard index != selectedIndex else { return }
        selectionChangedByHover = true
        selectedIndex = index
        debugLog("Hover selected index \(index)")
        sendMessage(["action": "select_tab", "tabId": tabs[index].id])
    }
    
    func hideSwitcher() {
        DispatchQueue.main.async {
            self.isVisible = false
            self.tabs = []
            self.selectedIndex = 0
            self.layout = .empty
        }
    }
}

// MARK: - Toast Notification

class ToastManager: ObservableObject {
    static let shared = ToastManager()

    @Published var isVisible = false
    @Published var isAnimatingOut = false
    @Published var message = ""
    @Published var detail = ""

    private var dismissTimer: DispatchWorkItem?
    private var animateOutTimer: DispatchWorkItem?

    func showToast(message: String, detail: String, duration: TimeInterval = 2.0) {
        DispatchQueue.main.async {
            self.dismissTimer?.cancel()
            self.animateOutTimer?.cancel()
            self.isAnimatingOut = false
            self.message = message
            self.detail = detail
            self.isVisible = true

            let timer = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                self.isAnimatingOut = true
                let hideTimer = DispatchWorkItem { [weak self] in
                    self?.isVisible = false
                    self?.isAnimatingOut = false
                }
                self.animateOutTimer = hideTimer
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: hideTimer)
            }
            self.dismissTimer = timer
            DispatchQueue.main.asyncAfter(deadline: .now() + duration, execute: timer)
        }
    }
}

struct ToastView: View {
    @ObservedObject var toast = ToastManager.shared
    let toastWidth: CGFloat = 260

    var body: some View {
        if toast.isVisible {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundColor(Color(red: 0.3, green: 0.85, blue: 0.4))

                VStack(alignment: .leading, spacing: 2) {
                    Text(toast.message)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                    Text(toast.detail)
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.6))
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
            }
            .frame(width: toastWidth)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(white: 0.22))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.white.opacity(0.18), lineWidth: 0.5)
            )
            .opacity(toast.isAnimatingOut ? 0 : 1)
            .scaleEffect(toast.isAnimatingOut ? 0.95 : 1)
            .animation(.easeInOut(duration: 0.25), value: toast.isAnimatingOut)
        }
    }
}

class ToastWindow: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 290, height: 54),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        self.level = .floating
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        self.isMovableByWindowBackground = false

        let hostingView = NSHostingView(rootView: ToastView())
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = .clear
        self.contentView = hostingView
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// MARK: - Tab Card View

struct TabCardView: View {
    let tab: TabInfo
    let isSelected: Bool
    var cardWidth: CGFloat = SwitcherLayout.baseCardWidth
    var cardHeight: CGFloat = SwitcherLayout.baseCardHeight
    let cornerRadius: CGFloat = 10
    
    var body: some View {
        ZStack(alignment: .top) {
            // Background layer - thumbnail or fallback
            Group {
                if let thumbnail = tab.thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: cardWidth, height: cardHeight)
                } else {
                    // Fallback gradient with favicon
                    ZStack {
                        LinearGradient(
                            gradient: Gradient(colors: [Color.gray.opacity(0.6), Color.gray.opacity(0.4)]),
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                        
                        // Large favicon in center
                        AsyncFaviconView(url: tab.favIconUrl, size: 36)
                    }
                }
            }
            .frame(width: cardWidth, height: cardHeight)
            
            // Title overlay at top - always on top
            HStack(spacing: 5) {
                AsyncFaviconView(url: tab.favIconUrl, size: 12)
                
                Text(tab.title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .truncationMode(.tail)
                
                Spacer()
            }
            .padding(.horizontal, 6)
            .padding(.top, 5)
            .padding(.bottom, 10)
            .frame(width: cardWidth)
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [Color.black.opacity(0.8), Color.black.opacity(0.0)]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .frame(width: cardWidth, height: cardHeight)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius)
                .stroke(isSelected ? Color.white : Color.white.opacity(0.15), lineWidth: isSelected ? 3 : 1)
        )
    }
}

// MARK: - Async Favicon View

struct AsyncFaviconView: View {
    let url: String
    let size: CGFloat
    @State private var image: NSImage?
    
    var body: some View {
        Group {
            if let image = image {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size)
            } else {
                Image(systemName: "globe")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size)
                    .foregroundColor(.white.opacity(0.7))
            }
        }
        .onAppear {
            loadFavicon()
        }
    }
    
    private func loadFavicon() {
        guard !url.isEmpty, let faviconURL = URL(string: url) else { return }
        
        URLSession.shared.dataTask(with: faviconURL) { data, _, _ in
            if let data = data,
               let loadedImage = downsampleImage(data, maxPixelSize: 72) ?? NSImage(data: data) {
                DispatchQueue.main.async {
                    self.image = loadedImage
                }
            }
        }.resume()
    }
}

// MARK: - Hover Tracking

/// Reports when the cursor is over a view. Uses an AppKit tracking area with `.activeAlways`
/// because the switcher panel never becomes key and the app is never active, which makes
/// SwiftUI's `.onHover` unreliable here.
final class HoverTrackingNSView: NSView {
    var onHover: (() -> Void)?
    private var trackingArea: NSTrackingArea?
    
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingArea {
            removeTrackingArea(existing)
        }
        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }
    
    override func mouseEntered(with event: NSEvent) { onHover?() }
    override func mouseMoved(with event: NSEvent) { onHover?() }
    
    // Only observes the cursor; never intercepts clicks.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

struct HoverTrackingView: NSViewRepresentable {
    let onHover: () -> Void
    
    func makeNSView(context: Context) -> HoverTrackingNSView {
        let view = HoverTrackingNSView()
        view.onHover = onHover
        return view
    }
    
    func updateNSView(_ nsView: HoverTrackingNSView, context: Context) {
        nsView.onHover = onHover
    }
}

// MARK: - Tab Switcher View

struct TabSwitcherView: View {
    @ObservedObject var state = TabSwitcherState.shared
    
    var body: some View {
        if state.isVisible && !state.tabs.isEmpty {
            let layout = state.layout
            let validIndices = 0..<state.tabs.count
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(spacing: SwitcherLayout.spacing) {
                        ForEach(Array(layout.rowRanges.enumerated()), id: \.offset) { _, range in
                            HStack(spacing: SwitcherLayout.spacing) {
                                // Clamp in case the layout briefly lags behind a tab list change
                                ForEach(range.clamped(to: validIndices), id: \.self) { index in
                                    TabCardView(
                                        tab: state.tabs[index],
                                        isSelected: index == state.selectedIndex,
                                        cardWidth: layout.cardWidth,
                                        cardHeight: layout.cardHeight
                                    )
                                    .overlay(
                                        HoverTrackingView { state.hoverSelect(index: index) }
                                    )
                                    .id(index)
                                }
                            }
                        }
                    }
                    .padding(SwitcherLayout.padding)
                }
                .onChange(of: state.selectedIndex) {
                    // Hover-driven changes happen under the cursor already; scrolling would
                    // move a different card under it and fight the user.
                    if state.selectionChangedByHover {
                        state.selectionChangedByHover = false
                        return
                    }
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo(state.selectedIndex, anchor: .center)
                    }
                }
            }
            .background(
                VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
            )
        }
    }
}

// MARK: - Visual Effect View (for blur background)

struct VisualEffectView: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode
    
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }
    
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}

// MARK: - Get Browser Window Frame

/// The display that anchors the global coordinate space. Its origin is (0, 0) in AppKit
/// coordinates and its top edge is y = 0 in WindowServer and Accessibility coordinates.
func primaryScreen() -> NSScreen? {
    return NSScreen.screens.first(where: { $0.frame.origin == .zero }) ?? NSScreen.screens.first
}

/// Flip a top-left-origin global rect (Accessibility or WindowServer) to AppKit's
/// bottom-left-origin space. Both spaces are anchored to the primary display, so the flip is
/// always around that display's top edge, whichever display the window is on. NSScreen.main
/// must not be used here: with no key window it follows whichever display the user is active
/// on, which placed the switcher a full screen height away when the browser sat on a display
/// above the primary one.
func flipToAppKit(topLeftOrigin: CGPoint, size: CGSize, desktopTop: CGFloat) -> NSRect {
    return NSRect(x: topLeftOrigin.x, y: desktopTop - topLeftOrigin.y - size.height,
                  width: size.width, height: size.height)
}

/// The window the user is actually typing into, via Accessibility.
///
/// This is not the same as the frontmost window in WindowServer's z-order. With a browser
/// window open on more than one display, that list keeps the window on the display holding the
/// menu bar ahead of the focused one, so choosing by z-order opened the switcher on the wrong
/// display whenever the focused window was somewhere else.
func focusedBrowserWindowFrame(pid: pid_t, desktopTop: CGFloat) -> NSRect? {
    let appElement = AXUIElementCreateApplication(pid)
    // Bound the round trip. The browser is busy handling the keystroke we just intercepted, and
    // a slow reply must not hold up the switcher; the caller falls back to WindowServer data.
    AXUIElementSetMessagingTimeout(appElement, 0.2)

    var windowRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowRef) == .success,
          let focusedWindow = windowRef else {
        debugLog("No Accessibility focused window for pid \(pid)")
        return nil
    }

    var positionRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    let window = focusedWindow as! AXUIElement
    guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionRef) == .success,
          AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let positionValue = positionRef,
          let sizeValue = sizeRef else {
        debugLog("Could not read the focused window's position or size")
        return nil
    }

    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size),
          size.width > 100, size.height > 100 else {
        debugLog("Focused window has no usable geometry")
        return nil
    }

    return flipToAppKit(topLeftOrigin: position, size: size, desktopTop: desktopTop)
}

/// The frontmost browser window in WindowServer's z-order. Used only when Accessibility
/// declines or times out, since it cannot tell which window has focus.
func frontmostBrowserWindowFrame(pid: pid_t, desktopTop: CGFloat) -> NSRect? {
    guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        debugLog("Could not read the window list")
        return nil
    }

    // The list is front to back, so the first match is the frontmost window of that process.
    for window in windows {
        guard window[kCGWindowOwnerPID as String] as? pid_t == pid,
              window[kCGWindowLayer as String] as? Int == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              frame.width > 100, frame.height > 100 else { continue }
        return flipToAppKit(topLeftOrigin: frame.origin, size: frame.size, desktopTop: desktopTop)
    }

    debugLog("No browser window found in the window list")
    return nil
}

func getBrowserWindowFrame() -> NSRect? {
    // First check if a supported browser is the frontmost app
    guard let frontApp = NSWorkspace.shared.frontmostApplication,
          let bundleId = frontApp.bundleIdentifier,
          BrowserConfigManager.shared.enabledBundleIds.contains(bundleId) else {
        debugLog("No supported browser is frontmost")
        return nil
    }
    guard let desktopTop = primaryScreen()?.frame.maxY else {
        debugLog("No primary screen")
        return nil
    }

    if let frame = focusedBrowserWindowFrame(pid: frontApp.processIdentifier, desktopTop: desktopTop) {
        debugLog("Browser window (focused): \(frame)")
        return frame
    }

    if let frame = frontmostBrowserWindowFrame(pid: frontApp.processIdentifier, desktopTop: desktopTop) {
        debugLog("Browser window (frontmost, Accessibility unavailable): \(frame)")
        return frame
    }

    return nil
}

/// The screen containing the centre of `rect`, else the screen it overlaps most, else nil.
func screenContaining(_ rect: NSRect) -> NSScreen? {
    let center = NSPoint(x: rect.midX, y: rect.midY)
    if let screen = NSScreen.screens.first(where: { $0.frame.contains(center) }) {
        return screen
    }
    func overlap(_ screen: NSScreen) -> CGFloat {
        let i = screen.frame.intersection(rect)
        return i.isNull ? 0 : i.width * i.height
    }
    return NSScreen.screens.max { overlap($0) < overlap($1) }
}

/// Clamp a window origin so the span [origin, origin + length] stays inside `range`. If the span
/// is longer than the range, the lower edge wins.
func clampOrigin(_ origin: CGFloat, length: CGFloat, within range: ClosedRange<CGFloat>) -> CGFloat {
    let maxOrigin = max(range.lowerBound, range.upperBound - length)
    return min(max(origin, range.lowerBound), maxOrigin)
}

// MARK: - Floating Window

class TabSwitcherWindow: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 128),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        
        self.level = .floating
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        self.isMovableByWindowBackground = false
        self.acceptsMouseMovedEvents = true // needed for hover tracking on cards
        
        let hostingView = NSHostingView(rootView: TabSwitcherView())
        self.contentView = hostingView
    }
    
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// MARK: - Command Bar

/// One suggestion in the command bar. `payload` is the extension's own description of the row
/// and goes back unchanged when the row is chosen.
struct CommandBarItem: Identifiable {
    let id: Int
    let kind: String
    let title: String
    let detail: String
    let hint: String
    /// SF Symbol drawn for a row without a favicon, such as a command.
    let symbol: String
    /// What the field shows while the row is selected with the arrow keys. Empty leaves the
    /// field as typed.
    let fill: String
    let favicon: NSImage?
    let payload: [String: Any]
}

func parseCommandBarItems(_ results: [[String: Any]]) -> [CommandBarItem] {
    var items: [CommandBarItem] = []
    for var dict in results {
        guard let kind = dict["kind"] as? String else { continue }
        var favicon: NSImage? = nil
        if let dataUrl = dict.removeValue(forKey: "favicon") as? String,
           let comma = dataUrl.firstIndex(of: ","),
           let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])) {
            favicon = downsampleImage(data, maxPixelSize: 64)
        }
        // Display-only fields stay out of the payload sent back when the row is chosen.
        let fill = dict.removeValue(forKey: "fill") as? String ?? ""
        items.append(CommandBarItem(
            id: items.count,
            kind: kind,
            title: dict["title"] as? String ?? "",
            detail: dict["detail"] as? String ?? "",
            hint: dict["hint"] as? String ?? "",
            symbol: dict["symbol"] as? String ?? "",
            fill: fill,
            favicon: favicon,
            payload: dict
        ))
    }
    return items
}

/// A one-line tip at the foot of an empty bar. Text between backticks is what to type.
struct CommandBarTip {
    let id: String
    let text: String
}

enum CommandBarLayout {
    static let maxWidth: CGFloat = 720
    static let minWidth: CGFloat = 360
    static let fieldHeight: CGFloat = 62
    static let rowHeight: CGFloat = 46
    static let rowSpacing: CGFloat = 2
    static let listPadding: CGFloat = 8
    static let cornerRadius: CGFloat = 16
    static let tipHeight: CGFloat = 34

    static func height(rows: Int, tip: Bool = false) -> CGFloat {
        var height = fieldHeight
        if rows > 0 {
            height += 1 + listPadding * 2 + CGFloat(rows) * rowHeight + CGFloat(rows - 1) * rowSpacing
        }
        if tip {
            height += 1 + tipHeight
        }
        return height
    }
}

/// The command bar on screen. The extension supplies the rows and opens the choice; this side
/// owns the panel, the text and the selection.
final class CommandBarState: NSObject, ObservableObject, NSTextFieldDelegate, NSWindowDelegate {
    static let shared = CommandBarState()

    @Published var items: [CommandBarItem] = []
    @Published var selectedIndex: Int?
    /// The text the rows were found for, whose words are shown in bold in the titles.
    @Published var itemsQuery = ""
    /// Shown below the rows while nothing is typed. It is not a row, so the keys never select it.
    @Published var tip: CommandBarTip?

    private(set) var isVisible = false
    /// What was typed. The field can show more: an inline completion after it, selected.
    private var typed = ""
    /// Set when the last edit added text at the end. Only then is a completion shown, so
    /// deleting a completion does not bring it straight back.
    private var completing = false
    private var querySeq = 0
    private var panel: CommandBarPanel?
    /// Hover is ignored until the cursor moves, so a row that appears under a resting cursor is
    /// not selected by accident.
    private var mouseLocationAtShow: NSPoint = .zero

    /// Show the bar over the focused browser window, holding `text` (selected, so typing
    /// replaces it). Called again while open, it starts over with the new text. `placeholder`
    /// replaces the usual prompt, for a second choice such as the tab to split with.
    func show(text: String, placeholder: String? = nil) {
        if panel == nil {
            let newPanel = CommandBarPanel()
            newPanel.delegate = self
            newPanel.field.delegate = self
            panel = newPanel
        }
        guard let panel = panel else { return }

        let target = getBrowserWindowFrame() ?? (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? .zero
        let width = min(CommandBarLayout.maxWidth, max(CommandBarLayout.minWidth, target.width - 48))
        let height = CommandBarLayout.height(rows: 0)
        // A little above the middle of the window, like Arc and Zen.
        let top = target.maxY - max(70, target.height * 0.22)
        var frame = NSRect(x: target.midX - width / 2, y: top - height, width: width, height: height)
        if let bounds = (screenContaining(target) ?? NSScreen.main)?.visibleFrame {
            frame.origin.x = clampOrigin(frame.origin.x, length: width, within: bounds.minX...bounds.maxX)
            frame.origin.y = clampOrigin(frame.origin.y, length: height, within: bounds.minY...bounds.maxY)
        }

        typed = text
        completing = false
        items = []
        itemsQuery = ""
        tip = nil
        selectedIndex = nil
        mouseLocationAtShow = NSEvent.mouseLocation
        isVisible = true

        panel.setFrame(frame, display: false)
        panel.setPlaceholder(placeholder ?? CommandBarPanel.defaultPlaceholder)
        panel.field.stringValue = text
        // SwiftUI adds the field to the window during layout. On the panel's first show that
        // has not happened yet, and focusing a field outside the window fails silently, which
        // left the first bar after a launch deaf to typing.
        panel.contentView?.layoutSubtreeIfNeeded()
        panel.makeKeyAndOrderFront(nil)
        focusField()
        sendQuery()
    }

    private func focusField(retries: Int = 3) {
        guard let panel = panel, isVisible else { return }
        if panel.field.window == panel, panel.makeFirstResponder(panel.field) {
            panel.field.currentEditor()?.selectAll(nil)
        } else if retries > 0 {
            DispatchQueue.main.async { self.focusField(retries: retries - 1) }
        } else {
            debugLog("Command bar: could not focus the search field")
        }
    }

    /// Rows for query `seq`. A `refresh` carries the same rows again with their favicons.
    func receiveResults(seq: Int, items: [CommandBarItem], autocomplete: String, tip: CommandBarTip?, refresh: Bool) {
        guard isVisible, seq == querySeq else { return }
        if refresh {
            if items.count == self.items.count {
                self.items = items
            }
            return
        }
        self.items = items
        self.tip = tip
        itemsQuery = typed
        selectedIndex = typed.trimmingCharacters(in: .whitespaces).isEmpty || items.isEmpty ? nil : 0
        if completing {
            showCompletion(autocomplete)
        }
        resizePanel()
    }

    /// Hide the bar without opening anything.
    func dismiss() {
        guard isVisible else { return }
        hidePanel()
        sendMessage(["action": "command_bar_closed"])
    }

    /// Open a row, or the text in the field when no row is selected, and hide the bar.
    func choose(index: Int?) {
        guard isVisible else { return }
        var message: [String: Any] = ["action": "command_bar_choose", "text": panel?.field.stringValue ?? typed]
        if let index = index, items.indices.contains(index) {
            message["item"] = items[index].payload
            // A command that asks for a second choice keeps the bar open. The extension shows
            // it again with the new prompt.
            if items[index].payload["pick"] != nil {
                items = []
                selectedIndex = nil
                resizePanel()
                sendMessage(message)
                return
            }
        }
        // Hide first, so the browser window has the keyboard back before the tab opens.
        hidePanel()
        sendMessage(message)
    }

    /// Retire the tip on show. The bar stays open.
    func dismissTip() {
        guard isVisible, let tip = tip else { return }
        self.tip = nil
        resizePanel()
        sendMessage(["action": "command_bar_dismiss_tip", "id": tip.id])
    }

    func hoverSelect(index: Int) {
        guard isVisible, items.indices.contains(index), index != selectedIndex else { return }
        let location = NSEvent.mouseLocation
        if abs(location.x - mouseLocationAtShow.x) < 2 && abs(location.y - mouseLocationAtShow.y) < 2 {
            return
        }
        selectedIndex = index
    }

    /// Put `completion` in the field after what was typed, with the added part selected so the
    /// next keystroke replaces it. Skipped if the field has moved on since the query was sent.
    private func showCompletion(_ completion: String) {
        guard let field = panel?.field,
              let editor = field.currentEditor() as? NSTextView,
              field.stringValue == typed,
              editor.selectedRange() == NSRange(location: (typed as NSString).length, length: 0),
              completion.count > typed.count,
              completion.lowercased().hasPrefix(typed.lowercased()) else { return }
        let shown = typed + completion.dropFirst(typed.count)
        field.stringValue = shown
        let start = (typed as NSString).length
        editor.setSelectedRange(NSRange(location: start, length: (shown as NSString).length - start))
    }

    /// Select the next or previous row, and show it in the field the way Arc and Zen do. Typing
    /// after that edits what the field shows.
    private func move(_ delta: Int) {
        guard !items.isEmpty else { return }
        let index: Int
        if let current = selectedIndex {
            index = (current + delta + items.count) % items.count
        } else {
            index = delta > 0 ? 0 : items.count - 1
        }
        selectedIndex = index
        let fill = items[index].fill
        guard !fill.isEmpty, let field = panel?.field else { return }
        field.stringValue = fill
        field.currentEditor()?.selectedRange = NSRange(location: (fill as NSString).length, length: 0)
    }

    private func sendQuery() {
        querySeq += 1
        sendMessage(["action": "command_bar_query", "query": typed, "seq": querySeq])
    }

    private func hidePanel() {
        isVisible = false
        panel?.orderOut(nil)
        items = []
        tip = nil
        selectedIndex = nil
    }

    /// Grow or shrink the panel to its rows, keeping its top edge where it is.
    private func resizePanel() {
        guard let panel = panel else { return }
        var frame = panel.frame
        let height = CommandBarLayout.height(rows: items.count, tip: tip != nil)
        frame.origin.y = frame.maxY - height
        frame.size.height = height
        panel.setFrame(frame, display: true)
        panel.invalidateShadow()
    }

    // MARK: NSTextFieldDelegate

    func controlTextDidChange(_ obj: Notification) {
        guard let field = obj.object as? NSTextField else { return }
        let value = field.stringValue
        completing = value.count > typed.count && value.hasPrefix(typed)
        typed = value
        sendQuery()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        switch commandSelector {
        case #selector(NSResponder.moveDown(_:)), #selector(NSResponder.insertTab(_:)):
            move(1)
        case #selector(NSResponder.moveUp(_:)), #selector(NSResponder.insertBacktab(_:)):
            move(-1)
        case #selector(NSResponder.insertNewline(_:)):
            choose(index: selectedIndex)
        case #selector(NSResponder.cancelOperation(_:)):
            dismiss()
        default:
            return false
        }
        return true
    }

    // MARK: NSWindowDelegate

    /// A click outside the bar, or a switch to another app, closes it.
    func windowDidResignKey(_ notification: Notification) {
        dismiss()
    }
}

/// The search field. The app has no Edit menu while it runs as a helper, so the editing
/// shortcuts are handled here.
final class CommandBarTextField: NSTextField {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
           let editor = currentEditor() {
            switch event.charactersIgnoringModifiers {
            case "a": editor.selectAll(nil); return true
            case "c": editor.copy(nil); return true
            case "v": editor.paste(nil); return true
            case "x": editor.cut(nil); return true
            default: break
            }
        }
        return super.performKeyEquivalent(with: event)
    }
}

struct CommandBarFieldView: NSViewRepresentable {
    let field: NSTextField

    func makeNSView(context: Context) -> NSTextField { field }
    func updateNSView(_ nsView: NSTextField, context: Context) {}
}

/// `text` with every place a word of `query` occurs set in bold, as Zen and Arc show matches.
func commandBarHighlighted(_ text: String, query: String) -> AttributedString {
    var attributed = AttributedString(text)
    for word in query.lowercased().split(separator: " ") where !word.isEmpty {
        var searchStart = attributed.startIndex
        while searchStart < attributed.endIndex,
              let range = attributed[searchStart...].range(of: String(word), options: .caseInsensitive) {
            attributed[range].font = .system(size: 15, weight: .semibold)
            attributed[range].foregroundColor = .white
            searchStart = range.upperBound
        }
    }
    return attributed
}

struct CommandBarRow: View {
    let item: CommandBarItem
    let query: String
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            icon
            HStack(spacing: 0) {
                Text(commandBarHighlighted(item.title, query: item.kind == "search" ? "" : query))
                    .foregroundColor(.white.opacity(isSelected ? 1 : 0.85))
                    .layoutPriority(1)
                if !item.detail.isEmpty {
                    Text("  —  " + item.detail)
                        .foregroundColor(.white.opacity(isSelected ? 0.8 : 0.5))
                }
            }
            .font(.system(size: 15))
            .lineLimit(1)
            .truncationMode(.tail)
            Spacer(minLength: 8)
            if !item.hint.isEmpty {
                HStack(spacing: 8) {
                    Text(item.hint)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(isSelected ? 0.9 : 0.55))
                    if item.kind == "tab" {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.white.opacity(0.85))
                            .frame(width: 22, height: 22)
                            .background(RoundedRectangle(cornerRadius: 5).fill(Color.white.opacity(0.18)))
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: CommandBarLayout.rowHeight)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(isSelected ? Color(nsColor: .controlAccentColor).opacity(0.38) : Color.clear)
        )
    }

    private var icon: some View {
        Group {
            if let favicon = item.favicon {
                Image(nsImage: favicon)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                Image(systemName: !item.symbol.isEmpty ? item.symbol : item.kind == "search" ? "magnifyingglass" : "globe")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .foregroundColor(isSelected ? .black.opacity(0.7) : .white.opacity(0.75))
            }
        }
        .frame(width: 16, height: 16)
        .frame(width: 28, height: 28)
        .background(RoundedRectangle(cornerRadius: 7).fill(Color.white.opacity(isSelected ? 0.9 : 0.08)))
    }
}

/// A tip's text, with what to type set apart in a monospaced font.
func commandBarTipText(_ text: String) -> AttributedString {
    var attributed = AttributedString()
    for (index, part) in text.split(separator: "`", omittingEmptySubsequences: false).enumerated() {
        if index % 2 == 1 {
            var code = AttributedString("\u{2009}" + part + "\u{2009}")
            code.font = .system(size: 12, design: .monospaced)
            code.foregroundColor = .white.opacity(0.85)
            code.backgroundColor = .white.opacity(0.1)
            attributed += code
        } else {
            attributed += AttributedString(String(part))
        }
    }
    return attributed
}

struct CommandBarTipView: View {
    let tip: CommandBarTip
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "lightbulb")
                .font(.system(size: 12))
            Text(commandBarTipText(tip.text))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 8)
            Image(systemName: "xmark")
                .font(.system(size: 10, weight: .semibold))
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
                .onTapGesture(perform: onDismiss)
                .help("Don't show this tip again")
        }
        .font(.system(size: 12))
        .foregroundColor(.white.opacity(0.5))
        .padding(.horizontal, 20)
        .frame(height: CommandBarLayout.tipHeight)
    }
}

struct CommandBarView: View {
    @ObservedObject var state = CommandBarState.shared
    let field: NSTextField

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 17, weight: .regular))
                    .foregroundColor(.white.opacity(0.45))
                CommandBarFieldView(field: field)
            }
            .padding(.horizontal, 22)
            .frame(height: CommandBarLayout.fieldHeight)

            if !state.items.isEmpty {
                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 1)
                    .padding(.horizontal, 12)
                VStack(spacing: CommandBarLayout.rowSpacing) {
                    ForEach(state.items) { item in
                        CommandBarRow(item: item, query: state.itemsQuery, isSelected: state.selectedIndex == item.id)
                            .contentShape(Rectangle())
                            .background(HoverTrackingView { state.hoverSelect(index: item.id) })
                            .onTapGesture { state.choose(index: item.id) }
                    }
                }
                .padding(CommandBarLayout.listPadding)
            }

            if let tip = state.tip {
                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 1)
                    .padding(.horizontal, 12)
                CommandBarTipView(tip: tip) { state.dismissTip() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(white: 0.11))
        .clipShape(RoundedRectangle(cornerRadius: CommandBarLayout.cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: CommandBarLayout.cornerRadius)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
    }
}

/// A panel that takes the keyboard without activating the app, so the browser stays the
/// frontmost app while the bar is typed into, the way Spotlight works.
final class CommandBarPanel: NSPanel {
    let field = CommandBarTextField()

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: CommandBarLayout.maxWidth, height: CommandBarLayout.fieldHeight),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        level = .floating
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        acceptsMouseMovedEvents = true
        appearance = NSAppearance(named: .darkAqua)

        let font = NSFont.systemFont(ofSize: 18)
        field.font = font
        field.textColor = .white
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.usesSingleLineMode = true
        field.cell?.wraps = false
        field.cell?.isScrollable = true
        setPlaceholder(CommandBarPanel.defaultPlaceholder)

        contentView = NSHostingView(rootView: CommandBarView(field: field))
    }

    static let defaultPlaceholder = "Search with Google or enter address"

    func setPlaceholder(_ text: String) {
        field.placeholderAttributedString = NSAttributedString(
            string: text,
            attributes: [.foregroundColor: NSColor.white.withAlphaComponent(0.4), .font: field.font ?? NSFont.systemFont(ofSize: 18)]
        )
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: TabSwitcherWindow?
    var toastWindow: ToastWindow?
    var setupWindow: NSWindow?
    var cancellable: AnyCancellable?
    var toastCancellable: AnyCancellable?
    var setupCancellable: AnyCancellable?
    var launchedDirectly = false
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Setup application menu (for Cmd+Q support)
        if launchedDirectly {
            setupMainMenu()
        }
        debugLog("App delegate launched, launchedDirectly=\(launchedDirectly)")

        // Setup macOS system notifications for background update checking
        BackgroundUpdateChecker.shared.setupNotifications()
        
        // Floating windows are created on first use. Every profile runs a helper, but only
        // the one owning the focused browser ever shows a switcher.

        // Observe toast visibility
        toastCancellable = ToastManager.shared.$isVisible.sink { [weak self] isVisible in
            DispatchQueue.main.async {
                if isVisible {
                    if self?.toastWindow == nil { self?.toastWindow = ToastWindow() }
                    let toastWidth: CGFloat = 290
                    let toastHeight: CGFloat = 54
                    let bottomMargin: CGFloat = 20
                    // Position bottom-center of browser window
                    if let chromeFrame = getBrowserWindowFrame() {
                        let x = chromeFrame.midX - toastWidth / 2
                        let y = chromeFrame.minY + bottomMargin
                        self?.toastWindow?.setContentSize(NSSize(width: toastWidth, height: toastHeight))
                        self?.toastWindow?.setFrameOrigin(NSPoint(x: x, y: y))
                    } else if let screen = NSScreen.main {
                        let x = screen.visibleFrame.midX - toastWidth / 2
                        let y = screen.visibleFrame.minY + bottomMargin
                        self?.toastWindow?.setContentSize(NSSize(width: toastWidth, height: toastHeight))
                        self?.toastWindow?.setFrameOrigin(NSPoint(x: x, y: y))
                    }
                    self?.toastWindow?.invalidateShadow()
                    self?.toastWindow?.orderFront(nil)
                } else {
                    self?.toastWindow?.orderOut(nil)
                    self?.toastWindow = nil
                }
            }
        }
        
        // Only show setup UI when launched directly (from Finder/Dock)
        // Native messaging launches should NEVER show UI or dock icon
        if launchedDirectly {
            debugLog("Direct launch - showing setup window")
            // Always set showingSetup to true for direct launches so the window stays open
            allowConfigUI = true
            BrowserConfigManager.shared.showingSetup = true
            showSetupWindow()
            NSApp.activate(ignoringOtherApps: true)
        } else {
            debugLog("Running as accessory (native messaging mode)")
        }
        
        // Observe setup window state - but ONLY for direct launches
        setupCancellable = BrowserConfigManager.shared.$showingSetup
            .dropFirst() // Skip initial value to prevent immediate close
            .sink { [weak self] showing in
                guard let self = self else { return }
                
                // CRITICAL: Never process for native messaging instances unless user requested it
                if !self.launchedDirectly && !allowConfigUI {
                    return
                }
                
                DispatchQueue.main.async {
                    if showing {
                        NSApp.setActivationPolicy(.regular)
                        self.showSetupWindow()
                    } else {
                        self.setupWindow?.close()
                        self.setupWindow = nil
                        if !self.launchedDirectly {
                            // Return to background mode if this was only a temporary UI
                            NSApp.setActivationPolicy(.accessory)
                            allowConfigUI = false
                        }
                    }
                }
            }
        
        // Observe state changes to show/hide switcher window
        cancellable = TabSwitcherState.shared.$isVisible.sink { [weak self] isVisible in
            debugLog("Visibility changed to: \(isVisible)")
            DispatchQueue.main.async {
                if isVisible {
                    let startedAt = DispatchTime.now().uptimeNanoseconds
                    debugLog("Showing window with \(TabSwitcherState.shared.tabs.count) tabs")
                    
                    let tabCount = TabSwitcherState.shared.tabs.count
                    guard tabCount > 0 else { return }
                    // Kept alive after the first switch: rebuilding the panel and its SwiftUI
                    // hosting view sits directly on the path between the keypress and the first
                    // frame. The previews are released on hide instead, which is where the
                    // memory actually was.
                    if self?.window == nil { self?.window = TabSwitcherWindow() }
                    
                    // Get browser window frame
                    let chromeFrame = getBrowserWindowFrame()
                    
                    // Fallback when the browser frame is unavailable: the display the user is on
                    guard let fallbackScreen = NSScreen.main ?? NSScreen.screens.first else { return }
                    
                    // Use browser frame if available and valid, otherwise use screen
                    let targetFrame: NSRect
                    if let frame = chromeFrame, 
                       frame.width > 200 && frame.height > 200,
                       frame.origin.x >= -10000 && frame.origin.y >= -10000 {
                        targetFrame = frame
                        debugLog("Using browser window frame: \(frame)")
                    } else {
                        targetFrame = fallbackScreen.visibleFrame
                        debugLog("Falling back to screen frame: \(targetFrame)")
                    }
                    
                    // Lay out cards (rows + size) to fit within target, with max limit
                    let maxWidth = min(targetFrame.width - 40, 1200) // 20px margin on each side
                    let layout = SwitcherLayout.compute(tabCount: tabCount, maxWidth: maxWidth)
                    TabSwitcherState.shared.layout = layout
                    let width = min(layout.contentWidth, maxWidth)
                    let height = layout.contentHeight
                    debugLog("Layout rows=\(layout.rowSizes) card=\(layout.cardWidth)x\(layout.cardHeight)")
                    
                    self?.window?.setContentSize(NSSize(width: width, height: height))
                    
                    // Center within target frame
                    let x = targetFrame.origin.x + (targetFrame.width - width) / 2
                    let y = targetFrame.origin.y + (targetFrame.height - height) / 2 + targetFrame.height * 0.08 // Slightly above center
                    
                    // Keep the switcher on the display the browser window is on. Displays left of
                    // or below the primary one have negative coordinates, so clamping to 0 would
                    // drag the switcher onto the primary display.
                    let bounds = (screenContaining(targetFrame) ?? fallbackScreen).visibleFrame
                    let finalX = clampOrigin(x, length: width, within: bounds.minX...bounds.maxX)
                    let finalY = clampOrigin(y, length: height, within: bounds.minY...bounds.maxY)
                    
                    self?.window?.setFrameOrigin(NSPoint(x: finalX, y: finalY))
                    self?.window?.orderFront(nil)
                    let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
                    debugLog("Window positioned at (\(finalX), \(finalY)) with size \(width)x\(height) in \(elapsedMs) ms")
                } else {
                    debugLog("Hiding window")
                    self?.window?.orderOut(nil)
                }
            }
        }
    }
    
    func showSetupWindow() {
        if setupWindow == nil {
            let setupView = SetupView()
            setupWindow = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 460, height: 580),
                styleMask: [.titled, .closable, .fullSizeContentView],
                backing: .buffered,
                defer: false
            )
            setupWindow?.title = APP_NAME
            setupWindow?.titlebarAppearsTransparent = true
            setupWindow?.contentView = NSHostingView(rootView: setupView)
            setupWindow?.center()
            setupWindow?.isReleasedWhenClosed = false

            // Handle window close
            setupWindow?.delegate = self
        }
        
        // Ensure we can receive focus/menus even if we were running as a background app
        NSApp.setActivationPolicy(.regular)
        if NSApp.mainMenu == nil {
            setupMainMenu()
        }
        setupWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate()
        NSRunningApplication.current.activate()
    }
    
    func setupMainMenu() {
        let mainMenu = NSMenu()
        
        // App menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About \(APP_NAME)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide \(APP_NAME)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthersItem = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit \(APP_NAME)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)
        
        // Window menu
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)
        
        NSApp.mainMenu = mainMenu
    }
}

extension AppDelegate: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        if notification.object as? NSWindow == setupWindow {
            BrowserConfigManager.shared.showingSetup = false
        }
    }
}

extension AppDelegate {
    // Called when user clicks dock icon while app is running
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            allowConfigUI = true
            BrowserConfigManager.shared.showingSetup = true
        }
        return true
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        debugLog("Application will terminate - cleaning up locks")
        cleanupEventTapLock()
        BackgroundUpdateChecker.shared.cleanupUpdateCheckLock()
    }
}

// MARK: - Debug Logging (to stderr, doesn't interfere with native messaging)

let DEBUG_LOGGING = true // Set to true for debugging
let DEBUG_LOG_FILE = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/\(APP_NAME).log")

// The log is moved aside to Arclike.old.log once it reaches this size, so it never holds more
// than twice this on disk. The command bar logs every keystroke.
let DEBUG_LOG_MAX_BYTES: UInt64 = 2 * 1024 * 1024
let debugLogDateFormatter = ISO8601DateFormatter()
let debugLogLock = NSLock()

func debugLog(_ message: String) {
    if DEBUG_LOGGING {
        debugLogLock.lock()
        defer { debugLogLock.unlock() }
        let timestamp = debugLogDateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] TabSwitch: \(message)\n"
        
        // Write to stderr
        FileHandle.standardError.write(logMessage.data(using: .utf8)!)
        
        // Also append to log file for debugging
        if let data = logMessage.data(using: .utf8) {
            if let size = (try? FileManager.default.attributesOfItem(atPath: DEBUG_LOG_FILE.path))?[.size] as? UInt64,
               size > DEBUG_LOG_MAX_BYTES {
                let old = DEBUG_LOG_FILE.deletingPathExtension().appendingPathExtension("old.log")
                try? FileManager.default.removeItem(at: old)
                try? FileManager.default.moveItem(at: DEBUG_LOG_FILE, to: old)
            }
            if FileManager.default.fileExists(atPath: DEBUG_LOG_FILE.path) {
                if let handle = try? FileHandle(forWritingTo: DEBUG_LOG_FILE) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    handle.closeFile()
                }
            } else {
                try? data.write(to: DEBUG_LOG_FILE)
            }
        }
    }
}

// MARK: - Native Messaging Protocol

// Serializes stdout writes so messages sent from different threads can't interleave
let sendMessageLock = NSLock()

func sendMessage(_ dict: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: dict, options: []) else {
        debugLog("Failed to serialize message")
        return
    }
    
    var length = UInt32(jsonData.count).littleEndian
    let lengthData = Data(bytes: &length, count: 4)
    
    sendMessageLock.lock()
    FileHandle.standardOutput.write(lengthData)
    FileHandle.standardOutput.write(jsonData)
    sendMessageLock.unlock()
}

func sendAction(_ action: String) {
    sendMessage(["action": action])
}

// Set once stdin reaches EOF, which is the browser closing the connection. A message that
// simply fails to parse must not be mistaken for this.
var stdinClosed = false

func readMessage() -> [String: Any]? {
    let lengthData = FileHandle.standardInput.readData(ofLength: 4)
    guard lengthData.count == 4 else { 
        // Connection closed (EOF) - extension disconnected
        stdinClosed = true
        debugLog("Connection closed (EOF on stdin) - extension disconnected, exiting...")
        // Exit the app when the extension disconnects
        // This is critical for multi-profile support - prevents orphan processes
        DispatchQueue.main.async {
            NSApplication.shared.terminate(nil)
        }
        return nil 
    }
    
    let length = lengthData.withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
    guard length > 0 && length < 10 * 1024 * 1024 else { 
        debugLog("Invalid message length: \(length)")
        return nil 
    }
    
    let messageData = FileHandle.standardInput.readData(ofLength: Int(length))
    guard messageData.count == Int(length) else { 
        debugLog("Incomplete message data")
        return nil 
    }
    
    let result = try? JSONSerialization.jsonObject(with: messageData, options: []) as? [String: Any]
    if let action = result?["action"] as? String {
        debugLog("Received message: \(action)")
    }
    return result
}

// MARK: - Message Handler

func handleMessage(_ message: [String: Any]) {
    guard let action = message["action"] as? String else { 
        debugLog("Message has no action")
        return 
    }
    
    debugLog("Handling action: \(action)")
    
    switch action {
    case "show_switcher":
        if let tabsData = message["tabs"] as? [[String: Any]],
           let selectedIndex = message["selectedIndex"] as? Int {
            let tabs = tabsData.compactMap { parseTabInfo($0) }
            debugLog("Showing switcher with \(tabs.count) tabs, selected: \(selectedIndex)")
            TabSwitcherState.shared.showSwitcher(tabs: tabs, selectedIndex: selectedIndex)
        } else {
            debugLog("Invalid show_switcher data")
        }
        
    case "update_selection":
        if let selectedIndex = message["selectedIndex"] as? Int {
            debugLog("Updating selection to: \(selectedIndex)")
            TabSwitcherState.shared.updateSelection(index: selectedIndex)
        }
        
    case "hide_switcher":
        debugLog("Hiding switcher")
        TabSwitcherState.shared.hideSwitcher()

    case "show_command_bar":
        let text = message["text"] as? String ?? ""
        let placeholder = message["placeholder"] as? String
        DispatchQueue.main.async {
            CommandBarState.shared.show(text: text, placeholder: placeholder)
        }

    case "command_bar_results":
        if let seq = message["seq"] as? Int, let results = message["results"] as? [[String: Any]] {
            let items = parseCommandBarItems(results)
            let autocomplete = message["autocomplete"] as? String ?? ""
            let refresh = message["refresh"] as? Bool ?? false
            var tip: CommandBarTip? = nil
            if let dict = message["tip"] as? [String: Any], let id = dict["id"] as? String, let text = dict["text"] as? String {
                tip = CommandBarTip(id: id, text: text)
            }
            debugLog("Command bar results for query \(seq): \(items.count) rows\(refresh ? " (favicons)" : "")")
            DispatchQueue.main.async {
                CommandBarState.shared.receiveResults(seq: seq, items: items, autocomplete: autocomplete, tip: tip, refresh: refresh)
            }
        }

    case "little_arc_focus":
        let focused = message["focused"] as? Bool ?? false
        DispatchQueue.main.async {
            littleArcFocusedHere = focused
            guard let browser = ownerBrowserBundleId else { return }
            DistributedNotificationCenter.default().postNotificationName(
                NSNotification.Name(littleArcFocusNotificationName),
                object: nil,
                userInfo: ["browser": browser, "pid": Int(myProcessId), "focused": focused],
                deliverImmediately: true
            )
        }

    case "log":
        if let text = message["message"] as? String {
            debugLog("Extension: \(text)")
        }
        
    case "register":
        // Extension tells us which browser it's running in
        // Only use this if we couldn't auto-detect, or if it matches a known browser
        if let extVersion = message["extensionVersion"] as? String {
            debugLog("Extension version: \(extVersion)")
            BackgroundUpdateChecker.shared.setExtensionVersion(extVersion)
        }
        if let bundleId = message["bundleId"] as? String {
            if ownerBrowserBundleId == nil {
                ownerBrowserBundleId = bundleId
                // Try to detect the PID now if we didn't before
                if ownerBrowserProcessId == nil {
                    if let (_, detectedPid) = detectParentBrowser() {
                        ownerBrowserProcessId = detectedPid
                        debugLog("Registered with browser (from extension): \(bundleId) with late-detected PID \(detectedPid)")
                    } else {
                        debugLog("Registered with browser (from extension): \(bundleId) but couldn't detect PID")
                    }
                } else {
                    debugLog("Registered with browser (from extension): \(bundleId)")
                }
            } else {
                debugLog("Already auto-detected browser: \(ownerBrowserBundleId!) (PID \(ownerBrowserProcessId ?? -1)), ignoring extension registration: \(bundleId)")
            }
            let shortcuts: [String: String] = [
                "tabSwitch": BrowserConfigManager.shared.shortcuts.tabSwitch.displayString,
                "copyUrl": BrowserConfigManager.shared.shortcuts.copyUrl.displayString
            ]
            sendMessage(["action": "registered", "bundleId": ownerBrowserBundleId ?? bundleId, "shortcuts": shortcuts])
            DispatchQueue.main.async {
                extensionRegistered = true
                announceHost()
            }
            if let features = message["features"] as? [String], features.contains("command_bar") {
                DispatchQueue.main.async {
                    extensionSupportsCommandBar = true
                    announceCommandBar()
                }
            }
        }
        
    case "ping":
        // Respond to ping to confirm connection is alive
        debugLog("Received ping, sending pong")
        sendMessage(["action": "pong"])

    case "read_arc":
        let requestId = message["requestId"]
        DispatchQueue.global(qos: .userInitiated).async {
            sendMessage(arcImportResponse(requestId: requestId))
        }

    case "url_copied":
        if let url = message["url"] as? String {
            debugLog("Received URL to copy: \(url)")
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(url, forType: .string)
            DispatchQueue.main.async {
                ToastManager.shared.showToast(message: "Copied!", detail: url)
            }
        }

    default:
        debugLog("Unknown action: \(action)")
    }
}

/// Decode `data` straight to a thumbnail no larger than `maxPixelSize`, so the full-size
/// image is never materialised.
func downsampleImage(_ data: Data, maxPixelSize: Int) -> NSImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, [
        kCGImageSourceShouldCache: false
    ] as CFDictionary),
    let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary) else { return nil }
    return NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
}

func parseTabInfo(_ dict: [String: Any]) -> TabInfo? {
    guard let id = dict["id"] as? Int,
          let title = dict["title"] as? String else {
        return nil
    }
    
    let favIconUrl = dict["favIconUrl"] as? String ?? ""
    let url = dict["url"] as? String ?? ""
    
    var thumbnail: NSImage? = nil
    if let thumbnailData = dict["thumbnail"] as? String,
       !thumbnailData.isEmpty,
       let dataUrl = thumbnailData.components(separatedBy: ",").last,
       let imageData = Data(base64Encoded: dataUrl) {
        // Cards are at most 220 points wide, so a Retina-sized preview is enough. Decoding
        // the full 4K screenshot is what made the helper retain hundreds of MB of surfaces.
        // Deliberately no NSImage(data:) fallback here: previews are always JPEG, and falling
        // back would reintroduce the full-size decode this avoids. A card without a preview
        // still renders its title and favicon.
        thumbnail = downsampleImage(imageData, maxPixelSize: 440)
    }
    
    return TabInfo(id: id, title: title, favIconUrl: favIconUrl, thumbnail: thumbnail, url: url)
}

// MARK: - Browser Detection

func isSupportedBrowserActive() -> Bool {
    guard let frontApp = NSWorkspace.shared.frontmostApplication,
          let bundleId = frontApp.bundleIdentifier else {
        return false
    }
    
    // If we're registered with a specific browser process, only respond to that exact process
    // This is critical for multi-profile support - each Chrome profile is a separate process
    if let ownerBundle = ownerBrowserBundleId, let ownerPid = ownerBrowserProcessId {
        // Check both bundle ID AND process ID match
        let bundleMatches = bundleId == ownerBundle
        let pidMatches = frontApp.processIdentifier == ownerPid
        
        debugLog("Browser check: frontmost=\(bundleId) (PID \(frontApp.processIdentifier)), owner=\(ownerBundle) (PID \(ownerPid)), bundleMatch=\(bundleMatches), pidMatch=\(pidMatches)")
        
        // Only respond if this is the exact same browser process that spawned us
        return bundleMatches && pidMatches
    }
    
    // Fallback: if we only have bundle ID (e.g., from extension registration)
    if let ownerBundle = ownerBrowserBundleId {
        let isOwner = bundleId == ownerBundle
        debugLog("Browser check (bundle only): frontmost=\(bundleId), owner=\(ownerBundle), match=\(isOwner)")
        return isOwner
    }
    
    // If launched directly (for config UI), respond to any enabled browser
    if isatty(STDIN_FILENO) != 0 {
        return BrowserConfigManager.shared.enabledBundleIds.contains(bundleId)
    }
    
    // If launched via native messaging but no owner detected, DON'T respond
    // This prevents multiple native hosts from all responding
    debugLog("No owner browser set, not responding to events")
    return false
}

// Get bundle ID of active browser (for window frame detection)
func getActiveBrowserBundleId() -> String? {
    guard let frontApp = NSWorkspace.shared.frontmostApplication,
          let bundleId = frontApp.bundleIdentifier else {
        return nil
    }
    
    // If registered, only return if it's our owner browser process
    if let ownerBundle = ownerBrowserBundleId, let ownerPid = ownerBrowserProcessId {
        // Check both bundle ID AND process ID match
        return (bundleId == ownerBundle && frontApp.processIdentifier == ownerPid) ? bundleId : nil
    }
    
    // Fallback: if we only have bundle ID
    if let ownerBundle = ownerBrowserBundleId {
        return bundleId == ownerBundle ? bundleId : nil
    }
    
    // If launched directly, allow any enabled browser
    if isatty(STDIN_FILENO) != 0 {
        guard BrowserConfigManager.shared.enabledBundleIds.contains(bundleId) else {
            return nil
        }
        return bundleId
    }
    
    return nil
}

// MARK: - Global State

var switchModifierIsPressed = false
var switchInProgress = false
var tabPressCount = 0
var ownerBrowserBundleId: String? = nil  // The browser that launched this native host instance
var ownerBrowserProcessId: pid_t? = nil  // The PID of the specific browser process that launched us
var myProcessId: pid_t = getpid()  // This native host's PID for identification
var isEventTapLeader = false  // Whether this instance owns the event tap
var allowConfigUI = false  // Allow showing config UI even if not direct launch
var extensionSupportsCommandBar = false  // Our extension can answer the command bar
var extensionRegistered = false  // Our extension has connected and registered
/// Native hosts whose extension has registered, by browser. The event tap leader acts only in a
/// browser listed here, so a browser without Arclike keeps every key, Ctrl+Tab included. Every
/// instance keeps this, since any of them may become the leader. Only touched on the main thread.
var connectedHosts: [String: Set<pid_t>] = [:]
/// Native hosts whose extension answers the command bar, by browser. Every instance keeps this,
/// since any of them may become the event tap leader. Only touched on the main thread.
var commandBarHosts: [String: Set<pid_t>] = [:]
// Native hosts whose browser profile has a Little Arc in front, by browser. The event tap
// leader takes Cmd+O only then, so Chrome keeps it for Open File everywhere else.
var littleArcFocusedHosts: [String: Set<pid_t>] = [:]
var littleArcFocusedHere = false  // This host's own profile has a Little Arc in front

// Detect which browser launched this native host by checking parent process
// Returns (bundleId, processId) tuple
func detectParentBrowser() -> (String, pid_t)? {
    var currentPid = getppid()
    debugLog("Starting parent detection from PID: \(currentPid)")
    
    // Walk up the process tree looking for a known browser
    for level in 0..<10 {  // Check up to 10 levels
        // Try to get bundle ID via NSRunningApplication
        if let app = NSRunningApplication(processIdentifier: currentPid),
           let bundleId = app.bundleIdentifier {
            debugLog("Level \(level): PID \(currentPid) = \(bundleId)")
            
            // Check if this is a known browser
            if BrowserConfigManager.shared.enabledBundleIds.contains(bundleId) {
                debugLog("Found browser at level \(level): \(bundleId) with PID \(currentPid)")
                return (bundleId, currentPid)
            }
            
            // Check for browser helper processes by bundle ID patterns
            // Chrome variants: match the most specific first
            if bundleId.hasPrefix("com.google.Chrome.canary") {
                debugLog("Found Chrome Canary helper process with PID \(currentPid)")
                return ("com.google.Chrome.canary", currentPid)
            }
            if bundleId.hasPrefix("com.google.Chrome.dev") {
                debugLog("Found Chrome Dev helper process with PID \(currentPid)")
                return ("com.google.Chrome.dev", currentPid)
            }
            if bundleId.contains("Chrome") || app.localizedName?.contains("Chrome") == true {
                debugLog("Found Chrome-related process, assuming com.google.Chrome with PID \(currentPid)")
                return ("com.google.Chrome", currentPid)
            }
            if bundleId.contains("Helium") || bundleId.contains("imput") {
                debugLog("Found Helium-related process with PID \(currentPid)")
                return ("net.imput.helium", currentPid)
            }
            if bundleId.contains("Brave") {
                return ("com.brave.Browser", currentPid)
            }
            if bundleId.contains("Edge") {
                return ("com.microsoft.edgemac", currentPid)
            }
            if bundleId.contains("Thorium") || bundleId.contains("org.chromium.Thorium") {
                return ("org.chromium.Thorium", currentPid)
            }
            if bundleId.contains("perplexity") || bundleId.contains("comet") {
                return ("ai.perplexity.comet", currentPid)
            }
            if bundleId.contains("openai") || bundleId.contains("atlas") {
                return ("com.openai.atlas", currentPid)
            }
        }
        
        // Get parent of current process using sysctl
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, currentPid]
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        
        if sysctl(&mib, 4, &info, &size, nil, 0) == 0 {
            let nextParent = info.kp_eproc.e_ppid
            debugLog("Level \(level): PID \(currentPid) parent is \(nextParent)")
            
            if nextParent == currentPid || nextParent <= 1 {
                break
            }
            currentPid = nextParent
        } else {
            debugLog("sysctl failed at level \(level)")
            break
        }
    }
    
    debugLog("Could not detect parent browser after walking tree")
    return nil
}

// Lock file for event tap coordination - only one native host should have the event tap
let eventTapLockFile = appSupportDirectory.appendingPathComponent("eventtap.lock")

// Check if we should be the event tap leader (first one to claim the lock)
func tryBecomeEventTapLeader() -> Bool {
    let myPid = getpid()
    
    // Check if lock file exists
    if FileManager.default.fileExists(atPath: eventTapLockFile.path) {
        // Read existing PID
        if let contents = try? String(contentsOf: eventTapLockFile, encoding: .utf8),
           let existingPid = Int32(contents.trimmingCharacters(in: .whitespacesAndNewlines)) {
            // Check if that process is still running AND is actually Tab Switcher
            if kill(existingPid, 0) == 0 {
                // Process exists, but verify it's actually Tab Switcher
                if let app = NSRunningApplication(processIdentifier: existingPid),
                   app.bundleIdentifier == Bundle.main.bundleIdentifier {
                    // It's actually our app - we're not the leader
                    debugLog("Another Tab Switcher instance (PID \(existingPid)) owns the event tap, we (PID \(myPid)) will listen only")
                    return false
                } else {
                    // PID exists but it's not Tab Switcher - stale lock file
                    debugLog("Lock file has PID \(existingPid) but it's not Tab Switcher - removing stale lock")
                    try? FileManager.default.removeItem(at: eventTapLockFile)
                }
            } else {
                // Process doesn't exist - stale lock file
                debugLog("Lock file has dead PID \(existingPid) - removing stale lock")
                try? FileManager.default.removeItem(at: eventTapLockFile)
            }
        } else {
            // Couldn't read PID from lock file - remove it
            debugLog("Lock file exists but couldn't read PID - removing")
            try? FileManager.default.removeItem(at: eventTapLockFile)
        }
    }
    
    // Claim the lock
    do {
        try String(myPid).write(to: eventTapLockFile, atomically: true, encoding: .utf8)
        debugLog("We (PID \(myPid)) are now the event tap leader")
        return true
    } catch {
        debugLog("Failed to write lock file: \(error)")
        return false
    }
}

// Clean up lock file on exit and notify listeners to take over
func cleanupEventTapLock() {
    if isEventTapLeader {
        try? FileManager.default.removeItem(at: eventTapLockFile)
        debugLog("Cleaned up event tap lock file")
        
        // Notify other instances that the leader has resigned
        // They should try to become the new leader
        DistributedNotificationCenter.default().postNotificationName(
            NSNotification.Name(leaderResignedNotificationName),
            object: nil,
            userInfo: nil,
            deliverImmediately: true
        )
        debugLog("Posted leader-resigned notification")
    }
}

// Distributed notification names for IPC between native hosts
let ctrlTabNotificationName = APP_ID + ".ctrlTab"
let ctrlReleaseNotificationName = APP_ID + ".ctrlRelease"
let ctrlCancelNotificationName = APP_ID + ".ctrlCancel"
let leaderResignedNotificationName = APP_ID + ".leaderResigned"
let showConfigNotificationName = APP_ID + ".showConfig"
let copyUrlNotificationName = APP_ID + ".copyUrl"
let shortcutsChangedNotificationName = APP_ID + ".shortcutsChanged"
let commandBarNotificationName = APP_ID + ".commandBar"
let commandBarReadyNotificationName = APP_ID + ".commandBarReady"
let hostReadyNotificationName = APP_ID + ".hostReady"
let commandBarRollCallNotificationName = APP_ID + ".commandBarRollCall"
let littleArcFocusNotificationName = APP_ID + ".littleArcFocus"
let littleArcToMainNotificationName = APP_ID + ".littleArcToMain"

// Setup listener for distributed notifications (for non-leader hosts)
func setupNotificationListener() {
    let center = DistributedNotificationCenter.default()
    
    center.addObserver(forName: NSNotification.Name(ctrlTabNotificationName), object: nil, queue: .main) { notification in
        guard let userInfo = notification.userInfo,
              let direction = userInfo["direction"] as? String,
              let showUI = userInfo["showUI"] as? Bool,
              let combineWindows = userInfo["combineWindows"] as? Bool,
              let targetBrowser = userInfo["targetBrowser"] as? String else {
            return
        }
        
        // Only respond if this notification is for OUR browser
        guard let myBrowser = ownerBrowserBundleId, myBrowser == targetBrowser else {
            debugLog("Ignoring ctrl-tab notification - target=\(targetBrowser), we are=\(ownerBrowserBundleId ?? "unknown")")
            return
        }
        
        debugLog("Received ctrl-tab notification for our browser: direction=\(direction), showUI=\(showUI)")
        
        // Send to our extension
        sendMessage([
            "action": direction,
            "show_ui": showUI,
            "current_window_only": !combineWindows
        ])
    }
    
    center.addObserver(forName: NSNotification.Name(ctrlReleaseNotificationName), object: nil, queue: .main) { notification in
        // Only respond if this is for our browser
        if let userInfo = notification.userInfo,
           let targetBrowser = userInfo["targetBrowser"] as? String {
            guard let myBrowser = ownerBrowserBundleId, myBrowser == targetBrowser else {
                return
            }
        }
        
        debugLog("Received ctrl-release notification")
        sendAction("end_switch")
    }
    
    center.addObserver(forName: NSNotification.Name(ctrlCancelNotificationName), object: nil, queue: .main) { notification in
        // Only respond if this is for our browser
        if let userInfo = notification.userInfo,
           let targetBrowser = userInfo["targetBrowser"] as? String {
            guard let myBrowser = ownerBrowserBundleId, myBrowser == targetBrowser else {
                return
            }
        }
        
        debugLog("Received ctrl-cancel notification")
        // Hide our panel right away so Esc feels instant and still works if the extension
        // predates cancel_switch; the extension's own hide_switcher is then a no-op.
        TabSwitcherState.shared.hideSwitcher()
        sendAction("cancel_switch")
    }
    
    // Listen for leader resignation - try to become the new leader
    center.addObserver(forName: NSNotification.Name(leaderResignedNotificationName), object: nil, queue: .main) { _ in
        debugLog("Received leader-resigned notification")
        
        // If we're not already the leader, try to become one
        if !isEventTapLeader {
            // Small delay to let the old leader fully exit
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if tryBecomeEventTapLeader() {
                    isEventTapLeader = true
                    if setupEventTap() {
                        debugLog("Successfully became new event tap leader after resignation")
                    } else {
                        debugLog("Failed to setup event tap after becoming leader")
                    }
                }
            }
        }
    }
    
    // Listen for show-config request (from directly-launched app trying to show UI)
    center.addObserver(forName: NSNotification.Name(showConfigNotificationName), object: nil, queue: .main) { _ in
        debugLog("Received show-config notification")
        // Show the config window if we have one
        DispatchQueue.main.async {
            allowConfigUI = true
            BrowserConfigManager.shared.showingSetup = true
        }
    }
    
    // Listen for copy-URL request
    center.addObserver(forName: NSNotification.Name(copyUrlNotificationName), object: nil, queue: .main) { notification in
        guard let userInfo = notification.userInfo,
              let targetBrowser = userInfo["targetBrowser"] as? String else { return }
        guard let myBrowser = ownerBrowserBundleId, myBrowser == targetBrowser else {
            debugLog("Ignoring copy-url notification - not our browser")
            return
        }
        debugLog("Received copy-url notification for our browser")
        sendMessage(["action": "copy_url"])
    }

    // Cmd+T or Cmd+L in our browser: ask the extension, which opens the bar if its profile
    // owns the focused window.
    center.addObserver(forName: NSNotification.Name(commandBarNotificationName), object: nil, queue: .main) { notification in
        guard let userInfo = notification.userInfo,
              let mode = userInfo["mode"] as? String,
              let targetBrowser = userInfo["targetBrowser"] as? String,
              extensionSupportsCommandBar,
              ownerBrowserBundleId == targetBrowser else { return }
        debugLog("Received command-bar notification, mode=\(mode)")
        sendMessage(["action": "command_bar_open", "mode": mode])
    }

    center.addObserver(forName: NSNotification.Name(hostReadyNotificationName), object: nil, queue: .main) { notification in
        guard let userInfo = notification.userInfo,
              let browser = userInfo["browser"] as? String,
              let pid = userInfo["pid"] as? Int else { return }
        connectedHosts[browser, default: []].insert(pid_t(pid))
    }

    center.addObserver(forName: NSNotification.Name(commandBarReadyNotificationName), object: nil, queue: .main) { notification in
        guard let userInfo = notification.userInfo,
              let browser = userInfo["browser"] as? String,
              let pid = userInfo["pid"] as? Int else { return }
        commandBarHosts[browser, default: []].insert(pid_t(pid))
    }

    center.addObserver(forName: NSNotification.Name(littleArcFocusNotificationName), object: nil, queue: .main) { notification in
        guard let userInfo = notification.userInfo,
              let browser = userInfo["browser"] as? String,
              let pid = userInfo["pid"] as? Int else { return }
        if userInfo["focused"] as? Bool == true {
            littleArcFocusedHosts[browser, default: []].insert(pid_t(pid))
        } else {
            littleArcFocusedHosts[browser]?.remove(pid_t(pid))
        }
    }

    // Cmd+O in a Little Arc: the host whose profile has it in front moves its tab to the main window.
    center.addObserver(forName: NSNotification.Name(littleArcToMainNotificationName), object: nil, queue: .main) { notification in
        guard let targetBrowser = notification.userInfo?["targetBrowser"] as? String,
              ownerBrowserBundleId == targetBrowser,
              littleArcFocusedHere else { return }
        sendMessage(["action": "little_arc_to_main"])
    }

    center.addObserver(forName: NSNotification.Name(commandBarRollCallNotificationName), object: nil, queue: .main) { _ in
        if extensionRegistered {
            announceHost()
        }
        if extensionSupportsCommandBar {
            announceCommandBar()
        }
    }

    // Listen for shortcut config changes from other instances
    center.addObserver(forName: NSNotification.Name(shortcutsChangedNotificationName), object: nil, queue: .main) { _ in
        debugLog("Received shortcuts-changed notification, reloading")
        BrowserConfigManager.shared.loadShortcuts()
    }

    // Listen for app update trigger (from notification click)
    center.addObserver(forName: NSNotification.Name(APP_ID + ".triggerAppUpdate"), object: nil, queue: .main) { _ in
        debugLog("Received triggerAppUpdate notification")
        if let delegate = NSApp.delegate as? AppDelegate, delegate.launchedDirectly {
            allowConfigUI = true
            BrowserConfigManager.shared.showingSetup = true
            NSApp.activate(ignoringOtherApps: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                updaterViewModel.checkForUpdates()
            }
        }
    }

    // Listen for extension update display request (from notification click)
    center.addObserver(forName: NSNotification.Name(APP_ID + ".showExtensionUpdate"), object: nil, queue: .main) { _ in
        debugLog("Received showExtensionUpdate notification")
        DispatchQueue.main.async {
            allowConfigUI = true
            BrowserConfigManager.shared.showingSetup = true
            BrowserConfigManager.shared.showExtensionUpdateInstructions = true
        }
    }

    // Listen for update checker leader resignation
    center.addObserver(forName: NSNotification.Name(APP_ID + ".updateCheckerResigned"), object: nil, queue: .main) { _ in
        debugLog("Update checker leader resigned, attempting to take over")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            BackgroundUpdateChecker.shared.tryTakeOverLeadership()
        }
    }

    debugLog("Notification listener setup complete (PID \(myProcessId), browser=\(ownerBrowserBundleId ?? "unknown"))")

    // Learn which browsers already have a command bar, in case this instance becomes the leader.
    DistributedNotificationCenter.default().postNotificationName(
        NSNotification.Name(commandBarRollCallNotificationName),
        object: nil,
        userInfo: nil,
        deliverImmediately: true
    )
    
    // Periodic check for dead leader (backup in case leader crashes without notification)
    // Only do this for non-leaders that were launched via native messaging
    if !isEventTapLeader {
        let recoveryTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { timer in
            if isEventTapLeader {
                timer.invalidate()
                return
            }
            // Check if the current leader is still alive
            if FileManager.default.fileExists(atPath: eventTapLockFile.path) {
                if let contents = try? String(contentsOf: eventTapLockFile, encoding: .utf8),
                   let leaderPid = Int32(contents.trimmingCharacters(in: .whitespacesAndNewlines)) {
                    // Check if leader is still running
                    if kill(leaderPid, 0) != 0 {
                        debugLog("Detected dead leader (PID \(leaderPid)), attempting to take over")
                        if tryBecomeEventTapLeader() {
                            isEventTapLeader = true
                            if setupEventTap() {
                                debugLog("Successfully became event tap leader after detecting dead leader")
                            }
                        }
                    }
                }
            } else {
                // No lock file exists, try to become leader
                debugLog("No lock file exists, attempting to become leader")
                if tryBecomeEventTapLeader() {
                    isEventTapLeader = true
                    if setupEventTap() {
                        debugLog("Successfully became event tap leader (no previous lock file)")
                    }
                }
            }
        }
        // This only backs up the resignation notification, so let the system batch it with
        // other timers rather than waking the process on the exact second.
        recoveryTimer.tolerance = 1.0
    }
}

// Get the frontmost browser's bundle ID - check against ALL known browsers, not just enabled ones
func getFrontmostBrowserBundleId() -> String? {
    guard let frontApp = NSWorkspace.shared.frontmostApplication,
          let bundleId = frontApp.bundleIdentifier else {
        return nil
    }
    
    // Check if this is any known Chromium browser (not just enabled ones)
    // This allows the event tap to work even before setup is complete
    let allKnownBrowserIds = Set(knownBrowsers.map { $0.id })
    if allKnownBrowserIds.contains(bundleId) {
        return bundleId
    }
    
    return nil
}

// Post notification to all native hosts - includes frontmost browser so only that browser responds
func postCtrlTabNotification(direction: String, showUI: Bool, combineWindows: Bool) {
    guard let frontmostBrowser = getFrontmostBrowserBundleId() else { return }
    
    let center = DistributedNotificationCenter.default()
    center.postNotificationName(
        NSNotification.Name(ctrlTabNotificationName),
        object: nil,
        userInfo: [
            "direction": direction,
            "showUI": showUI,
            "combineWindows": combineWindows,
            "targetBrowser": frontmostBrowser
        ],
        deliverImmediately: true
    )
    debugLog("Posted ctrl-tab notification for browser: \(frontmostBrowser)")
}

func postCtrlReleaseNotification() {
    guard let frontmostBrowser = getFrontmostBrowserBundleId() else { return }
    
    let center = DistributedNotificationCenter.default()
    center.postNotificationName(
        NSNotification.Name(ctrlReleaseNotificationName),
        object: nil,
        userInfo: ["targetBrowser": frontmostBrowser],
        deliverImmediately: true
    )
}

// Esc was pressed while the switch modifier was held: the extension should dismiss the
// switcher and leave the current tab alone.
func postCtrlCancelNotification() {
    guard let frontmostBrowser = getFrontmostBrowserBundleId() else { return }
    
    let center = DistributedNotificationCenter.default()
    center.postNotificationName(
        NSNotification.Name(ctrlCancelNotificationName),
        object: nil,
        userInfo: ["targetBrowser": frontmostBrowser],
        deliverImmediately: true
    )
    debugLog("Posted ctrl-cancel notification for browser: \(frontmostBrowser)")
}

func postCopyUrlNotification() {
    guard let frontmostBrowser = getFrontmostBrowserBundleId() else { return }

    let center = DistributedNotificationCenter.default()
    center.postNotificationName(
        NSNotification.Name(copyUrlNotificationName),
        object: nil,
        userInfo: ["targetBrowser": frontmostBrowser],
        deliverImmediately: true
    )
    debugLog("Posted copy-url notification for browser: \(frontmostBrowser)")
}

/// Tell every instance that our browser's extension is connected, so the leader starts taking
/// Arclike's shortcuts in that browser.
func announceHost() {
    guard let browser = ownerBrowserBundleId else { return }
    DistributedNotificationCenter.default().postNotificationName(
        NSNotification.Name(hostReadyNotificationName),
        object: nil,
        userInfo: ["browser": browser, "pid": Int(myProcessId)],
        deliverImmediately: true
    )
}

/// Whether a running native host has a connected extension in `browser`.
func hostAvailable(for browser: String) -> Bool {
    guard let pids = connectedHosts[browser] else { return false }
    let alive = pids.filter { kill($0, 0) == 0 }
    connectedHosts[browser] = alive
    return !alive.isEmpty
}

/// Tell every instance that our browser's extension answers the command bar, so the leader
/// starts taking Cmd+T and Cmd+L from that browser.
func announceCommandBar() {
    guard let browser = ownerBrowserBundleId else { return }
    DistributedNotificationCenter.default().postNotificationName(
        NSNotification.Name(commandBarReadyNotificationName),
        object: nil,
        userInfo: ["browser": browser, "pid": Int(myProcessId)],
        deliverImmediately: true
    )
}

/// Whether a running native host for `browser` can answer the command bar. A browser whose
/// extension cannot keeps its own Cmd+T and Cmd+L.
func commandBarAvailable(for browser: String) -> Bool {
    guard let pids = commandBarHosts[browser] else { return false }
    let alive = pids.filter { kill($0, 0) == 0 }
    commandBarHosts[browser] = alive
    return !alive.isEmpty
}

func littleArcFocused(for browser: String) -> Bool {
    guard let pids = littleArcFocusedHosts[browser] else { return false }
    let alive = pids.filter { kill($0, 0) == 0 }
    littleArcFocusedHosts[browser] = alive
    return !alive.isEmpty
}

func postCommandBarNotification(mode: String, browser: String) {
    DistributedNotificationCenter.default().postNotificationName(
        NSNotification.Name(commandBarNotificationName),
        object: nil,
        userInfo: ["mode": mode, "targetBrowser": browser],
        deliverImmediately: true
    )
    debugLog("Posted command-bar notification for browser: \(browser), mode=\(mode)")
}

// MARK: - Event Tap Callback

func eventTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    // An event passed on is returned unretained: the tap does not own it, and retaining it
    // leaked every key pressed anywhere on the Mac.

    // Handle tap disabled
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = keyboardEventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }
    
    // Only process when the frontmost app is a browser with Arclike connected. A known browser
    // without the extension (Arc next to Chrome, say) must keep Ctrl+Tab and every other key.
    guard let frontApp = NSWorkspace.shared.frontmostApplication,
          let bundleId = frontApp.bundleIdentifier else {
        return Unmanaged.passUnretained(event)
    }
    
    let allKnownBrowserIds = Set(knownBrowsers.map { $0.id })
    guard allKnownBrowserIds.contains(bundleId), hostAvailable(for: bundleId) else {
        return Unmanaged.passUnretained(event)
    }
    
    let flags = event.flags
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

    // Mask to only modifier bits for matching
    let modifierMask: UInt64 = CGEventFlags([.maskControl, .maskShift, .maskCommand, .maskAlternate]).rawValue
    let currentMods = flags.rawValue & modifierMask

    // Determine the primary modifier for the tab-switch shortcut (for release detection)
    // Use the configured modifiers minus Shift (Shift is used for direction)
    let switchModFlag = CGEventFlags(rawValue: tabSwitchModifiers & modifierMask & ~CGEventFlags.maskShift.rawValue)

    // Handle flags changed (modifier key state changes)
    if type == .flagsChanged {
        let modifierNowPressed = !switchModFlag.isEmpty && flags.contains(switchModFlag)

        // Detect switch modifier release
        if switchModifierIsPressed && !modifierNowPressed && switchInProgress {
            postCtrlReleaseNotification()
            switchInProgress = false
            tabPressCount = 0
        }

        switchModifierIsPressed = modifierNowPressed
        return Unmanaged.passUnretained(event)
    }

    // Handle key down events
    if type == .keyDown {
        // Esc while the switch modifier is still held: cancel the switch without changing tabs.
        // switchInProgress is cleared here, so the eventual modifier release posts nothing.
        if switchInProgress && keyCode == Int64(kVK_Escape) && flags.contains(switchModFlag) {
            debugLog("Escape pressed during switch - cancelling")
            postCtrlCancelNotification()
            switchInProgress = false
            tabPressCount = 0
            return nil
        }

        // Cmd+T and Cmd+L open the command bar instead of the browser's new tab and address
        // bar: Cmd+T to open the choice in a new tab, Cmd+L to open it in this one.
        let isCommandBarKey = keyCode == Int64(kVK_ANSI_T) || keyCode == Int64(kVK_ANSI_L)
        if isCommandBarKey && currentMods == CGEventFlags.maskCommand.rawValue && commandBarAvailable(for: bundleId) {
            if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                postCommandBarNotification(mode: keyCode == Int64(kVK_ANSI_T) ? "new_tab" : "current_tab", browser: bundleId)
            }
            return nil
        }

        // Cmd+O in a Little Arc moves its tab to the main window, as in Arc.
        if keyCode == Int64(kVK_ANSI_O) && currentMods == CGEventFlags.maskCommand.rawValue && littleArcFocused(for: bundleId) {
            if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                DistributedNotificationCenter.default().postNotificationName(
                    NSNotification.Name(littleArcToMainNotificationName),
                    object: nil,
                    userInfo: ["targetBrowser": bundleId],
                    deliverImmediately: true
                )
            }
            return nil
        }

        // Check for tab-switch shortcut (Shift excluded from base match — it toggles direction)
        let baseMods = tabSwitchModifiers & modifierMask & ~CGEventFlags.maskShift.rawValue
        let currentBase = currentMods & ~CGEventFlags.maskShift.rawValue
        if keyCode == tabSwitchKeyCode && currentBase == baseMods {
            if !switchInProgress {
                switchInProgress = true
                tabPressCount = 0
            }
            switchModifierIsPressed = true
            tabPressCount += 1

            let direction = (currentMods & CGEventFlags.maskShift.rawValue != 0) ? "cycle_prev" : "cycle_next"
            let combineWindows = false

            debugLog("Broadcasting tab switch: direction=\(direction), tabPressCount=\(tabPressCount)")

            // showUI stays true for every press. An extension that predates this change reads
            // the flag and shows the switcher on the first press instead of waiting for a
            // request that no longer comes.
            postCtrlTabNotification(direction: direction, showUI: true, combineWindows: combineWindows)

            return nil
        }

        // Check for copy-URL shortcut
        let copyMods = copyUrlModifiers & modifierMask
        if keyCode == copyUrlKeyCode && currentMods == copyMods {
            debugLog("Copy URL shortcut detected")
            postCopyUrlNotification()
            return nil
        }
    }

    return Unmanaged.passUnretained(event)
}

// MARK: - Setup Event Tap

var keyboardEventTap: CFMachPort?

func setupEventTap() -> Bool {
    let eventMask: CGEventMask = (1 << CGEventType.keyDown.rawValue) |
                                  (1 << CGEventType.flagsChanged.rawValue)
    
    guard let eventTap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: eventMask,
        callback: eventTapCallback,
        userInfo: nil
    ) else {
        sendAction("error_no_accessibility")
        return false
    }
    
    // The callback is a C function pointer and can only reach globals, so the port has to be
    // stored here for the .tapDisabledByTimeout branch to re-enable it.
    keyboardEventTap = eventTap

    let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
    CGEvent.tapEnable(tap: eventTap, enable: true)
    
    return true
}

// MARK: - Message Reading Thread

func startMessageReader() {
    debugLog("Starting message reader thread")
    DispatchQueue.global(qos: .userInitiated).async {
        // This block lives for the whole connection, so temporaries created while decoding a
        // message would otherwise be held until it returns, which is never. Draining a pool
        // per message is what stops image and Foundation temporaries accumulating.
        while !stdinClosed {
            autoreleasepool {
                if let message = readMessage() {
                    handleMessage(message)
                } else if !stdinClosed {
                    // A message that could not be parsed, not a closed pipe. Skip it; only EOF
                    // ends the loop, and readMessage terminates the app in that case.
                    Thread.sleep(forTimeInterval: 0.01)
                }
            }
        }
        debugLog("Message reader stopped: the browser closed the connection")
    }
}

// MARK: - Main

import Combine

// Check if launched directly (from Finder/Dock) or via native messaging (from browser)
func isLaunchedDirectly() -> Bool {
    // If Chrome launches via native messaging, it passes the extension URL as an argument
    // Example: chrome-extension://<id>/
    let args = ProcessInfo.processInfo.arguments
    if args.contains(where: { $0.hasPrefix("chrome-extension://") }) {
        debugLog("Detected chrome-extension:// arg - launched via native messaging")
        return false
    }
    
    // Check if parent process is launchd (PID 1) - means launched from Finder/Spotlight/Dock
    let parentPid = getppid()
    if parentPid == 1 {
        debugLog("Parent PID is 1 (launchd) - launched directly")
        return true
    }
    
    // Check if stdin is a pipe (native messaging) vs /dev/null or TTY (direct launch)
    var statInfo = stat()
    if fstat(STDIN_FILENO, &statInfo) == 0 {
        // S_IFIFO means it's a pipe (native messaging from browser)
        let mode = statInfo.st_mode & S_IFMT
        let isPipe = mode == S_IFIFO
        debugLog("stdin mode: \(mode), isPipe: \(isPipe)")
        if isPipe {
            return false  // Launched via native messaging
        }
    }
    
    // Fallback to isatty check
    let isTTY = isatty(STDIN_FILENO) != 0
    debugLog("isatty check: \(isTTY)")
    return true  // If not a pipe, assume direct launch
}

// Check if another instance of the app is already running (for direct launch only)
func isAnotherInstanceRunning() -> Bool {
    let currentPID = ProcessInfo.processInfo.processIdentifier
    let runningApps = NSWorkspace.shared.runningApplications
    
    // Look for other Tab Switcher instances (any activation policy)
    for app in runningApps {
        if app.bundleIdentifier == Bundle.main.bundleIdentifier,
           app.processIdentifier != currentPID {
            return true
        }
    }
    return false
}

// Tell existing instances to show their config window
func notifyExistingInstancesToShowConfig() {
    debugLog("Notifying existing instances to show config")
    DistributedNotificationCenter.default().postNotificationName(
        NSNotification.Name(showConfigNotificationName),
        object: nil,
        userInfo: nil,
        deliverImmediately: true
    )
}

// Check if accessibility permission is granted, optionally prompting the user
func checkAccessibilityPermission(prompt: Bool = false) -> Bool {
    if prompt {
        // This will trigger the system permission prompt if not already granted
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)
        debugLog("Accessibility check with prompt: \(trusted)")
        return trusted
    } else {
        let trusted = AXIsProcessTrusted()
        debugLog("Accessibility check (no prompt): \(trusted)")
        return trusted
    }
}

// Show accessibility permission alert
func showAccessibilityAlert() {
    let alert = NSAlert()
    alert.messageText = "Accessibility Permission Required"
    alert.informativeText = "\(APP_NAME) needs Accessibility permission to intercept its keyboard shortcuts.\n\nClick 'Open System Settings' to grant permission, then relaunch the app."
    alert.alertStyle = .warning
    alert.addButton(withTitle: "Open System Settings")
    alert.addButton(withTitle: "Continue Anyway")
    alert.addButton(withTitle: "Quit")
    
    let response = alert.runModal()
    
    switch response {
    case .alertFirstButtonReturn:
        // Open Accessibility settings
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
        exit(0)
    case .alertSecondButtonReturn:
        // Continue without event tap (config only)
        break
    default:
        exit(0)
    }
}

// Main entry point
func main() {
    debugLog("Tab Switcher Native Host starting (PID \(myProcessId))...")
    
    let directLaunch = isLaunchedDirectly()
    debugLog("Launched directly: \(directLaunch)")
    
    // For direct launches, check if another DIRECTLY-LAUNCHED instance is already running
    // (Native messaging hosts don't count - they can't show config windows)
    if directLaunch {
        let currentPID = ProcessInfo.processInfo.processIdentifier
        var directlyLaunchedInstanceExists = false
        
        for app in NSWorkspace.shared.runningApplications {
            if app.bundleIdentifier == Bundle.main.bundleIdentifier,
               app.processIdentifier != currentPID,
               app.activationPolicy == .regular {  // Only count apps showing in dock
                directlyLaunchedInstanceExists = true
                break
            }
        }
        
        if directlyLaunchedInstanceExists {
            // Another directly-launched instance exists, activate it and exit
            debugLog("Another directly-launched instance exists, activating it")
            for app in NSWorkspace.shared.runningApplications {
                if app.bundleIdentifier == Bundle.main.bundleIdentifier,
                   app.activationPolicy == .regular {
                    app.activate(options: [])
                    break
                }
            }
            exit(0)
        }
        
        // No directly-launched instance, so we'll show the config
        // (There might be native messaging hosts running, but they can't show config)
        debugLog("No directly-launched instance found, we will show config")
        
        // Proactively check/request accessibility permission when launched directly
        // This triggers the system permission prompt if not already granted
        let hasAccessibility = checkAccessibilityPermission(prompt: true)
        debugLog("Accessibility permission: \(hasAccessibility)")
    }
    
    // Try to become the event tap leader (only one native host should have the event tap)
    isEventTapLeader = tryBecomeEventTapLeader()
    
    // Setup cleanup on exit using signal handlers
    signal(SIGTERM) { _ in
        cleanupEventTapLock()
        BackgroundUpdateChecker.shared.cleanupUpdateCheckLock()
        exit(0)
    }
    signal(SIGINT) { _ in
        cleanupEventTapLock()
        BackgroundUpdateChecker.shared.cleanupUpdateCheckLock()
        exit(0)
    }
    
    // Only setup event tap if we're the leader
    var eventTapSuccess = false
    if isEventTapLeader {
        eventTapSuccess = setupEventTap()
        if !eventTapSuccess {
            debugLog("Failed to setup event tap - likely missing accessibility permission")
        } else {
            debugLog("Event tap setup complete (we are the leader)")
        }
    } else {
        debugLog("Not the event tap leader, will listen for notifications only")
    }
    
    // Setup notification listener for receiving broadcasts from the leader
    setupNotificationListener()
    
    // Only start message reader if launched via native messaging
    if !directLaunch {
        // Detect which browser launched us BEFORE anything else
        // We need both bundle ID and process ID to correctly handle multiple profiles
        if let (detectedBundleId, detectedPid) = detectParentBrowser() {
            ownerBrowserBundleId = detectedBundleId
            ownerBrowserProcessId = detectedPid
            debugLog("Auto-detected owner browser: \(detectedBundleId) with PID \(detectedPid)")
        } else {
            debugLog("WARNING: Could not auto-detect browser, will wait for registration")
        }
        
        startMessageReader()
        sendAction("ready")
        debugLog("Ready message sent")
    }
    
    // Setup and run the application
    let app = NSApplication.shared
    let delegate = AppDelegate()
    delegate.launchedDirectly = directLaunch
    app.delegate = delegate
    
    if directLaunch {
        // Show in dock when launched directly
        app.setActivationPolicy(.regular)
    } else {
        // Run as background app when launched via native messaging
        app.setActivationPolicy(.accessory)
    }
    
    // Start Sparkle updater only when launched from Finder/Dock
    if directLaunch {
        // Sparkle stays off: its feed is upstream's, and an update from there would replace
        // Arclike with Tab Switcher.
        BackgroundUpdateChecker.shared.skipAppUpdateNotifications = true
    }

    // Start background update checker (leader election ensures only one instance checks)
    BackgroundUpdateChecker.shared.startPeriodicChecks()

    debugLog("Starting NSApplication run loop")
    app.run()
}

main()
