#!/bin/bash
set -euo pipefail

# Remove Arclike from this Mac: the app, its settings and logs, and the native messaging host
# manifest from every browser's NativeMessagingHosts folder. Remove the extension yourself in
# chrome://extensions.
#
# Usage:
#   ./uninstall.sh

APP_NAME="Arclike"
APP_ID="com.amitrahman1026.arclike"
INSTALLED_APP="/Applications/$APP_NAME.app"
SUPPORT="$HOME/Library/Application Support"

remove() {
    if [ -e "$1" ]; then
        echo "Removing $1"
        rm -rf "$1"
    fi
}

echo "==> Quitting $APP_NAME..."
pkill -f "$INSTALLED_APP/Contents/MacOS/arclike" || true
pkill -f "$HOME/Applications/$APP_NAME.app/Contents/MacOS/arclike" || true

echo "==> Removing the app, its settings and its logs..."
remove "$INSTALLED_APP"
remove "$HOME/Applications/$APP_NAME.app"
remove "$SUPPORT/$APP_NAME"
remove "$HOME/Library/Logs/$APP_NAME.log"
remove "$HOME/Library/Logs/$APP_NAME.old.log"

echo "==> Removing the native messaging host manifests..."
# The app writes one for each browser enabled in its setup window.
find "$SUPPORT" -maxdepth 4 -path "*/NativeMessagingHosts/$APP_ID.json" -print0 2>/dev/null |
    while IFS= read -r -d '' manifest; do remove "$manifest"; done

# Left by upstream's old installer.
remove "$HOME/.arclike"
remove "$HOME/.clut-native-host"

echo ""
echo "Done. Also remove:"
echo "  - the extension, in chrome://extensions"
echo "  - $APP_NAME from System Settings > Privacy & Security > Accessibility (select it, then click -)"
