using System;
using System.Collections.Generic;
using System.Linq;

namespace Arclike.Services
{
    /// <summary>
    /// The running native hosts whose extension has registered, by browser, and what each can do.
    /// The keyboard hook leader acts only in a browser listed here, so a browser without Arclike
    /// keeps every key, Ctrl+Tab included. Every instance keeps one, since any of them may become
    /// the leader. The hook thread reads it and the IPC threads write it, so it locks.
    /// </summary>
    public sealed class HostRegistry
    {
        private sealed class Host
        {
            public bool CommandBar;
            public bool LittleArcInFront;
        }

        private readonly Dictionary<string, Dictionary<int, Host>> _hosts = new();
        private readonly object _lock = new();
        private readonly Func<int, bool> _isAlive;

        public HostRegistry(Func<int, bool> isAlive) => _isAlive = isAlive;

        /// <summary>A host's extension registered. commandBar: it answers the command bar.</summary>
        public void SetReady(string browser, int pid, bool commandBar)
        {
            lock (_lock) HostFor(browser, pid).CommandBar = commandBar;
        }

        /// <summary>A Little Arc of the host's profile came to the front, or left it.</summary>
        public void SetLittleArcInFront(string browser, int pid, bool inFront)
        {
            lock (_lock) HostFor(browser, pid).LittleArcInFront = inFront;
        }

        public bool Connected(string browser) => Any(browser, _ => true);

        public bool CommandBar(string browser) => Any(browser, host => host.CommandBar);

        public bool LittleArcInFront(string browser) => Any(browser, host => host.LittleArcInFront);

        private Host HostFor(string browser, int pid)
        {
            if (!_hosts.TryGetValue(browser, out var hosts))
                _hosts[browser] = hosts = new Dictionary<int, Host>();
            if (!hosts.TryGetValue(pid, out var host))
                hosts[pid] = host = new Host();
            return host;
        }

        // A host that exited without a word, such as one Chrome killed, drops out here.
        private bool Any(string browser, Func<Host, bool> test)
        {
            lock (_lock)
            {
                if (!_hosts.TryGetValue(browser, out var hosts)) return false;
                foreach (var pid in hosts.Keys.Where(pid => !_isAlive(pid)).ToList())
                    hosts.Remove(pid);
                return hosts.Values.Any(test);
            }
        }
    }
}
