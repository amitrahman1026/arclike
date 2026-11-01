using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Arclike.Helpers;

namespace Arclike.IPC
{
    /// <summary>
    /// Named-pipe IPC between the native hosts of one desktop session. Replaces
    /// DistributedNotificationCenter in main.swift. The leader runs the pipe server, the others
    /// connect as clients, and the leader relays each client's message to the rest.
    ///
    /// Posts are queued and written by one background task, so the keyboard hook never blocks on
    /// a pipe and messages keep their order. A leader also handles its own posts, so every
    /// instance sees every message exactly once.
    /// </summary>
    public class InstanceCommunication
    {
        private static readonly Encoding Utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

        private readonly Channel<string> _outgoing = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });
        private readonly ConcurrentDictionary<Connection, byte> _clients = new();
        private CancellationTokenSource _cts = new();
        private CancellationTokenSource? _clientCts;
        private Connection? _leader;
        private volatile bool _isLeader;

        public event Action<string, bool, bool, string>? OnCtrlTab;   // direction, showUI, combineWindows, targetBrowser
        public event Action<string>? OnCtrlRelease;                     // targetBrowser
        public event Action<string>? OnCtrlCancel;                      // targetBrowser
        public event Action<string>? OnCopyUrl;                         // targetBrowser
        public event Action<string, string>? OnCommandBar;              // mode, targetBrowser
        public event Action<string, int, bool>? OnHostReady;            // browser, pid, commandBar
        public event Action<string, int, bool>? OnLittleArcFocus;       // browser, pid, focused
        public event Action<string>? OnLittleArcToMain;                 // targetBrowser
        public event Action? OnShortcutsChanged;
        public event Action? OnLeaderResigned;
        public event Action? OnShowConfig;
        /// <summary>A client (re)connected to a leader. It re-announces what the new leader must know.</summary>
        public event Action? OnConnectedToLeader;

        public bool IsLeader => _isLeader;

        public void Start(bool isLeader)
        {
            _isLeader = isLeader;
            _ = Task.Run(() => WriteLoop(_cts.Token));
            if (isLeader)
                StartServer();
            else
                StartClient();
        }

        /// <summary>Switch from client to server after winning a leader election.</summary>
        public void BecomeLeader()
        {
            if (_isLeader) return;
            _isLeader = true;
            _clientCts?.Cancel();
            _leader?.Dispose();
            _leader = null;
            StartServer();
        }

        public void Stop()
        {
            if (_isLeader)
            {
                // Written directly: the queue stops with the app.
                var line = JsonSerializer.Serialize(new { type = "leaderResigned" });
                foreach (var client in _clients.Keys)
                    client.TryWrite(line);
            }
            _cts.Cancel();
            _leader?.Dispose();
            foreach (var client in _clients.Keys)
                client.Dispose();
        }

        // ---- Posting ----

        public void PostCtrlTab(string direction, bool showUI, bool combineWindows, string targetBrowser) =>
            Post(new { type = "ctrlTab", direction, showUI, combineWindows, targetBrowser });

        public void PostCtrlRelease(string targetBrowser) => Post(new { type = "ctrlRelease", targetBrowser });

        public void PostCtrlCancel(string targetBrowser) => Post(new { type = "ctrlCancel", targetBrowser });

        public void PostCopyUrl(string targetBrowser) => Post(new { type = "copyUrl", targetBrowser });

        public void PostCommandBar(string mode, string targetBrowser) => Post(new { type = "commandBar", mode, targetBrowser });

        public void PostHostReady(string browser, int pid, bool commandBar) => Post(new { type = "hostReady", browser, pid, commandBar });

        public void PostLittleArcFocus(string browser, int pid, bool focused) => Post(new { type = "littleArcFocus", browser, pid, focused });

        public void PostLittleArcToMain(string targetBrowser) => Post(new { type = "littleArcToMain", targetBrowser });

        public void PostShortcutsChanged() => Post(new { type = "shortcutsChanged" });

        private void Post(object message) => _outgoing.Writer.TryWrite(JsonSerializer.Serialize(message));

        private async Task WriteLoop(CancellationToken ct)
        {
            try
            {
                await foreach (var line in _outgoing.Reader.ReadAllAsync(ct))
                {
                    if (_isLeader)
                    {
                        Broadcast(line, exclude: null);
                        HandleReceivedMessage(line);
                    }
                    else if (_leader == null || !_leader.TryWrite(line))
                    {
                        DebugLogger.Log("IPC: no leader connected, message dropped");
                    }
                }
            }
            catch (OperationCanceledException) { }
        }

        private void Broadcast(string line, Connection? exclude)
        {
            foreach (var client in _clients.Keys)
            {
                if (client == exclude) continue;
                if (!client.TryWrite(line))
                {
                    _clients.TryRemove(client, out _);
                    client.Dispose();
                }
            }
        }

        // ---- Server (leader) ----

        private void StartServer()
        {
            _ = Task.Run(() => RunServer(_cts.Token));
            DebugLogger.Log($"IPC pipe server started on {Constants.IpcPipeName}");
        }

        private async Task RunServer(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var server = new NamedPipeServerStream(
                        Constants.IpcPipeName,
                        PipeDirection.InOut,
                        NamedPipeServerStream.MaxAllowedServerInstances,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

                    await server.WaitForConnectionAsync(ct);
                    var connection = new Connection(server);
                    _clients[connection] = 0;
                    DebugLogger.Log("IPC client connected");
                    _ = Task.Run(() => ReadClient(connection, ct), ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    DebugLogger.Log($"IPC server error: {ex.Message}");
                    try { await Task.Delay(1000, ct); } catch (OperationCanceledException) { break; }
                }
            }
        }

        private async Task ReadClient(Connection connection, CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    var line = await connection.Reader.ReadLineAsync(ct);
                    if (line == null) break;
                    HandleReceivedMessage(line);
                    Broadcast(line, exclude: connection);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                DebugLogger.Log($"IPC client read error: {ex.Message}");
            }
            catch (OperationCanceledException) { }
            _clients.TryRemove(connection, out _);
            connection.Dispose();
        }

        // ---- Client ----

        private void StartClient()
        {
            _clientCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            _ = Task.Run(() => RunClient(_clientCts.Token));
            DebugLogger.Log("IPC pipe client connecting");
        }

        private async Task RunClient(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var pipe = new NamedPipeClientStream(".", Constants.IpcPipeName, PipeDirection.InOut,
                        PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await pipe.ConnectAsync(5000, ct);
                    var connection = new Connection(pipe);
                    _leader = connection;
                    DebugLogger.Log("IPC connected to leader");
                    OnConnectedToLeader?.Invoke();

                    while (!ct.IsCancellationRequested)
                    {
                        var line = await connection.Reader.ReadLineAsync(ct);
                        if (line == null) break;
                        HandleReceivedMessage(line);
                    }
                    _leader = null;
                    connection.Dispose();
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    DebugLogger.Log($"IPC client error: {ex.Message}");
                }

                try { await Task.Delay(1000, ct); } catch (OperationCanceledException) { break; }
            }
        }

        // ---- Dispatch ----

        private void HandleReceivedMessage(string json)
        {
            try
            {
                var doc = JsonNode.Parse(json)?.AsObject();
                if (doc == null) return;

                string Str(string name) => doc[name]?.GetValue<string>() ?? "";
                bool Bool(string name) => doc[name]?.GetValue<bool>() ?? false;

                switch (Str("type"))
                {
                    case "ctrlTab":
                        OnCtrlTab?.Invoke(Str("direction"), Bool("showUI"), Bool("combineWindows"), Str("targetBrowser"));
                        break;
                    case "ctrlRelease":
                        OnCtrlRelease?.Invoke(Str("targetBrowser"));
                        break;
                    case "ctrlCancel":
                        OnCtrlCancel?.Invoke(Str("targetBrowser"));
                        break;
                    case "copyUrl":
                        OnCopyUrl?.Invoke(Str("targetBrowser"));
                        break;
                    case "commandBar":
                        OnCommandBar?.Invoke(Str("mode"), Str("targetBrowser"));
                        break;
                    case "hostReady":
                        OnHostReady?.Invoke(Str("browser"), doc["pid"]?.GetValue<int>() ?? 0, Bool("commandBar"));
                        break;
                    case "littleArcFocus":
                        OnLittleArcFocus?.Invoke(Str("browser"), doc["pid"]?.GetValue<int>() ?? 0, Bool("focused"));
                        break;
                    case "littleArcToMain":
                        OnLittleArcToMain?.Invoke(Str("targetBrowser"));
                        break;
                    case "shortcutsChanged":
                        OnShortcutsChanged?.Invoke();
                        break;
                    case "leaderResigned":
                        OnLeaderResigned?.Invoke();
                        break;
                    case "showConfig":
                        OnShowConfig?.Invoke();
                        break;
                }
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"IPC message parse error: {ex.Message}");
            }
        }

        /// <summary>One pipe end, with a single writer guarded by a lock.</summary>
        private sealed class Connection : IDisposable
        {
            private readonly PipeStream _pipe;
            private readonly StreamWriter _writer;
            private readonly object _lock = new();
            public StreamReader Reader { get; }

            public Connection(PipeStream pipe)
            {
                _pipe = pipe;
                _writer = new StreamWriter(pipe, Utf8) { AutoFlush = true };
                Reader = new StreamReader(pipe, Utf8);
            }

            public bool TryWrite(string line)
            {
                try
                {
                    lock (_lock)
                    {
                        if (!_pipe.IsConnected) return false;
                        _writer.WriteLine(line);
                    }
                    return true;
                }
                catch
                {
                    return false;
                }
            }

            public void Dispose()
            {
                try { _pipe.Dispose(); } catch { }
            }
        }
    }
}
