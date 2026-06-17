#!/usr/bin/env node
// Convert a Mermaid source file (.mmd / .mermaid / stdin) to a full
// .excalidraw file, using Excalidraw's official `@excalidraw/mermaid-to-excalidraw`
// library executed inside a Puppeteer page (DOM required by mermaid).
//
// This avoids hand-rolled layout math and delegates node positioning to
// mermaid's own layout engine — much more accurate for large diagrams.
//
// Usage:
//   node mermaid-to-excalidraw.mjs <input.mmd> [output.excalidraw]
//   cat diagram.mmd | node mermaid-to-excalidraw.mjs - out.excalidraw

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , inputPath, outputArg] = process.argv;
if (!inputPath) {
  console.error('Usage: node mermaid-to-excalidraw.mjs <input.mmd|-> [output.excalidraw]');
  process.exit(1);
}

const readInput = () => {
  if (inputPath === '-') return fs.readFileSync(0, 'utf-8');
  return fs.readFileSync(inputPath, 'utf-8');
};
// Pre-process: replace literal \n (backslash-n two-char sequence) with <br/>
// inside Mermaid node label brackets. Claude (and many human authors) write \n
// for line-breaks in labels, but Mermaid flowchart only understands <br/>.
// Leaving \n un-converted causes the literal characters "\" and "n" to appear
// in the rendered node text.
//
// IMPORTANT: only apply to flowchart-family diagrams. sequenceDiagram, gantt,
// journey, etc. treat `\n` as their official line-break marker and would break
// if we rewrote it to <br/>. We sniff the diagram type from the first non-blank,
// non-directive line and skip the rewrite for those types.
const rawSource = readInput();
// Find the diagram-type header by skipping blank lines, %% comments, and any
// YAML frontmatter block delimited by --- ... --- (mermaid supports this for
// titles/themes).
const sniffHeader = (src) => {
  const lines = src.split('\n').map((l) => l.trim());
  let inFrontmatter = false;
  let seenContent = false;
  for (const l of lines) {
    if (inFrontmatter) {
      if (l === '---') inFrontmatter = false;
      continue;
    }
    if (!l || l.startsWith('%%')) continue;
    if (!seenContent && l === '---') { inFrontmatter = true; seenContent = true; continue; }
    return l;
  }
  return '';
};
const firstHeader = sniffHeader(rawSource);
const FLOWCHART_PREFIXES = ['flowchart', 'graph', 'classDiagram', 'stateDiagram', 'erDiagram'];
const isFlowchartFamily = FLOWCHART_PREFIXES.some((p) => firstHeader.startsWith(p));
const mermaidSource = isFlowchartFamily
  ? rawSource.replace(/\\n/g, '<br/>')
  : rawSource;

const outputPath =
  outputArg ??
  (inputPath === '-'
    ? 'diagram.excalidraw'
    : inputPath.replace(/\.(mmd|mermaid|txt)$/i, '') + '.excalidraw');

// ---- Locate a browser (shared logic with render.mjs) -------------------------

const systemChromePaths = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const resolveBrowser = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const p of systemChromePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.error('puppeteer is not installed. Run: npm i puppeteer');
  process.exit(1);
}

const executablePath = resolveBrowser();
const launchOpts = {
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  ...(executablePath ? { executablePath } : {}),
};

// ---- Build page HTML ---------------------------------------------------------
//
// We need both libraries in the page:
//   1. @excalidraw/mermaid-to-excalidraw → produces ExcalidrawElementSkeleton[]
//   2. @excalidraw/excalidraw            → convertToExcalidrawElements() fills
//                                           all required defaults (versioning,
//                                           seed, roundness, etc.)
//
// mermaid-to-excalidraw is ESM-only; we load it via esm.sh inside a module.
// Excalidraw ships a UMD, loaded the same way render.mjs does (vendor-first).

const vendorDir = path.join(__dirname, 'vendor');
const hasVendor =
  fs.existsSync(path.join(vendorDir, 'excalidraw.production.min.js')) &&
  fs.existsSync(path.join(vendorDir, 'react.production.min.js')) &&
  fs.existsSync(path.join(vendorDir, 'react-dom.production.min.js'));

