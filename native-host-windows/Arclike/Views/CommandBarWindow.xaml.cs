using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Arclike.Helpers;
using Arclike.Models;

namespace Arclike.Views
{
    /// <summary>
    /// The command bar: an Arc-style search field over the browser window, opened by Ctrl+T and
    /// Ctrl+L. Port of CommandBarState and CommandBarPanel in main.swift. The extension supplies
    /// the rows and opens the choice. This side owns the window, the text and the selection.
    ///
    /// On macOS the panel takes keys without activating the app. Windows has no such window for
    /// typed text, so the bar becomes the foreground window while it is open, and gives the
    /// foreground back to the browser window when it closes.
    /// </summary>
    public partial class CommandBarWindow : Window
    {
        private const double MaxWidth_ = 720;
        private const double MinWidth_ = 360;
        private const double FieldHeight = 62;
        private const double RowHeight = 46;
        private const double RowSpacing = 2;
        private const double ListPadding = 8;
        private const double TipHeight = 34;
        private const string DefaultPlaceholder = "Search with Google or enter address";
        private static readonly FontFamily IconFont = new("Segoe Fluent Icons, Segoe MDL2 Assets");
        private static readonly Brush SelectedBackground = new SolidColorBrush(Color.FromArgb(0x61, 0x3B, 0x82, 0xF6));

        private List<CommandBarItem> _items = new();
        private readonly List<Border> _rowViews = new();
        private int? _selectedIndex;
        private string _itemsQuery = "";
        private (string Id, string Text)? _tip;

        private bool _isVisible;
        private bool _showing;  // inside ShowBar, where a deactivation is not a dismissal
        /// <summary>What was typed. The field can show more: an inline completion after it, selected.</summary>
        private string _typed = "";
        /// <summary>Set when the last edit added text at the end. Only then is a completion shown.</summary>
        private bool _completing;
        private bool _settingText;
        private int _querySeq;
        /// <summary>The row to select when the rows come back after one was removed.</summary>
        private int? _keepSelection;
        private IntPtr _browserWindow;
        private Win32.POINT _cursorAtShow;

        /// <summary>Sends a message to the extension.</summary>
        public Action<object>? Send { get; set; }

