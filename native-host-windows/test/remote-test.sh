#!/usr/bin/env bash
# Build, install and test the Windows app on the headless Windows box, from the Mac.
#   native-host-windows/test/remote-test.sh            protocol test and every scenario
#   native-host-windows/test/remote-test.sh smoke ...  named scenarios from test/scenarios
#   native-host-windows/test/remote-test.sh setup      one-time: probe, puppeteer-core, the task
# Needs an SSH host entry (default name arclike-win, or set ARCLIKE_WIN_HOST) and a one-time run
# of the setup mode. See docs/windows-port.md, sections 7 and 8.
set -euo pipefail

HOST="${ARCLIKE_WIN_HOST:-arclike-win}"
ROOT="$(git rev-parse --show-toplevel)"
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(smoke command-bar switcher copy-url little-arc other-browser second-monitor arc-import)
PS="powershell -NoProfile -ExecutionPolicy Bypass"

# Copy the working tree as one tar file, with uncommitted and untracked (not ignored) files. A
# temporary index keeps the real one untouched.
TAR="$(mktemp -t arclike-src).tar"
INDEX="$(mktemp -t arclike-index)"
trap 'rm -f "$TAR" "$INDEX"' EXIT
cp "$(git -C "$ROOT" rev-parse --path-format=absolute --git-path index)" "$INDEX"
GIT_INDEX_FILE="$INDEX" git -C "$ROOT" add -A
git -C "$ROOT" archive --format=tar -o "$TAR" "$(GIT_INDEX_FILE="$INDEX" git -C "$ROOT" write-tree)"
ssh "$HOST" "$PS -Command \"New-Item -ItemType Directory -Force C:\\arclike | Out-Null; Remove-Item -Recurse -Force C:\\arclike\\src -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force C:\\arclike\\src | Out-Null\""
scp -q "$TAR" "$HOST:C:/arclike/src.tar"
ssh "$HOST" "tar -x -f C:/arclike/src.tar -C C:/arclike/src"

if [ "${SCENARIOS[0]}" = setup ]; then
    ssh "$HOST" "$PS -File C:\\arclike\\src\\native-host-windows\\test\\Register-InteractiveRunner.ps1"
    exit
fi

echo "== install"
ssh "$HOST" "$PS -File C:\\arclike\\src\\native-host-windows\\install-local.ps1"

echo "== protocol"
ssh "$HOST" "$PS -File C:\\arclike\\src\\native-host-windows\\test\\Test-Protocol.ps1"

status=0
for scenario in "${SCENARIOS[@]}"; do
    echo "== scenario $scenario"
    ssh "$HOST" "$PS -File C:\\arclike\\src\\native-host-windows\\test\\Invoke-Interactive.ps1 -ScriptPath C:\\arclike\\src\\native-host-windows\\test\\scenarios\\$scenario.ps1" || status=1
done

RESULTS="$ROOT/native-host-windows/test/results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS"
scp -q -r "$HOST:C:/arclike/test/out/*" "$RESULTS/" || true
echo "Results in $RESULTS"
exit $status
