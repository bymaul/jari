#!/bin/bash
# Launch a headless Chromium instance for the Jari E2E tests. Detaches and
# writes browser.log + browser.pid next to the profile, then exits.
#
# Usage: launch.sh <profile-dir> <extension-dir>
#
# Environment:
#   BROWSER_BIN  browser binary (default: google-chrome)
#   DEBUG_PORT   remote debugging port (default: 9223)
set -euo pipefail

PROFILE="${1:?usage: launch.sh <profile-dir> <extension-dir>}"
EXT="${2:?usage: launch.sh <profile-dir> <extension-dir>}"
BROWSER_BIN="${BROWSER_BIN:-google-chrome}"
DEBUG_PORT="${DEBUG_PORT:-9223}"

mkdir -p "$PROFILE"
nohup setsid "$BROWSER_BIN" --headless=new --no-first-run \
  --no-default-browser-check --disable-gpu --enable-unsafe-swiftshader \
  --load-extension="$EXT" --remote-debugging-port="$DEBUG_PORT" \
  --user-data-dir="$PROFILE" --noerrdialogs --ozone-platform=headless \
  --ozone-override-screen-size=800,600 --no-sandbox about:blank \
  > "$PROFILE/browser.log" 2>&1 < /dev/null &
echo $! > "$PROFILE/browser.pid"
exit 0
