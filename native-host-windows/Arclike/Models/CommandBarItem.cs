using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Arclike.Models
{
    /// <summary>A command bar row from the extension. Port of CommandBarItem in main.swift.</summary>
    public sealed class CommandBarItem
    {
        public int Index { get; init; }
        public string Kind { get; init; } = "";
        public string Title { get; init; } = "";
        public string Detail { get; init; } = "";
        public string Hint { get; init; } = "";
        /// <summary>SF Symbol name, drawn for a row without a favicon, such as a command.</summary>
        public string Symbol { get; init; } = "";
        /// <summary>What the field shows while the row is selected with the arrow keys. Empty leaves the field as typed.</summary>
        public string Fill { get; init; } = "";
        /// <summary>The favicon as a data URL, or empty.</summary>
        public string Favicon { get; init; } = "";
        /// <summary>A page from history or a past search, which Shift+Delete removes.</summary>
        public bool Removable { get; init; }
        /// <summary>The row as sent, without the display-only fields. Sent back when the row is chosen.</summary>
        public JsonObject Payload { get; init; } = new();

        public bool AsksForPick => Payload.ContainsKey("pick");

        public static List<CommandBarItem> Parse(JsonArray? results)
        {
            var items = new List<CommandBarItem>();
            if (results == null) return items;
            foreach (var node in results)
            {
                if (node is not JsonObject source) continue;
                var dict = (JsonObject)source.DeepClone();
                var kind = Str(dict, "kind");
                if (kind.Length == 0) continue;
                var favicon = Str(dict, "favicon");
                var fill = Str(dict, "fill");
                dict.Remove("favicon");
                dict.Remove("fill");
                items.Add(new CommandBarItem
                {
                    Index = items.Count,
                    Kind = kind,
                    Title = Str(dict, "title"),
                    Detail = Str(dict, "detail"),
                    Hint = Str(dict, "hint"),
                    Symbol = Str(dict, "symbol"),
                    Fill = fill,
                    Favicon = favicon,
                    Removable = dict["removable"] is JsonValue removable && removable.TryGetValue<bool>(out var r) && r,
                    Payload = dict
                });
            }
            return items;
        }

        private static string Str(JsonObject dict, string key) =>
            dict[key] is JsonValue value && value.TryGetValue<string>(out var s) ? s : "";

        /// <summary>
        /// Segoe Fluent Icons (Windows 11) and Segoe MDL2 Assets (Windows 10) glyphs for the SF
        /// Symbol names the extension sends. An unknown name shows a globe.
        /// </summary>
        public static string Glyph(string symbol, string kind)
        {
            if (symbol.Length == 0) symbol = kind == "search" ? "magnifyingglass" : "globe";
            return SymbolGlyphs.TryGetValue(symbol, out var glyph) ? glyph : SymbolGlyphs["globe"];
        }

        private static readonly Dictionary<string, string> SymbolGlyphs = new()
        {
            ["magnifyingglass"] = "",
            ["globe"] = "",
            ["xmark"] = "",
            ["arrow.clockwise"] = "",
            ["link"] = "",
            ["arrow.uturn.backward"] = "",
            ["macwindow"] = "",
            ["macwindow.badge.plus"] = "",
            ["macwindow.on.rectangle"] = "",
            ["rectangle"] = "",
            ["rectangle.split.2x1"] = "",
            ["eyeglasses"] = "",
            ["arrow.up.left.and.arrow.down.right"] = "",
            ["gearshape"] = "",
            ["slider.horizontal.3"] = "",
            ["clock"] = "",
            ["arrow.down.circle"] = "",
            ["book"] = "",
            ["trash"] = "",
            ["pin"] = "",
            ["plus"] = "",
            ["plus.square.on.square"] = "",
            ["plus.rectangle.on.rectangle"] = "",
            ["speaker.slash"] = "",
            ["folder"] = "",
            ["folder.badge.plus"] = "",
            ["folder.badge.minus"] = "",
            ["puzzlepiece.extension"] = "",
            ["key"] = "",
            ["arrow.right"] = "",
            ["lightbulb"] = "",
        };

        /// <summary>
        /// Split `title` into runs, with each word of `query` in bold wherever it appears, ignoring
        /// case. Port of commandBarHighlighted in main.swift.
        /// </summary>
        public static List<(string Text, bool Bold)> Highlight(string title, string query)
        {
            var bold = new bool[title.Length];
            foreach (var word in query.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
            {
                int start = 0;
                while (start < title.Length)
                {
                    int found = title.IndexOf(word, start, StringComparison.OrdinalIgnoreCase);
                    if (found < 0) break;
                    for (int i = found; i < found + word.Length; i++) bold[i] = true;
                    start = found + word.Length;
                }
            }
            var runs = new List<(string, bool)>();
            int runStart = 0;
            for (int i = 1; i <= title.Length; i++)
            {
                if (i == title.Length || bold[i] != bold[runStart])
                {
                    runs.Add((title[runStart..i], bold[runStart]));
                    runStart = i;
                }
            }
            return runs;
        }

        /// <summary>Split a tip into runs. Text between backticks is what to type.</summary>
        public static List<(string Text, bool Code)> TipRuns(string text) =>
            text.Split('`').Select((part, i) => (part, i % 2 == 1)).Where(r => r.part.Length > 0).ToList();
    }
}
