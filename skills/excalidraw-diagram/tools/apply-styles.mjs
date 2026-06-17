#!/usr/bin/env node
// Apply skill-palette colors + style preset to an .excalidraw file based on an
// AI-produced semantic mapping. Pairs with list-elements.mjs:
//
//   node list-elements.mjs diagram.excalidraw > summary.json
//   # (AI reads summary.json, writes mapping.json)
//   node apply-styles.mjs diagram.excalidraw mapping.json
//
// mapping.json shape:
//   {
//     "style": "formal" | "sketch",             // optional, default "formal"
//     "elements": { "<id>": "<semantic>", ... }, // node/subgraph semantics
//     "arrows":   { "<id>": "<semantic>", ... }  // arrow semantics
//   }
//
// Node semantics (from references/color-system.md):
//   input | service | data | decision | success | error | neutral
//   zone-frontend | zone-logic | zone-data
//   palette-1 .. palette-9           (扩展色板按顺序)
//
// Arrow semantics:
//   main | success | error | return | async
//
// Writes back to the same .excalidraw file (in place).

import fs from 'node:fs';

const [, , inputPath, mappingPath] = process.argv;
if (!inputPath || !mappingPath) {
  console.error('Usage: node apply-styles.mjs diagram.excalidraw mapping.json');
  process.exit(1);
}

const NODE_PALETTE = {
  input:    { bg: '#b8d4d4', sc: '#464650', fg: '#1e1e1e' },
  service:  { bg: '#c3e0fe', sc: '#464650', fg: '#1e1e1e' },
  data:     { bg: '#f5ede0', sc: '#464650', fg: '#1e1e1e' },
  decision: { bg: '#e8c0a8', sc: '#464650', fg: '#1e1e1e' },
  success:  { bg: '#548484', sc: '#464650', fg: '#ffffff' },
  error:    { bg: '#ffc9c9', sc: '#464650', fg: '#1e1e1e' },
  neutral:  { bg: 'transparent', sc: '#464650', fg: '#1e1e1e' },
};

const ZONE_PALETTE = {
  'zone-frontend': { bg: '#f5ede0', sc: '#d4846a', fg: '#1e1e1e', op: 45 },
  'zone-logic':    { bg: '#d8eaea', sc: '#1a5f5a', fg: '#1e1e1e', op: 45 },
  'zone-data':     { bg: '#1a5f5a', sc: '#1a5f5a', fg: '#ffffff', op: 20 },
};

