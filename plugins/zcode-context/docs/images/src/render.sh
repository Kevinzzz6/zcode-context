#!/usr/bin/env bash
# Regenerates every README image under docs/images/.
#   1. Builds a private copy of the panel and service (output/readme-build/, dist/ is left alone).
#   2. Serves a synthetic session (fixture.mjs) and captures raw side-pane shots with Playwright and local Chrome
#      (shots.mjs) in Chinese and English, light and dark, complete and default (tail) recording, into output/readme-raw/.
#   3. Frames and composes them with headless Chrome: hero, frame-*, events-flow and architecture.
# Usage, from anywhere:
#   PLAYWRIGHT=/abs/path/to/node_modules/playwright/index.mjs bash docs/images/src/render.sh
#   SKIP_SHOTS=1 bash docs/images/src/render.sh      # reuse output/readme-raw/
# Needs Node.js 24+, Chrome (CHROME=… overrides the path), curl and ImageMagick (magick, for image heights).
# oxipng, when on PATH, losslessly shrinks the generated PNGs; the pass is skipped without it.
set -euo pipefail
cd "$(dirname "$0")/../../.."
chrome="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
root="$(pwd -W 2>/dev/null || pwd)"
src="file:///${root#/}/docs/images/src"
raw="output/readme-raw"
rawurl="file:///${root#/}/$raw/"
out="docs/images"
port="${PORT:-4185}"
variants=("" ".en" ".dark" ".en.dark")

if [ -z "${SKIP_SHOTS:-}" ]; then
  : "${PLAYWRIGHT:?set PLAYWRIGHT to the absolute path of playwright/index.mjs}"
  node docs/images/src/build.mjs
  mkdir -p "$raw"
  capture() { # lang tail mode
    FIXTURE_LANG="$1" FIXTURE_TAIL="$2" PORT="$port" node docs/images/src/fixture.mjs &
    until curl -s -o /dev/null "http://127.0.0.1:$port/"; do sleep 0.3; done
    for theme in light dark; do PORT="$port" node docs/images/src/shots.mjs "$PLAYWRIGHT" "$raw" "$1" "$theme" "$3"; done
    curl -s "http://127.0.0.1:$port/quit" || true
    wait
  }
  capture zh 0 full
  capture en 0 full
  capture zh 12 partial
  capture en 12 partial
fi

shot() { # out width height url
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=00000000 --virtual-time-budget=2500 --allow-file-access-from-files \
    --window-size="$2,$3" --screenshot="$root/$out/$1" "$4" 2>/dev/null
}
theme() { [[ $1 == *dark ]] && echo dark || echo light; }
lang() { [[ $1 == .en* ]] && echo en || echo zh; }

frame() { # name crop (source px, 0 = whole shot)
  for v in "${variants[@]}"; do
    local h crop="$2"
    h=$(magick identify -format %h "$raw/sidebar-$1$v.png")
    if [ "$crop" -eq 0 ] || [ "$crop" -gt "$h" ]; then crop="$h"; fi
    shot "frame-$1$v.png" 452 $(( crop / 2 + 32 )) "$src/frame.html?img=${rawurl}sidebar-$1$v.png&crop=$crop&theme=$(theme "$v")"
  done
}
frame overview 1200
frame changes 1200
frame tool-card 0
frame schemas 0
frame partial 0
frame events 0
frame summarized 0

shot hero.png 1200 560 "$src/hero.html?raw=$rawurl"
shot hero.en.png 1200 560 "$src/hero.html?raw=$rawurl&lang=en"
for v in "${variants[@]}"; do
  rows=$(node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(process.argv[1], "utf8")))' "$raw/events-rows$v.json")
  shot "events-flow$v.png" 1200 860 "$src/events-flow.html?raw=$rawurl&lang=$(lang "$v")&theme=$(theme "$v")&rows=$rows"
  shot "architecture$v.png" 1200 520 "$src/architecture.html?lang=$(lang "$v")&theme=$(theme "$v")"
done

# Palette-quantize the UI images (about a third of the size, visually lossless at this scale),
# then squeeze every PNG losslessly with oxipng when it is on PATH.
for f in "$out"/frame-*.png "$out"/events-flow*.png "$out"/architecture*.png; do
  magick "$f" -strip -dither None -colors 256 -define png:compression-level=9 "PNG8:$f"
done
if command -v oxipng >/dev/null; then oxipng -o max --strip safe --quiet "$out"/*.png; fi
echo "README images written to $out/"
