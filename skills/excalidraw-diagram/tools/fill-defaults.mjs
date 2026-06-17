#!/usr/bin/env node
// Convert a compact diagram spec into a full .excalidraw file.
//
// Compact spec: Claude only writes core fields (type, id, x, y, width, height,
// text/label, colors). This script fills in the 15+ required housekeeping
// fields (angle, seed, version, versionNonce, isDeleted, updated, link, locked,
// opacity, groupIds, frameId, roundness, boundElements...) and also desugars
// the `label: {text, fontSize, strokeColor}` syntax (as used in create_view)
// into standalone text elements with containerId bindings.
//
// Usage:
//   node fill-defaults.mjs <compact.json> <output.excalidraw>

import fs from 'node:fs';

const [,, inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node fill-defaults.mjs <compact.json> <output.excalidraw>');
  process.exit(1);
}

const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const rawElements = Array.isArray(input) ? input : (input.elements || []);

const now = Date.now();
let seedCounter = 1000;
const nextSeed = () => ++seedCounter;

// Defaults align with apply-styles.mjs sketch-soft preset (the skill's
// documented default style): roughness=2 (wobbly hand-drawn lines), fontFamily=5
// (Excalifont with XiaolaiSC CJK fallback). Compact specs that want crisp
// formal output should override per-element with roughness:0, fontFamily:2.
const base = (el) => ({
  angle: 0,
  strokeColor: '#464650',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 2,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: nextSeed(),
  version: 1,
  versionNonce: nextSeed(),
  isDeleted: false,
  boundElements: [],
  updated: now,
  link: null,
  locked: false,
  ...el,
});

const textDefaults = (el) => {
  const fontSize = el.fontSize ?? 16;
  const text = el.text ?? '';
  return {
    ...base({ strokeWidth: 1, ...el }),
    fontSize,
    fontFamily: el.fontFamily ?? 5,
    textAlign: el.textAlign ?? 'center',
    verticalAlign: el.verticalAlign ?? 'middle',
    containerId: el.containerId ?? null,
    originalText: el.originalText ?? text,
    lineHeight: el.lineHeight ?? 1.25,
    baseline: el.baseline ?? Math.max(fontSize - 2, 10),
    text,
  };
};

const arrowDefaults = (el) => {
  const points = el.points ?? [[0, 0], [el.width ?? 0, el.height ?? 0]];
  return {
    ...base(el),
    points,
    lastCommittedPoint: el.lastCommittedPoint ?? null,
    startBinding: el.startBinding ?? null,
    endBinding: el.endBinding ?? null,
    startArrowhead: el.startArrowhead ?? null,
    endArrowhead: el.endArrowhead ?? 'arrow',
  };
};

// Rough text-size estimator, matches SKILL.md "字符宽度估算".
// Handles multi-line text (split on \n): width = widest line, height = sum of
// all lines (lineHeight 1.25 per line). Without multi-line awareness, the
// centroid calculation puts the text block near the bottom of the container.
const estimateTextSize = (text, fontSize) => {
  const lines = text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    let w = 0;
    for (const ch of [...line]) {
      w += /[\u4e00-\u9fff]/.test(ch) ? fontSize : fontSize * 0.55;
    }
    if (w > maxWidth) maxWidth = w;
  }
  const height = fontSize * 1.25 * lines.length;
  return { width: Math.ceil(maxWidth), height: Math.ceil(height) };
};

// Desugar: shape with `label: {text, fontSize?, strokeColor?}` → shape + bound text.
const expanded = [];
for (const el of rawElements) {
  // Drop pseudo-elements that only exist in create_view.
  if (el.type === 'cameraUpdate' || el.type === 'restoreCheckpoint' || el.type === 'delete') {
    continue;
  }

  if (el.label && el.type !== 'text') {
    const labelSpec = typeof el.label === 'string' ? { text: el.label } : el.label;
    const textId = `${el.id}__label`;
    const fontSize = labelSpec.fontSize ?? 16;
    const { width: tw, height: th } = estimateTextSize(labelSpec.text, fontSize);
    const textX = el.x + (el.width - tw) / 2;
    const textY = el.y + (el.height - th) / 2;

    const { label, ...shapeRest } = el;
    const boundElements = [...(shapeRest.boundElements ?? []), { type: 'text', id: textId }];
    const shape = { ...shapeRest, boundElements };
    expanded.push(shape);

    expanded.push({
      type: 'text',
      id: textId,
      x: textX,
      y: textY,
      width: tw,
      height: th,
      text: labelSpec.text,
      fontSize,
      strokeColor: labelSpec.strokeColor ?? '#1e1e1e',
      containerId: el.id,
    });
    continue;
  }

  expanded.push(el);
}

// Fill defaults by type.
const final = expanded.map((el) => {
  if (el.type === 'text') return textDefaults(el);
  if (el.type === 'arrow' || el.type === 'line') return arrowDefaults(el);
  return base(el);
});

// Strip any user-supplied `roundness: { type: N }` short form into actual shape
// default when omitted on rectangle/ellipse/diamond (optional — user decides).
const doc = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: final,
  appState: {
    viewBackgroundColor: input.appState?.viewBackgroundColor ?? '#ffffff',
    gridSize: input.appState?.gridSize ?? null,
    ...(input.appState ?? {}),
  },
  files: input.files ?? {},
};

fs.writeFileSync(outputPath, JSON.stringify(doc, null, 2));
console.log(`Wrote ${outputPath} (${final.length} elements)`);