const excalidrawScripts = hasVendor
  ? `<script src="file://${vendorDir}/react.production.min.js"></script>
     <script src="file://${vendorDir}/react-dom.production.min.js"></script>
     <script src="file://${vendorDir}/excalidraw.production.min.js"></script>`
  : `<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
     <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
     <script src="https://unpkg.com/@excalidraw/excalidraw@0.17.3/dist/excalidraw.production.min.js"></script>`;

// svg-to-excalidraw bundle: produced by build-svg-bundle.mjs from the
// vendored TS sources (obsidian-excalidraw-plugin's copy + local patches).
// Built on-demand if missing so fresh checkouts work without a manual step.
const svgBundlePath = path.join(vendorDir, 'svg-to-excalidraw.bundle.js');
if (!fs.existsSync(svgBundlePath)) {
  console.error('[info] building svg-to-excalidraw bundle (first run only)…');
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('node', [path.join(__dirname, 'build-svg-bundle.mjs')], {
    cwd: __dirname,
    stdio: 'inherit',
  });
  if (r.status !== 0 || !fs.existsSync(svgBundlePath)) {
    console.error(
      '[error] failed to build svg-to-excalidraw bundle. ' +
        'Run: cd tools && npm install && node build-svg-bundle.mjs',
    );
    process.exit(1);
  }
}
const svgBundleSource = fs.readFileSync(svgBundlePath, 'utf-8');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
${excalidrawScripts}
<script>${svgBundleSource}</script>
<script type="module">
  import { parseMermaidToExcalidraw } from "https://esm.sh/@excalidraw/mermaid-to-excalidraw@2.2.2";
  window.__parseMermaid = parseMermaidToExcalidraw;
  window.__mermaidReady = true;
