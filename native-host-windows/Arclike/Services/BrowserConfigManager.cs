using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;
using Arclike.Helpers;
using Arclike.Models;

namespace Arclike.Services
{
    /// <summary>
    /// Browser configuration manager.
    /// Port of BrowserConfigManager (main.swift:263-476).
    /// Handles config persistence and native messaging manifest/registry management.
    /// </summary>
    public class BrowserConfigManager : INotifyPropertyChanged
    {
        public static BrowserConfigManager Instance { get; } = new();

        private static readonly JsonSerializerOptions _jsonOptions = new()
        {
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private List<BrowserInfo> _browsers = new();
        private ShortcutsConfiguration _shortcuts = ShortcutsConfiguration.Defaults;
        private bool _showingSetup;

        public List<BrowserInfo> Browsers
        {
            get => _browsers;
            set { _browsers = value; OnPropertyChanged(); OnPropertyChanged(nameof(InstalledBrowsers)); }
        }

        public ShortcutsConfiguration Shortcuts
        {
            get => _shortcuts;
            set { _shortcuts = value; OnPropertyChanged(); }
        }

        public bool ShowingSetup
        {
            get => _showingSetup;
            set { _showingSetup = value; OnPropertyChanged(); }
        }

        public IEnumerable<BrowserInfo> InstalledBrowsers => Browsers.Where(b => b.IsInstalled);

        public HashSet<string> EnabledBrowserIds =>
            new(Browsers.Where(b => b.IsEnabled).Select(b => b.Id));

        // ---- Hardcoded fallback browser list for Windows ----
        private static readonly List<BrowserInfo> KnownBrowsers = new()
        {
            new() { Id = "com.google.Chrome", Name = "Google Chrome", AppName = "Google Chrome",
                     ExeName = "chrome.exe", RegistryKey = @"SOFTWARE\Google\Chrome\NativeMessagingHosts",
                     InstallPaths = new() { @"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe", @"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" } },
            new() { Id = "com.brave.Browser", Name = "Brave", AppName = "Brave Browser",
                     ExeName = "brave.exe", RegistryKey = @"SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts",
                     InstallPaths = new() { @"%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe", @"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" } },
            new() { Id = "com.microsoft.edgemac", Name = "Microsoft Edge", AppName = "Microsoft Edge",
                     ExeName = "msedge.exe", RegistryKey = @"SOFTWARE\Microsoft\Edge\NativeMessagingHosts",
                     InstallPaths = new() { @"%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe", @"%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe" } },
            new() { Id = "com.vivaldi.Vivaldi", Name = "Vivaldi", AppName = "Vivaldi",
                     ExeName = "vivaldi.exe", RegistryKey = @"SOFTWARE\Vivaldi\NativeMessagingHosts",
                     InstallPaths = new() { @"%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe" } },
            new() { Id = "com.operasoftware.Opera", Name = "Opera", AppName = "Opera",
                     ExeName = "opera.exe", RegistryKey = @"SOFTWARE\Google\Chrome\NativeMessagingHosts",
                     InstallPaths = new() { @"%LOCALAPPDATA%\Programs\Opera\opera.exe" } },
            new() { Id = "com.operasoftware.OperaGX", Name = "Opera GX", AppName = "Opera GX",
                     ExeName = "opera.exe", RegistryKey = @"SOFTWARE\Google\Chrome\NativeMessagingHosts",
                     InstallPaths = new() { @"%LOCALAPPDATA%\Programs\Opera GX\opera.exe" } },
            new() { Id = "org.chromium.Chromium", Name = "Chromium", AppName = "Chromium",
                     ExeName = "chrome.exe", RegistryKey = @"SOFTWARE\Chromium\NativeMessagingHosts",
                     InstallPaths = new() { @"%LOCALAPPDATA%\Chromium\Application\chrome.exe" } },
            new() { Id = "org.chromium.Thorium", Name = "Thorium", AppName = "Thorium",
                     ExeName = "thorium.exe", RegistryKey = @"SOFTWARE\Thorium\NativeMessagingHosts",
                     InstallPaths = new() { @"%PROGRAMFILES%\Thorium\Application\thorium.exe" } },
        };

        // ---- Config Loading ----

        public void LoadConfig()
        {
            var baseBrowsers = BaseBrowserList();

            // Try to load saved user config
            if (File.Exists(Constants.BrowserConfigPath))
            {
                try
                {
                    var json = File.ReadAllText(Constants.BrowserConfigPath);
                    var saved = JsonSerializer.Deserialize<List<BrowserInfo>>(json, _jsonOptions);
                    if (saved != null)
                    {
                        // Merge saved config into base list
                        foreach (var browser in baseBrowsers)
                        {
                            var savedBrowser = saved.FirstOrDefault(s => s.Id == browser.Id);
                            if (savedBrowser != null)
                            {
                                browser.ExtensionId = savedBrowser.ExtensionId;
                                browser.IsEnabled = savedBrowser.IsEnabled;
                                browser.CombineAllWindows = savedBrowser.CombineAllWindows;
                            }
                        }

                        // Keep any saved browsers not in base list
                        foreach (var savedBrowser in saved.Where(s => s.IsEnabled))
                        {
                            if (!baseBrowsers.Any(b => b.Id == savedBrowser.Id))
                                baseBrowsers.Add(savedBrowser);
                        }
                    }
                }
                catch (Exception ex)
                {
                    DebugLogger.Log($"Failed to load browser config: {ex.Message}");
                }
            }

            // The installer registers the host for every browser it knows and writes no config.
            // A browser whose key names an existing manifest is registered, so the setup window
            // shows it as enabled, and enabling another browser there does not remove its key.
            foreach (var browser in baseBrowsers)
            {
                if (!browser.IsEnabled && IsRegistered(browser.RegistryKey))
                    browser.IsEnabled = true;
            }

            Browsers = baseBrowsers;
        }

        /// <summary>Whether HKCU has the host under `registryKey`, naming a manifest that exists.</summary>
        private static bool IsRegistered(string registryKey)
        {
            if (!OperatingSystem.IsWindows() || string.IsNullOrEmpty(registryKey)) return false;
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey($@"{registryKey}\{Constants.NativeMessagingHostName}");
                return key?.GetValue(null) is string path && File.Exists(path);
            }
            catch
            {
                return false;
            }
        }

