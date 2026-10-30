using System.Text.Json.Serialization;

namespace Arclike.Models
{
    public class ShortcutConfig
    {
        [JsonPropertyName("vkCode")]
        public int VkCode { get; set; }

        [JsonPropertyName("modifiers")]
        public ModifierKeysFlag Modifiers { get; set; }

        [JsonIgnore]
        public string DisplayString
        {
            get
            {
                var parts = new System.Collections.Generic.List<string>();
                if (Modifiers.HasFlag(ModifierKeysFlag.Control)) parts.Add("Ctrl");
                if (Modifiers.HasFlag(ModifierKeysFlag.Alt)) parts.Add("Alt");
                if (Modifiers.HasFlag(ModifierKeysFlag.Shift)) parts.Add("Shift");
                if (Modifiers.HasFlag(ModifierKeysFlag.Win)) parts.Add("Win");
                parts.Add(VkCodeToString(VkCode));
                return string.Join("+", parts);
            }
        }

        public static string VkCodeToString(int vkCode)
        {
            // Letters A-Z
            if (vkCode >= 0x41 && vkCode <= 0x5A)
                return ((char)vkCode).ToString();

            // Numbers 0-9
            if (vkCode >= 0x30 && vkCode <= 0x39)
                return ((char)vkCode).ToString();

            // F-keys
            if (vkCode >= 0x70 && vkCode <= 0x7B)
                return $"F{vkCode - 0x70 + 1}";

            return vkCode switch
            {
                0x09 => "Tab",
                0x0D => "Enter",
                0x20 => "Space",
                0x08 => "Backspace",
                0x1B => "Esc",
                0x25 => "Left",
                0x26 => "Up",
                0x27 => "Right",
                0x28 => "Down",
                0xC0 => "`",
                0xBD => "-",
                0xBB => "=",
                0xDB => "[",
                0xDD => "]",
                0xDC => "\\",
                0xBA => ";",
                0xDE => "'",
                0xBC => ",",
                0xBE => ".",
                0xBF => "/",
                _ => $"Key({vkCode})"
            };
        }
    }

    [System.Flags]
    public enum ModifierKeysFlag
    {
        None = 0,
        Control = 1,
        Shift = 2,
        Alt = 4,
        Win = 8
    }

    public class ShortcutsConfiguration
    {
        [JsonPropertyName("tabSwitch")]
        public ShortcutConfig TabSwitch { get; set; } = DefaultTabSwitch();

        [JsonPropertyName("copyUrl")]
        public ShortcutConfig CopyUrl { get; set; } = DefaultCopyUrl();

        // The initializers must not use Defaults: it constructs this class, so it would recurse.
        public static ShortcutsConfiguration Defaults => new();

        // Ctrl+Tab
        private static ShortcutConfig DefaultTabSwitch() =>
            new() { VkCode = 0x09, Modifiers = ModifierKeysFlag.Control };

        // Alt+Shift+C. Ctrl+Shift+C is Chrome's "inspect element" on Windows.
        private static ShortcutConfig DefaultCopyUrl() =>
            new() { VkCode = 0x43, Modifiers = ModifierKeysFlag.Alt | ModifierKeysFlag.Shift };
    }
}
