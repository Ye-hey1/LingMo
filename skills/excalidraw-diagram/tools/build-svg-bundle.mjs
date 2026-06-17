#!/usr/bin/env node
// Bundle the vendored svg-to-excalidraw TypeScript source into a single
// browser-ready JS file (IIFE) that exposes `window.__svgToExcalidraw`.
//
// Usage:
//   node build-svg-bundle.mjs
//
// Output: tools/vendor/svg-to-excalidraw.bundle.js

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, "vendor/svg-to-excalidraw-src/browser-entry.ts");
const outfile = path.join(__dirname, "vendor/svg-to-excalidraw.bundle.js");

await build({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  logLevel: "info",
});
console.log(`Wrote ${outfile}`);
