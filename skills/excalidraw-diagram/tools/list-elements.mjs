#!/usr/bin/env node
// Summarise an .excalidraw file as a compact JSON list so the AI can decide
// per-element semantic categories and pass them to apply-styles.mjs.
//
// Output format (printed to stdout):
//   {
//     "nodes":     [ {id, text, bbox:[x,y,w,h]} ],       // leaf shapes
//     "subgraphs": [ {id, text, bbox:[x,y,w,h], children:[...ids]} ],
//     "arrows":    [ {id, bbox:[x,y,w,h]} ]
//   }
//
// Usage:
//   node list-elements.mjs diagram.excalidraw [> summary.json]

import fs from 'node:fs';

const [, , inputPath] = process.argv;
if (!inputPath) {
  console.error('Usage: node list-elements.mjs diagram.excalidraw');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const shapes = data.elements.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type));
const texts = data.elements.filter((e) => e.type === 'text');
const arrows = data.elements.filter((e) => e.type === 'arrow' || e.type === 'line');

const bbox = (e) => [e.x, e.y, e.width, e.height];
const area = (e) => e.width * e.height;
const contains = (outer, inner) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

// Pair each text element with the smallest shape that contains it.
const shapeIdToTexts = new Map();
for (const t of texts) {
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  const candidates = shapes.filter((s) => cx >= s.x && cx <= s.x + s.width && cy >= s.y && cy <= s.y + s.height);
  if (candidates.length === 0) continue;
  const owner = candidates.reduce((a, b) => (area(a) < area(b) ? a : b));
  const arr = shapeIdToTexts.get(owner.id) ?? [];
  arr.push(t);
  shapeIdToTexts.set(owner.id, arr);
}

const textOf = (shape) => {
  const ts = shapeIdToTexts.get(shape.id) ?? [];
  // Concatenate multiple text children in visual top-to-bottom order.
  return ts.sort((a, b) => a.y - b.y).map((t) => t.text).join('\n');
};

// Subgraph detection: a shape that contains at least one OTHER shape fully.
// Pick them first so the remaining shapes are "leaf" nodes.
const subgraphs = shapes.filter((s) =>
  shapes.some((other) => other.id !== s.id && contains(s, other)),
);
const subgraphIds = new Set(subgraphs.map((s) => s.id));
const nodes = shapes.filter((s) => !subgraphIds.has(s.id));

const childIdsOf = (sub) => {
  return shapes
    .filter((s) => s.id !== sub.id && contains(sub, s))
    .filter((s) => {
      // A node is a "direct" child of the smallest enclosing subgraph only.
      const enclosers = subgraphs.filter((g) => g.id !== s.id && contains(g, s));
      if (enclosers.length === 0) return false;
      const smallestEncloser = enclosers.reduce((a, b) => (area(a) < area(b) ? a : b));
      return smallestEncloser.id === sub.id;
    })
    .map((s) => s.id);
};

const out = {
  nodes: nodes.map((n) => ({ id: n.id, text: textOf(n), bbox: bbox(n) })),
  subgraphs: subgraphs.map((g) => ({
    id: g.id,
    text: textOf(g),
    bbox: bbox(g),
    children: childIdsOf(g),
  })),
  arrows: arrows.map((a) => ({ id: a.id, bbox: bbox(a) })),
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
