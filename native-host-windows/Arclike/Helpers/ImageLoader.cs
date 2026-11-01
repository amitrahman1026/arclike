using System;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Arclike.Helpers
{
    public static class ImageLoader
    {
        /// <summary>
        /// Decode an image from a data URL at `pixelWidth`, or return null. It decodes now and is
        /// frozen, so any thread may create it. The extension sends favicons as data URLs from
        /// Chrome's own cache, and the app makes no network requests, so a web URL gives null.
        /// WPF cannot decode SVG, so an SVG favicon gives null too.
        /// </summary>
        public static ImageSource? Load(string? url, int pixelWidth)
        {
            if (string.IsNullOrEmpty(url)) return null;
            try
            {
                var image = new BitmapImage();
                image.BeginInit();
                image.DecodePixelWidth = pixelWidth;
                image.CacheOption = BitmapCacheOption.OnLoad;
                if (!url.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return null;
                if (url.StartsWith("data:image/svg", StringComparison.OrdinalIgnoreCase)) return null;
                var comma = url.IndexOf(',');
                if (comma < 0) return null;
                image.StreamSource = new MemoryStream(Convert.FromBase64String(url[(comma + 1)..]));
                image.EndInit();
                image.Freeze();
                return image;
            }
            catch
            {
                return null;
            }
        }
    }
}
