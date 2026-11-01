using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Arclike.Helpers;
using Arclike.IPC;
using Arclike.Models;
using Arclike.Services;

namespace Arclike.Keyboard
{
    /// <summary>
    /// Low-level keyboard hook for Ctrl+Tab, Ctrl+Esc, the copy-URL shortcut, the command bar
    /// keys (Ctrl+T, Ctrl+L) and Ctrl+O in a Little Arc. Port of eventTapCallback in main.swift.
    /// It acts only in a browser that has Arclike connected (HostRegistry).
    ///
    /// The hook runs on its own thread with its own message loop. Windows drops a low-level hook
    /// whose callback is too slow (LowLevelHooksTimeout), so the callback never waits on the UI
    /// thread, the pipes or a process lookup it has done before: IPC posts are queued, and the
    /// browser behind each process ID is cached.
    ///
    /// Injected keys (LLKHF_INJECTED) are handled like typed ones, so the headless tests can
    /// drive the hook with SendInput.
    /// </summary>
    public class KeyboardHook
    {
        private const int VK_T = 0x54;
        private const int VK_L = 0x4C;
        private const int VK_O = 0x4F;

        private readonly InstanceCommunication _ipc;
        private readonly HostRegistry _hosts;
        private NativeMethods.LowLevelKeyboardProc? _hookProc;
        private IntPtr _hookId = IntPtr.Zero;
        private Thread? _thread;
        private uint _threadId;

        // Touched only on the hook thread.
        private bool _switchInProgress;
        private string? _switchBrowser;
        private int _commandKeyDown;
        private bool _swallowEscapeUp;
        private readonly Dictionary<uint, string?> _browserByProcess = new();

        public KeyboardHook(InstanceCommunication ipc, HostRegistry hosts)
        {
            _ipc = ipc;
            _hosts = hosts;
        }

        /// <summary>Start the hook thread. Returns whether the hook was installed.</summary>
        public bool Install()
        {
            using var ready = new ManualResetEventSlim();
            _thread = new Thread(() => Run(ready))
            {
                IsBackground = true,
                Name = "KeyboardHook",
                Priority = ThreadPriority.AboveNormal
            };
            _thread.Start();
            ready.Wait(TimeSpan.FromSeconds(5));
            return _hookId != IntPtr.Zero;
        }

