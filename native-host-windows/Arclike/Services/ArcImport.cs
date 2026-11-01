using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Arclike.Services
{
    /// <summary>
    /// Reads Arc's sidebar for Import from Arc. Port of ArcImport.swift. The extension cannot read
    /// files, so the app reads the sidebar and trims it to what the import uses. The extension
    /// turns it into bookmarks and pinned tabs (extension/arcimport.js), where the mapping is tested.
    /// Arc for Windows keeps the same files as Arc for macOS, in its package's LocalCache.
    /// </summary>
    public sealed class ArcImport
    {
        // Chrome refuses native messages over 1 MB from the app.
        public const int MessageLimit = 900 * 1024;

        private readonly string _arcDir;
        private readonly string _chromeDir;
        private readonly Action<string> _log;

        public ArcImport(string arcDir, string chromeDir, Action<string> log)
        {
            _arcDir = arcDir;
            _chromeDir = chromeDir;
            _log = log;
        }

        public string SidebarPath => Path.Combine(_arcDir, "StorableSidebar.json");
        // What Arc's command bar remembers: the last choice for each text typed into it.
        private string RankingPath => Path.Combine(_arcDir, "StorableCommandBarAdditionalRanking.json");
        private string ExtensionsDir => Path.Combine(_arcDir, "User Data", "Default", "Extensions");

        /// <summary>
        /// Arc's data folder: %LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_*\LocalCache\Local\Arc.
        /// The package suffix is usually ttt1ap7aakyb4, so the folder is looked up by its prefix.
        /// ARCLIKE_ARC_DIR overrides it, for tests. Returns the usual path when Arc is missing.
        /// </summary>
        public static string FindArcDir()
        {
            var overridden = Environment.GetEnvironmentVariable("ARCLIKE_ARC_DIR");
            if (!string.IsNullOrEmpty(overridden)) return overridden;
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var packages = Path.Combine(local, "Packages");
            var package = Directory.Exists(packages)
                ? Directory.GetDirectories(packages, "TheBrowserCompany.Arc_*").OrderBy(d => d).FirstOrDefault()
                : null;
            return Path.Combine(package ?? Path.Combine(packages, "TheBrowserCompany.Arc_ttt1ap7aakyb4"), "LocalCache", "Local", "Arc");
        }

        public static string ChromeUserDataDir() =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "User Data");

        /// <summary>The arc_data message for a read_arc request.</summary>
        public JsonObject Response(JsonNode? requestId, string appVersion, string osVersion)
        {
            var response = new JsonObject
            {
                ["action"] = "arc_data",
                ["app"] = appVersion,
                ["windows"] = osVersion,
                ["path"] = SidebarPath,
            };
            if (requestId != null) response["requestId"] = requestId.DeepClone();

            JsonObject Fail(string code, string detail)
            {
                _log($"Arc import: {code}: {detail}");
                response["ok"] = false;
                response["error"] = code;
                response["detail"] = detail;
                return response;
            }

            var file = new FileInfo(SidebarPath);
            if (!file.Exists)
                return Fail("arc_not_found", $"No file at {SidebarPath}");
            response["bytes"] = file.Length;
            response["modified"] = file.LastWriteTimeUtc.ToString("yyyy-MM-ddTHH:mm:ssZ");

            JsonNode? root;
            try
            {
                // Arc may be writing the file, so open it with sharing.
                using var stream = new FileStream(SidebarPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                try { root = JsonNode.Parse(stream); }
                catch (JsonException) { return Fail("arc_bad_format", "The file is not a JSON object"); }
            }
            catch (Exception ex)
            {
                return Fail("arc_unreadable", ex.Message);
            }
            if (root is not JsonObject rootObject)
                return Fail("arc_bad_format", "The file is not a JSON object");

            response["formatVersion"] = rootObject["version"]?.DeepClone();
            var main = (rootObject["sidebar"]?["containers"] as JsonArray)?
                .OfType<JsonObject>().FirstOrDefault(c => c["spaces"] != null);
            if (main?["spaces"] is not JsonArray spaces || main["items"] is not JsonArray items)
                return Fail("arc_bad_format", "No sidebar.containers entry with spaces and items");

            // Arc stores spaces and items as flat lists that alternate an ID string and an object.
            // Keep only the objects, and only the fields the import reads.
            var trimmedSpaces = new JsonArray();
            foreach (var space in spaces.OfType<JsonObject>())
            {
                trimmedSpaces.Add(new JsonObject
                {
                    ["id"] = space["id"]?.DeepClone(),
                    ["title"] = space["title"]?.DeepClone(),
                    ["containerIDs"] = space["containerIDs"]?.DeepClone() ?? new JsonArray(),
                });
            }
            var trimmedItems = new JsonArray();
            foreach (var item in items.OfType<JsonObject>())
            {
                if (Str(item["id"]) is not { } id) continue;
                var data = item["data"] as JsonObject ?? new JsonObject();
                var trimmed = new JsonObject
                {
                    ["id"] = id,
                    ["kind"] = data.FirstOrDefault().Key ?? "",
                    ["childrenIds"] = item["childrenIds"]?.DeepClone() ?? new JsonArray(),
                };
                if (Str(item["title"]) is { } title) trimmed["title"] = title;
                if (data["tab"] is JsonObject tab)
                {
                    if (Str(tab["savedURL"]) is { } url) trimmed["url"] = url;
                    if (Str(tab["savedTitle"]) is { } savedTitle) trimmed["savedTitle"] = savedTitle;
                }
                if (data["itemContainer"]?["containerType"] is JsonObject containerType)
                    trimmed["containerType"] = containerType.FirstOrDefault().Key ?? "";
                trimmedItems.Add(trimmed);
            }

            response["sidebar"] = new JsonObject
            {
                ["spaces"] = trimmedSpaces,
                ["items"] = trimmedItems,
                ["topAppsContainerIDs"] = main["topAppsContainerIDs"]?.DeepClone() ?? new JsonArray(),
            };
            response["extensions"] = ArcOnlyExtensions();
            response["ok"] = true;

            // The command bar choices are a bonus: when they do not fit, the import goes ahead without them.
            var picks = RankingPicks();
            if (picks.Count > 0)
            {
                response["rankingPicks"] = picks;
                int withPicks = Size(response);
                if (withPicks > MessageLimit)
                {
                    _log($"Arc import: left out {picks.Count} command bar choices, {withPicks} bytes with them");
                    response.Remove("rankingPicks");
                }
            }

            int size = Size(response);
            if (size > MessageLimit)
                return Fail("too_large", $"Trimmed sidebar is {size} bytes, over the {MessageLimit}-byte message limit");
            _log($"Arc import: read {trimmedSpaces.Count} spaces, {trimmedItems.Count} items and {(response["rankingPicks"] as JsonArray)?.Count ?? 0} command bar choices");
            return response;
        }

        /// <summary>
        /// Extensions installed in Arc but not in Chrome's last used profile, as [{id, name}]. Both
        /// browsers keep each installed extension in Extensions\&lt;id&gt;\&lt;version&gt;\.
        /// </summary>
        public JsonArray ArcOnlyExtensions()
        {
            var result = new JsonArray();
            if (!Directory.Exists(ExtensionsDir)) return result;
            var profile = "Default";
            var localState = ReadJson(Path.Combine(_chromeDir, "Local State"));
            if (Str(localState?["profile"]?["last_used"]) is { } lastUsed) profile = lastUsed;
            var chromeExtensions = Path.Combine(_chromeDir, profile, "Extensions");
            var inChrome = Directory.Exists(chromeExtensions)
                ? Directory.GetDirectories(chromeExtensions).Select(Path.GetFileName).ToHashSet()
                : new HashSet<string?>();

            foreach (var dir in Directory.GetDirectories(ExtensionsDir).OrderBy(d => d, StringComparer.Ordinal))
            {
                var id = Path.GetFileName(dir);
                if (id.Length != 32 || inChrome.Contains(id)) continue;
                var version = Directory.GetDirectories(dir).OrderBy(d => d, StringComparer.Ordinal).LastOrDefault();
                if (version != null && ExtensionName(version) is { } name)
                    result.Add(new JsonObject { ["id"] = id, ["name"] = name });
            }
            return result;
        }

        /// <summary>
        /// The name in an extension's manifest, looked up in its default locale when it is a
        /// __MSG_key__ placeholder.
        /// </summary>
        public static string? ExtensionName(string versionDir)
        {
            var manifest = ReadJson(Path.Combine(versionDir, "manifest.json"));
            if (Str(manifest?["name"]) is not { } name) return null;
            if (!name.StartsWith("__MSG_") || !name.EndsWith("__")) return name;
            var key = name[6..^2];
            var locale = Str(manifest!["default_locale"]) ?? "en";
            var messages = ReadJson(Path.Combine(versionDir, "_locales", locale, "messages.json")) as JsonObject;
            var entry = messages?.FirstOrDefault(m => string.Equals(m.Key, key, StringComparison.OrdinalIgnoreCase)).Value;
            return Str(entry?["message"]);
        }

        /// <summary>
        /// Arc's command bar choices as {query, type, url, title, search, selectedAt}, so Arclike's
        /// bar starts out knowing them (extension/ranking.js). Arc wraps each choice in an
        /// "archetype". A Chromium one nests another. Choices with neither a page nor a search, such
        /// as Arc's own commands, are left out. Empty when Arc has no such file.
        /// </summary>
        public JsonArray RankingPicks()
        {
            var result = new JsonArray();
            var profiles = ReadJson(RankingPath)?["dataByProfile"] as JsonObject;
            var profile = profiles?["Default"] ?? profiles?.FirstOrDefault().Value;
            if (profile?["queriesToSelectedArchetype"] is not JsonObject picks) return result;

            foreach (var (query, value) in picks)
            {
                if (value?["archetype"] is not JsonObject archetype) continue;
                var type = Str(archetype["type"]) ?? "";
                var associated = archetype["associatedValues"] as JsonObject ?? new JsonObject();
                var values = associated["associatedValue0"] as JsonObject ?? associated;
                if (type == "chromiumArchetype")
                {
                    type = Str(values["type"]) ?? "";
                    values = values["associatedValues"] as JsonObject ?? new JsonObject();
                }
                var pick = new JsonObject
                {
                    ["query"] = query,
                    ["type"] = type,
                    ["selectedAt"] = value["selectedAt"]?.DeepClone() ?? 0,
                };
                if (Str(values["query"] ?? values["search"]) is { } search) pick["search"] = search;
                // A search's URL is only Google's results page, which the search itself stands for.
                if (!type.Contains("search", StringComparison.OrdinalIgnoreCase) && Str(values["url"]) is { } url)
                {
                    pick["url"] = url;
                    if (Str(values["title"] ?? values["siteName"]) is { } title) pick["title"] = title;
                }
                if (pick["search"] != null || pick["url"] != null) result.Add(pick);
            }
            return result;
        }

        private static string? Str(JsonNode? node) =>
            node is JsonValue value && value.TryGetValue<string>(out var s) ? s : null;

        private static JsonNode? ReadJson(string path)
        {
            try { return File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) : null; }
            catch { return null; }
        }

        private static int Size(JsonNode node) => Encoding.UTF8.GetByteCount(node.ToJsonString());
    }
}