</script>
</head><body></body></html>`;

// ---- Run ---------------------------------------------------------------------

const browser = await puppeteer.launch(launchOpts);
const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[page error]', err.message));
page.on('console', async (msg) => {
  if (msg.type() === 'error') {
    const args = await Promise.all(
      msg.args().map((a) => a.jsonValue().catch(() => a.toString())),
    );
    console.error('[page console]', ...args);
  }
});

await page.setContent(html, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => window.__mermaidReady === true && window.ExcalidrawLib,
  { timeout: 30000 },
);

const result = await page.evaluate(async (src) => {
  // Capture the library's internal error before it swallows it
  const origError = console.error;
  let libError = null;
  console.error = (...args) => {
    for (const a of args) {
      if (a && typeof a === 'object' && a.message) {
        libError = { message: a.message, stack: a.stack };
      }
    }
    origError.apply(console, args);
  };
  // mermaid uses CSS stylesheets (`.node rect { fill:#ECECFF; stroke:#... }`)
  // for styling rather than inline attributes, but svg-to-excalidraw only
  // reads attributes via getAttribute(). So we:
  //   1. mount the SVG into the live document
  //   2. ask getComputedStyle() for fill/stroke/opacity/stroke-width
  //   3. write those back as attributes on each shape
  //   4. extract text from <foreignObject> labels as positioned records
  //      (returned separately — svg-to-excalidraw ignores <text>)
  //
  // Returns: { svg: sanitizedSvgString, labels: [{x,y,text,fontSize,color}] }
  function prepareMermaidSvg(rawSvg) {
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
    // Preserve XHTML-unfriendly <br> tags by rewriting to <br/> before parsing.
    const cleaned = rawSvg.replace(/<br\s*\/?>/gi, '<br/>');
    container.innerHTML = cleaned;
    document.body.appendChild(container);
    const svg = container.querySelector('svg');
    if (!svg) { container.remove(); return { svg: rawSvg, labels: [] }; }

    // Helper: resolve a CSS property via getComputedStyle, returning null for
    // `none` / transparent-ish values so we don't override defaults with junk.
    const computed = (el, prop) => {
      const v = getComputedStyle(el).getPropertyValue(prop).trim();
      if (!v || v === 'none' || v === 'rgba(0, 0, 0, 0)') return null;
      return v;
    };

    // Drop mermaid's inner label-background rects — these live inside
    // <g class="label"> / <g class="nodeLabel"> and only exist to paint a
    // white box behind the foreignObject text. They create the "nested
    // inner rectangle" artefact in the output.
    for (const label of [...svg.querySelectorAll('g.label, g.nodeLabel')]) {
      for (const inner of [...label.querySelectorAll('rect')]) inner.remove();
    }

    // Mark edge paths so we can turn them into arrows later. Mermaid edges
    // live under <g class="edgePaths"> or have class "flowchart-link" /
    // "edge-thickness-*" on the path itself.
    for (const p of [...svg.querySelectorAll('g.edgePaths path, path.flowchart-link, path[class*="edge-"]')]) {
      p.setAttribute('data-mermaid-edge', '1');
    }

    // Inline computed fill/stroke/stroke-width/opacity for every shape.
    const shapeSel = 'rect, circle, ellipse, polygon, polyline, path, line';
    for (const el of svg.querySelectorAll(shapeSel)) {
      if (!el.hasAttribute('fill')) {
        const v = computed(el, 'fill');
        el.setAttribute('fill', v ?? 'none');
      }
      if (!el.hasAttribute('stroke')) {
        const v = computed(el, 'stroke');
        if (v) el.setAttribute('stroke', v);
      }
      if (!el.hasAttribute('stroke-width')) {
        const v = computed(el, 'stroke-width');
        if (v && parseFloat(v) > 0) el.setAttribute('stroke-width', parseFloat(v));
      }
      const op = computed(el, 'opacity');
      if (op && !el.hasAttribute('opacity')) el.setAttribute('opacity', op);
    }

    // Extract labels from <foreignObject> — mermaid puts all text there.
    // getBoundingClientRect gives us absolute viewport coords; we map back
    // to SVG coordinates via the SVG's CTM.
    const svgRect = svg.getBoundingClientRect();
    const viewBox = (svg.getAttribute('viewBox') || '0 0 0 0').split(/\s+/).map(Number);
    const [vx, vy, vw, vh] = viewBox;
    const toSvgX = (px) => vx + ((px - svgRect.left) / svgRect.width) * vw;
    const toSvgY = (py) => vy + ((py - svgRect.top) / svgRect.height) * vh;

    // Walk an element and produce its text content with <br> preserved as
    // newlines and each <p>/<div>/<span> block treated as a logical line.
    const extractMultilineText = (root) => {
      const lines = [];
      const walkNode = (n, line) => {
        if (n.nodeType === 3) { // text node
          line.push(n.nodeValue);
          return line;
        }
        if (n.nodeType !== 1) return line;
        const tag = n.tagName.toLowerCase();
        if (tag === 'br') {
          lines.push(line.join(''));
          return [];
        }
        if (tag === 'p' || tag === 'div') {
          if (line.length) lines.push(line.join(''));
          let next = [];
          for (const c of n.childNodes) next = walkNode(c, next);
          if (next.length) lines.push(next.join(''));
          return [];
        }
        let cur = line;
        for (const c of n.childNodes) cur = walkNode(c, cur);
        return cur;
      };
      let trailing = [];
      for (const c of root.childNodes) trailing = walkNode(c, trailing);
      if (trailing.length) lines.push(trailing.join(''));
      return lines
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    };

    const labels = [];
    for (const fo of [...svg.querySelectorAll('foreignObject')]) {
      const textContent = extractMultilineText(fo);
      if (textContent) {
        const r = fo.getBoundingClientRect();
        // Find the first child with visible text to measure font size.
        const inner = fo.querySelector('span, p, div') || fo;
        const cs = getComputedStyle(inner);
        const fontSize = Math.max(10, parseFloat(cs.fontSize) || 16);
        const color = cs.color || '#000000';
        const sx = toSvgX(r.left);
        const sy = toSvgY(r.top);
        const sw = (r.width / svgRect.width) * vw;
        const sh = (r.height / svgRect.height) * vh;
        // Use foreignObject's actual box as the text-wrap bounds. Inflating
        // the width (as we did before) shifts the textAlign:center anchor
        // right, pushing labels into the bottom-right corner of the node.
        labels.push({
          x: sx,
          y: sy,
          width: sw,
          height: sh,
          text: textContent,
          fontSize,
          color,
        });
      }
      fo.remove();
    }

    const out = new XMLSerializer().serializeToString(svg);
    container.remove();
    return { svg: out, labels };
  }

  // Build native Excalidraw text elements from extracted label records.
  // Mermaid's computed font-size (typically 20px for labels, bigger for
  // cluster titles) is larger than skill convention — scale down to ~0.85
  // so labels fit inside their boxes at default zoom.
  function buildTextElements(labels) {
    const FONT_SCALE = 0.85;
    return labels.map((l) => {
      const fontSize = Math.max(10, Math.round(l.fontSize * FONT_SCALE));
      const lineCount = Math.max(1, l.text.split('\n').length);
      const textHeight = fontSize * 1.25 * lineCount;
      const color = /rgb\(\s*0,\s*0,\s*0\s*\)/.test(l.color) || l.color === '#000000'
        ? '#1e1e1e'
        : l.color;
      return {
        type: 'text',
        // Re-center vertically around the label's midline using the scaled font.
        x: l.x,
        y: l.y + (l.height - textHeight) / 2,
        width: l.width,
        height: textHeight,
        text: l.text,
        fontSize,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        strokeColor: color,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        angle: 0,
      };
    });
  }

  // Remap mermaid's default CSS colors to the skill's neutral palette
  // (references/color-system.md). We can't infer semantic categories
  // (user / service / decision) from the SVG, so we pick skill-compatible
  // neutrals — user assigns semantic colors per-node after opening.
  //
  // Colors come from getComputedStyle as "rgb(r, g, b)" / "rgba(...)" —
  // compare by normalised rgb triple.
  const rgb = (r, g, b) => `rgb(${r}, ${g}, ${b})`;
  const COLOR_REMAP = {
    // node fill → skill neutral (transparent lets the subgraph Zone show through)
    [rgb(236, 236, 255)]: { bg: 'transparent' },
    // node stroke → skill default stroke
    [rgb(147, 112, 219)]: { sc: '#464650' },
    // subgraph cluster fill → skill Zone Frontend/UI
    [rgb(255, 255, 222)]: { bg: '#f5ede0', op: 40 },
    // subgraph cluster stroke → skill Zone Frontend/UI stroke
    [rgb(170, 170, 51)]: { sc: '#d4846a' },
    // edge stroke → skill main-flow stroke
    [rgb(51, 51, 51)]: { sc: '#2c2c2c' },
    // text color → skill node-text
    [rgb(0, 0, 0)]: { sc: '#1e1e1e' },
  };
  function applySkillPalette(el) {
    const bgRemap = COLOR_REMAP[el.backgroundColor];
    if (bgRemap) {
      if ('bg' in bgRemap) el.backgroundColor = bgRemap.bg;
      if ('op' in bgRemap) el.opacity = bgRemap.op;
    }
    const scRemap = COLOR_REMAP[el.strokeColor];
    if (scRemap && 'sc' in scRemap) el.strokeColor = scRemap.sc;
    return el;
  }

  // Post-process svg-to-excalidraw output:
  //   - normalise opacity / fill-/strokeStyle / roughness defaults
  //   - remap mermaid default colors to skill palette
  //   - bump edge strokeWidth so lines are visible at high-DPI render
  // Ramer–Douglas–Peucker: collapse dense polyline samples into the minimum
  // set of points whose perpendicular distance from the original path stays
  // within `epsilon`. For mermaid edges (typically straight with 1 bend) this
  // shrinks 20–160 points down to 2–4 and guarantees every retained segment
  // is visually significant — giving the end arrowhead a clean base to sit on.
  function simplifyPoints(points, epsilon) {
    if (points.length < 3) return points;
    const perpDist = ([px, py], [ax, ay], [bx, by]) => {
      const dx = bx - ax;
      const dy = by - ay;
      const norm = Math.hypot(dx, dy) || 1;
      return Math.abs(dy * px - dx * py + bx * ay - by * ax) / norm;
    };
    const rdp = (pts) => {
      if (pts.length < 3) return pts.slice();
      let maxDist = 0;
      let idx = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
        if (d > maxDist) {
          maxDist = d;
          idx = i;
        }
      }
      if (maxDist > epsilon) {
        const left = rdp(pts.slice(0, idx + 1));
        const right = rdp(pts.slice(idx));
        return left.slice(0, -1).concat(right);
      }
      return [pts[0], pts[pts.length - 1]];
    };
    return rdp(points);
  }

  function sanitizeElements(elements) {
    for (const el of elements) {
      if (el.opacity == null || el.opacity <= 1) el.opacity = 100;
      if (el.opacity > 100) el.opacity = 100;
      if (el.strokeColor === 'none') el.strokeColor = 'transparent';
      if (el.backgroundColor === 'none') el.backgroundColor = 'transparent';
      if (!el.fillStyle) el.fillStyle = 'solid';
      if (!el.strokeStyle) el.strokeStyle = 'solid';
      if (el.roughness == null) el.roughness = 1;
      applySkillPalette(el);
      // Thicken edges (lines with no fill) so they render at skill's typical
      // weight — also makes the arrowhead visibly larger (Excalidraw scales
      // arrowheads with strokeWidth).
      if (el.type === 'line' && (el.backgroundColor === 'transparent' || el.backgroundColor === '#00000000')) {
        el.strokeWidth = Math.max(el.strokeWidth || 1, 4);
        // Promote edge lines to arrows with an end arrowhead — matches how
        // mermaid's SVG intends them (marker-end="url(#arrowhead)" is lost
        // during svg-to-excalidraw's path walk).
        el.type = 'arrow';
        el.endArrowhead = 'arrow';
        el.startArrowhead = null;
        // svg-to-excalidraw samples SVG curves into 20–160 dense points per
        // arrow. Excalidraw orients the arrowhead along the VERY LAST segment;
        // when that segment is 5px long, the arrowhead visually merges into
        // the stroke (no clear triangle). Simplify with Ramer–Douglas–Peucker
        // so the final segment is long enough for a clean arrowhead.
        if (Array.isArray(el.points) && el.points.length > 4) {
          el.points = simplifyPoints(el.points, 3);
          // Ensure last segment is at least ~20px so the arrowhead lands
          // perpendicular to a visible stroke.
          const pts = el.points;
          while (pts.length >= 3) {
            const [px, py] = pts[pts.length - 2];
            const [ex, ey] = pts[pts.length - 1];
            if (Math.hypot(ex - px, ey - py) >= 20) break;
            pts.splice(pts.length - 2, 1);
          }
        }
      }
    }
    return elements;
  }

  try {
    const { elements: skeletons, files } = await window.__parseMermaid(src);
    const { convertToExcalidrawElements } = window.ExcalidrawLib;
    const isImageFallback =
      skeletons.length === 1 && skeletons[0].type === 'image';

    if (isImageFallback && window.__svgToExcalidraw) {
      const imgSkel = skeletons[0];
      const entry = (files || {})[imgSkel.fileId];
      const dataUrl = entry?.dataURL || '';
      if (dataUrl.startsWith('data:image/svg')) {
        const b64 = dataUrl.replace(/^data:image\/svg\+xml;base64,/, '');
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const rawSvg = new TextDecoder('utf-8').decode(bytes);
        const { svg: preparedSvg, labels } = prepareMermaidSvg(rawSvg);
        const conv = window.__svgToExcalidraw(preparedSvg);
        if (!conv.hasErrors && Array.isArray(conv.content) && conv.content.length > 0) {
          const shapes = sanitizeElements(conv.content);
          const textEls = buildTextElements(labels);
          const combined = [...shapes, ...textEls];
          // Don't pass text elements through convertToExcalidrawElements —
          // they are already valid excalidraw elements (with computed x/y
          // from DOM). We still pass shapes so defaults like seed/version
          // match core Excalidraw expectations.
          let nativeShapes;
          try {
            nativeShapes = convertToExcalidrawElements(shapes);
          } catch {
            nativeShapes = shapes;
          }
          const native = [...nativeShapes, ...textEls];
          return {
            elements: native,
            files: {},
            isImageFallback: false,
            nativeFromSvg: true,
            nativeCount: native.length,
            textCount: textEls.length,
          };
        }
        return {
          elements: convertToExcalidrawElements(skeletons),
          files: files || {},
          isImageFallback: true,
          fallbackReason: libError ? libError.message : null,
          svgConvError: conv?.errors || 'no elements produced',
        };
      }
    }

    const elements = convertToExcalidrawElements(skeletons);
    return {
      elements,
      files: files || {},
      isImageFallback,
      fallbackReason: isImageFallback && libError ? libError.message : null,
    };
  } catch (err) {
    return { error: err.message || String(err), stack: err.stack };
  }
}, mermaidSource);

