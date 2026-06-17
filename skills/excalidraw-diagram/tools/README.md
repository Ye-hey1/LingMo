# Skill Tools

Shared helpers invoked by the skill in local file-output mode (environment B).
Install once — reused across all diagrams in all projects.

```bash
cd <skill-dir>/tools
npm install          # installs Puppeteer (~170 MB Chromium, one-time)
```

Or skip the Chromium download and use system Chrome:

```bash
cd <skill-dir>/tools
PUPPETEER_SKIP_DOWNLOAD=1 npm install
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Scripts

### `fill-defaults.mjs`

Converts a compact diagram spec (only core fields) into a full `.excalidraw`
file with all required housekeeping fields populated. Also desugars the
`label: {text, fontSize, strokeColor}` form (as used in `create_view`) into
standalone text elements with `containerId` bindings, so the same compact JSON
can be authored once and written to a file.

```bash
node fill-defaults.mjs compact.json diagram.excalidraw
```

### `mermaid-to-excalidraw.mjs`

Converts a Mermaid source file to a full `.excalidraw` file using Excalidraw's
official `@excalidraw/mermaid-to-excalidraw` library (executed inside a
Puppeteer page, since Mermaid needs a DOM). Layout coordinates come from
Mermaid's own rendering engine, so large/complex diagrams stay accurate
instead of relying on hand-rolled layout math.

```bash
node mermaid-to-excalidraw.mjs diagram.mmd [diagram.excalidraw]
cat diagram.mmd | node mermaid-to-excalidraw.mjs - diagram.excalidraw
```

Chain with `render.mjs` to produce a PNG:

```bash
node mermaid-to-excalidraw.mjs diagram.mmd diagram.excalidraw
node render.mjs diagram.excalidraw diagram.png
```

### `list-elements.mjs`

Reads a `.excalidraw` file and prints a JSON summary of every non-text, non-arrow
element (id, label text, bounding box) plus every arrow (id, bounding box).
Used as the bridge between `mermaid-to-excalidraw.mjs` output and `apply-styles.mjs`
input: Claude reads the summary and writes a `mapping.json` that assigns a
semantic color to each node id.

```bash
node list-elements.mjs diagram.excalidraw
# or pipe into a file
node list-elements.mjs diagram.excalidraw > elements.json
```

### `apply-styles.mjs`

Applies skill-palette colors and a style preset (`sketch-soft` / `sketch` /
`formal`) to a `.excalidraw` file using a `mapping.json` produced by Claude.
Writes back to the same file in place.

`mapping.json` shape:
```json
{
  "style": "sketch-soft",
  "elements": { "<id>": "input | service | data | decision | success | error | neutral | palette-1…9 | zone-*", "…": "…" },
  "arrows":   { "<id>": "main | success | error | return | async", "…": "…" }
}
```

```bash
node apply-styles.mjs diagram.excalidraw mapping.json
```

### `render.mjs`

Renders a `.excalidraw` file to PNG using Puppeteer + Excalidraw's official
`exportToCanvas` API. Honors `PUPPETEER_EXECUTABLE_PATH`; falls back to common
system Chrome locations if Puppeteer's bundled Chromium isn't available.

```bash
node render.mjs diagram.excalidraw [output.png]
```

### `build-svg-bundle.mjs`

One-time build step that compiles the vendored
`vendor/svg-to-excalidraw-src/` TypeScript sources into a self-contained
browser bundle at `vendor/svg-to-excalidraw.bundle.js`. Called automatically
by `mermaid-to-excalidraw.mjs` on first run if the bundle is missing; you can
also run it manually after updating the vendored sources.

```bash
node build-svg-bundle.mjs
```

### Optional: `vendor/` (offline use)

If `vendor/` contains `react.production.min.js`, `react-dom.production.min.js`,
and `excalidraw.production.min.js`, `render.mjs` loads those instead of
fetching from unpkg. Useful on networks that block CDNs.

```bash
mkdir -p vendor && cd vendor
curl -fsSLO https://unpkg.com/react@18/umd/react.production.min.js
curl -fsSLO https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
curl -fsSL  https://unpkg.com/@excalidraw/excalidraw@0.17.3/dist/excalidraw.production.min.js -o excalidraw.production.min.js
```
