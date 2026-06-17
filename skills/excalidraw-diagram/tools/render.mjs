#!/usr/bin/env node
// Render a .excalidraw file to PNG using Puppeteer + Excalidraw's official
// exportToCanvas API.
//
// Resolution strategy (ordered):
//   1. If PUPPETEER_EXECUTABLE_PATH is set, use it (respects user override).
//   2. If puppeteer is installed and has downloaded Chromium → use its default.
//   3. Try common system Chrome/Edge paths on macOS/Linux/Windows.
//
// Excalidraw UMD is loaded from ./vendor/ if present (offline-safe),
// otherwise from unpkg.
//
// Usage:
//   node render.mjs <input.excalidraw> [output.png]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [,, inputPath, outputArg] = process.argv;
if (!inputPath) {
  console.error('Usage: node render.mjs <input.excalidraw> [output.png]');
  process.exit(1);
}
const outputPath = outputArg ?? inputPath.replace(/\.(excalidraw|svg)$/, '.png');
const isSvgInput = inputPath.endsWith('.svg');
const data = isSvgInput ? null : JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

// ---- Locate a browser --------------------------------------------------------

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

// ---- Locate Excalidraw UMD ---------------------------------------------------

const vendorDir = path.join(__dirname, 'vendor');
const hasVendor =
  fs.existsSync(path.join(vendorDir, 'excalidraw.production.min.js')) &&
  fs.existsSync(path.join(vendorDir, 'react.production.min.js')) &&
  fs.existsSync(path.join(vendorDir, 'react-dom.production.min.js'));

const scriptTags = hasVendor
  ? `<script src="file://${vendorDir}/react.production.min.js"></script>
     <script src="file://${vendorDir}/react-dom.production.min.js"></script>
     <script src="file://${vendorDir}/excalidraw.production.min.js"></script>`
  : `<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
     <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
     <script src="https://unpkg.com/@excalidraw/excalidraw@0.17.3/dist/excalidraw.production.min.js"></script>`;

// Excalidraw ships Virgil (hand-drawn Latin only) inside 0.17.3. For CJK we
// graft XiaolaiSC (the exact same font excalidraw.com 0.18 uses as CJK
// fallback for fontFamily=5) onto the 'Virgil' family via unicode-range, so
// the PNG renders the same hand-drawn Chinese you see in excalidraw.com.
//
// The .excalidraw file stores fontFamily=5 (Excalifont). At PNG time we
// rewrite 5 → 1 (0.17.3 UMD doesn't know 5) and serve hand-drawn glyphs for
// the 'Virgil' family across Latin+CJK.
//
// XiaolaiSC isn't shipped as a single woff2 — 0.18 splits it into 205
// subset files, each keyed by a unicode-range. The authoritative mapping
// lives in 0.18's minified JS chunk. We extract it once offline (see
// tools/vendor/xiaolai.css — regenerate with tools/scripts/gen-xiaolai-css.sh
// if upgrading Excalidraw version) and read it at runtime so the render
// stays network-resilient. Each @font-face points at jsdelivr's copy of the
// corresponding woff2; browsers lazy-load per codepoint.
const xiaolaiCssPath = path.join(__dirname, 'vendor', 'xiaolai.css');
const xiaolaiCss = fs.existsSync(xiaolaiCssPath)
  ? fs.readFileSync(xiaolaiCssPath, 'utf-8')
  : '';
if (!xiaolaiCss) {
  console.error(
    '[render] warning: tools/vendor/xiaolai.css missing — CJK will fall back to system font',
  );
}

const fontCss = `
@font-face {
  font-family: 'Virgil';
  src: url('https://unpkg.com/@excalidraw/excalidraw@0.17.3/dist/excalidraw-assets/Virgil.woff2') format('woff2');
  font-display: block;
  unicode-range: U+0000-024F, U+0300-036F, U+1E00-1EFF, U+2000-206F, U+2100-214F, U+2190-21FF, U+2200-22FF, U+2500-257F, U+25A0-25FF;
}
@font-face {
  font-family: 'Cascadia';
  src: url('https://unpkg.com/@excalidraw/excalidraw@0.17.3/dist/excalidraw-assets/Cascadia.woff2') format('woff2');
  font-display: block;
}
${xiaolaiCss}
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#fff;}#c{display:block;}${fontCss}</style>
${scriptTags}
</head><body><div id="root"></div></body></html>`;