if (result.error) {
  console.error('mermaid parse error:', result.error);
  if (result.stack) console.error(result.stack);
  await browser.close();
  process.exit(2);
}

if (result.nativeFromSvg) {
  console.error(
    `[info] mermaid-to-excalidraw couldn't parse this diagram natively ` +
      `(likely subgraph/advanced syntax). Rendered mermaid → SVG, then ` +
      `converted SVG → ${result.nativeCount} native Excalidraw elements ` +
      `(${result.textCount} text labels) via the vendored svg-to-excalidraw ` +
      `parser. Fully editable.`,
  );
}

if (result.isImageFallback) {
  console.error(
    `[warn] mermaid-to-excalidraw fell back to a rasterized image ` +
      `(${result.fallbackReason || 'unsupported syntax'})` +
      (result.svgConvError
        ? `; svg-to-excalidraw also failed: ${JSON.stringify(result.svgConvError)}`
        : '') +
      `. The .excalidraw will contain a single image element; ` +
      `native shapes are not available for this diagram.`,
  );
  const imgEl = result.elements[0];
  const fileEntry = result.files[imgEl.fileId];
  if (fileEntry?.dataURL?.startsWith('data:image/svg')) {
    const svg = Buffer.from(
      fileEntry.dataURL.replace(/^data:image\/svg\+xml;base64,/, ''),
      'base64',
    ).toString('utf-8');
    const vb = svg.match(/viewBox="([^"]+)"/);
    if (vb) {
      const [, , w, h] = vb[1].split(/\s+/).map(Number);
      imgEl.width = w;
      imgEl.height = h;
    }
    // Emit the raw SVG as a sidecar file so callers can render it directly
    // (render.mjs path via excalidraw doesn't always decode SVG dataURLs).
    const svgPath = outputPath.replace(/\.excalidraw$/, '.svg');
    fs.writeFileSync(svgPath, svg);
    console.error(`[warn] sidecar SVG: ${svgPath} (render directly with Chrome/sips for best quality)`);
  }
}

