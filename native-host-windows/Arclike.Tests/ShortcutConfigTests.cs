using System.Text.Json;
using Arclike.Models;
using Xunit;

public class ShortcutConfigTests
{
    [Fact]
    public void DefaultsAreCtrlTabAndAltShiftC()
    {
        var defaults = ShortcutsConfiguration.Defaults;
        Assert.Equal(0x09, defaults.TabSwitch.VkCode);
        Assert.Equal(ModifierKeysFlag.Control, defaults.TabSwitch.Modifiers);
        Assert.Equal(0x43, defaults.CopyUrl.VkCode);
        Assert.Equal(ModifierKeysFlag.Alt | ModifierKeysFlag.Shift, defaults.CopyUrl.Modifiers);
    }

    [Fact]
    public void MissingFieldsKeepTheirDefaults()
    {
        var config = JsonSerializer.Deserialize<ShortcutsConfiguration>("""{"tabSwitch":{"vkCode":192,"modifiers":2}}""")!;
        Assert.Equal(192, config.TabSwitch.VkCode);
        Assert.Equal(0x43, config.CopyUrl.VkCode);
    }
}
