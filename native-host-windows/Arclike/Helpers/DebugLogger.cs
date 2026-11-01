using System;
using System.IO;

namespace Arclike.Helpers
{
    public static class DebugLogger
    {
        private static readonly object _lock = new();
        // The log is moved aside to Arclike.old.log once it reaches this size, so it never holds
        // more than twice this on disk. The command bar logs every keystroke.
        private const long MaxBytes = 2 * 1024 * 1024;
        private static bool _enabled = true;

        public static bool Enabled
        {
            get => _enabled;
            set => _enabled = value;
        }

        public static void Log(string message)
        {
            if (!_enabled) return;

            var timestamp = DateTime.UtcNow.ToString("O");
            var logMessage = $"[{timestamp}] {message}";

            try
            {
                // Write to stderr (doesn't interfere with native messaging on stdout)
                Console.Error.WriteLine(logMessage);
            }
            catch
            {
                // Ignore stderr write failures
            }

            try
            {
                lock (_lock)
                {
                    var log = new FileInfo(Constants.DebugLogPath);
                    if (log.Exists && log.Length > MaxBytes)
                        File.Move(log.FullName, Path.ChangeExtension(log.FullName, ".old.log"), overwrite: true);
                    File.AppendAllText(Constants.DebugLogPath, logMessage + Environment.NewLine);
                }
            }
            catch
            {
                // Ignore log file write failures
            }
        }
    }
}
