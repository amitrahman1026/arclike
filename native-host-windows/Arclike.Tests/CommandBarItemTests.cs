using System.Linq;
using System.Text.Json.Nodes;
using Arclike.Models;
using Xunit;

public class CommandBarItemTests
{
    [Fact]
    public void ParseKeepsDisplayOnlyFieldsOutOfThePayload()
    {
        var results = JsonNode.Parse("""
            [
              {"kind": "tab", "title": "GitHub", "detail": "github.com", "hint": "Switch to Tab",
               "favicon": "data:image/png;base64,AAAA", "fill": "https://github.com/", "tabId": 7},
              {"title": "no kind, skipped"},
              {"kind": "command", "title": "Move Tab to Group", "symbol": "folder", "pick": "group"}
            ]
            """)!.AsArray();

        var items = CommandBarItem.Parse(results);

        Assert.Equal(2, items.Count);
        var tab = items[0];
        Assert.Equal(0, tab.Index);
        Assert.Equal("https://github.com/", tab.Fill);
        Assert.Equal("data:image/png;base64,AAAA", tab.Favicon);
        Assert.False(tab.Payload.ContainsKey("favicon"));
        Assert.False(tab.Payload.ContainsKey("fill"));
        Assert.Equal(7, tab.Payload["tabId"]!.GetValue<int>());
        Assert.False(tab.AsksForPick);

        Assert.Equal(1, items[1].Index);
        Assert.True(items[1].AsksForPick);
    }

    [Fact]
    public void ParseReadsWhetherARowCanBeRemoved()
    {
        var results = JsonNode.Parse("""
            [{"kind": "history", "title": "a", "removable": true}, {"kind": "tab", "title": "b"}]
            """)!.AsArray();

        var items = CommandBarItem.Parse(results);

        Assert.True(items[0].Removable);
        Assert.True(items[0].Payload["removable"]!.GetValue<bool>());
        Assert.False(items[1].Removable);
    }

    [Fact]
    public void ParseLeavesTheSourceUntouched()
    {
        var results = JsonNode.Parse("""[{"kind": "url", "title": "x", "fill": "x"}]""")!.AsArray();
        CommandBarItem.Parse(results);
        Assert.True(results[0]!.AsObject().ContainsKey("fill"));
    }

    [Fact]
    public void HighlightBoldsEachQueryWordIgnoringCase()
    {
        var runs = CommandBarItem.Highlight("GitHub Pull Requests", "pull git");
        Assert.Equal(new[] { ("Git", true), ("Hub ", false), ("Pull", true), (" Requests", false) }, runs);
    }

    [Fact]
    public void HighlightWithoutAQueryIsOnePlainRun()
    {
        Assert.Equal(new[] { ("Settings", false) }, CommandBarItem.Highlight("Settings", ""));
        Assert.Empty(CommandBarItem.Highlight("", "x"));
    }

    [Fact]
    public void TipRunsMarkTextBetweenBackticksAsCode()
    {
        var runs = CommandBarItem.TipRuns("Type `>` to run a command");
        Assert.Equal(new[] { ("Type ", false), (">", true), (" to run a command", false) }, runs);
    }

    [Fact]
    public void GlyphFallsBackByKind()
    {
        Assert.Equal(CommandBarItem.Glyph("magnifyingglass", ""), CommandBarItem.Glyph("", "search"));
        Assert.Equal(CommandBarItem.Glyph("globe", ""), CommandBarItem.Glyph("", "url"));
        Assert.Equal(CommandBarItem.Glyph("globe", ""), CommandBarItem.Glyph("no.such.symbol", "command"));
    }

    [Fact]
    public void EverySymbolTheExtensionSendsHasAGlyph()
    {
        var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(System.AppContext.BaseDirectory, "../../../../.."));
        var symbols = System.IO.Directory.GetFiles(System.IO.Path.Combine(root, "extension"), "*.js")
            .SelectMany(f => System.Text.RegularExpressions.Regex.Matches(System.IO.File.ReadAllText(f), "symbol: *\"([a-z0-9.]+)\"").Select(m => m.Groups[1].Value))
            .Distinct()
            .ToList();
        Assert.NotEmpty(symbols);
        var globe = CommandBarItem.Glyph("globe", "");
        var missing = symbols.Where(s => s != "globe" && CommandBarItem.Glyph(s, "command") == globe).ToList();
        Assert.True(missing.Count == 0, "No glyph for: " + string.Join(", ", missing));
    }
}
