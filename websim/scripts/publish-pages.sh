#!/usr/bin/env bash
# Publishes the simulator as a static site: index.html, the compiled TypeScript, dist/wasm and the
# web UI (dist/webui) go to the gh-pages branch of a remote (default: origin), which GitHub Pages
# serves at https://<owner>.github.io/<repo>/. The branch is a single generated commit, replaced
# (force-pushed) on every publish. Needs dist/wasm from `npm run build` and dist/webui from
# `npm run build:webui`.
set -euo pipefail

SIM="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${1:-origin}"
URL="$(git -C "$SIM" remote get-url "$REMOTE")"
REV="$(git -C "$SIM" rev-parse --short HEAD)"

if [ ! -f "$SIM/dist/wasm/display.wasm" ]; then
  echo "dist/wasm is missing: run npm run build first" >&2
  exit 1
fi
if [ ! -f "$SIM/dist/webui/index.html" ]; then
  echo "dist/webui is missing: run npm run build:webui first" >&2
  exit 1
fi
(cd "$SIM" && npx tsc -p .)

SITE="$(mktemp -d)"
trap 'rm -rf "$SITE"' EXIT
cp "$SIM/index.html" "$SITE/"
rsync -a --include='*/' --include='*.js' --exclude='*' "$SIM/dist/src/" "$SITE/dist/src/"
rsync -a "$SIM/dist/wasm/" "$SITE/dist/wasm/"
rsync -a "$SIM/dist/webui/" "$SITE/dist/webui/"
touch "$SITE/.nojekyll" # serve files as they are, without a Jekyll pass

cd "$SITE"
git init -q -b gh-pages
git add -A
git commit -q -m "Publish the simulator from $REV"
git push -f "$URL" gh-pages
echo "Published $REV to the gh-pages branch of $URL"