        private List<BrowserInfo> BaseBrowserList()
        {
            return KnownBrowsers.Select(b => new BrowserInfo
            {
                Id = b.Id, Name = b.Name, AppName = b.AppName, ExeName = b.ExeName,
                RegistryKey = b.RegistryKey, InstallPaths = new(b.InstallPaths)
            }).ToList();
        }

        public void SaveConfig()
        {
            try
            {
                var json = JsonSerializer.Serialize(Browsers, _jsonOptions);
                File.WriteAllText(Constants.BrowserConfigPath, json);
                UpdateManifests();
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"Failed to save browser config: {ex.Message}");
            }
        }

        // ---- Shortcuts ----

        public void LoadShortcuts()
        {
            if (File.Exists(Constants.ShortcutsPath))
            {
                try
                {
                    var json = File.ReadAllText(Constants.ShortcutsPath);
                    var loaded = JsonSerializer.Deserialize<ShortcutsConfiguration>(json, _jsonOptions);
                    if (loaded != null)
                        Shortcuts = loaded;
                }
                catch (Exception ex)
                {
                    DebugLogger.Log($"Failed to load shortcuts: {ex.Message}");
                }
            }
        }

        public void SaveShortcuts()
        {
            try
            {
                var json = JsonSerializer.Serialize(Shortcuts, _jsonOptions);
                File.WriteAllText(Constants.ShortcutsPath, json);
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"Failed to save shortcuts: {ex.Message}");
            }
        }

        // ---- Browser Management ----

        /// <summary>Enable a browser. An empty extensionId means the Arclike extension's fixed ID.</summary>
        public void EnableBrowser(string id, string? extensionId = null)
        {
            var browser = Browsers.FirstOrDefault(b => b.Id == id);
            if (browser != null)
            {
                browser.ExtensionId = string.IsNullOrEmpty(extensionId) ? null : extensionId;
                browser.IsEnabled = true;
                SaveConfig();
                OnPropertyChanged(nameof(Browsers));
            }
        }

        public void DisableBrowser(string id)
        {
            var browser = Browsers.FirstOrDefault(b => b.Id == id);
            if (browser != null)
            {
                browser.IsEnabled = false;
                SaveConfig();
                OnPropertyChanged(nameof(Browsers));
            }
        }

        public void SetCombineWindows(string id, bool combine)
        {
            var browser = Browsers.FirstOrDefault(b => b.Id == id);
            if (browser != null)
            {
                browser.CombineAllWindows = combine;
                SaveConfig();
            }
        }

        // ---- Native Messaging Registration (Windows Registry) ----

        /// <summary>
        /// Write a manifest and an HKCU registry key for each enabled browser, and remove the keys
        /// of disabled ones. Port of updateManifests in main.swift.
        /// Some browsers share a key (Opera reads Chrome's), so a key is removed only when no
        /// enabled browser uses it, and its manifest allows the origins of every browser on it.
        /// </summary>
        public void UpdateManifests()
        {
            var exePath = Environment.ProcessPath ?? "";
            DebugLogger.Log($"Using exe path for manifest: {exePath}");

            var enabledByKey = Browsers.Where(b => b.IsEnabled)
                .GroupBy(b => b.RegistryKey, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

            foreach (var (registryKey, browsers) in enabledByKey)
            {
                // Always the Arclike extension; also any other ID a user entered for a browser.
                var origins = new List<string> { $"chrome-extension://{Constants.ExtensionId}/" };
                foreach (var b in browsers)
                {
                    if (!string.IsNullOrEmpty(b.ExtensionId) && b.ExtensionId != Constants.ExtensionId)
                        origins.Add($"chrome-extension://{b.ExtensionId}/");
                }

                var manifestPath = Path.Combine(Constants.ManifestDir, $"{browsers[0].Id}.json");
                var manifest = new
                {
                    name = Constants.NativeMessagingHostName,
                    description = $"{Constants.AppName} native helper",
                    path = exePath,
                    type = "stdio",
                    allowed_origins = origins.Distinct().ToArray()
                };

                var registryKeyPath = $@"{registryKey}\{Constants.NativeMessagingHostName}";
                try
                {
                    Directory.CreateDirectory(Constants.ManifestDir);
                    File.WriteAllText(manifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }));
                    using var key = Registry.CurrentUser.CreateSubKey(registryKeyPath);
                    key?.SetValue(null, manifestPath); // The default value is the manifest's path.
                    DebugLogger.Log($"Registered {manifestPath} at HKCU\\{registryKeyPath}");
                }
                catch (Exception ex)
                {
                    DebugLogger.Log($"Failed to register native host at HKCU\\{registryKeyPath}: {ex.Message}");
                }
            }

            foreach (var registryKey in Browsers.Select(b => b.RegistryKey).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (enabledByKey.ContainsKey(registryKey)) continue;
                try
                {
                    Registry.CurrentUser.DeleteSubKey($@"{registryKey}\{Constants.NativeMessagingHostName}", throwOnMissingSubKey: false);
                }
                catch { }
            }
        }

        // ---- INotifyPropertyChanged ----

        public event PropertyChangedEventHandler? PropertyChanged;
        private void OnPropertyChanged([CallerMemberName] string? name = null) =>
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