await browser.close();

// ---- Post-process: clean residual HTML tags from text elements ---------------
// @excalidraw/mermaid-to-excalidraw passes Mermaid node labels through its own
// parser. For certain node shapes (e.g. diamonds), HTML-style line-break tags
// like <br/> are NOT rendered as actual DOM elements — they land verbatim in
// the text content. We normalise them here so they render as proper newlines
// in Excalidraw rather than showing literal "<br>" characters.
// Tolerant: matches <br>, <br/>, <br /> and also the Mermaid auto-wrap case
// where the tag got split by an injected newline (e.g. "<\nbr>") because the
// node is too narrow.
const brRe = /<\s*br\s*\/?\s*>/gi;
const cleanText = (t) =>
  typeof t === 'string'
    ? t.replace(brRe, '\n').replace(/\n{2,}/g, '\n').trim()
    : t;

for (const el of result.elements) {
  if (typeof el.text === 'string') el.text = cleanText(el.text);
  if (typeof el.originalText === 'string') el.originalText = cleanText(el.originalText);
  if (el.label && typeof el.label.text === 'string') el.label.text = cleanText(el.label.text);
}

// ---- Post-process: re-center bound text whose line-count was changed -------
// Mermaid's library auto-wraps narrow labels (e.g. "15 分钟" → "1\n5 分钟"),
// but does NOT update the text element's `height` to reflect the new line
// count. The stale height makes Excalidraw's verticalAlign:middle compute a
// wrong centerline, so multi-line text in rectangles renders bottom-shifted
// and overflows the container. Diamonds tolerate this (they have padding to
// spare); rectangles don't. Recompute height + y for every bound text so the
// stored geometry matches reality.
//
// Arrows are handled separately in the next pass — `verticalAlign:middle`
// inside an arrow's bbox would put the label at the bbox center, not the
// arrow's path midpoint.
const elementById = new Map(result.elements.map((e) => [e.id, e]));
const isArrowLike = (e) => e && (e.type === 'arrow' || e.type === 'line');
for (const el of result.elements) {
  if (el.type !== 'text' || !el.containerId) continue;
  const container = elementById.get(el.containerId);
  if (isArrowLike(container)) continue;
  const lines = (el.text ?? '').split('\n');
  if (lines.length < 2) continue;
  const lh = el.lineHeight ?? 1.25;
  const newH = Math.ceil(el.fontSize * lh * lines.length);
  if (newH === el.height) continue;
  el.height = newH;
  if (container) {
    el.y = container.y + (container.height - newH) / 2;
  }
}