        public CommandBarWindow()
        {
            InitializeComponent();
            Placeholder.Text = DefaultPlaceholder;
            Field.TextChanged += Field_TextChanged;
            Field.PreviewKeyDown += Field_PreviewKeyDown;
            // The foreground steps in ShowBar can deactivate the bar for a moment. Decide once
            // they are done, so only a real loss of focus closes it.
            Deactivated += (s, e) => Dispatcher.BeginInvoke(DispatcherPriority.Input, () =>
            {
                if (!_showing && !IsActive) Dismiss();
            });
            SourceInitialized += (s, e) =>
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                // No Alt+Tab entry, and DWM's rounded corners on Windows 11 (ignored on 10).
                Win32.AddExtendedStyle(hwnd, Win32.WS_EX_TOOLWINDOW);
                int corner = Win32.DWMWCP_ROUND;
                NativeMethods.DwmSetWindowAttribute(hwnd, Win32.DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
                int dark = 1;
                NativeMethods.DwmSetWindowAttribute(hwnd, NativeMethods.DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
            };
        }

        public bool IsOpen => _isVisible;

        /// <summary>
        /// Show the bar over `browserWindow`, holding `text` (selected, so typing replaces it).
        /// Called again while open, it starts over with the new text.
        /// </summary>
        public void ShowBar(string text, string? placeholder, IntPtr browserWindow)
        {
            if (browserWindow != IntPtr.Zero && browserWindow != new WindowInteropHelper(this).Handle)
                _browserWindow = browserWindow;

            var target = WindowPlacement.ForWindow(_browserWindow) ?? WindowPlacement.ForCursorMonitor();
            double scale = target.Scale;
            double width = Math.Min(MaxWidth_, Math.Max(MinWidth_, target.Frame.Width / scale - 48));
            double height = BarHeight(0, false);
            int widthPx = (int)Math.Round(width * scale);
            int heightPx = (int)Math.Round(height * scale);
            // A little above the middle of the window, like Arc and Zen.
            double topOffset = Math.Max(70, target.Frame.Height / scale * 0.22);
            int x = target.Frame.Left + (target.Frame.Width - widthPx) / 2;
            int y = target.Frame.Top + (int)Math.Round(topOffset * scale);
            x = WindowPlacement.Clamp(x, widthPx, target.WorkArea.Left, target.WorkArea.Right);
            y = WindowPlacement.Clamp(y, heightPx, target.WorkArea.Top, target.WorkArea.Bottom);

            _typed = text;
            _completing = false;
            _items = new List<CommandBarItem>();
            _itemsQuery = "";
            _selectedIndex = null;
            _tip = null;
            Win32.GetCursorPos(out _cursorAtShow);
            _isVisible = true;

            Placeholder.Text = placeholder ?? DefaultPlaceholder;
            SetFieldText(text, selectAll: true);
            RenderRows();

            WindowPlacement.MoveTo(this, x, y);
            Width = width;
            Height = height;
            WindowPlacement.MoveTo(this, x, y);

            string method;
            _showing = true;
            try
            {
                Show();
                method = TakeForeground();
                Field.Focus();
                System.Windows.Input.Keyboard.Focus(Field);
                Field.SelectAll();
            }
            finally
            {
                _showing = false;
            }
            DebugLogger.Log($"commandbar shown rect={x},{y},{widthPx}x{heightPx} scale={scale} focused={IsActive} method={method}");
            SendQuery();
        }

        /// <summary>Rows for query `seq`. A `refresh` carries the same rows again with their favicons.</summary>
        public void ReceiveResults(int seq, List<CommandBarItem> items, string autocomplete, (string Id, string Text)? tip, bool refresh)
        {
            if (!_isVisible || seq != _querySeq) return;
            if (refresh)
            {
                if (items.Count == _items.Count)
                {
                    _items = items;
                    RenderRows();
                }
                return;
            }
            _items = items;
            _tip = tip;
            _itemsQuery = _typed;
            if (_keepSelection is int keep)
            {
                _selectedIndex = items.Count == 0 ? null : Math.Min(keep, items.Count - 1);
                _keepSelection = null;
            }
            else
            {
                _selectedIndex = string.IsNullOrWhiteSpace(_typed) || items.Count == 0 ? null : 0;
            }
            if (_completing)
                ShowCompletion(autocomplete);
            RenderRows();
        }

        /// <summary>Hide the bar without opening anything.</summary>
        public void Dismiss()
        {
            if (!_isVisible) return;
            HideBar();
            Send?.Invoke(new { action = "command_bar_closed" });
        }

        /// <summary>Open a row, or the text in the field when no row is selected, and hide the bar.</summary>
        private void Choose(int? index)
        {
            if (!_isVisible) return;
            var message = new JsonObject { ["action"] = "command_bar_choose", ["text"] = Field.Text };
            if (index is int i && i >= 0 && i < _items.Count)
            {
                message["item"] = _items[i].Payload.DeepClone();
                // A command that asks for a second choice keeps the bar open. The extension
                // shows it again with the new prompt.
                if (_items[i].AsksForPick)
                {
                    _items = new List<CommandBarItem>();
                    _selectedIndex = null;
                    RenderRows();
                    Send?.Invoke(message);
                    return;
                }
            }
            // Hide first, so the browser window has the keyboard back before the tab opens.
            HideBar();
            Send?.Invoke(message);
        }

        /// <summary>
        /// Remove a row from the history or the memory, as Shift+Delete does in Chrome's address
        /// bar. The extension answers the query again without it, and the selection stays in place.
        /// </summary>
        private void Remove(int index)
        {
            if (!_isVisible || index < 0 || index >= _items.Count || !_items[index].Removable) return;
            var item = _items[index];
            _querySeq++;
            _keepSelection = index;
            _completing = false;
            if (Field.Text != _typed) SetFieldText(_typed);
            Send?.Invoke(new JsonObject
            {
                ["action"] = "command_bar_remove", ["item"] = item.Payload.DeepClone(),
                ["query"] = _typed, ["seq"] = _querySeq
            });
        }

        private void DismissTip()
        {
            if (!_isVisible || _tip is not { } tip) return;
            _tip = null;
            RenderRows();
            Send?.Invoke(new { action = "command_bar_dismiss_tip", id = tip.Id });
        }

        private void HideBar()
        {
            // Esc and Enter close the bar while it is the foreground window. A click on another
            // window or Alt+Tab closes it after the foreground has moved on, and the browser must
            // not take it back from the window the user chose.
            bool wasForeground = NativeMethods.GetForegroundWindow() == new WindowInteropHelper(this).Handle;
            _isVisible = false;
            Hide();
            _items = new List<CommandBarItem>();
            _selectedIndex = null;
            RenderRows();
            // Windows would activate whatever window is next in z-order, which may not be the
            // browser. The bar had the last input, so it may hand the foreground back.
            if (wasForeground && _browserWindow != IntPtr.Zero && Win32.IsWindow(_browserWindow))
                Win32.SetForegroundWindow(_browserWindow);
        }

        /// <summary>
        /// Become the foreground window. A background process may not always take the foreground,
        /// so a plain SetForegroundWindow can fail. The fallback attaches to the foreground
        /// window's input thread first. Returns the method that worked, for the log.
        /// </summary>
        private string TakeForeground()
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (Win32.SetForegroundWindow(hwnd) && NativeMethods.GetForegroundWindow() == hwnd)
            {
                Activate();
                return "direct";
            }

            var foreground = NativeMethods.GetForegroundWindow();
            uint foregroundThread = NativeMethods.GetWindowThreadProcessId(foreground, out _);
            uint thisThread = Win32.GetCurrentThreadId();
            bool attached = foregroundThread != 0 && foregroundThread != thisThread &&
                            Win32.AttachThreadInput(thisThread, foregroundThread, true);
            try
            {
                Win32.BringWindowToTop(hwnd);
                Win32.SetForegroundWindow(hwnd);
                Win32.SetFocus(hwnd);
            }
            finally
            {
                if (attached) Win32.AttachThreadInput(thisThread, foregroundThread, false);
            }
            Activate();
            return NativeMethods.GetForegroundWindow() == hwnd ? "attach" : "failed";
        }

