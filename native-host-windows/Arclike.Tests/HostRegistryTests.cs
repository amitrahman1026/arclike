using System.Collections.Generic;
using Arclike.Services;
using Xunit;

public class HostRegistryTests
{
    private readonly HashSet<int> _alive = new() { 10, 20 };
    private HostRegistry NewRegistry() => new(pid => _alive.Contains(pid));

    [Fact]
    public void ABrowserWithoutARegisteredHostIsNotConnected()
    {
        var hosts = NewRegistry();
        hosts.SetReady("com.google.Chrome", 10, commandBar: true);
        Assert.True(hosts.Connected("com.google.Chrome"));
        Assert.False(hosts.Connected("com.microsoft.edgemac"));
    }

    [Fact]
    public void TheCommandBarNeedsAHostThatAnswersIt()
    {
        var hosts = NewRegistry();
        hosts.SetReady("com.google.Chrome", 10, commandBar: false);
        Assert.False(hosts.CommandBar("com.google.Chrome"));
        hosts.SetReady("com.google.Chrome", 20, commandBar: true);
        Assert.True(hosts.CommandBar("com.google.Chrome"));
    }

    [Fact]
    public void AHostThatExitedDropsOut()
    {
        var hosts = NewRegistry();
        hosts.SetReady("com.google.Chrome", 10, commandBar: true);
        _alive.Remove(10);
        Assert.False(hosts.Connected("com.google.Chrome"));
    }

    [Fact]
    public void LittleArcInFrontFollowsTheLastFocusMessage()
    {
        var hosts = NewRegistry();
        hosts.SetReady("com.google.Chrome", 10, commandBar: true);
        hosts.SetLittleArcInFront("com.google.Chrome", 10, true);
        Assert.True(hosts.LittleArcInFront("com.google.Chrome"));
        hosts.SetLittleArcInFront("com.google.Chrome", 10, false);
        Assert.False(hosts.LittleArcInFront("com.google.Chrome"));
    }
}
