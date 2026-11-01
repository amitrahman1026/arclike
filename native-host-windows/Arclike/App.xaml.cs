using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using Arclike.Helpers;
using Arclike.IPC;
using Arclike.Keyboard;
using Arclike.Models;
using Arclike.NativeMessaging;
using Arclike.Services;
using Arclike.Views;

namespace Arclike
{
    public partial class App : Application
    {
        private NativeMessagingHost? _nativeMessaging;
        private KeyboardHook? _keyboardHook;
        private LeaderElection? _leaderElection;
        private InstanceCommunication? _ipc;
        private DispatcherTimer? _leaderRecoveryTimer;
        private TabSwitcherOverlay? _overlay;
        private CommandBarWindow? _commandBar;
        private ToastOverlay? _toastOverlay;
        private SetupWindow? _setupWindow;

        /// <summary>Set once our extension has registered.</summary>
        private volatile bool _extensionRegistered;
        /// <summary>Set once our extension says it answers the command bar.</summary>
        private volatile bool _extensionSupportsCommandBar;
        /// <summary>A Little Arc of our extension's profile is in front, as the extension last said.</summary>
        private volatile bool _littleArcFocusedHere;
        /// <summary>Every host whose extension registered. The hook acts only in their browsers.</summary>
        private readonly HostRegistry _hosts = new(pid => Win32.IsProcessAlive((uint)pid));

        public bool LaunchedDirectly { get; private set; }
        public string? OwnerBrowserId { get; set; }
        public uint? OwnerBrowserProcessId { get; set; }

        public static App Instance => (App)Current;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            Constants.EnsureAppDataDir();
            DebugLogger.Log($"Arclike native host starting (PID {Environment.ProcessId}, session {System.Diagnostics.Process.GetCurrentProcess().SessionId})...");

            LaunchedDirectly = DetectLaunchMode(e.Args);
            DebugLogger.Log($"Launched directly: {LaunchedDirectly}");

            BrowserConfigManager.Instance.LoadConfig();
            BrowserConfigManager.Instance.LoadShortcuts();

            _overlay = new TabSwitcherOverlay { Send = SendToExtension };
            _commandBar = new CommandBarWindow { Send = SendToExtension };
            _toastOverlay = new ToastOverlay();

            _ipc = new InstanceCommunication();
            _ipc.OnCtrlTab += OnIpcCtrlTab;
            _ipc.OnCtrlRelease += OnIpcCtrlRelease;
            _ipc.OnCtrlCancel += OnIpcCtrlCancel;
            _ipc.OnCopyUrl += OnIpcCopyUrl;
            _ipc.OnCommandBar += OnIpcCommandBar;
            _ipc.OnHostReady += _hosts.SetReady;
            _ipc.OnLittleArcFocus += _hosts.SetLittleArcInFront;
            _ipc.OnLittleArcToMain += OnIpcLittleArcToMain;
            _ipc.OnConnectedToLeader += AnnounceHost;
            _ipc.OnShortcutsChanged += OnIpcShortcutsChanged;
            _ipc.OnLeaderResigned += () => Dispatcher.BeginInvoke(TryTakeLeadership);

            _leaderElection = new LeaderElection();
            bool isLeader = _leaderElection.TryBecomeLeader();
            _ipc.Start(isLeader);
            if (isLeader)
                InstallHook();

            // A leader that is killed sends no resignation. Its mutex is then abandoned, which
            // the next attempt here picks up.
            _leaderRecoveryTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _leaderRecoveryTimer.Tick += (s, args) => TryTakeLeadership();
            if (!isLeader)
                _leaderRecoveryTimer.Start();

            if (!LaunchedDirectly)
            {
                DetectParentBrowser();

                _nativeMessaging = new NativeMessagingHost();
                _nativeMessaging.OnMessageReceived += OnNativeMessage;
                _nativeMessaging.OnDisconnected += OnNativeDisconnected;
                _nativeMessaging.Start();
                _nativeMessaging.SendAction("ready");
                DebugLogger.Log("Ready message sent");
            }
            else
            {
                DebugLogger.Log("Direct launch - showing setup window");
                ShowSetupWindow();
            }
        }

        private bool DetectLaunchMode(string[] args)
        {
            // Chrome passes the caller's origin, chrome-extension://<id>/, as the first argument.
            // Console.IsInputRedirected is not reliable for a WinExe, which has no console.
            if (args.Any(a => a.StartsWith("chrome-extension://")))
            {
                DebugLogger.Log($"Launched by the browser: {string.Join(" ", args)}");
                return false;
            }
            return true;
        }

        private void DetectParentBrowser()
        {
            var result = BrowserDetector.DetectParentBrowser();
            if (result != null)
            {
                OwnerBrowserId = result.Value.browserId;
                OwnerBrowserProcessId = result.Value.processId;
                DebugLogger.Log($"Auto-detected owner browser: {OwnerBrowserId} with PID {OwnerBrowserProcessId}");
            }
            else
            {
                DebugLogger.Log("WARNING: Could not auto-detect browser, will wait for registration");
            }
        }