        // ---- Field ----

        private void SetFieldText(string text, bool selectAll = false, int? caret = null)
        {
            _settingText = true;
            Field.Text = text;
            if (selectAll) Field.SelectAll();
            else Field.Select(caret ?? text.Length, 0);
            _settingText = false;
            UpdatePlaceholder();
        }

        private void UpdatePlaceholder() =>
            Placeholder.Visibility = Field.Text.Length == 0 ? Visibility.Visible : Visibility.Hidden;

        private void Field_TextChanged(object sender, TextChangedEventArgs e)
        {
            UpdatePlaceholder();
            if (_settingText || !_isVisible) return;
            var value = Field.Text;
            _completing = value.Length > _typed.Length && value.StartsWith(_typed, StringComparison.Ordinal);
            _typed = value;
            SendQuery();
        }

        private void Field_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            bool shift = (System.Windows.Input.Keyboard.Modifiers & ModifierKeys.Shift) != 0;
            switch (e.Key)
            {
                case Key.Down:
                    Move(1);
                    break;
                case Key.Up:
                    Move(-1);
                    break;
                case Key.Tab:
                    Move(shift ? -1 : 1);
                    break;
                case Key.Enter:
                    Choose(_selectedIndex);
                    break;
                case Key.Escape:
                    Dismiss();
                    break;
                // Shift+Delete removes the selected row, as in Chrome. Elsewhere it cuts text.
                case Key.Delete when shift && _selectedIndex is int selected && selected < _items.Count && _items[selected].Removable:
                    Remove(selected);
                    break;
                default:
                    return;
            }
            e.Handled = true;
        }

        /// <summary>
        /// Put `completion` in the field after what was typed, with the added part selected so
        /// the next keystroke replaces it. Skipped if the field has moved on since the query.
        /// </summary>
        private void ShowCompletion(string completion)
        {
            if (Field.Text != _typed || Field.SelectionStart != _typed.Length || Field.SelectionLength != 0) return;
            if (completion.Length <= _typed.Length || !completion.StartsWith(_typed, StringComparison.OrdinalIgnoreCase)) return;
            var shown = _typed + completion[_typed.Length..];
            _settingText = true;
            Field.Text = shown;
            Field.Select(_typed.Length, shown.Length - _typed.Length);
            _settingText = false;
        }

        /// <summary>Select the next or previous row, and show it in the field the way Arc and Zen do.</summary>
        private void Move(int delta)
        {
            if (_items.Count == 0) return;
            int index = _selectedIndex is int current
                ? (current + delta + _items.Count) % _items.Count
                : (delta > 0 ? 0 : _items.Count - 1);
            _selectedIndex = index;
            UpdateRowSelection();
            var fill = _items[index].Fill;
            if (fill.Length > 0)
                SetFieldText(fill);
        }