        public void Uninstall()
        {
            if (_threadId != 0)
            {
                Win32.PostThreadMessage(_threadId, Win32.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                _thread?.Join(TimeSpan.FromSeconds(1));
                _threadId = 0;
            }
        }

        private void Run(ManualResetEventSlim ready)
        {
            _threadId = Win32.GetCurrentThreadId();
            _hookProc = HookCallback;
            _hookId = NativeMethods.SetWindowsHookEx(NativeMethods.WH_KEYBOARD_LL, _hookProc, NativeMethods.GetModuleHandle(null!), 0);
            if (_hookId == IntPtr.Zero)
            {
                DebugLogger.Log($"Failed to install keyboard hook: {Marshal.GetLastWin32Error()}");
                ready.Set();
                return;
            }
            DebugLogger.Log("Keyboard hook installed");
            ready.Set();

            while (Win32.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
            {
                Win32.TranslateMessage(ref msg);
                Win32.DispatchMessage(ref msg);
            }

            NativeMethods.UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
            DebugLogger.Log("Keyboard hook uninstalled");
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode < 0)
                return NativeMethods.CallNextHookEx(_hookId, nCode, wParam, lParam);

            try
            {
                if (Handle((int)wParam, Marshal.PtrToStructure<NativeMethods.KBDLLHOOKSTRUCT>(lParam)))
                    return (IntPtr)1;
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"Keyboard hook error: {ex.Message}");
            }
            return NativeMethods.CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        /// <summary>Handle one key event. Returns true to swallow it.</summary>
        private bool Handle(int msg, NativeMethods.KBDLLHOOKSTRUCT key)
        {
            int vk = (int)key.vkCode;
            bool isDown = msg == NativeMethods.WM_KEYDOWN || msg == NativeMethods.WM_SYSKEYDOWN;
            bool isUp = msg == NativeMethods.WM_KEYUP || msg == NativeMethods.WM_SYSKEYUP;
            var shortcuts = BrowserConfigManager.Instance.Shortcuts;
            var switchBaseMods = shortcuts.TabSwitch.Modifiers & ~ModifierKeysFlag.Shift;

            // Key-ups first, whatever window is in front: the command bar or the switcher may
            // have taken the foreground since the key went down.
            if (isUp)
            {
                if (vk == _commandKeyDown)
                    _commandKeyDown = 0;

                if (vk == NativeMethods.VK_ESCAPE && _swallowEscapeUp)
                {
                    _swallowEscapeUp = false;
                    return true;
                }

                if (_switchInProgress && IsModifierKeyOf(vk, switchBaseMods))
                {
                    DebugLogger.Log("Switch modifier released - ending switch");
                    _ipc.PostCtrlRelease(_switchBrowser!);
                    _switchInProgress = false;
                    _switchBrowser = null;
                }
                return false;
            }

            if (!isDown)
                return false;

            // A browser without Arclike connected keeps every key.
            var browser = ForegroundBrowserId();
            if (browser == null || !_hosts.Connected(browser))
                return false;

            var currentMods = CurrentModifiers();
            var currentBaseMods = currentMods & ~ModifierKeysFlag.Shift;

            // Esc while the switch modifier is still held: cancel without changing tabs. Ctrl+Esc
            // would also open the Start menu, so the key-up is swallowed too.
            if (_switchInProgress && vk == NativeMethods.VK_ESCAPE && (currentMods & switchBaseMods) == switchBaseMods)
            {
                DebugLogger.Log("Escape pressed during switch - cancelling");
                _ipc.PostCtrlCancel(_switchBrowser!);
                _switchInProgress = false;
                _switchBrowser = null;
                _swallowEscapeUp = true;
                return true;
            }

            // Ctrl+T and Ctrl+L open the command bar instead of the browser's new tab and address
            // bar, when a host for this browser can answer it. Ctrl+Shift+T and the others pass.
            if ((vk == VK_T || vk == VK_L) && currentMods == ModifierKeysFlag.Control && _hosts.CommandBar(browser))
            {
                // Low-level hooks get no auto-repeat flag: a second key-down before the key-up
                // is a repeat.
                if (_commandKeyDown != vk)
                {
                    _commandKeyDown = vk;
                    _ipc.PostCommandBar(vk == VK_T ? "new_tab" : "current_tab", browser);
                }
                return true;
            }

            // Ctrl+O while a Little Arc is in front moves its tab to the main window, as Cmd+O
            // does in Arc. Elsewhere Ctrl+O stays the browser's Open File.
            if (vk == VK_O && currentMods == ModifierKeysFlag.Control && _hosts.LittleArcInFront(browser))
            {
                if (_commandKeyDown != vk)
                {
                    _commandKeyDown = vk;
                    _ipc.PostLittleArcToMain(browser);
                }
                return true;
            }

            // Tab-switch shortcut (Shift is not part of the match: it reverses the direction).
            if (vk == shortcuts.TabSwitch.VkCode && switchBaseMods != ModifierKeysFlag.None && currentBaseMods == switchBaseMods)
            {
                if (!_switchInProgress)
                {
                    _switchInProgress = true;
                    _switchBrowser = browser;
                }
                var direction = currentMods.HasFlag(ModifierKeysFlag.Shift) ? "cycle_prev" : "cycle_next";
                // showUI stays true for every press, as in main.swift: the extension shows the
                // switcher on the first press.
                _ipc.PostCtrlTab(direction, showUI: true, combineWindows: false, _switchBrowser!);
                return true;
            }

            if (vk == shortcuts.CopyUrl.VkCode && shortcuts.CopyUrl.Modifiers != ModifierKeysFlag.None && currentMods == shortcuts.CopyUrl.Modifiers)
            {
                DebugLogger.Log("Copy URL shortcut detected");
                _ipc.PostCopyUrl(browser);
                return true;
            }

            return false;
        }

        private static ModifierKeysFlag CurrentModifiers()
        {
            static bool Down(int vk) => (NativeMethods.GetAsyncKeyState(vk) & 0x8000) != 0;
            var mods = ModifierKeysFlag.None;
            if (Down(NativeMethods.VK_CONTROL)) mods |= ModifierKeysFlag.Control;
            if (Down(NativeMethods.VK_SHIFT)) mods |= ModifierKeysFlag.Shift;
            if (Down(NativeMethods.VK_MENU)) mods |= ModifierKeysFlag.Alt;
            if (Down(NativeMethods.VK_LWIN) || Down(NativeMethods.VK_RWIN)) mods |= ModifierKeysFlag.Win;
            return mods;
        }

        private static bool IsModifierKeyOf(int vk, ModifierKeysFlag mods)
        {
            if (mods.HasFlag(ModifierKeysFlag.Control) &&
                (vk == NativeMethods.VK_CONTROL || vk == NativeMethods.VK_LCONTROL || vk == NativeMethods.VK_RCONTROL))
                return true;
            if (mods.HasFlag(ModifierKeysFlag.Alt) &&
                (vk == NativeMethods.VK_MENU || vk == NativeMethods.VK_LMENU || vk == NativeMethods.VK_RMENU))
                return true;
            if (mods.HasFlag(ModifierKeysFlag.Win) && (vk == NativeMethods.VK_LWIN || vk == NativeMethods.VK_RWIN))
                return true;
            return false;
        }

        /// <summary>
        /// The browser ID of the foreground window's process, or null if it is not a known
        /// browser. Port of getActiveBrowserBundleId in main.swift.
        /// </summary>
        private string? ForegroundBrowserId()
        {
            IntPtr hwnd = NativeMethods.GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return null;
            NativeMethods.GetWindowThreadProcessId(hwnd, out uint processId);
            if (processId == 0) return null;

            if (_browserByProcess.TryGetValue(processId, out var cached))
                return cached;
            if (_browserByProcess.Count > 256)
                _browserByProcess.Clear();

            var browser = BrowserDetector.BrowserIdForProcessName(Win32.ProcessImageName(processId));
            _browserByProcess[processId] = browser;
            return browser;
        }
    }
}