// ---- Post-process: re-center arrow edge labels to the path midpoint --------
// Mermaid places edge labels close to the source node (≈10% along the path),
// which crowds the source and looks visually unbalanced. Reposition each
// arrow-bound label to the geometric midpoint of the arrow's VISIBLE path —
// i.e., the portion outside both source and target node bboxes.
//
// Why "visible" not "polyline": mermaid's polyline often starts deep inside
// the source node (sometimes at its center) and only exits at the boundary.
// Naive "polyline midpoint" therefore lands inside / next to the source. We
// clip the leading segments inside the source bbox (and trailing inside the
// target bbox, if any), then take the midpoint of what remains.

const allShapes = result.elements.filter((e) =>
  ['rectangle', 'diamond', 'ellipse'].includes(e.type),
);
const insideBbox = (p, s) =>
  p[0] >= s.x && p[0] <= s.x + s.width && p[1] >= s.y && p[1] <= s.y + s.height;

// Liang–Barsky-style clip: given p1 INSIDE bbox and p2 OUTSIDE bbox, return
// the segment's exit point on the bbox boundary.
const exitPointFromBbox = (p1, p2, s) => {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (s.x + s.width - p1[0]) / dx);
  else if (dx < 0) t = Math.min(t, (s.x - p1[0]) / dx);
  if (dy > 0) t = Math.min(t, (s.y + s.height - p1[1]) / dy);
  else if (dy < 0) t = Math.min(t, (s.y - p1[1]) / dy);
  if (!isFinite(t) || t < 0 || t > 1) return p1;
  return [p1[0] + t * dx, p1[1] + t * dy];
};