        // ---- Leadership ----

        private void InstallHook()
        {
            _keyboardHook = new KeyboardHook(_ipc!, _hosts);
            if (!_keyboardHook.Install())
                DebugLogger.Log("Keyboard hook failed to install");
        }

        /// <summary>Called on the UI thread, which owns the mutex once it is taken.</summary>
        private void TryTakeLeadership()
        {
            if (_leaderElection == null || _leaderElection.IsLeader) return;
            if (!_leaderElection.TryBecomeLeader()) return;
            _leaderRecoveryTimer?.Stop();
            _ipc!.BecomeLeader();
            InstallHook();
            AnnounceHost();
            DebugLogger.Log("Became the keyboard hook leader");
        }

        // ---- Host availability ----

        /// <summary>
        /// Tell every instance that our browser's extension is connected and what it answers, so
        /// the leader starts taking Arclike's keys in that browser. A new leader hears it again.
        /// </summary>
        private void AnnounceHost()
        {
            if (!_extensionRegistered || OwnerBrowserId == null) return;
            _ipc?.PostHostReady(OwnerBrowserId, Environment.ProcessId, _extensionSupportsCommandBar);
            if (_littleArcFocusedHere)
                _ipc?.PostLittleArcFocus(OwnerBrowserId, Environment.ProcessId, true);
        }

        // ---- Native messaging ----

        private void SendToExtension(object message) => _nativeMessaging?.SendMessage(message);

        private void OnNativeMessage(NativeMessage message)
        {
            var raw = message.Raw ?? new JsonObject();
            switch (message.Action)
            {
                case "show_switcher":
                    if (message.Tabs != null && message.SelectedIndex.HasValue)
                    {
                        var foreground = NativeMethods.GetForegroundWindow();
                        Dispatcher.Invoke(() => _overlay?.ShowSwitcher(message.Tabs, message.SelectedIndex.Value, foreground));
                    }
                    break;

                case "update_selection":
                    if (message.SelectedIndex.HasValue)
                        Dispatcher.Invoke(() => _overlay?.UpdateSelection(message.SelectedIndex.Value));
                    break;

                case "hide_switcher":
                    Dispatcher.Invoke(() => _overlay?.HideSwitcher());
                    break;

                case "show_command_bar":
                {
                    var text = Str(raw, "text");
                    var placeholder = raw["placeholder"] is JsonValue p && p.TryGetValue<string>(out var ps) ? ps : null;
                    var foreground = NativeMethods.GetForegroundWindow();
                    Dispatcher.BeginInvoke(() => _commandBar?.ShowBar(text, placeholder, foreground));
                    break;
                }

                case "command_bar_results":
                {
                    if (raw["seq"] is not JsonValue seqValue || !seqValue.TryGetValue<int>(out var seq)) break;
                    var items = CommandBarItem.Parse(raw["results"] as JsonArray);
                    var autocomplete = Str(raw, "autocomplete");
                    var refresh = raw["refresh"] is JsonValue r && r.TryGetValue<bool>(out var rb) && rb;
                    (string, string)? tip = null;
                    if (raw["tip"] is JsonObject t && Str(t, "id") is { Length: > 0 } tipId)
                        tip = (tipId, Str(t, "text"));
                    DebugLogger.Log($"Command bar results for query {seq}: {items.Count} rows{(refresh ? " (favicons)" : "")}");
                    Dispatcher.BeginInvoke(() => _commandBar?.ReceiveResults(seq, items, autocomplete, tip, refresh));
                    break;
                }

                case "log":
                    DebugLogger.Log($"Extension: {Str(raw, "message")}");
                    break;

                case "read_arc":
                {
                    var requestId = raw["requestId"]?.DeepClone();
                    System.Threading.Tasks.Task.Run(() =>
                    {
                        var import = new ArcImport(ArcImport.FindArcDir(), ArcImport.ChromeUserDataDir(), DebugLogger.Log);
                        _nativeMessaging?.SendMessage(import.Response(requestId, Constants.AppVersion, Environment.OSVersion.Version.ToString()));
                    });
                    break;
                }

                case "little_arc_focus":
                    _littleArcFocusedHere = raw["focused"]?.GetValue<bool>() ?? false;
                    if (OwnerBrowserId != null)
                        _ipc?.PostLittleArcFocus(OwnerBrowserId, Environment.ProcessId, _littleArcFocusedHere);
                    break;

                case "register":
                    HandleRegister(message, raw);
                    break;

                case "ping":
                    _nativeMessaging?.SendMessage(new { action = "pong" });
                    break;

                case "url_copied":
                    if (message.Url != null)
                    {
                        var url = message.Url;
                        Dispatcher.Invoke(() =>
                        {
                            CopyToClipboard(url);
                            _toastOverlay?.ShowToast("Copied!", url);
                        });
                    }
                    break;

                default:
                    DebugLogger.Log($"Unknown action: {message.Action}");
                    break;
            }
        }