        private void SendQuery()
        {
            _keepSelection = null;
            _querySeq++;
            Send?.Invoke(new { action = "command_bar_query", query = _typed, seq = _querySeq });
        }

        // ---- Rows ----

        private static double BarHeight(int rows, bool tip)
        {
            double height = FieldHeight + 2; // + the 1 px border on each side
            if (rows > 0) height += 1 + ListPadding * 2 + rows * RowHeight + (rows - 1) * RowSpacing;
            if (tip) height += 1 + TipHeight;
            return height;
        }

        private void RenderRows()
        {
            Rows.Children.Clear();
            _rowViews.Clear();
            foreach (var item in _items)
            {
                var row = BuildRow(item);
                if (_rowViews.Count > 0) row.Margin = new Thickness(0, RowSpacing, 0, 0);
                _rowViews.Add(row);
                Rows.Children.Add(row);
            }
            bool hasRows = _items.Count > 0;
            Rows.Visibility = RowsSeparator.Visibility = hasRows ? Visibility.Visible : Visibility.Collapsed;

            TipText.Inlines.Clear();
            if (_tip is { } tip)
            {
                foreach (var (text, code) in CommandBarItem.TipRuns(tip.Text))
                {
                    TipText.Inlines.Add(code
                        ? new Run(" " + text + " ")
                        {
                            FontFamily = new FontFamily("Consolas"),
                            Foreground = new SolidColorBrush(Color.FromArgb(0xD9, 0xFF, 0xFF, 0xFF)),
                            Background = new SolidColorBrush(Color.FromArgb(0x1A, 0xFF, 0xFF, 0xFF))
                        }
                        : new Run(text));
                }
            }
            TipRow.Visibility = TipSeparator.Visibility = _tip != null ? Visibility.Visible : Visibility.Collapsed;
            UpdateRowSelection();

            // Grow or shrink to the rows, keeping the top edge where it is.
            Height = BarHeight(_items.Count, _tip != null);
        }

        private Border BuildRow(CommandBarItem item)
        {
            var grid = new Grid { Height = RowHeight, Margin = new Thickness(12, 0, 12, 0) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Icon: the favicon, or a glyph for the row's symbol.
            var iconBox = new Border
            {
                Width = 28, Height = 28, CornerRadius = new CornerRadius(7),
                Margin = new Thickness(0, 0, 12, 0), Tag = "icon"
            };
            var favicon = ImageLoader.Load(item.Favicon, 32);
            iconBox.Child = favicon != null
                ? new Image { Source = favicon, Width = 16, Height = 16 }
                : new TextBlock
                {
                    Text = CommandBarItem.Glyph(item.Symbol, item.Kind), FontFamily = IconFont, FontSize = 15,
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
                    Tag = "glyph"
                };
            Grid.SetColumn(iconBox, 0);
            grid.Children.Add(iconBox);

            var title = new TextBlock { FontSize = 15, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, Tag = "title" };
            foreach (var (text, bold) in CommandBarItem.Highlight(item.Title, item.Kind == "search" ? "" : _itemsQuery))
                title.Inlines.Add(new Run(text) { FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal });
            if (item.Detail.Length > 0)
                title.Inlines.Add(new Run("  —  " + item.Detail) { Tag = "detail" });
            Grid.SetColumn(title, 1);
            grid.Children.Add(title);

            if (item.Hint.Length > 0)
            {
                var hint = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 0, 0) };
                hint.Children.Add(new TextBlock { Text = item.Hint, FontSize = 13, FontWeight = FontWeights.Medium, VerticalAlignment = VerticalAlignment.Center, Tag = "hint" });
                if (item.Kind == "tab")
                {
                    hint.Children.Add(new Border
                    {
                        Width = 22, Height = 22, CornerRadius = new CornerRadius(5), Margin = new Thickness(8, 0, 0, 0),
                        Background = new SolidColorBrush(Color.FromArgb(0x2E, 0xFF, 0xFF, 0xFF)),
                        Child = new TextBlock
                        {
                            Text = CommandBarItem.Glyph("arrow.right", ""), FontFamily = IconFont, FontSize = 11,
                            Foreground = new SolidColorBrush(Color.FromArgb(0xD9, 0xFF, 0xFF, 0xFF)),
                            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
                        }
                    });
                }
                Grid.SetColumn(hint, 2);
                grid.Children.Add(hint);
            }