// ---- Render ------------------------------------------------------------------

const browser = await puppeteer.launch(launchOpts);
const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[page error]', err.message));

// ---- SVG-direct fallback path -----------------------------------------------
// When input is an SVG (e.g. mermaid-to-excalidraw image fallback), skip
// excalidraw entirely and render the SVG natively via Chrome.
if (isSvgInput) {
  const rawSvg = fs.readFileSync(inputPath, 'utf-8');
  const vb = rawSvg.match(/viewBox="([^"]+)"/);
  const [, , vbw, vbh] = vb
    ? vb[1].split(/\s+/).map(Number)
    : [0, 0, 1600, 1200];
  const scale = 2;
  const W = Math.ceil(vbw * scale);
  const H = Math.ceil(vbh * scale);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const wrapper = `<!DOCTYPE html><html><head><style>
    html,body{margin:0;padding:0;background:#fff;overflow:hidden;}
  </style></head><body>${rawSvg}</body></html>`;
  await page.setContent(wrapper, { waitUntil: 'networkidle0' });
  // Force-size the SVG to fill the viewport, overriding any intrinsic
  // width/height/max-width attrs set by mermaid.
  await page.evaluate((w, h) => {
    const svg = document.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.style.maxWidth = 'none';
    svg.style.display = 'block';
  }, W, H);
  await page.screenshot({ path: outputPath, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  console.log(`Wrote ${outputPath} (${W}x${H}, SVG-direct)`);
  process.exit(0);
}

await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle0' });

// Export via canvas.toDataURL → write bytes in Node. This avoids the
// viewport-vs-canvas-size mismatch that would otherwise clip screenshots
// when the exported canvas is larger than the Puppeteer viewport.
const result = await page.evaluate(async (payload) => {
  if (!window.ExcalidrawLib) throw new Error('ExcalidrawLib failed to load');
  // 0.17.3 UMD doesn't know fontFamily=5 (Excalifont, added in 0.18). Rewrite
  // to 1 (Virgil) so getFontString resolves correctly; our @font-face rules
  // serve Virgil for Latin and LXGW WenKai for CJK under the same family.
  const elements = payload.elements.map((el) =>
    el.type === 'text' && el.fontFamily === 5 ? { ...el, fontFamily: 1 } : el,
  );
  // Collect every glyph the diagram actually uses so the right unicode-range
  // subsets get fetched before export. Without this, canvas falls back to
  // system fonts on first paint — text rendered "formal" despite fontFamily
  // being set correctly.
  const sampleText =
    elements
      .filter((e) => e.type === 'text' && typeof e.text === 'string')
      .map((e) => e.text)
      .join('') || 'Aa中';
  await Promise.all([
    document.fonts.load('16px Virgil', sampleText).catch(() => {}),
    document.fonts.load('16px Cascadia', sampleText).catch(() => {}),
  ]);
  await document.fonts.ready;
  const { exportToCanvas } = window.ExcalidrawLib;
  const scale = 2;
  const canvas = await exportToCanvas({
    elements,
    appState: {
      ...(payload.appState || {}),
      exportBackground: true,
      viewBackgroundColor: payload.appState?.viewBackgroundColor || '#ffffff',
    },
    files: payload.files || {},
    // width/height must be multiplied by scale: Excalidraw draws at `scale`
    // using ctx.scale(), so the canvas buffer must be large enough to fit
    // scaled content. Without multiplication, content gets clipped.
    getDimensions: (w, h) => ({ width: w * scale, height: h * scale, scale }),
  });
  return {
    w: canvas.width,
    h: canvas.height,
    dataUrl: canvas.toDataURL('image/png'),
  };
}, data);

await browser.close();
const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '');
fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
console.log(`Wrote ${outputPath} (${result.w}x${result.h})`);