        private static string Str(JsonObject obj, string key) =>
            obj[key] is JsonValue value && value.TryGetValue<string>(out var s) ? s : "";

        /// <summary>The clipboard can be held open by another process for a moment, so retry.</summary>
        private static void CopyToClipboard(string text)
        {
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    Clipboard.SetDataObject(text, copy: true);
                    return;
                }
                catch (System.Runtime.InteropServices.COMException)
                {
                    Thread.Sleep(30);
                }
            }
            DebugLogger.Log("Could not copy to the clipboard");
        }

        private void HandleRegister(NativeMessage message, JsonObject raw)
        {
            if (message.ExtensionVersion != null)
                DebugLogger.Log($"Extension version: {message.ExtensionVersion}");

            if (message.BundleId == null) return;

            if (OwnerBrowserId == null)
            {
                OwnerBrowserId = message.BundleId;
                if (OwnerBrowserProcessId == null)
                {
                    var detected = BrowserDetector.DetectParentBrowser();
                    if (detected != null)
                        OwnerBrowserProcessId = detected.Value.processId;
                }
                DebugLogger.Log($"Registered with browser (from extension): {message.BundleId}");
            }

            var shortcuts = new
            {
                tabSwitch = BrowserConfigManager.Instance.Shortcuts.TabSwitch.DisplayString,
                copyUrl = BrowserConfigManager.Instance.Shortcuts.CopyUrl.DisplayString
            };
            _nativeMessaging?.SendMessage(new { action = "registered", bundleId = OwnerBrowserId ?? message.BundleId, shortcuts });

            _extensionSupportsCommandBar = raw["features"] is JsonArray features && features.Any(f => f?.GetValue<string>() == "command_bar");
            _extensionRegistered = true;
            AnnounceHost();
        }

        private void OnNativeDisconnected()
        {
            DebugLogger.Log("Connection closed (EOF on stdin) - extension disconnected, exiting...");
            Dispatcher.Invoke(() => Shutdown());
        }

        // ---- IPC ----

        private bool IsOurs(string targetBrowser) => OwnerBrowserId != null && OwnerBrowserId == targetBrowser;

        private void OnIpcCtrlTab(string direction, bool showUI, bool combineWindows, string targetBrowser)
        {
            if (!IsOurs(targetBrowser)) return;
            _nativeMessaging?.SendMessage(new { action = direction, show_ui = showUI, current_window_only = !combineWindows });
        }

        private void OnIpcCtrlRelease(string targetBrowser)
        {
            if (!IsOurs(targetBrowser)) return;
            _nativeMessaging?.SendAction("end_switch");
        }

        private void OnIpcCtrlCancel(string targetBrowser)
        {
            if (!IsOurs(targetBrowser)) return;
            // Hide at once so Esc feels instant. The extension's own hide_switcher is then a no-op.
            Dispatcher.BeginInvoke(() => _overlay?.HideSwitcher());
            _nativeMessaging?.SendAction("cancel_switch");
        }

        private void OnIpcCopyUrl(string targetBrowser)
        {
            if (!IsOurs(targetBrowser)) return;
            _nativeMessaging?.SendMessage(new { action = "copy_url" });
        }

        /// <summary>Ctrl+T or Ctrl+L in our browser: ask the extension, which opens the bar if its profile owns the focused window.</summary>
        private void OnIpcCommandBar(string mode, string targetBrowser)
        {
            if (!_extensionSupportsCommandBar || !IsOurs(targetBrowser)) return;
            DebugLogger.Log($"Command bar requested, mode={mode}");
            _nativeMessaging?.SendMessage(new { action = "command_bar_open", mode });
        }

        /// <summary>
        /// Ctrl+O in a Little Arc of our browser. Every host of that browser hears it. Only the one
        /// whose profile has the Little Arc in front passes it on.
        /// </summary>
        private void OnIpcLittleArcToMain(string targetBrowser)
        {
            if (!_littleArcFocusedHere || !IsOurs(targetBrowser)) return;
            _nativeMessaging?.SendMessage(new { action = "little_arc_to_main" });
        }

        private void OnIpcShortcutsChanged()
        {
            BrowserConfigManager.Instance.LoadShortcuts();
        }

        // ---- UI ----

        public void ShowSetupWindow()
        {
            if (_setupWindow == null)
            {
                _setupWindow = new SetupWindow();
                _setupWindow.Closed += (s, e) => _setupWindow = null;
            }
            _setupWindow.Show();
            _setupWindow.Activate();
        }

        protected override void OnExit(ExitEventArgs e)
        {
            DebugLogger.Log("Application exiting - cleaning up");
            _keyboardHook?.Uninstall();
            _leaderElection?.Release();
            _ipc?.Stop();
            _nativeMessaging?.Stop();
            base.OnExit(e);
        }
    }
}
