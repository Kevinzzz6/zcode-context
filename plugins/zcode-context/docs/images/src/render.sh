#!/usr/bin/env bash
# Regenerates the README hero and framed screenshots from docs/images/*.png with headless Chrome.
#   CHROME=/path/to/chrome bash docs/images/src/render.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
chrome="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
root="$(pwd -W 2>/dev/null || pwd)"
src="file:///${root#/}/docs/images/src"

shot() { # out width height url
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=00000000 --virtual-time-budget=1500 \
    --window-size="$2,$3" --screenshot="$root/docs/images/$1" "$4" 2>/dev/null
}

shot hero.png 1200 560 "$src/hero.html"
shot hero.en.png 1200 560 "$src/hero.html?lang=en"

frame() { # out source crop
  shot "$1" 452 $(( $3 / 2 + 32 )) "$src/frame.html?img=$2&crop=$3"
}

frame frame-overview.png sidebar-overview.png 1200
frame frame-changes.png sidebar-changes.png 1200
frame frame-tool-card.png sidebar-tool-card.png 600
frame frame-schemas.png sidebar-schemas.png 600
frame frame-partial.png sidebar-partial.png 1412
