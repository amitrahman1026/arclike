using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace Arclike.Probe
{
    /// <summary>
    /// Headless test helper. It must run in the logged-on user's desktop session (see
    /// Invoke-Interactive.ps1): an SSH session has no desktop to capture, type into or read.
    ///
    ///   probe run-job &lt;dir&gt;                         run dir\job.ps1 without a window, output to dir\out
    ///   probe screenshot &lt;file.png&gt; [--window &lt;automationId&gt;]
    ///   probe keys &lt;token&gt;...                       ctrl+t  down:ctrl  tab  up:ctrl  esc  wait:200
    ///   probe type &lt;text&gt;
    ///   probe move &lt;x&gt; &lt;y&gt;                          cursor to a point in physical pixels
    ///   probe hover &lt;automationId&gt; [index]            cursor to the middle of an element
    ///   probe click
    ///   probe foreground                             JSON: hwnd, pid, process, title, rect
    ///   probe uia [--process Arclike] [--depth 8]    JSON tree
    ///   probe wait &lt;automationId&gt; [--gone] [--timeout 5000]
    /// </summary>
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            if (args.Length == 0)
            {
                Console.Error.WriteLine("usage: probe <command> [args]");
                return 2;
            }
            try
            {
                return args[0] switch
                {
                    "run-job" => RunJob(args[1]),
                    "screenshot" => Screenshot(args[1], Option(args, "--window")),
                    "keys" => Keys(args.Skip(1)),
                    "type" => TypeText(string.Join(" ", args.Skip(1))),
                    "move" => Move(int.Parse(args[1]), int.Parse(args[2])),
                    "hover" => Hover(args[1], args.Length > 2 && int.TryParse(args[2], out var i) ? i : 0),
                    "click" => Click(),
                    "foreground" => Foreground(),
                    "activate" => Activate(args[1]),
                    "uia" => Uia(Option(args, "--process") ?? "Arclike", int.Parse(Option(args, "--depth") ?? "8")),
                    "wait" => Wait(args[1], args.Contains("--gone"), int.Parse(Option(args, "--timeout") ?? "5000")),
                    _ => Fail($"unknown command {args[0]}")
                };
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"probe {args[0]} failed: {ex.Message}");
                return 1;
            }
        }

        private static string? Option(string[] args, string name)
        {
            int i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        private static int Fail(string message)
        {
            Console.Error.WriteLine(message);
            return 2;
        }

        // ---- run-job ----

        /// <summary>
        /// Run dir\job.ps1 with no window, so nothing takes the foreground from Chrome. Writes
        /// stdout.txt and stderr.txt to dir\out, then exitcode.txt last, which the SSH side waits for.
        /// </summary>
        private static int RunJob(string dir)
        {
            var outDir = Path.Combine(dir, "out");
            Directory.CreateDirectory(outDir);
            var psi = new ProcessStartInfo("powershell.exe",
                $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{Path.Combine(dir, "job.ps1")}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = dir
            };
            int exitCode;
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            using (var process = Process.Start(psi)!)
            {
                process.OutputDataReceived += (_, e) => { if (e.Data != null) lock (stdout) stdout.AppendLine(e.Data); };
                process.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (stderr) stderr.AppendLine(e.Data); };
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                // A process the job leaves running, such as the test Chrome, inherits the pipes, so
                // they never reach EOF. WaitForExit() would wait for that EOF, the timed overload
                // does not. The pause lets the readers take the last lines.
                while (!process.WaitForExit(250)) { }
                Thread.Sleep(500);
                exitCode = process.ExitCode;
            }
            lock (stdout) File.WriteAllText(Path.Combine(outDir, "stdout.txt"), stdout.ToString());
            lock (stderr) File.WriteAllText(Path.Combine(outDir, "stderr.txt"), stderr.ToString());
            File.WriteAllText(Path.Combine(outDir, "exitcode.txt"), exitCode.ToString());
            return exitCode;
        }

        // ---- screenshot ----

        private static int Screenshot(string file, string? automationId)
        {
            int x, y, w, h;
            if (automationId != null)
            {
                var element = FindByAutomationId(automationId) ?? throw new Exception($"no element {automationId}");
                var r = element.Current.BoundingRectangle;
                (x, y, w, h) = ((int)r.X, (int)r.Y, (int)r.Width, (int)r.Height);
            }
            else
            {
                (x, y, w, h) = (GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
            }

            IntPtr screen = GetDC(IntPtr.Zero);
            IntPtr memory = CreateCompatibleDC(screen);
            IntPtr bitmap = CreateCompatibleBitmap(screen, w, h);
            IntPtr old = SelectObject(memory, bitmap);
            try
            {
                // CAPTUREBLT includes layered windows, such as the switcher overlay.
                if (!BitBlt(memory, 0, 0, w, h, screen, x, y, SRCCOPY | CAPTUREBLT))
                    throw new Exception($"BitBlt failed: {Marshal.GetLastWin32Error()}");
                SelectObject(memory, old);
                var source = Imaging.CreateBitmapSourceFromHBitmap(bitmap, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(source));
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
                using var stream = File.Create(file);
                encoder.Save(stream);
            }
            finally
            {
                DeleteObject(bitmap);
                DeleteDC(memory);
                ReleaseDC(IntPtr.Zero, screen);
            }
            Console.WriteLine($"{file} {w}x{h} at {x},{y}");
            return 0;
        }

        // ---- input ----

        private static readonly Dictionary<string, ushort> KeyNames = new(StringComparer.OrdinalIgnoreCase)
        {
            ["ctrl"] = 0xA2, ["shift"] = 0xA0, ["alt"] = 0xA4, ["win"] = 0x5B,
            ["tab"] = 0x09, ["enter"] = 0x0D, ["esc"] = 0x1B, ["space"] = 0x20, ["backspace"] = 0x08,
            ["left"] = 0x25, ["up"] = 0x26, ["right"] = 0x27, ["down"] = 0x28, ["delete"] = 0x2E,
            ["f6"] = 0x75,
        };

        private static readonly HashSet<ushort> ExtendedKeys = new() { 0x25, 0x26, 0x27, 0x28, 0x2E, 0x5B };

        private static ushort Vk(string name)
        {
            if (KeyNames.TryGetValue(name, out var vk)) return vk;
            if (name.Length == 1 && char.IsLetterOrDigit(name[0])) return char.ToUpperInvariant(name[0]);
            throw new Exception($"unknown key {name}");
        }

        /// <summary>
        /// Tokens: "ctrl+t" presses and releases a chord. "down:ctrl" and "up:ctrl" hold and release
        /// one key, for Ctrl+Tab sequences that must keep Ctrl down. "wait:200" pauses in ms.
        /// </summary>
        private static int Keys(IEnumerable<string> tokens)
        {
            foreach (var token in tokens)
            {
                if (token.StartsWith("wait:")) { Thread.Sleep(int.Parse(token[5..])); continue; }
                if (token.StartsWith("down:")) { SendKey(Vk(token[5..]), up: false); continue; }
                if (token.StartsWith("up:")) { SendKey(Vk(token[3..]), up: true); continue; }

                var keys = token.Split('+').Select(Vk).ToArray();
                foreach (var k in keys) SendKey(k, up: false);
                foreach (var k in keys.Reverse()) SendKey(k, up: true);
                Thread.Sleep(30);
            }
            return 0;
        }

        private static void SendKey(ushort vk, bool up)
        {
            uint flags = (up ? KEYEVENTF_KEYUP : 0) | (ExtendedKeys.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
            var input = new INPUT
            {
                type = INPUT_KEYBOARD,
                U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = (ushort)MapVirtualKey(vk, 0), dwFlags = flags } }
            };
            Send(input);
            Thread.Sleep(10);
        }

        private static int TypeText(string text)
        {
            foreach (char c in text)
            {
                foreach (var up in new[] { false, true })
                {
                    Send(new INPUT
                    {
                        type = INPUT_KEYBOARD,
                        U = new InputUnion { ki = new KEYBDINPUT { wScan = c, dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0) } }
                    });
                }
                Thread.Sleep(15);
            }
            return 0;
        }

        private static int Move(int x, int y)
        {
            int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
            // Two steps, so the target sees a real move and not only an arrival.
            foreach (var (px, py) in new[] { (x - 3, y - 3), (x, y) })
            {
                Send(new INPUT
                {
                    type = INPUT_MOUSE,
                    U = new InputUnion
                    {
                        mi = new MOUSEINPUT
                        {
                            dx = (int)((px - vx) * 65535L / Math.Max(1, vw - 1)),
                            dy = (int)((py - vy) * 65535L / Math.Max(1, vh - 1)),
                            dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK
                        }
                    }
                });
                Thread.Sleep(30);
            }
            return 0;
        }

        private static int Hover(string automationId, int index)
        {
            var element = FindAllByAutomationId(automationId).ElementAtOrDefault(index)
                ?? throw new Exception($"no element {automationId}[{index}]");
            var r = element.Current.BoundingRectangle;
            return Move((int)(r.X + r.Width / 2), (int)(r.Y + r.Height / 2));
        }

        private static int Click()
        {
            foreach (var flag in new[] { MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP })
                Send(new INPUT { type = INPUT_MOUSE, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = flag } } });
            return 0;
        }

        private static void Send(INPUT input)
        {
            // SendInput fails on the secure desktop (lock screen, UAC) and into elevated windows.
            if (SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>()) != 1)
                throw new Exception($"SendInput failed: {Marshal.GetLastWin32Error()}. Is the desktop locked?");
        }

        // ---- foreground ----

        private static int Foreground()
        {
            var hwnd = GetForegroundWindow();
            GetWindowThreadProcessId(hwnd, out uint pid);
            GetWindowRect(hwnd, out var rect);
            var title = new StringBuilder(512);
            GetWindowText(hwnd, title, title.Capacity);
            string process = "";
            try { process = Process.GetProcessById((int)pid).ProcessName; } catch { }
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                hwnd = hwnd.ToInt64(),
                pid,
                process,
                title = title.ToString(),
                rect = new { x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top }
            }));
            return 0;
        }

        /// <summary>
        /// Bring the main window of a process to the foreground, as a click on it would. Windows
        /// refuses SetForegroundWindow to a process without the last input, which is the case for
        /// a Chrome that the test started. A tap of Alt first gives this process the last input.
        /// </summary>
        private static int Activate(string processName)
        {
            var hwnd = Process.GetProcessesByName(processName)
                .Select(p => p.MainWindowHandle).FirstOrDefault(h => h != IntPtr.Zero);
            if (hwnd == IntPtr.Zero) return Fail($"no window for {processName}");
            if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
            SendKey(VK_MENU, up: false);
            SendKey(VK_MENU, up: true);
            SetForegroundWindow(hwnd);
            Thread.Sleep(200);
            return GetForegroundWindow() == hwnd ? 0 : Fail($"{processName} did not take the foreground");
        }

        // ---- UI Automation ----

        private static IEnumerable<AutomationElement> TopLevelWindows(string processName)
        {
            var pids = Process.GetProcessesByName(processName).Select(p => p.Id).ToHashSet();
            foreach (AutomationElement window in AutomationElement.RootElement.FindAll(TreeScope.Children, System.Windows.Automation.Condition.TrueCondition))
            {
                if (pids.Contains(window.Current.ProcessId)) yield return window;
            }
        }

        private static IEnumerable<AutomationElement> FindAllByAutomationId(string automationId, string processName = "Arclike")
        {
            var condition = new PropertyCondition(AutomationElement.AutomationIdProperty, automationId);
            foreach (var window in TopLevelWindows(processName))
            {
                foreach (AutomationElement element in window.FindAll(TreeScope.Subtree, condition))
                    yield return element;
            }
        }

        private static AutomationElement? FindByAutomationId(string automationId) =>
            FindAllByAutomationId(automationId).FirstOrDefault();

        private static int Uia(string processName, int depth)
        {
            var windows = TopLevelWindows(processName).Select(w => Describe(w, depth)).ToList();
            Console.WriteLine(JsonSerializer.Serialize(windows, new JsonSerializerOptions { WriteIndented = true }));
            return 0;
        }

        private static object Describe(AutomationElement element, int depth)
        {
            var current = element.Current;
            var children = new List<object>();
            if (depth > 0)
            {
                var walker = TreeWalker.ControlViewWalker;
                for (var child = walker.GetFirstChild(element); child != null; child = walker.GetNextSibling(child))
                    children.Add(Describe(child, depth - 1));
            }
            var r = current.BoundingRectangle;
            return new
            {
                type = current.ControlType.ProgrammaticName.Replace("ControlType.", ""),
                automationId = current.AutomationId,
                name = current.Name,
                rect = r.IsEmpty ? null : new { x = (int)r.X, y = (int)r.Y, width = (int)r.Width, height = (int)r.Height },
                children
            };
        }

        private static int Wait(string automationId, bool gone, int timeoutMs)
        {
            var stopwatch = Stopwatch.StartNew();
            while (stopwatch.ElapsedMilliseconds < timeoutMs)
            {
                bool present = FindByAutomationId(automationId) != null;
                if (present != gone)
                {
                    Console.WriteLine($"{automationId} {(gone ? "gone" : "present")} after {stopwatch.ElapsedMilliseconds} ms");
                    return 0;
                }
                Thread.Sleep(100);
            }
            Console.Error.WriteLine($"{automationId} still {(gone ? "present" : "absent")} after {timeoutMs} ms");
            return 1;
        }

        // ---- Win32 ----

        private const int SRCCOPY = 0x00CC0020;
        private const int CAPTUREBLT = 0x40000000;
        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;
        private const uint MOUSEEVENTF_MOVE = 0x0001;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
        private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT { public uint type; public InputUnion U; }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code, uint mapType);
        [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
        private const int SW_RESTORE = 9;
        private const ushort VK_MENU = 0x12;
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
        [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
        [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
        [DllImport("gdi32.dll", SetLastError = true)] private static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    }
}
