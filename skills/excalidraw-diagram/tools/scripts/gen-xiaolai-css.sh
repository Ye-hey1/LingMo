#!/usr/bin/env bash
# Regenerate tools/vendor/xiaolai.css by extracting the XiaolaiSC subset
# font-face mapping from Excalidraw's minified JS chunk.
#
# Run this when bumping the pinned Excalidraw version below. The chunk hash
# changes between releases — find the correct one by listing the package's
# /dist/prod/chunk-*.js files and grepping for "Xiaolai-Regular-".
#
# Usage:  tools/scripts/gen-xiaolai-css.sh

set -euo pipefail

VERSION="0.18.0"
CHUNK="chunk-FX7ZIABN.js"
BASE="https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@${VERSION}/dist/prod"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor"
OUT_FILE="$OUT_DIR/xiaolai.css"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

mkdir -p "$OUT_DIR"
echo "Fetching $BASE/$CHUNK..."
curl -sSL --fail "$BASE/$CHUNK" -o "$TMP"

python3 - "$TMP" "$BASE" > "$OUT_FILE" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
base = sys.argv[2]
# Step 1: variable → Xiaolai woff2 filename
var_to_file = {}
for m in re.finditer(
    r'var\s+([A-Za-z_0-9]+)\s*=\s*"\./fonts/Xiaolai/(Xiaolai-Regular-[a-f0-9]+\.woff2)"',
    src,
):
    var_to_file[m.group(1)] = m.group(2)
# Step 2: descriptor entries {uri:VAR,descriptors:{unicodeRange:"..."}}
faces = []
for m in re.finditer(
    r'\{uri:([A-Za-z_0-9]+),descriptors:\{unicodeRange:"([^"]+)"\}\}', src,
):
    fn = var_to_file.get(m.group(1))
    if not fn:
        continue
    faces.append(
        f"@font-face{{font-family:'Virgil';font-display:block;"
        f"src:url('{base}/fonts/Xiaolai/{fn}') format('woff2');"
        f"unicode-range:{m.group(2)};}}"
    )
print("\n".join(faces))
print(f"/* {len(faces)} XiaolaiSC subsets from Excalidraw {base.rsplit('@',1)[1].split('/')[0]} */", file=sys.stderr)
PY

echo "Wrote $OUT_FILE ($(wc -l <"$OUT_FILE") font-faces)"
