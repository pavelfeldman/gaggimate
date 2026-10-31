#!/usr/bin/env bash
# Builds controller.wasm and display.wasm into websim/dist/wasm (see ../MIGRATION.md).
# Needs emsdk at $EMSDK or ~/emsdk, python3 with protobuf + grpcio-tools, and the third-party
# sources in wasm/third_party (LVGL 8.4.0, ArduinoJson 7, nanopb 0.4.9, PSM).
set -euo pipefail

WASM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$WASM/../.." && pwd)"
BUILD="$WASM/build"
GEN="$BUILD/generated"

if ! command -v emcc >/dev/null; then
  # shellcheck disable=SC1091
  source "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" >/dev/null 2>&1
fi

mkdir -p "$GEN"

# gaggimate.pb.{c,h}: same generator and flags as platformio.ini's custom_nanopb_options.
(cd "$REPO/lib/NanoPbComm/proto" &&
  python3 "$WASM/third_party/nanopb/generator/nanopb_generator.py" --error-on-unmatched -q -D "$GEN" gaggimate.proto)

# version.h: same content scripts/auto_firmware_version.py writes for the firmware builds.
VERSION="$(git -C "$REPO" describe --tags --dirty --match 'v*' 2>/dev/null || echo dev)"
cat > "$GEN/version.h.tmp" <<EOF
#pragma once
#ifndef GIT_VERSION_H
#define GIT_VERSION_H
#define BUILD_GIT_VERSION "$VERSION"
#define BUILD_TIMESTAMP "websim"
#endif
EOF
cmp -s "$GEN/version.h.tmp" "$GEN/version.h" || mv "$GEN/version.h.tmp" "$GEN/version.h"
rm -f "$GEN/version.h.tmp"

# Web UI manifest: the empty stub scripts/embed_webui_pre.py writes when the bundle isn't built.
mkdir -p "$GEN/display/webassets"
[ -f "$GEN/display/webassets/web_ui_manifest.h" ] || python3 "$REPO/scripts/embed_webui.py" --out "$GEN/display/webassets" --stub >/dev/null

emcmake cmake -S "$WASM" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$BUILD" -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)" "$@"

# Seed profiles for a fresh display flash (data/p), as one JSON the host writes into LittleFS.
python3 - "$REPO/data/p" "$WASM/../dist/wasm/seed-profiles.json" <<'PY'
import json, os, sys
src, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(out), exist_ok=True)
files = {f: open(os.path.join(src, f)).read() for f in sorted(os.listdir(src)) if f.endswith('.json')}
json.dump(files, open(out, 'w'))
PY
