using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Arclike.Services;
using Xunit;

public class ArcImportTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "arclike-test-" + Guid.NewGuid().ToString("N"));
    private string ArcDir => Path.Combine(_root, "Arc");
    private string ChromeDir => Path.Combine(_root, "Chrome");

    public ArcImportTests()
    {
        Directory.CreateDirectory(ArcDir);
        Directory.CreateDirectory(ChromeDir);
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private ArcImport Import() => new(ArcDir, ChromeDir, _ => { });

    private void Write(string relativePath, string text)
    {
        var path = Path.Combine(_root, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    private const string Sidebar = """
        {"version": 1, "sidebar": {"containers": [
          {"global": {}},
          {"topAppsContainerIDs": ["top"],
           "spaces": ["s1", {"id": "s1", "title": "Work", "containerIDs": ["pinned", "p1", "unpinned", "u1"], "customInfo": {}}],
           "items": ["t1", {"id": "t1", "title": null, "childrenIds": [], "parentID": "p1",
                            "data": {"tab": {"savedURL": "https://example.com/", "savedTitle": "Example", "timeLastActiveAt": 1}}},
                     "f1", {"id": "f1", "title": "Folder", "childrenIds": ["t1"],
                            "data": {"itemContainer": {"containerType": {"spaceItems": {"_0": "s1"}}}}}]}
        ]}}
        """;

    [Fact]
    public void MissingSidebarFailsWithArcNotFound()
    {
        var response = Import().Response(JsonValue.Create(7), "0.1.0", "10.0.26100.0");
        Assert.False(response["ok"]!.GetValue<bool>());
        Assert.Equal("arc_not_found", response["error"]!.GetValue<string>());
        Assert.Equal(7, response["requestId"]!.GetValue<int>());
    }

    [Fact]
    public void BadJsonFailsWithBadFormat()
    {
        Write("Arc/StorableSidebar.json", "{ not json");
        Assert.Equal("arc_bad_format", Import().Response(null, "0.1.0", "10")["error"]!.GetValue<string>());
    }

    [Fact]
    public void SidebarIsTrimmedToWhatTheImportReads()
    {
        Write("Arc/StorableSidebar.json", Sidebar);
        var response = Import().Response(null, "0.1.0", "10.0.26100.0");

        Assert.True(response["ok"]!.GetValue<bool>());
        Assert.Equal("arc_data", response["action"]!.GetValue<string>());
        Assert.Equal("10.0.26100.0", response["windows"]!.GetValue<string>());
        var space = response["sidebar"]!["spaces"]!.AsArray().Single()!;
        Assert.Equal("Work", space["title"]!.GetValue<string>());
        Assert.Null(space["customInfo"]);

        var items = response["sidebar"]!["items"]!.AsArray();
        var tab = items.Single(i => i!["id"]!.GetValue<string>() == "t1")!;
        Assert.Equal("tab", tab["kind"]!.GetValue<string>());
        Assert.Equal("https://example.com/", tab["url"]!.GetValue<string>());
        Assert.Equal("Example", tab["savedTitle"]!.GetValue<string>());
        Assert.Null(tab["title"]);
        var folder = items.Single(i => i!["id"]!.GetValue<string>() == "f1")!;
        Assert.Equal("spaceItems", folder["containerType"]!.GetValue<string>());
        Assert.Equal("top", response["sidebar"]!["topAppsContainerIDs"]![0]!.GetValue<string>());
    }

    [Fact]
    public void ArcOnlyExtensionsLeaveOutTheOnesInChromesLastProfile()
    {
        string inBoth = new('a', 32), arcOnly = new('b', 32);
        Write("Chrome/Local State", """{"profile": {"last_used": "Profile 1"}}""");
        Directory.CreateDirectory(Path.Combine(ChromeDir, "Profile 1", "Extensions", inBoth));
        Write($"Arc/User Data/Default/Extensions/{inBoth}/1.0/manifest.json", """{"name": "Both"}""");
        Write($"Arc/User Data/Default/Extensions/{arcOnly}/1.0/manifest.json", """{"name": "__MSG_appName__", "default_locale": "en"}""");
        Write($"Arc/User Data/Default/Extensions/{arcOnly}/1.0/_locales/en/messages.json", """{"appName": {"message": "Arc Only"}}""");

        var extensions = Import().ArcOnlyExtensions();
        var only = Assert.Single(extensions)!;
        Assert.Equal(arcOnly, only["id"]!.GetValue<string>());
        Assert.Equal("Arc Only", only["name"]!.GetValue<string>());
    }

    [Fact]
    public void RankingPicksUnwrapArchetypesAndSkipArcCommands()
    {
        Write("Arc/StorableCommandBarAdditionalRanking.json", """
            {"dataByProfile": {"Default": {"queriesToSelectedArchetype": {
              "gh": {"selectedAt": 5, "archetype": {"type": "chromiumArchetype", "associatedValues": {"associatedValue0":
                     {"type": "history", "associatedValues": {"url": "https://github.com/", "title": "GitHub"}}}}},
              "wea": {"selectedAt": 6, "archetype": {"type": "googleSearch", "associatedValues": {"query": "weather", "url": "https://www.google.com/search?q=weather"}}},
              "set": {"selectedAt": 7, "archetype": {"type": "arcCommand", "associatedValues": {"command": "settings"}}}
            }}}}
            """);
        var picks = Import().RankingPicks();
        Assert.Equal(2, picks.Count);
        var gh = picks.Single(p => p!["query"]!.GetValue<string>() == "gh")!;
        Assert.Equal("history", gh["type"]!.GetValue<string>());
        Assert.Equal("https://github.com/", gh["url"]!.GetValue<string>());
        var search = picks.Single(p => p!["query"]!.GetValue<string>() == "wea")!;
        Assert.Equal("weather", search["search"]!.GetValue<string>());
        Assert.Null(search["url"]);
    }
}
