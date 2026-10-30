import Foundation

// MARK: - Arc Import

// The extension cannot read files, so the app reads Arc's sidebar for it. The app only reads
// the file and trims it to what the import uses; the extension turns it into bookmarks and
// pinned tabs (extension/arcimport.js), where the mapping is tested.

let ARC_SIDEBAR_PATH = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Arc/StorableSidebar.json").path

// What Arc's command bar remembers: the last choice for each text typed into it.
let ARC_RANKING_PATH = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Arc/StorableCommandBarAdditionalRanking.json").path

// Chrome refuses native messages over 1 MB from the app.
let ARC_MESSAGE_LIMIT = 900 * 1024

let ARC_EXTENSIONS_DIR = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Arc/User Data/Default/Extensions").path
let CHROME_DIR = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Google/Chrome").path

/// The name in an extension's manifest, looked up in its default locale when it is a
/// `__MSG_key__` placeholder.
func extensionName(versionDir: String) -> String? {
    guard let data = FileManager.default.contents(atPath: versionDir + "/manifest.json"),
          let manifest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let name = manifest["name"] as? String else { return nil }
    guard name.hasPrefix("__MSG_"), name.hasSuffix("__") else { return name }
    let key = String(name.dropFirst(6).dropLast(2)).lowercased()
    let locale = manifest["default_locale"] as? String ?? "en"
    guard let messagesData = FileManager.default.contents(atPath: "\(versionDir)/_locales/\(locale)/messages.json"),
          let messages = (try? JSONSerialization.jsonObject(with: messagesData)) as? [String: Any],
          let entry = messages.first(where: { $0.key.lowercased() == key })?.value as? [String: Any],
          let message = entry["message"] as? String else { return nil }
    return message
}

/// Extensions installed in Arc but not in Chrome's last used profile, as [{id, name}]. Both
/// browsers keep each installed extension in Extensions/<id>/<version>/.
func arcOnlyExtensions() -> [[String: String]] {
    let fm = FileManager.default
    var profile = "Default"
    if let data = fm.contents(atPath: CHROME_DIR + "/Local State"),
       let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
       let lastUsed = (state["profile"] as? [String: Any])?["last_used"] as? String {
        profile = lastUsed
    }
    let inChrome = Set((try? fm.contentsOfDirectory(atPath: "\(CHROME_DIR)/\(profile)/Extensions")) ?? [])
    let inArc = (try? fm.contentsOfDirectory(atPath: ARC_EXTENSIONS_DIR)) ?? []
    return inArc.sorted().compactMap { id in
        guard id.count == 32, !inChrome.contains(id),
              let version = try? fm.contentsOfDirectory(atPath: "\(ARC_EXTENSIONS_DIR)/\(id)").sorted().last,
              let name = extensionName(versionDir: "\(ARC_EXTENSIONS_DIR)/\(id)/\(version)") else { return nil }
        return ["id": id, "name": name]
    }
}

/// Arc's command bar choices as {query, type, url, title, search, selectedAt}, so Arclike's bar
/// starts out knowing them (extension/ranking.js). Arc wraps each choice in an "archetype"; a
/// Chromium one nests another. Choices with neither a page nor a search, such as Arc's own
/// commands, are left out. Empty when Arc has no such file.
func arcRankingPicks() -> [[String: Any]] {
    guard let data = FileManager.default.contents(atPath: ARC_RANKING_PATH),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let profiles = root["dataByProfile"] as? [String: Any],
          let profile = (profiles["Default"] ?? profiles.values.first) as? [String: Any],
          let picks = profile["queriesToSelectedArchetype"] as? [String: Any] else { return [] }
    return picks.compactMap { query, value in
        guard let value = value as? [String: Any],
              let archetype = value["archetype"] as? [String: Any] else { return nil }
        var type = archetype["type"] as? String ?? ""
        let associated = archetype["associatedValues"] as? [String: Any] ?? [:]
        var values = associated["associatedValue0"] as? [String: Any] ?? associated
        if type == "chromiumArchetype" {
            type = values["type"] as? String ?? ""
            values = values["associatedValues"] as? [String: Any] ?? [:]
        }
        var pick: [String: Any] = ["query": query, "type": type, "selectedAt": value["selectedAt"] ?? 0]
        if let search = (values["query"] ?? values["search"]) as? String { pick["search"] = search }
        // A search's URL is only Google's results page, which the search itself stands for.
        if !type.lowercased().contains("search"), let url = values["url"] as? String {
            pick["url"] = url
            if let title = (values["title"] ?? values["siteName"]) as? String { pick["title"] = title }
        }
        return pick["search"] == nil && pick["url"] == nil ? nil : pick
    }
}