// Same as above but for entry: p1 OUTSIDE, p2 INSIDE → entry point.
const entryPointToBbox = (p1, p2, s) => {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  let t = -Infinity;
  if (dx > 0) t = Math.max(t, (s.x - p1[0]) / dx);
  else if (dx < 0) t = Math.max(t, (s.x + s.width - p1[0]) / dx);
  if (dy > 0) t = Math.max(t, (s.y - p1[1]) / dy);
  else if (dy < 0) t = Math.max(t, (s.y + s.height - p1[1]) / dy);
  if (!isFinite(t) || t < 0 || t > 1) return p2;
  return [p1[0] + t * dx, p1[1] + t * dy];
};

// Polyline length-based midpoint walker.
const polylineMidpoint = (absPts) => {
  if (absPts.length < 2) return absPts[0];
  const segLens = [];
  let total = 0;
  for (let i = 1; i < absPts.length; i++) {
    const len = Math.hypot(absPts[i][0] - absPts[i - 1][0], absPts[i][1] - absPts[i - 1][1]);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return absPts[0];
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= half) {
      const t = segLens[i] === 0 ? 0 : (half - acc) / segLens[i];
      return [
        absPts[i][0] + t * (absPts[i + 1][0] - absPts[i][0]),
        absPts[i][1] + t * (absPts[i + 1][1] - absPts[i][1]),
      ];
    }
    acc += segLens[i];
  }
  return absPts[absPts.length - 1];
};

