// Browser entry: exposes the svg-to-excalidraw API on window for use inside
// a Puppeteer page. Bundled by build-svg-bundle.mjs via esbuild (IIFE).

import { svgToExcalidraw } from "./parser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__svgToExcalidraw = svgToExcalidraw;