func arcImportResponse(requestId: Any?) -> [String: Any] {
    let os = ProcessInfo.processInfo.operatingSystemVersion
    var response: [String: Any] = [
        "action": "arc_data",
        "app": APP_VERSION,
        "macos": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
        "path": ARC_SIDEBAR_PATH,
    ]
    if let requestId = requestId { response["requestId"] = requestId }

    func fail(_ code: String, _ detail: String) -> [String: Any] {
        debugLog("Arc import: \(code): \(detail)")
        response["ok"] = false
        response["error"] = code
        response["detail"] = detail
        return response
    }

    let fm = FileManager.default
    guard fm.fileExists(atPath: ARC_SIDEBAR_PATH) else {
        return fail("arc_not_found", "No file at \(ARC_SIDEBAR_PATH)")
    }
    if let attributes = try? fm.attributesOfItem(atPath: ARC_SIDEBAR_PATH) {
        if let size = attributes[.size] as? NSNumber { response["bytes"] = size.intValue }
        if let modified = attributes[.modificationDate] as? Date {
            response["modified"] = ISO8601DateFormatter().string(from: modified)
        }
    }

    let data: Data
    do {
        data = try Data(contentsOf: URL(fileURLWithPath: ARC_SIDEBAR_PATH))
    } catch {
        return fail("arc_unreadable", error.localizedDescription)
    }

    guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        return fail("arc_bad_format", "The file is not a JSON object")
    }
    response["formatVersion"] = root["version"] ?? NSNull()
    guard let sidebar = root["sidebar"] as? [String: Any],
          let containers = sidebar["containers"] as? [Any],
          let main = containers.compactMap({ $0 as? [String: Any] }).first(where: { $0["spaces"] != nil }),
          let spaces = main["spaces"] as? [Any],
          let items = main["items"] as? [Any] else {
        return fail("arc_bad_format", "No sidebar.containers entry with spaces and items")
    }

    // Arc stores spaces and items as flat lists that alternate an ID string and an object.
    // Keep only the objects, and only the fields the import reads.
    let trimmedSpaces: [[String: Any]] = spaces.compactMap { entry in
        guard let space = entry as? [String: Any] else { return nil }
        return [
            "id": space["id"] ?? NSNull(),
            "title": space["title"] ?? NSNull(),
            "containerIDs": space["containerIDs"] ?? [],
        ]
    }
    let trimmedItems: [[String: Any]] = items.compactMap { entry in
        guard let item = entry as? [String: Any], let id = item["id"] as? String else { return nil }
        let data = item["data"] as? [String: Any] ?? [:]
        var trimmed: [String: Any] = [
            "id": id,
            "kind": data.keys.first ?? "",
            "childrenIds": item["childrenIds"] ?? [],
        ]
        if let title = item["title"] as? String { trimmed["title"] = title }
        if let tab = data["tab"] as? [String: Any] {
            if let url = tab["savedURL"] as? String { trimmed["url"] = url }
            if let title = tab["savedTitle"] as? String { trimmed["savedTitle"] = title }
        }
        if let container = data["itemContainer"] as? [String: Any],
           let type = container["containerType"] as? [String: Any] {
            trimmed["containerType"] = type.keys.first ?? ""
        }
        return trimmed
    }

    response["sidebar"] = [
        "spaces": trimmedSpaces,
        "items": trimmedItems,
        "topAppsContainerIDs": main["topAppsContainerIDs"] ?? [],
    ]
    response["extensions"] = arcOnlyExtensions()
    response["ok"] = true

    // The command bar choices are a bonus: when they do not fit, the import goes ahead without them.
    let picks = arcRankingPicks()
    if !picks.isEmpty {
        response["rankingPicks"] = picks
        if let encoded = try? JSONSerialization.data(withJSONObject: response), encoded.count > ARC_MESSAGE_LIMIT {
            debugLog("Arc import: left out \(picks.count) command bar choices, \(encoded.count) bytes with them")
            response.removeValue(forKey: "rankingPicks")
        }
    }

    if let encoded = try? JSONSerialization.data(withJSONObject: response), encoded.count > ARC_MESSAGE_LIMIT {
        return fail("too_large", "Trimmed sidebar is \(encoded.count) bytes, over the \(ARC_MESSAGE_LIMIT)-byte message limit")
    }
    debugLog("Arc import: read \(trimmedSpaces.count) spaces, \(trimmedItems.count) items and \((response["rankingPicks"] as? [Any])?.count ?? 0) command bar choices")
    return response
}
