using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Threading;
using System.Windows.Media.Imaging;
using Arclike.Helpers;
using Arclike.Models;

namespace Arclike.NativeMessaging
{
    /// <summary>
    /// Parsed native message from the Chrome extension
    /// </summary>
    public class NativeMessage
    {
        public string Action { get; set; } = "";
        public string? BundleId { get; set; }
        public string? ExtensionVersion { get; set; }
        public int? SelectedIndex { get; set; }
        public string? Url { get; set; }
        public TabInfo[]? Tabs { get; set; }
        public JsonObject? Raw { get; set; }
    }

    /// <summary>
    /// Native messaging host implementing Chrome's 4-byte length-prefixed JSON protocol over stdin/stdout.
    /// Port of sendMessage() and readMessage() in main.swift.
    /// </summary>
    public class NativeMessagingHost
    {
        private readonly Stream _stdin;
        private readonly Stream _stdout;
        private readonly object _writeLock = new();
        private Thread? _readerThread;
        private volatile bool _running;

        public event Action<NativeMessage>? OnMessageReceived;
        public event Action? OnDisconnected;

        public NativeMessagingHost()
        {
            _stdin = Console.OpenStandardInput();
            _stdout = Console.OpenStandardOutput();
        }

        public void Start()
        {
            _running = true;
            _readerThread = new Thread(ReadLoop)
            {
                IsBackground = true,
                Name = "NativeMessagingReader"
            };
            _readerThread.Start();
            DebugLogger.Log("Starting message reader thread");
        }

        public void Stop()
        {
            _running = false;
        }

        /// <summary>
        /// Send a JSON message with 4-byte length prefix.
        /// Port of sendMessage() from main.swift:1978-1989.
        /// </summary>
        public void SendMessage(object messageObj)
        {
            try
            {
                var json = JsonSerializer.Serialize(messageObj, new JsonSerializerOptions
                {
                    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                });
                var jsonBytes = Encoding.UTF8.GetBytes(json);
                var lengthBytes = BitConverter.GetBytes((uint)jsonBytes.Length); // Little-endian on Windows

                lock (_writeLock)
                {
                    _stdout.Write(lengthBytes, 0, 4);
                    _stdout.Write(jsonBytes, 0, jsonBytes.Length);
                    _stdout.Flush();
                }

                // The action only, as in main.swift. The rest can hold what was typed in the
                // command bar, or a URL.
                DebugLogger.Log($"Sent message: {JsonNode.Parse(json)?["action"]}");
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"Failed to send message: {ex.Message}");
            }
        }

        public void SendAction(string action)
        {
            SendMessage(new { action });
        }

        /// <summary>
        /// Read loop matching readMessage() from main.swift:1995-2025.
        /// </summary>
        private void ReadLoop()
        {
            while (_running)
            {
                var message = ReadMessage();
                if (message != null)
                {
                    OnMessageReceived?.Invoke(message);
                }
                else
                {
                    // EOF or error
                    Thread.Sleep(10);
                }
            }
        }

        private NativeMessage? ReadMessage()
        {
            try
            {
                // Read 4-byte length prefix
                var lengthBuffer = new byte[4];
                int bytesRead = ReadExact(_stdin, lengthBuffer, 4);
                if (bytesRead < 4)
                {
                    // EOF - extension disconnected
                    _running = false;
                    OnDisconnected?.Invoke();
                    return null;
                }

                uint length = BitConverter.ToUInt32(lengthBuffer, 0);
                if (length == 0)
                    return null;
                // Chrome sends at most 64 MiB. A larger length means the stream is out of step,
                // and every later read would start in the middle of a message, so stop.
                if (length > 64 * 1024 * 1024)
                {
                    DebugLogger.Log($"Invalid message length: {length} - closing");
                    _running = false;
                    OnDisconnected?.Invoke();
                    return null;
                }

                // Read JSON payload
                var messageBuffer = new byte[length];
                bytesRead = ReadExact(_stdin, messageBuffer, (int)length);
                if (bytesRead < (int)length)
                {
                    DebugLogger.Log("Incomplete message data - closing");
                    _running = false;
                    OnDisconnected?.Invoke();
                    return null;
                }

                var json = Encoding.UTF8.GetString(messageBuffer);
                return ParseMessage(json);
            }
            catch (Exception ex)
            {
                if (_running)
                    DebugLogger.Log($"Error reading message: {ex.Message}");
                return null;
            }
        }

