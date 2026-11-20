#!/usr/bin/env bash
# Rebuild js/fx.bundle.js and the badge/no-signal sprite sheets from the effect sources in fx-src/arcade.
# Needs Node 18+ and a pixelfx checkout next to this repo: git clone https://github.com/patch-gg/pixelfx ../pixelfx
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
PFX="${PIXELFX:-$HUB/../pixelfx}"
mkdir -p "$PFX/src/fx/arcade"
cp "$HUB"/fx-src/arcade/*.js "$PFX/src/fx/arcade/"
cp "$HUB/fx-src/arcade-entry.js" "$PFX/"
cd "$PFX"
[ -d node_modules/esbuild ] || npm i --no-audit --no-fund
npx esbuild arcade-entry.js --bundle --minify --format=iife --target=es2019 --outfile="$HUB/js/fx.bundle.js"
for id in badge-release badge-beta badge-alpha badge-dev badge-soon no-signal; do
  node tools/render.mjs "arcade/$id" --sheet >/dev/null
  cp "records/arcade/$id/$id.png" "$HUB/assets/sprites/"
done
echo "done"