// 扩展色板 (1-indexed in semantic name for readability).
const EXTENDED_PALETTE = [
  { bg: '#CBCADB', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#C8DEFA', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#FAD4C0', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#C8E6C9', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#FFF3BF', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#F4C4B4', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#D4E8E1', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#F0E6D3', sc: '#464650', fg: '#1e1e1e' },
  { bg: '#D0E8F4', sc: '#464650', fg: '#1e1e1e' },
];

const ARROW_PALETTE = {
  main:    { sc: '#2c2c2c', ss: 'solid' },
  success: { sc: '#2d5c5c', ss: 'solid' },
  error:   { sc: '#b85050', ss: 'solid' },
  return:  { sc: '#2d5c5c', ss: 'dashed' },
  async:   { sc: '#d4846a', ss: 'dashed' },
};

// fontFamily: 1=Virgil (0.17 hand-drawn, Latin only), 2=Helvetica, 3=Cascadia,
// 5=Excalifont (0.18+, ships XiaolaiSC CJK fallback — so 中文 renders
// hand-drawn in excalidraw.com).
//
// We write fontFamily=5 for sketch modes so that .excalidraw files opened in
// excalidraw.com (0.18+) get hand-drawn CJK via Excalifont+XiaolaiSC.
// render.mjs rewrites 5 → 1 at PNG time (since the 0.17.3 UMD it bundles
// doesn't know 5) and serves LXGW WenKai under the 'Virgil' family name via
// unicode-range so CJK still renders hand-drawn in the PNG.
//
// sketch-soft (default): wobbly lines + solid color fill — best for 中文-heavy.
// sketch:        wobbly lines + hachure 斜纹 fill — classic 草稿/xkcd 风.
// formal:        crisp lines + solid fill + Helvetica — print-ready tech docs.
// strokeWidth: shapes vs arrows unified so arrowheads stay proportional to
// node borders.
const STYLE_PRESETS = {
  'sketch-soft': { roughness: 2, fillStyle: 'solid', fontFamily: 5, strokeWidth: 2, arrowStrokeWidth: 2 },
  sketch: { roughness: 2, fillStyle: 'hachure', fontFamily: 5, strokeWidth: 2, arrowStrokeWidth: 2 },
  formal: { roughness: 0, fillStyle: 'solid', fontFamily: 2, strokeWidth: 1, arrowStrokeWidth: 2 },
};
const DEFAULT_STYLE = 'sketch-soft';

const resolveNodeSemantic = (name) => {
  if (!name) return NODE_PALETTE.neutral;
  if (NODE_PALETTE[name]) return NODE_PALETTE[name];
  if (ZONE_PALETTE[name]) return ZONE_PALETTE[name];
  const paletteMatch = /^palette-(\d+)$/.exec(name);
  if (paletteMatch) {
    const idx = (Number(paletteMatch[1]) - 1) % EXTENDED_PALETTE.length;
    return EXTENDED_PALETTE[idx];
  }
  return NODE_PALETTE.neutral;
};

const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
const stylePreset = STYLE_PRESETS[mapping.style] ?? STYLE_PRESETS[DEFAULT_STYLE];
const elementMap = mapping.elements ?? {};
const arrowMap = mapping.arrows ?? {};

// Figure out which text element belongs to which shape (smallest enclosing
// shape by center point) — needed so we can recolor labels to match bg.
const shapes = data.elements.filter((e) =>
  ['rectangle', 'ellipse', 'diamond'].includes(e.type),
);
const texts = data.elements.filter((e) => e.type === 'text');
const area = (e) => e.width * e.height;
const textToShape = new Map();
for (const t of texts) {
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  const candidates = shapes.filter(
    (s) => cx >= s.x && cx <= s.x + s.width && cy >= s.y && cy <= s.y + s.height,
  );
  if (candidates.length === 0) continue;
  const owner = candidates.reduce((a, b) => (area(a) < area(b) ? a : b));
  textToShape.set(t.id, owner.id);
}

const shapeIdToFg = new Map();

const nextElements = data.elements.map((el) => {
  if (['rectangle', 'ellipse', 'diamond'].includes(el.type)) {
    const semantic = elementMap[el.id];
    if (!semantic) return el;
    const palette = resolveNodeSemantic(semantic);
    shapeIdToFg.set(el.id, palette.fg);
    return {
      ...el,
      backgroundColor: palette.bg,
      strokeColor: palette.sc,
      fillStyle: stylePreset.fillStyle,
      strokeStyle: 'solid',
      strokeWidth: stylePreset.strokeWidth,
      roughness: stylePreset.roughness,
      opacity: palette.op ?? el.opacity ?? 100,
    };
  }

  if (el.type === 'arrow' || el.type === 'line') {
    const semantic = arrowMap[el.id] ?? 'main';
    const palette = ARROW_PALETTE[semantic] ?? ARROW_PALETTE.main;
    return {
      ...el,
      strokeColor: palette.sc,
      strokeStyle: palette.ss,
      strokeWidth: stylePreset.arrowStrokeWidth,
      roughness: stylePreset.roughness,
    };
  }

  return el;
});

// Second pass: update text colors based on the bg of their owning shape, and
// switch the font to match the style preset.
const finalElements = nextElements.map((el) => {
  if (el.type !== 'text') return el;
  const ownerId = textToShape.get(el.id);
  const fg = ownerId ? shapeIdToFg.get(ownerId) : null;
  return {
    ...el,
    fontFamily: stylePreset.fontFamily,
    ...(fg ? { strokeColor: fg } : {}),
  };
});

const out = { ...data, elements: finalElements };
fs.writeFileSync(inputPath, JSON.stringify(out, null, 2));
console.error(
  `Applied style=${mapping.style ?? DEFAULT_STYLE} to ${
    Object.keys(elementMap).length
  } elements, ${Object.keys(arrowMap).length} arrows.`,
);