            int index = item.Index;
            if (item.Removable)
            {
                // Shown on the selected row. A click removes the row instead of opening it.
                var remove = new Border
                {
                    Width = 22, Height = 22, CornerRadius = new CornerRadius(5), Margin = new Thickness(8, 0, 0, 0),
                    Background = new SolidColorBrush(Color.FromArgb(0x2E, 0xFF, 0xFF, 0xFF)),
                    Visibility = Visibility.Collapsed, Tag = "remove", ToolTip = "Remove this suggestion (Shift+Delete)",
                    Child = new TextBlock
                    {
                        Text = CommandBarItem.Glyph("xmark", ""), FontFamily = IconFont, FontSize = 10,
                        Foreground = new SolidColorBrush(Color.FromArgb(0xD9, 0xFF, 0xFF, 0xFF)),
                        HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
                    }
                };
                System.Windows.Automation.AutomationProperties.SetAutomationId(remove, "CommandBarRowRemove");
                remove.MouseLeftButtonUp += (s, e) => { e.Handled = true; Remove(index); };
                Grid.SetColumn(remove, 3);
                grid.Children.Add(remove);
            }

            var row = new AutomationBorder { CornerRadius = new CornerRadius(10), Child = grid, Background = Brushes.Transparent, Cursor = Cursors.Hand };
            System.Windows.Automation.AutomationProperties.SetAutomationId(row, "CommandBarRow");
            System.Windows.Automation.AutomationProperties.SetName(row, item.Title);
            row.MouseMove += (s, e) => HoverSelect(index);
            row.MouseLeftButtonUp += (s, e) => Choose(index);
            return row;
        }

        private void UpdateRowSelection()
        {
            for (int i = 0; i < _rowViews.Count; i++)
            {
                bool selected = _selectedIndex == i;
                var row = _rowViews[i];
                row.Background = selected ? SelectedBackground : Brushes.Transparent;
                var grid = (Grid)row.Child;
                foreach (var child in grid.Children.OfType<FrameworkElement>())
                {
                    switch (child)
                    {
                        case Border { Tag: "icon" } icon:
                            icon.Background = new SolidColorBrush(Color.FromArgb(selected ? (byte)0xE6 : (byte)0x14, 0xFF, 0xFF, 0xFF));
                            if (icon.Child is TextBlock glyph)
                                glyph.Foreground = selected
                                    ? new SolidColorBrush(Color.FromArgb(0xB3, 0, 0, 0))
                                    : new SolidColorBrush(Color.FromArgb(0xBF, 0xFF, 0xFF, 0xFF));
                            break;
                        case TextBlock { Tag: "title" } title:
                            title.Foreground = new SolidColorBrush(Color.FromArgb(selected ? (byte)0xFF : (byte)0xD9, 0xFF, 0xFF, 0xFF));
                            foreach (var run in title.Inlines.OfType<Run>().Where(r => (r.Tag as string) == "detail"))
                                run.Foreground = new SolidColorBrush(Color.FromArgb(selected ? (byte)0xCC : (byte)0x80, 0xFF, 0xFF, 0xFF));
                            break;
                        case Border { Tag: "remove" } remove:
                            remove.Visibility = selected ? Visibility.Visible : Visibility.Collapsed;
                            break;
                        case StackPanel hint:
                            foreach (var text in hint.Children.OfType<TextBlock>())
                                text.Foreground = new SolidColorBrush(Color.FromArgb(selected ? (byte)0xE6 : (byte)0x8C, 0xFF, 0xFF, 0xFF));
                            break;
                    }
                }
            }
        }

        /// <summary>Hover selects a row once the cursor has moved since the bar opened.</summary>
        private void HoverSelect(int index)
        {
            if (!_isVisible || index == _selectedIndex || index >= _items.Count) return;
            Win32.GetCursorPos(out var now);
            if (Math.Abs(now.X - _cursorAtShow.X) < 2 && Math.Abs(now.Y - _cursorAtShow.Y) < 2) return;
            _selectedIndex = index;
            UpdateRowSelection();
        }

        private void TipDismiss_Click(object sender, RoutedEventArgs e) => DismissTip();
    }
}
