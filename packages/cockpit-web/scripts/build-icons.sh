#!/usr/bin/env bash
# Run manually with librsvg installed; normal builds use the checked-in PNGs.
set -euo pipefail

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo 'Missing rsvg-convert: install librsvg to regenerate icons.' >&2
  exit 1
fi

WEB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$WEB_ROOT/icons-src"
OUTPUT="$WEB_ROOT/public"
mkdir -p "$OUTPUT/icons"

rsvg-convert -w 192 -h 192 "$SOURCE/icon.svg" -o "$OUTPUT/icons/icon-192.png"
rsvg-convert -w 512 -h 512 "$SOURCE/icon.svg" -o "$OUTPUT/icons/icon-512.png"
rsvg-convert -w 180 -h 180 "$SOURCE/icon.svg" -o "$OUTPUT/icons/apple-touch-icon.png"
rsvg-convert -w 512 -h 512 "$SOURCE/icon-maskable.svg" -o "$OUTPUT/icons/icon-maskable-512.png"
cp "$SOURCE/icon.svg" "$OUTPUT/favicon.svg"