        private static int ReadExact(Stream stream, byte[] buffer, int count)
        {
            int totalRead = 0;
            while (totalRead < count)
            {
                int read = stream.Read(buffer, totalRead, count - totalRead);
                if (read == 0) return totalRead; // EOF
                totalRead += read;
            }
            return totalRead;
        }

        /// <summary>
        /// Parse JSON into NativeMessage, handling all message types from handleMessage() (main.swift:2029-2128).
        /// </summary>
        private NativeMessage? ParseMessage(string json)
        {
            try
            {
                var doc = JsonNode.Parse(json)?.AsObject();
                if (doc == null) return null;

                var action = doc["action"]?.GetValue<string>();
                if (action == null) return null;

                DebugLogger.Log($"Received message: {action}");

                var msg = new NativeMessage
                {
                    Action = action,
                    Raw = doc
                };

                switch (action)
                {
                    case "show_switcher":
                        msg.SelectedIndex = doc["selectedIndex"]?.GetValue<int>();
                        msg.Tabs = ParseTabs(doc["tabs"]?.AsArray());
                        break;

                    case "update_selection":
                        msg.SelectedIndex = doc["selectedIndex"]?.GetValue<int>();
                        break;

                    case "register":
                        msg.BundleId = doc["bundleId"]?.GetValue<string>();
                        msg.ExtensionVersion = doc["extensionVersion"]?.GetValue<string>();
                        break;

                    case "url_copied":
                        msg.Url = doc["url"]?.GetValue<string>();
                        break;
                }

                return msg;
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"Failed to parse message: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Parse tab array matching parseTabInfo() from main.swift:2110-2128.
        /// </summary>
        private TabInfo[]? ParseTabs(JsonArray? tabsArray)
        {
            if (tabsArray == null) return null;

            var tabs = new System.Collections.Generic.List<TabInfo>();
            foreach (var tabNode in tabsArray)
            {
                if (tabNode == null) continue;
                var obj = tabNode.AsObject();

                var id = obj["id"]?.GetValue<int>();
                var title = obj["title"]?.GetValue<string>();
                if (id == null || title == null) continue;

                BitmapImage? thumbnail = null;
                var thumbnailData = obj["thumbnail"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(thumbnailData))
                {
                    try
                    {
                        // Extract base64 from data URL
                        var commaIdx = thumbnailData.IndexOf(',');
                        if (commaIdx >= 0)
                        {
                            var base64 = thumbnailData.Substring(commaIdx + 1);
                            var imageBytes = Convert.FromBase64String(base64);
                            thumbnail = new BitmapImage();
                            thumbnail.BeginInit();
                            // Decode straight to preview size, as main.swift does with ImageIO.
                            thumbnail.DecodePixelWidth = 440;
                            thumbnail.StreamSource = new MemoryStream(imageBytes);
                            thumbnail.CacheOption = BitmapCacheOption.OnLoad;
                            thumbnail.EndInit();
                            thumbnail.Freeze();
                        }
                    }
                    catch
                    {
                        // Ignore thumbnail parse errors
                    }
                }

                tabs.Add(new TabInfo
                {
                    Id = id.Value,
                    Title = title,
                    FavIconUrl = obj["favIconUrl"]?.GetValue<string>() ?? "",
                    Url = obj["url"]?.GetValue<string>() ?? "",
                    Thumbnail = thumbnail
                });
            }

            return tabs.ToArray();
        }
    }
}