for (const el of result.elements) {
  if (el.type !== 'text' || !el.containerId) continue;
  const arrow = elementById.get(el.containerId);
  if (!isArrowLike(arrow)) continue;
  const pts = arrow.points;
  if (!Array.isArray(pts) || pts.length < 2) continue;

  // Recompute height for multi-line labels.
  const lines = (el.text ?? '').split('\n');
  const lh = el.lineHeight ?? 1.25;
  const newH = Math.ceil(el.fontSize * lh * lines.length);
  if (newH !== el.height) el.height = newH;

  // Convert polyline to absolute coordinates.
  const abs = pts.map((p) => [arrow.x + p[0], arrow.y + p[1]]);

  // Identify source/target shapes by bbox containment of polyline endpoints.
  // Prefer the smallest containing shape (handles subgraph-nested nodes).
  const findContainer = (p) => {
    const cands = allShapes.filter((s) => insideBbox(p, s));
    if (cands.length === 0) return null;
    return cands.reduce((a, b) => (a.width * a.height < b.width * b.height ? a : b));
  };
  const sourceShape = findContainer(abs[0]);
  const targetShape = findContainer(abs[abs.length - 1]);

  // Clip leading segments inside source.
  let visible = [...abs];
  if (sourceShape) {
    let i = 0;
    while (i < visible.length && insideBbox(visible[i], sourceShape)) i++;
    if (i > 0 && i < visible.length) {
      const exit = exitPointFromBbox(visible[i - 1], visible[i], sourceShape);
      visible = [exit, ...visible.slice(i)];
    }
  }
  // Clip trailing segments inside target.
  if (targetShape) {
    let j = visible.length - 1;
    while (j >= 0 && insideBbox(visible[j], targetShape)) j--;
    if (j >= 0 && j < visible.length - 1) {
      const entry = entryPointToBbox(visible[j], visible[j + 1], targetShape);
      visible = [...visible.slice(0, j + 1), entry];
    }
  }

  // Find midpoint of visible portion. Fallback to full polyline if clipping
  // collapsed the path (shouldn't happen for well-formed mermaid output).
  const [midX, midY] =
    visible.length >= 2 ? polylineMidpoint(visible) : polylineMidpoint(abs);

  // Re-anchor text (x, y) is top-left of label box; center on (midX, midY).
  // Lift the label ~0.6× font-size above the line so it doesn't sit ON the
  // arrow stroke.
  const verticalLift = el.fontSize * 0.6;
  el.x = midX - el.width / 2;
  el.y = midY - el.height / 2 - verticalLift;
}

// ---- Wrap into .excalidraw format -------------------------------------------

const excalidrawFile = {
  type: 'excalidraw',
  version: 2,
  source: 'excalidraw-diagram-skill/mermaid-to-excalidraw',
  elements: result.elements,
  appState: {
    gridSize: null,
    viewBackgroundColor: '#ffffff',
  },
  files: result.files,
};

fs.writeFileSync(outputPath, JSON.stringify(excalidrawFile, null, 2));
console.log(`Wrote ${outputPath} (${result.elements.length} elements)`);
