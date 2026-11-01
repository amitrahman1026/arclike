using System.Windows.Automation.Peers;
using System.Windows.Controls;

namespace Arclike.Helpers
{
    /// <summary>
    /// A Border that UI Automation can see. A plain Border has no automation peer, so its
    /// AutomationId never reaches the tree. Command bar rows and switcher cards use this, so
    /// screen readers and the test probe can find them.
    /// </summary>
    public class AutomationBorder : Border
    {
        protected override AutomationPeer OnCreateAutomationPeer() => new Peer(this);

        private sealed class Peer : FrameworkElementAutomationPeer
        {
            public Peer(AutomationBorder owner) : base(owner) { }

            protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.ListItem;

            protected override string GetClassNameCore() => nameof(AutomationBorder);
        }
    }
}
