using System;
using System.Diagnostics;
using System.IO;

namespace Arclike
{
    public static class Constants
    {
        public const string AppVersion = "0.2.0";
        public const string AppName = "Arclike";
        public const string AppId = "com.amitrahman1026.arclike";
        public const string NativeMessagingHostName = AppId;
        public const string ManifestFileName = AppId + ".json";
        /// <summary>Fixed by the "key" in extension/manifest.json.</summary>
        public const string ExtensionId = "jlmidbafifiahhcpahkcejphlibhjapo";

        // IPC. Local\ and the session ID keep leader election inside one desktop session, so a
        // copy started from SSH (session 0) cannot take the hook from the logged-on user.
        public const string EventTapMutexName = "Local\\" + AppId + ".hook";
        public static readonly string IpcPipeName = $"{AppId}.ipc.{Process.GetCurrentProcess().SessionId}";

        // Paths
        public static readonly string AppDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            AppName);

        public static readonly string BrowserConfigPath = Path.Combine(AppDataDir, "browser_config.json");
        public static readonly string ShortcutsPath = Path.Combine(AppDataDir, "shortcuts.json");
        public static readonly string ManifestDir = Path.Combine(AppDataDir, "manifests");
        public static readonly string DebugLogPath = Path.Combine(AppDataDir, AppName + ".log");

        // UI dimensions
        public const double CardWidth = 220;
        public const double CardHeight = 146;
        public const double CardCornerRadius = 10;
        public const double CardSpacing = 12;
        public const double OverlayPadding = 16;
        public const double OverlayCornerRadius = 20;
        public const double MaxOverlayWidth = 1200;

        // Setup window
        public const double SetupWidth = 460;
        public const double SetupHeight = 580;

        public static void EnsureAppDataDir()
        {
            Directory.CreateDirectory(AppDataDir);
        }
    }
}
