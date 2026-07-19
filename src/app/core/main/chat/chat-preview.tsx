'use client'
import useSettingStore from "@/stores/setting";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl';
import { cn } from "@/lib/utils"
import MarkdownIt from 'markdown-it';
import katex from '@traptitech/markdown-it-katex';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import 'highlight.js/styles/github.min.css';
import './chat.css';
import { advanceStreamingSmoother } from './streaming-smoother';
import { getMermaidRenderer } from '@/lib/mermaid';
import {
  getClawStreamVisibleMarkdown,
  normalizeClawNestedFences,
} from './claw-stream-format';
import { renderStreamingMarkdownSegments } from './streaming-markdown-segments';

const GITHUB_REPO_REFERENCE_RE = /(^|[^\w./@-])([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})(?=$|[^\w./-])/g;
const GITHUB_REPO_SKIP_OWNERS = new Set([
  'api',
  'app',
  'assets',
  'build',
  'components',
  'dist',
  'docs',
  'lib',
  'node_modules',
  'pages',
  'public',
  'scripts',
  'src',
  'styles',
  'test',
  'tests',
  'types',
]);
const GITHUB_REPO_SKIP_REPOS = new Set([
  'api',
  'app',
  'assets',
  'build',
  'components',
  'dist',
  'docs',
  'lib',
  'node_modules',
  'pages',
  'public',
  'scripts',
  'src',
  'styles',
  'test',
  'tests',
  'types',
]);

// 平衡行内标记（`, **, ~~）：流式时孤立的开始标记会把后续文本错误格式化，
// 奇数个则在末尾补一个配对。仅在代码围栏外统计，避免误伤代码块内容。
function balanceInlineMarks(text: string): string {
  let result = text;
  if ((result.match(/`/g) || []).length % 2 !== 0) result += '`';
  if ((result.match(/\*\*/g) || []).length % 2 !== 0) result += '**';
  if ((result.match(/~~/g) || []).length % 2 !== 0) result += '~~';
  return result;
}

// 按 ``` 分段，仅对「围栏外」的普通文本段（偶数下标）做行内标记平衡。
function balanceInlineMarksOutsideFences(text: string): string {
  const segments = text.split(/```/);
  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = balanceInlineMarks(segments[i]);
  }
  return segments.join('```');
}

function preprocessMarkdown(text: string, clawFormat = false): string {
  if (clawFormat) {
    return normalizeClawNestedFences(text);
  }

  let processed = text;

  const codeBlockCount = (processed.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    processed += '\n```\n';
  }

  // 围栏外的行内标记平衡（流式容错：避免孤立 ` / ** / ~~ 破坏后续渲染）
  processed = balanceInlineMarksOutsideFences(processed);

  const katexBlockCount = (processed.match(/\$\$/g) || []).length;
  if (katexBlockCount % 2 !== 0) {
    processed += '\n$$\n';
  }

  const inlineKatexCount = (processed.match(/\$/g) || []).length;
  const singleDollarCount = inlineKatexCount - (katexBlockCount * 2);
  if (singleDollarCount % 2 !== 0) {
    processed += '$';
  }

  return processed;
}

function getFenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.replace(/^language-/, '').toLowerCase() || '';
}

function isLikelyGitHubRepoReference(reference: string): boolean {
  const [owner = '', repo = ''] = reference.split('/');
  if (!owner || !repo) return false;
  if (owner.startsWith('-') || owner.endsWith('-')) return false;
  if (repo.startsWith('.') || repo.endsWith('.')) return false;
  if (/^\d+$/.test(owner) || /^\d+$/.test(repo)) return false;

  const ownerLower = owner.toLowerCase();
  const repoLower = repo.toLowerCase();
  if (GITHUB_REPO_SKIP_OWNERS.has(ownerLower)) return false;
  if (GITHUB_REPO_SKIP_REPOS.has(repoLower)) return false;

  return true;
}

function installGitHubRepoAutolinks(markdown: MarkdownIt) {
  markdown.core.ruler.after('linkify', 'github_repo_autolink', (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== 'inline' || !blockToken.children?.length) continue;

      const nextChildren: typeof blockToken.children = [];
      let linkLevel = 0;

      for (const child of blockToken.children) {
        if (child.type === 'link_open') {
          linkLevel += 1;
          nextChildren.push(child);
          continue;
        }

        if (child.type === 'link_close') {
          linkLevel = Math.max(0, linkLevel - 1);
          nextChildren.push(child);
          continue;
        }

        if (linkLevel > 0 || child.type !== 'text' || !child.content.includes('/')) {
          nextChildren.push(child);
          continue;
        }

        const content = child.content;
        GITHUB_REPO_REFERENCE_RE.lastIndex = 0;
        let lastIndex = 0;
        let matched = false;
        let match: RegExpExecArray | null;

        while ((match = GITHUB_REPO_REFERENCE_RE.exec(content)) !== null) {
          const prefix = match[1] || '';
          const repoReference = match[2] || '';
          const repoStart = match.index + prefix.length;
          const repoEnd = repoStart + repoReference.length;

          if (!isLikelyGitHubRepoReference(repoReference)) continue;

          if (repoStart > lastIndex) {
            const token = new state.Token('text', '', 0);
            token.content = content.slice(lastIndex, repoStart);
            nextChildren.push(token);
          }

          const open = new state.Token('link_open', 'a', 1);
          open.attrs = [
            ['href', `https://github.com/${repoReference}`],
            ['data-autolink-kind', 'github-repo'],
          ];
          nextChildren.push(open);

          const text = new state.Token('text', '', 0);
          text.content = repoReference;
          nextChildren.push(text);

          nextChildren.push(new state.Token('link_close', 'a', -1));
          lastIndex = repoEnd;
          matched = true;
        }

        if (!matched) {
          nextChildren.push(child);
          continue;
        }

        if (lastIndex < content.length) {
          const token = new state.Token('text', '', 0);
          token.content = content.slice(lastIndex);
          nextChildren.push(token);
        }
      }

      blockToken.children = nextChildren;
    }
  });
}

function renderClawCodeBlockHtml(
  source: string,
  language: string,
  highlightedHtml: string,
  themeClass: string,
  escapeHtml: (value: string) => string,
): string {
  const label = getFenceLanguage(language) || 'code';
  const code = highlightedHtml || escapeHtml(source);
  const body = code && !code.endsWith('\n') ? `${code}\n` : code;
  return [
    `<pre class="hljs ${themeClass} claw-code-block"><code>`,
    `<span class="claw-code-block-border">╭─ ${escapeHtml(label)}</span>\n`,
    body,
    '<span class="claw-code-block-border">╰─</span>',
    '</code></pre>',
  ].join('');
}

type MermaidRenderCacheEntry = {
  svg?: string;
  error?: string;
}

type MermaidRenderResult = {
  svg: string;
  repaired: boolean;
}

const MERMAID_RENDER_CACHE_PREFIX = 'lingmo:chat:mermaid:';
const MERMAID_RENDER_STYLE_VERSION = 'clean-v4';
const MAX_STORED_MERMAID_SVG_LENGTH = 500_000;
const MERMAID_RENDER_TIMEOUT_MS = 15_000;
const MERMAID_STATEMENT_START = /([)\]}"])\s+([A-Za-z_][\w-]*\s*(?:-->|---|-.->|==>|--o|--x|o--|x--))/g;
const MERMAID_SEPARATOR_LINE = /^\s*[-–—_=]{3,}\s*;?\s*$/;
const MERMAID_DASH_TARGET_EDGE = /^\s*[A-Za-z_][\w-]*\s*(?:-->|---|-.->|==>|--o|--x)\s*[-–—_]{3,}\s*;?\s*$/;
const MERMAID_SIMPLE_LABEL = /\b([A-Za-z_][\w-]*)\[([^\]\n"]*?[<>()（）:：,，;；/][^\]\n"]*?)\]/g;
const MERMAID_ELLIPSIS_PREFIX_LABEL = /\[\s*(?:\.{3}|…)\s*([^\]\n]+?)\s*\]/g;

type MermaidViewState = {
  scale: number;
  translateX: number;
  translateY: number;
  isDragging: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  lastTranslateX: number;
  lastTranslateY: number;
}

type MermaidViewerState = {
  title: string;
  svg: string;
  scale: number;
  translateX: number;
  translateY: number;
  isDragging: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  lastTranslateX: number;
  lastTranslateY: number;
}

function getMermaidCacheKey(source: string, theme: 'light' | 'dark'): string {
  return `${MERMAID_RENDER_STYLE_VERSION}:${theme}:${source}`;
}

function hashMermaidCacheKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getStoredMermaidCacheEntry(source: string, theme: 'light' | 'dark'): MermaidRenderCacheEntry | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const cacheKey = getMermaidCacheKey(source, theme);
    const storageKey = MERMAID_RENDER_CACHE_PREFIX + hashMermaidCacheKey(cacheKey);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as {
      source?: string;
      theme?: 'light' | 'dark';
      svg?: string;
    };

    if (parsed.source !== source || parsed.theme !== theme || !parsed.svg) {
      return undefined;
    }

    return { svg: parsed.svg };
  } catch {
    return undefined;
  }
}

function storeMermaidCacheEntry(source: string, theme: 'light' | 'dark', entry: MermaidRenderCacheEntry) {
  if (typeof window === 'undefined' || !entry.svg || entry.svg.length > MAX_STORED_MERMAID_SVG_LENGTH) {
    return;
  }

  try {
    const cacheKey = getMermaidCacheKey(source, theme);
    const storageKey = MERMAID_RENDER_CACHE_PREFIX + hashMermaidCacheKey(cacheKey);
    window.localStorage.setItem(storageKey, JSON.stringify({
      source,
      theme,
      svg: entry.svg,
    }));
  } catch {
    // localStorage quota or privacy mode should not block live rendering.
  }
}

function wrapMermaidSvg(svg: string): string {
  return `<div class="mermaid-canvas-viewport">${svg}</div>`;
}

function getMermaidDiagramSvg(container: HTMLDivElement): SVGSVGElement | null {
  return (
    container.querySelector<SVGSVGElement>('.mermaid-canvas-viewport > svg') ||
    container.querySelector<SVGSVGElement>('.chart-canvas-viewport > svg') ||
    container.querySelector<SVGSVGElement>('.mermaid-canvas-render > svg') ||
    container.querySelector<SVGSVGElement>('.chart-canvas-render > svg') ||
    container.querySelector<SVGSVGElement>('.mermaid-canvas-render svg') ||
    container.querySelector<SVGSVGElement>('.chart-canvas-render svg')
  );
}

const CHART_CANVAS_CONTROLS_STYLE = [
  'position:absolute',
  'top:8px',
  'right:8px',
  'display:inline-flex',
  'align-items:center',
  'justify-content:center',
  'flex-wrap:nowrap',
  'gap:1px',
  'padding:2px',
  'white-space:nowrap',
  'z-index:10',
].join(';');

const CHART_CANVAS_BUTTON_STYLE = [
  'appearance:none',
  '-webkit-appearance:none',
  'display:inline-flex',
  'align-items:center',
  'justify-content:center',
  'flex:0 0 auto',
  'width:22px',
  'height:22px',
  'min-width:22px',
  'min-height:22px',
  'padding:0',
  'margin:0',
  'border:0',
  'background:transparent',
  'line-height:1',
  'font-size:0',
  'cursor:pointer',
].join(';');

const CHART_CANVAS_DIVIDER_STYLE = 'flex:0 0 auto;width:1px;height:12px;margin:0 1px';

function renderChartCanvasControlButtons(kind: 'mermaid' | 'chart'): string {
  const classPrefix = `${kind}-canvas`;
  const buttonClass = `${classPrefix}-btn`;
  const exportLabel = kind === 'mermaid' ? '导出图表 PNG' : '下载图表 PNG';
  const copyLabel = kind === 'mermaid' ? '复制图表 SVG' : '复制图表';

  return [
    `<button type="button" class="${buttonClass} ${classPrefix}-zoom-in" title="放大" aria-label="放大图表" style="${CHART_CANVAS_BUTTON_STYLE}">`,
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    '</button>',
    `<button type="button" class="${buttonClass} ${classPrefix}-zoom-out" title="缩小" aria-label="缩小图表" style="${CHART_CANVAS_BUTTON_STYLE}">`,
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    '</button>',
    `<button type="button" class="${buttonClass} ${classPrefix}-reset" title="重置视图" aria-label="重置图表视图" style="${CHART_CANVAS_BUTTON_STYLE}">`,
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    '</button>',
    `<div class="${classPrefix}-divider" style="${CHART_CANVAS_DIVIDER_STYLE}"></div>`,
    `<button type="button" class="${buttonClass} ${classPrefix}-open" title="展开查看" aria-label="展开查看图表" style="${CHART_CANVAS_BUTTON_STYLE}">`,
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
    '</button>',
    `<button type="button" class="${buttonClass} ${classPrefix}-copy" title="${copyLabel}" aria-label="${copyLabel}" style="${CHART_CANVAS_BUTTON_STYLE}">`,
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    '</button>',
    `<button type="button" class="${buttonClass} ${classPrefix}-export" title="${exportLabel}" aria-label="${exportLabel}" style="${CHART_CANVAS_BUTTON_STYLE}">`,
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    '</button>',
  ].join('');
}

function shouldEnhanceInlineSvgChart(svg: SVGSVGElement): boolean {
  return !svg.closest(
    '.mermaid-canvas-container, .chart-canvas-container, pre, code, .katex, .katex-html',
  );
}

function wrapInlineSvgChart(svg: SVGSVGElement): HTMLDivElement | null {
  const parent = svg.parentNode;
  if (!parent) return null;

  const container = document.createElement('div');
  container.className = 'chart-canvas-container';
  container.dataset.chartKind = 'svg';
  container.tabIndex = 0;
  container.setAttribute('aria-label', '图表画布');

  const renderArea = document.createElement('div');
  renderArea.className = 'chart-canvas-render';
  const viewport = document.createElement('div');
  viewport.className = 'chart-canvas-viewport';
  parent.replaceChild(container, svg);
  svg.classList.add('chart-canvas-graphic');
  viewport.appendChild(svg);
  renderArea.appendChild(viewport);

  const controls = document.createElement('div');
  controls.className = 'chart-canvas-controls';
  controls.style.cssText = CHART_CANVAS_CONTROLS_STYLE;
  controls.innerHTML = renderChartCanvasControlButtons('chart');

  container.append(renderArea, controls);
  return container;
}

function serializeChartSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

function getChartSvgExportSize(svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const attributeWidth = Number.parseFloat(svg.getAttribute('width') || '');
  const attributeHeight = Number.parseFloat(svg.getAttribute('height') || '');
  const width = rect.width || attributeWidth || viewBox.width || 960;
  const height = rect.height || attributeHeight || viewBox.height || 540;

  return {
    width: Math.min(4096, Math.max(1, Math.round(width))),
    height: Math.min(4096, Math.max(1, Math.round(height))),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('无法生成图表图片。'));
    }, 'image/png');
  });
}

async function chartSvgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const { width, height } = getChartSvgExportSize(svg);
  const source = new Blob([serializeChartSvg(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(source);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('无法加载图表导出预览。'));
      nextImage.src = sourceUrl;
    });
    const pixelRatio = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持图表导出。');
    context.scale(pixelRatio, pixelRatio);
    context.drawImage(image, 0, 0, width, height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function downloadChartBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function copyChartSvg(svg: SVGSVGElement): Promise<void> {
  const svgMarkup = serializeChartSvg(svg);

  try {
    const png = await chartSvgToPngBlob(svg);
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return;
    }
  } catch {
    // Some Tauri and browser clipboard implementations only permit text writes.
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error('当前环境不支持复制图表。');
  }
  await navigator.clipboard.writeText(svgMarkup);
}

async function exportChartSvg(svg: SVGSVGElement): Promise<void> {
  try {
    downloadChartBlob(await chartSvgToPngBlob(svg), 'chart.png');
  } catch {
    downloadChartBlob(
      new Blob([serializeChartSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }),
      'chart.svg',
    );
  }
}

function normalizeMermaidSource(source: string): string {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/^\s*```(?:mermaid|mmd)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/<br\s*\/?>/gi, '<br/>')
    .split('\n')
    .flatMap((line) => line.replace(MERMAID_STATEMENT_START, '$1\n$2').split('\n'))
    .map((line) => line.trimEnd())
    .filter((line) => !MERMAID_SEPARATOR_LINE.test(line))
    .filter((line) => !MERMAID_DASH_TARGET_EDGE.test(line))
    .map((line) => line.replace(MERMAID_ELLIPSIS_PREFIX_LABEL, '[$1]'))
    .join('\n')
    .trim();
}

function quoteMermaidLabels(source: string): string {
  return source.replace(MERMAID_SIMPLE_LABEL, (_match, id: string, label: string) => {
    const escapedLabel = label
      .replace(/"/g, '&quot;')
      .replace(/\s+/g, ' ')
      .trim();
    return `${id}["${escapedLabel}"]`;
  });
}

function getMermaidRenderCandidates(source: string): string[] {
  const normalized = normalizeMermaidSource(source);
  const quoted = quoteMermaidLabels(normalized);
  return Array.from(new Set([source.trim(), normalized, quoted].filter(Boolean)));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderMermaidFallback(message: string, source: string, escapeHtml: (value: string) => string): string {
  return [
    `<div class="chat-mermaid-error">${escapeHtml(message)}</div>`,
    '<pre class="chat-mermaid-source"><code>',
    escapeHtml(source),
    '</code></pre>',
  ].join('');
}

function withMermaidTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Mermaid 渲染超时，已显示源码。'));
    }, ms);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function renderMermaidSvg(
  mermaid: Awaited<ReturnType<typeof getMermaidRenderer>>,
  source: string,
  idBase: string,
): Promise<MermaidRenderResult> {
  const candidates = getMermaidRenderCandidates(source);
  let lastError = '';

  for (const [index, candidate] of candidates.entries()) {
    try {
      await mermaid.parse(candidate);
      const { svg } = await mermaid.render(`${idBase}-${index}`, candidate);
      return {
        svg,
        repaired: candidate !== source.trim(),
      };
    } catch (error) {
      lastError = getErrorMessage(error);
    }
  }

  throw new Error(lastError || 'Mermaid 图表语法无效，无法渲染。');
}

function renderMermaidFence(
  source: string,
  cacheEntry: MermaidRenderCacheEntry | undefined,
  escapeHtml: (value: string) => string,
  theme: 'light' | 'dark',
): string {
  const resolvedCacheEntry = cacheEntry ?? getStoredMermaidCacheEntry(source, theme);
  const encoded = encodeURIComponent(source);
  const renderStateAttrs = resolvedCacheEntry?.svg ? ' data-mermaid-rendered="true"' : '';
  const renderContent = resolvedCacheEntry?.svg
    ? resolvedCacheEntry.svg
    : resolvedCacheEntry?.error
      ? `<div class="chat-mermaid-error">${escapeHtml(resolvedCacheEntry.error)}</div>`
      : '<div class="mermaid-canvas-loading">正在渲染图表...</div>';

  return [
    '<div class="mermaid-canvas-container" data-chart-kind="mermaid" data-mermaid-encoded="' + encoded + '" tabindex="0">',
    '<div class="mermaid-canvas-render" data-mermaid-source="' + encoded + '"' + renderStateAttrs + '>',
    renderContent,
    '</div>',
    '<div class="mermaid-canvas-controls" style="' + CHART_CANVAS_CONTROLS_STYLE + '">',
    renderChartCanvasControlButtons('mermaid'),
    '</div>',
    '</div>',
  ].join('');
}

function decodeMermaidSource(area: HTMLElement): string {
  const encoded = area.getAttribute('data-mermaid-source') || '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

type ThemeType = 'light' | 'dark' | 'system';

type ChatPreviewProps = {
  text: string;
  streaming?: boolean; // 是否为流式内容
  highlightQuery?: string; // 搜索高亮关键词
  className?: string;
  clawFormat?: boolean;
};

const MIN_RENDER_INTERVAL_MS = 33;
const STREAMING_MARKDOWN_RENDER_INTERVAL_MS = 56;
const STREAMING_BOUNDARY_RENDER_INTERVAL_MS = 42;
const STREAMING_MAX_DEFER_MS = 120;
const STREAMING_LARGE_BACKLOG_CHARS = 1200;
const STREAMING_HUGE_BACKLOG_CHARS = 3600;
const MIN_CONTENT_TEXT_SCALE = 75;
const MAX_CONTENT_TEXT_SCALE = 150;
const CHAT_COPY_ICON_HTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
const CHAT_COPY_DONE_ICON_HTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

type ChatCopyKind = 'code' | 'table';
type ChatCopyLabels = {
  copyCode: string;
  copyTable: string;
  copiedCode: string;
  copiedTable: string;
  copyFailed: string;
};

function hasOpenMarkdownFence(text: string): boolean {
  return (text.match(/```/g) || []).length % 2 !== 0;
}

function hasStableStreamingBoundary(text: string, previousText: string): boolean {
  if (text.length <= previousText.length || hasOpenMarkdownFence(text)) {
    return false;
  }
  return /(?:\n\s*\n|[.!?。！？]\s*)$/.test(text);
}

function getStreamingMarkdownRenderInterval(backlog: number): number {
  if (backlog > STREAMING_HUGE_BACKLOG_CHARS) return 120;
  if (backlog > STREAMING_LARGE_BACKLOG_CHARS) return 88;
  return STREAMING_MARKDOWN_RENDER_INTERVAL_MS;
}

function getContentTextScaleRatio(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_CONTENT_TEXT_SCALE, Math.max(MIN_CONTENT_TEXT_SCALE, scale)) / 100;
}

async function copyChatText(text: string): Promise<void> {
  if (!text.trim()) return;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy selection path below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('复制命令未成功执行');
    }
  } finally {
    textarea.remove();
  }
}

function getCodeBlockCopyText(pre: HTMLPreElement): string {
  return pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
}

function getTableCopyText(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((row) => Array.from(row.cells)
      .map((cell) => cell.innerText.replace(/\s+/g, ' ').trim())
      .join('\t'))
    .join('\n');
}

function resetChatCopyButton(button: HTMLButtonElement, kind: ChatCopyKind, labels: ChatCopyLabels): void {
  const label = kind === 'code' ? labels.copyCode : labels.copyTable;
  button.classList.remove('copied', 'copy-error');
  button.dataset.copyState = 'idle';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = CHAT_COPY_ICON_HTML;
}

function setChatCopyButtonCopied(button: HTMLButtonElement, kind: ChatCopyKind, labels: ChatCopyLabels): void {
  const label = kind === 'code' ? labels.copiedCode : labels.copiedTable;
  button.classList.remove('copy-error');
  button.classList.add('copied');
  button.dataset.copyState = 'copied';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = CHAT_COPY_DONE_ICON_HTML;

  window.setTimeout(() => {
    resetChatCopyButton(button, kind, labels);
  }, 1400);
}

function setChatCopyButtonError(button: HTMLButtonElement, kind: ChatCopyKind, labels: ChatCopyLabels): void {
  button.classList.remove('copied');
  button.classList.add('copy-error');
  button.dataset.copyState = 'error';
  button.title = labels.copyFailed;
  button.setAttribute('aria-label', labels.copyFailed);

  window.setTimeout(() => {
    resetChatCopyButton(button, kind, labels);
  }, 1400);
}

export default function ChatPreview({text, streaming = false, highlightQuery, className, clawFormat = false}: ChatPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('editor');
  const { theme } = useTheme()
  const [mdTheme, setMdTheme] = useState<ThemeType>('light')
  const { codeTheme, contentTextScale } = useSettingStore()
  const [htmlContent, setHtmlContent] = useState<string>('');
  const animationRef = useRef<number | null>(null);
  const displayedTextRef = useRef('');
  const targetTextRef = useRef('');
  const carryCharsRef = useRef(0);
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastRenderTimeRef = useRef(0);
  const lastCommittedTextRef = useRef('');
  const pendingRenderTextRef = useRef<string | null>(null);
  const pendingRenderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRenderRafRef = useRef<number | null>(null);
  const pendingRenderStartedAtRef = useRef(0);
  const scheduledRenderAtRef = useRef(0);
  const md = useRef<MarkdownIt | null>(null);
  const streamingSegmentHtmlCacheRef = useRef<Map<string, string>>(new Map());
  const mermaidRenderCacheRef = useRef<Map<string, MermaidRenderCacheEntry>>(new Map());
  const mermaidViewStateRef = useRef<WeakMap<HTMLDivElement, MermaidViewState>>(new WeakMap());
  const [mermaidViewer, setMermaidViewer] = useState<MermaidViewerState | null>(null);
  const contentTextScaleRatio = useMemo(
    () => getContentTextScaleRatio(contentTextScale),
    [contentTextScale],
  );
  const chatContentFontSize = useMemo(
    () => `calc(0.875rem * ${contentTextScaleRatio})`,
    [contentTextScaleRatio],
  );
  const chatCopyLabels = useMemo<ChatCopyLabels>(() => ({
    copyCode: t('chatCopy.copyCode'),
    copyTable: t('chatCopy.copyTable'),
    copiedCode: t('chatCopy.copiedCode'),
    copiedTable: t('chatCopy.copiedTable'),
    copyFailed: t('chatCopy.copyFailed'),
  }), [t]);
  const previewStyle = useMemo<React.CSSProperties & Record<'--chat-content-font-size', string>>(
    () => ({
      fontSize: chatContentFontSize,
      '--chat-content-font-size': chatContentFontSize,
    }),
    [chatContentFontSize],
  );
  const renderText = useMemo(
    () => clawFormat ? getClawStreamVisibleMarkdown(text, streaming) : text,
    [clawFormat, streaming, text],
  );

  useEffect(() => {
    hljs.registerLanguage('javascript', javascript);
    hljs.registerLanguage('typescript', typescript);
    hljs.registerLanguage('bash', bash);
    hljs.registerLanguage('json', json);
    hljs.registerLanguage('html', xml);
    hljs.registerLanguage('css', css);
  }, []);
  
  useEffect(() => {
    const markdown = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: !clawFormat,
      highlight: function (str, lang): string {
        const themeClass = mdTheme === 'dark' ? 'hljs-dark' : 'hljs-light';
        if (lang && hljs.getLanguage(lang)) {
          try {
            const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
            if (clawFormat) {
              return renderClawCodeBlockHtml(str, lang, highlighted, themeClass, markdown.utils.escapeHtml);
            }
            return `<pre class="hljs ${themeClass}"><code>` +
              highlighted +
              '</code></pre>';
          } catch {
            // 语法高亮失败时静默处理，使用普通代码块
          }
        }
        if (clawFormat) {
          return renderClawCodeBlockHtml(str, lang, markdown.utils.escapeHtml(str), themeClass, markdown.utils.escapeHtml);
        }
        return `<pre class="hljs ${themeClass}"><code>` +
          markdown.utils.escapeHtml(str) +
          '</code></pre>';
      }
    }).use(katex, {
      throwOnError: false,
      errorColor: '#cc0000'
    });
    installGitHubRepoAutolinks(markdown);

    const defaultFence = markdown.renderer.rules.fence!;
    markdown.renderer.rules.fence = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      const lang = getFenceLanguage(token.info);

      if (!clawFormat && !streaming && (lang === 'mermaid' || lang === 'mmd')) {
        const mermaidTheme = mdTheme === 'dark' ? 'dark' : 'light';
        return renderMermaidFence(
          token.content,
          mermaidRenderCacheRef.current.get(getMermaidCacheKey(token.content, mermaidTheme)),
          markdown.utils.escapeHtml,
          mermaidTheme,
        );
      }

      return defaultFence(tokens, idx, options, env, self);
    };

    const defaultTableOpen = markdown.renderer.rules.table_open || function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options);
    };
    markdown.renderer.rules.table_open = function (tokens, idx, options, env, self) {
      if (clawFormat) {
        tokens[idx].attrJoin('class', 'claw_table_format');
      }
      return defaultTableOpen(tokens, idx, options, env, self);
    };

    markdown.renderer.rules.link_open = function (tokens, idx, options, _env, self) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      return self.renderToken(tokens, idx, options);
    }

    const defaultImage = markdown.renderer.rules.image || function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options);
    };
    markdown.renderer.rules.image = function (tokens, idx, options, env, self) {
      if (clawFormat) {
        const src = tokens[idx].attrGet('src') || '';
        const escapedSrc = markdown.utils.escapeHtml(src);
        return `<a href="${escapedSrc}" target="_blank" rel="noopener noreferrer">[image:${escapedSrc}]</a>`;
      }
      tokens[idx].attrSet('referrerpolicy', 'no-referrer');
      return defaultImage(tokens, idx, options, env, self);
    };

    md.current = markdown;
    pendingRenderTextRef.current = null;
    pendingRenderStartedAtRef.current = 0;
    scheduledRenderAtRef.current = 0;

    streamingSegmentHtmlCacheRef.current.clear();
    if (displayedTextRef.current) {
      lastCommittedTextRef.current = displayedTextRef.current;
      setHtmlContent(md.current.render(preprocessMarkdown(displayedTextRef.current, clawFormat)));
    } else {
      lastCommittedTextRef.current = '';
      setHtmlContent('');
    }
  }, [clawFormat, mdTheme, streaming]);

  const commitDisplayedText = useCallback((nextText: string) => {
    lastCommittedTextRef.current = nextText;
    lastRenderTimeRef.current = performance.now();
    pendingRenderTextRef.current = null;
    pendingRenderStartedAtRef.current = 0;
    scheduledRenderAtRef.current = 0;
    if (md.current) {
      const renderMarkdown = (value: string) => md.current!.render(preprocessMarkdown(value, clawFormat));
      const rendered = streaming && !clawFormat
        ? renderStreamingMarkdownSegments({
            text: nextText,
            cache: streamingSegmentHtmlCacheRef.current,
            renderMarkdown,
          }).html
        : renderMarkdown(nextText);
      if (!streaming || clawFormat) {
        streamingSegmentHtmlCacheRef.current.clear();
      }
      setHtmlContent(rendered);
    } else {
      setHtmlContent(nextText);
    }
  }, [clawFormat, streaming]);

  const cancelScheduledMarkdownRender = useCallback(() => {
    if (pendingRenderTimeoutRef.current) {
      clearTimeout(pendingRenderTimeoutRef.current);
      pendingRenderTimeoutRef.current = null;
    }
    if (pendingRenderRafRef.current !== null) {
      cancelAnimationFrame(pendingRenderRafRef.current);
      pendingRenderRafRef.current = null;
    }
    scheduledRenderAtRef.current = 0;
  }, []);

  const flushPendingMarkdownRender = useCallback(() => {
    const nextText = pendingRenderTextRef.current;
    pendingRenderTextRef.current = null;
    pendingRenderStartedAtRef.current = 0;
    scheduledRenderAtRef.current = 0;
    if (nextText === null || nextText === lastCommittedTextRef.current) {
      return;
    }
    commitDisplayedText(nextText);
  }, [commitDisplayedText]);

  const schedulePendingMarkdownRender = useCallback((delayMs: number) => {
    const now = performance.now();
    const safeDelay = Math.max(0, delayMs);
    const scheduledAt = now + safeDelay;

    if (
      scheduledRenderAtRef.current > 0 &&
      scheduledRenderAtRef.current <= scheduledAt + 1
    ) {
      return;
    }

    cancelScheduledMarkdownRender();
    scheduledRenderAtRef.current = scheduledAt;

    const scheduleRaf = () => {
      pendingRenderTimeoutRef.current = null;
      pendingRenderRafRef.current = requestAnimationFrame(() => {
        pendingRenderRafRef.current = null;
        flushPendingMarkdownRender();
      });
    };

    if (safeDelay <= 0) {
      scheduleRaf();
    } else {
      pendingRenderTimeoutRef.current = setTimeout(scheduleRaf, safeDelay);
    }
  }, [cancelScheduledMarkdownRender, flushPendingMarkdownRender]);

  const renderDisplayedText = useCallback((nextText: string, force = false) => {
    displayedTextRef.current = nextText;

    if (force) {
      cancelScheduledMarkdownRender();
      commitDisplayedText(nextText);
      return;
    }

    if (nextText === lastCommittedTextRef.current) {
      pendingRenderTextRef.current = null;
      pendingRenderStartedAtRef.current = 0;
      return;
    }

    const now = performance.now();
    const sinceLastRender = now - lastRenderTimeRef.current;
    pendingRenderTextRef.current = nextText;
    if (pendingRenderStartedAtRef.current === 0) {
      pendingRenderStartedAtRef.current = now;
    }

    if (!streaming) {
      schedulePendingMarkdownRender(Math.max(0, MIN_RENDER_INTERVAL_MS - sinceLastRender));
      return;
    }

    const pendingForMs = now - pendingRenderStartedAtRef.current;
    const backlog = Math.max(0, nextText.length - lastCommittedTextRef.current.length);
    const renderInterval = getStreamingMarkdownRenderInterval(backlog);
    const shouldRenderNow =
      lastCommittedTextRef.current.length === 0 ||
      sinceLastRender >= renderInterval ||
      pendingForMs >= STREAMING_MAX_DEFER_MS ||
      (
        sinceLastRender >= STREAMING_BOUNDARY_RENDER_INTERVAL_MS &&
        hasStableStreamingBoundary(nextText, lastCommittedTextRef.current)
      );

    if (shouldRenderNow) {
      schedulePendingMarkdownRender(0);
      return;
    }

    const intervalDelay = renderInterval - sinceLastRender;
    const maxDeferDelay = STREAMING_MAX_DEFER_MS - pendingForMs;
    schedulePendingMarkdownRender(Math.min(intervalDelay, maxDeferDelay));
  }, [
    cancelScheduledMarkdownRender,
    commitDisplayedText,
    schedulePendingMarkdownRender,
    streaming,
  ]);

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    lastFrameTimeRef.current = null;
    carryCharsRef.current = 0;
  }, []);

  const tickStreaming = useCallback((frameTime: number) => {
    const lastFrameTime = lastFrameTimeRef.current ?? frameTime;
    const elapsedMs = frameTime - lastFrameTime;
    lastFrameTimeRef.current = frameTime;

    const next = advanceStreamingSmoother(
      {
        carryChars: carryCharsRef.current,
        displayedLength: displayedTextRef.current.length,
      },
      targetTextRef.current.length,
      elapsedMs,
    );

    carryCharsRef.current = next.carryChars;

    if (next.charsAdded > 0) {
      renderDisplayedText(
        targetTextRef.current.slice(0, next.displayedLength),
      );
    }

    if (next.displayedLength >= targetTextRef.current.length) {
      animationRef.current = null;
      lastFrameTimeRef.current = null;
      carryCharsRef.current = 0;
      renderDisplayedText(targetTextRef.current);
      return;
    }

    animationRef.current = requestAnimationFrame(tickStreaming);
  }, [renderDisplayedText]);

  const ensureStreamingAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      return;
    }
    lastFrameTimeRef.current = null;
    animationRef.current = requestAnimationFrame(tickStreaming);
  }, [tickStreaming]);

  // 处理流式内容更新
  useEffect(() => {
    if (!streaming) {
      stopAnimation();
      targetTextRef.current = renderText;
      renderDisplayedText(renderText, true);
      return;
    }

    targetTextRef.current = renderText;

    if (renderText.length < displayedTextRef.current.length) {
      stopAnimation();
      renderDisplayedText(renderText, true);
      return;
    }

    if (renderText.length === displayedTextRef.current.length) {
      if (renderText !== displayedTextRef.current) {
        renderDisplayedText(renderText, true);
      }
      return;
    }

    if (clawFormat) {
      stopAnimation();
      renderDisplayedText(renderText, true);
      return;
    }

    ensureStreamingAnimation();
  }, [clawFormat, renderText, streaming, ensureStreamingAnimation, renderDisplayedText, stopAnimation]);

  // 清理动画
  useEffect(() => {
    return () => {
      stopAnimation();
      cancelScheduledMarkdownRender();
    };
  }, [cancelScheduledMarkdownRender, stopAnimation]);

  useEffect(() => {
    if (theme === 'system') {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setMdTheme('dark')
      } else {
        setMdTheme('light')
      }
    } else {
      setMdTheme(theme as ThemeType)
    }
  }, [theme])

  useEffect(() => {
    // 加载Markdown主题样式
    const link = document.createElement('link');
    link.id = 'markdown-theme-style';
    link.rel = 'stylesheet';
    switch (theme) {
      case 'dark':
        link.href = '/markdown/github-markdown-dark.css';
        break;
      case 'light':
        link.href = '/markdown/github-markdown-light.css';
        break;
      case 'system':
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          link.href = '/markdown/github-markdown-dark.css';
        } else {
          link.href = '/markdown/github-markdown-light.css';
        }
        break;
    }
    
    const existingLink = document.getElementById('markdown-theme-style');
    if (existingLink) document.head.removeChild(existingLink);
    document.head.appendChild(link);

    // 监听系统主题变化
    const matchMedia = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        const themeValue = matchMedia.matches ? 'dark' : 'light'
        setMdTheme(themeValue)
      }
    }
    matchMedia.addEventListener('change', handler)
    return () => {
      matchMedia.removeEventListener('change', handler)
    }
  }, [theme])
  
  // 搜索关键词高亮（基于 DOM TreeWalker）
  useEffect(() => {
    const el = previewRef.current
    if (!el) return

    // 先清除已有高亮
    el.querySelectorAll('mark.search-highlight').forEach((mark) => {
      const parent = mark.parentNode
      if (!parent) return
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
      parent.normalize()
    })

    if (!highlightQuery?.trim()) return

    const lowerQuery = highlightQuery.toLowerCase().trim()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName.toLowerCase()
        if (tag === 'code' || tag === 'pre' || tag === 'style') return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    const textNodes: Text[] = []
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

    for (const node of textNodes) {
      const text = node.textContent || ''
      const lowerText = text.toLowerCase()
      const idx = lowerText.indexOf(lowerQuery)
      if (idx === -1) continue

      const before = text.substring(0, idx)
      const match = text.substring(idx, idx + lowerQuery.length)
      const after = text.substring(idx + lowerQuery.length)

      const mark = document.createElement('mark')
      mark.className = 'bg-yellow-200 dark:bg-yellow-800 text-foreground px-0.5 rounded search-highlight'
      mark.textContent = match

      const parent = node.parentNode!
      if (before) parent.insertBefore(document.createTextNode(before), node)
      parent.insertBefore(mark, node)
      if (after) parent.insertBefore(document.createTextNode(after), node)
      parent.removeChild(node)
    }
  }, [htmlContent, highlightQuery])

  useEffect(() => {
    const el = previewRef.current
    if (!el) return

    const cleanups: Array<() => void> = []

    const enhanceCopyTarget = (target: HTMLPreElement | HTMLTableElement, kind: ChatCopyKind) => {
      if (target.closest('.mermaid-canvas-container')) return

      const parent = target.parentElement
      let shell: HTMLDivElement | null = parent?.classList.contains('chat-copy-shell')
        ? parent as HTMLDivElement
        : null

      if (!shell) {
        shell = document.createElement('div')
        shell.className = `chat-copy-shell chat-copy-${kind}-shell`
        target.parentNode?.insertBefore(shell, target)
        shell.appendChild(target)
      } else {
        shell.classList.add(`chat-copy-${kind}-shell`)
      }

      shell.dataset.copyKind = kind

      let button = Array.from(shell.children).find(
        (child): child is HTMLButtonElement =>
          child instanceof HTMLButtonElement && child.classList.contains('chat-copy-button'),
      )

      if (!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'chat-copy-button'
        shell.appendChild(button)
      }

      resetChatCopyButton(button, kind, chatCopyLabels)

      const handleCopyClick = async (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()

        const text = kind === 'code'
          ? getCodeBlockCopyText(target as HTMLPreElement)
          : getTableCopyText(target as HTMLTableElement)

        try {
          await copyChatText(text.trimEnd())
          setChatCopyButtonCopied(button, kind, chatCopyLabels)
        } catch (err) {
          console.error('复制失败:', err)
          setChatCopyButtonError(button, kind, chatCopyLabels)
        }
      }

      button.addEventListener('click', handleCopyClick)
      cleanups.push(() => button.removeEventListener('click', handleCopyClick))
    }

    el.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
      enhanceCopyTarget(pre, 'code')
    })

    el.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
      enhanceCopyTarget(table, 'table')
    })

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [htmlContent, chatCopyLabels])

  const getMermaidContainer = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return null
    return target.closest<HTMLDivElement>('.mermaid-canvas-container, .chart-canvas-container')
  }, [])

  const getMermaidViewState = useCallback((container: HTMLDivElement): MermaidViewState => {
    const existing = mermaidViewStateRef.current.get(container)
    if (existing) return existing

    const nextState: MermaidViewState = {
      scale: 1,
      translateX: 0,
      translateY: 0,
      isDragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastTranslateX: 0,
      lastTranslateY: 0,
    }
    mermaidViewStateRef.current.set(container, nextState)
    return nextState
  }, [])

  const applyMermaidTransform = useCallback((container: HTMLDivElement) => {
    const state = getMermaidViewState(container)
    const viewport = container.querySelector<HTMLDivElement>('.mermaid-canvas-viewport, .chart-canvas-viewport')
    if (!viewport) return
    viewport.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`
  }, [getMermaidViewState])

  const handleMermaidToolbarClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest<HTMLButtonElement>('.mermaid-canvas-btn, .chart-canvas-btn')
    if (!button) return

    const container = getMermaidContainer(button)
    if (!container) return

    event.preventDefault()
    event.stopPropagation()

    const state = getMermaidViewState(container)
    const svg = getMermaidDiagramSvg(container)

    const hasAction = (action: string) => (
      button.classList.contains(`mermaid-canvas-${action}`) ||
      button.classList.contains(`chart-canvas-${action}`)
    )

    if (hasAction('zoom-in')) {
      state.scale = Math.min(4, state.scale + 0.2)
      applyMermaidTransform(container)
      return
    }

    if (hasAction('zoom-out')) {
      state.scale = Math.max(0.25, state.scale - 0.2)
      applyMermaidTransform(container)
      return
    }

    if (hasAction('reset')) {
      state.scale = 1
      state.translateX = 0
      state.translateY = 0
      applyMermaidTransform(container)
      return
    }

    if (hasAction('open')) {
      if (!svg) return
      setMermaidViewer({
        title: container.dataset.chartKind === 'mermaid' ? 'Mermaid 图表' : '图表',
        svg: svg.outerHTML,
        scale: 1,
        translateX: 0,
        translateY: 0,
        isDragging: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        lastTranslateX: 0,
        lastTranslateY: 0,
      })
      return
    }

    if (hasAction('copy')) {
      if (!svg) return
      try {
        await copyChartSvg(svg)
        button.classList.add('copied')
        setTimeout(() => button.classList.remove('copied'), 1500)
      } catch (err) {
        console.error('复制失败:', err)
      }
      return
    }

    if (hasAction('export')) {
      if (!svg) return
      try {
        await exportChartSvg(svg)
        button.classList.add('exported')
        setTimeout(() => button.classList.remove('exported'), 1500)
      } catch (err) {
        console.error('导出失败:', err)
      }
    }
  }, [applyMermaidTransform, getMermaidContainer, getMermaidViewState])

  useEffect(() => {
    const el = previewRef.current
    if (!el) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.mermaid-canvas-controls, .chart-canvas-controls')) return

      const container = getMermaidContainer(target)
      if (!container || event.button !== 0) return

      const renderArea = container.querySelector<HTMLDivElement>('.mermaid-canvas-render, .chart-canvas-render')
      if (!renderArea) return

      const state = getMermaidViewState(container)
      state.isDragging = true
      state.pointerId = event.pointerId
      state.startX = event.clientX
      state.startY = event.clientY
      state.lastTranslateX = state.translateX
      state.lastTranslateY = state.translateY
      renderArea.setPointerCapture?.(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const container = getMermaidContainer(event.target)
      if (!container) return

      const state = getMermaidViewState(container)
      if (!state.isDragging || state.pointerId !== event.pointerId) return

      state.translateX = state.lastTranslateX + (event.clientX - state.startX)
      state.translateY = state.lastTranslateY + (event.clientY - state.startY)
      applyMermaidTransform(container)
    }

    const endPointerDrag = (event: PointerEvent) => {
      const container = getMermaidContainer(event.target)
      if (!container) return

      const state = getMermaidViewState(container)
      if (state.pointerId !== event.pointerId) return

      state.isDragging = false
      state.pointerId = null
      const renderArea = container.querySelector<HTMLDivElement>('.mermaid-canvas-render, .chart-canvas-render')
      renderArea?.releasePointerCapture?.(event.pointerId)
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      const container = getMermaidContainer(event.target)
      if (!container) return

      event.preventDefault()
      const state = getMermaidViewState(container)
      const delta = event.deltaY > 0 ? -0.12 : 0.12
      state.scale = Math.min(4, Math.max(0.25, state.scale + delta))
      applyMermaidTransform(container)
    }

    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', endPointerDrag)
    el.addEventListener('pointercancel', endPointerDrag)
    el.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown)
      el.removeEventListener('pointermove', handlePointerMove)
      el.removeEventListener('pointerup', endPointerDrag)
      el.removeEventListener('pointercancel', endPointerDrag)
      el.removeEventListener('wheel', handleWheel)
    }
  }, [
    applyMermaidTransform,
    getMermaidContainer,
    getMermaidViewState,
  ])

  // 渲染 Mermaid 图表并添加交互控制
  useLayoutEffect(() => {
    if (streaming || clawFormat) return

    const el = previewRef.current
    if (!el) return

    const containers = el.querySelectorAll<HTMLDivElement>('.mermaid-canvas-container')
    if (containers.length === 0) return

    let cancelled = false
    const currentTheme = mdTheme === 'dark' ? 'dark' : 'light';
    let renderedFreshDiagram = false;

    function setupInteraction(container: HTMLDivElement) {
      getMermaidViewState(container)
      applyMermaidTransform(container)
    }

    (async () => {
      try {
        const mermaid = await getMermaidRenderer(currentTheme)
        if (cancelled) return

        for (const container of Array.from(containers)) {
          if (cancelled) return
          const renderArea = container.querySelector('.mermaid-canvas-render') as HTMLDivElement;
          if (!renderArea) continue;
          const source = decodeMermaidSource(renderArea)
          if (!source.trim()) {
            renderArea.innerHTML = '<div class="chat-mermaid-error">Mermaid 源码为空，无法渲染图表。</div>'
            continue
          }
          const cacheKey = getMermaidCacheKey(source, currentTheme)
          const cached = mermaidRenderCacheRef.current.get(cacheKey) ?? getStoredMermaidCacheEntry(source, currentTheme)

          if (cached?.svg) {
            mermaidRenderCacheRef.current.set(cacheKey, cached)
            renderArea.innerHTML = wrapMermaidSvg(cached.svg)
            renderArea.dataset.mermaidRendered = 'true'
            setupInteraction(container)
            continue
          }

          if (cached?.error) {
            renderArea.innerHTML = `<div class="chat-mermaid-error">${md.current ? md.current.utils.escapeHtml(cached.error) : cached.error}</div>`
            continue
          }

          if (renderArea.dataset.mermaidRendered === 'true' && renderArea.querySelector('svg')) {
            setupInteraction(container)
            continue
          }

          try {
            renderArea.removeAttribute('data-mermaid-rendered')
            renderArea.innerHTML = '<div class="mermaid-canvas-loading">正在渲染图表...</div>'
            const id = `chat-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
            const { svg, repaired } = await withMermaidTimeout(
              renderMermaidSvg(mermaid, source, id),
              MERMAID_RENDER_TIMEOUT_MS,
            )
            const cacheEntry = { svg }
            mermaidRenderCacheRef.current.set(cacheKey, cacheEntry)
            storeMermaidCacheEntry(source, currentTheme, cacheEntry)
            if (cancelled) return
            renderArea.innerHTML = wrapMermaidSvg(svg)
            renderArea.dataset.mermaidRendered = 'true'
            if (repaired) {
              renderArea.dataset.mermaidRepaired = 'true'
            }
            setupInteraction(container);
            renderedFreshDiagram = true;
          } catch (err) {
            const msg = getErrorMessage(err)
            mermaidRenderCacheRef.current.set(cacheKey, { error: msg })
            if (cancelled) return
            const escapeHtml = md.current?.utils.escapeHtml || ((value: string) => value)
            renderArea.innerHTML = renderMermaidFallback(msg, source, escapeHtml)
          }
        }
        if (renderedFreshDiagram && !cancelled && md.current) {
          setHtmlContent(md.current.render(preprocessMarkdown(displayedTextRef.current, clawFormat)));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        containers.forEach((container) => {
          const renderArea = container.querySelector('.mermaid-canvas-render') as HTMLDivElement;
          if (renderArea) {
            const source = decodeMermaidSource(renderArea)
            const escapeHtml = md.current?.utils.escapeHtml || ((value: string) => value)
            renderArea.innerHTML = renderMermaidFallback(msg, source, escapeHtml)
          }
        })
      }
    })()

    return () => {
      cancelled = true;
    }
  }, [applyMermaidTransform, clawFormat, getMermaidViewState, htmlContent, mdTheme, streaming])

  // 让聊天输出中的独立 SVG 图表也获得与 Mermaid 相同的画布能力。
  useLayoutEffect(() => {
    if (streaming || clawFormat) return

    const el = previewRef.current
    if (!el) return

    const chartSvgs = Array.from(el.querySelectorAll<SVGSVGElement>('svg'))
      .filter(shouldEnhanceInlineSvgChart)

    chartSvgs.forEach((svg) => {
      const container = wrapInlineSvgChart(svg)
      if (!container) return
      getMermaidViewState(container)
      applyMermaidTransform(container)
    })
  }, [applyMermaidTransform, clawFormat, getMermaidViewState, htmlContent, streaming])

  useEffect(() => {
    if (!mermaidViewer) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMermaidViewer(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mermaidViewer])

  const updateMermaidViewer = useCallback((updater: (state: MermaidViewerState) => MermaidViewerState) => {
    setMermaidViewer((state) => state ? updater(state) : state)
  }, [])

  const handleMermaidViewerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.12 : 0.12
    updateMermaidViewer((state) => ({
      ...state,
      scale: Math.min(6, Math.max(0.15, state.scale + delta)),
    }))
  }, [updateMermaidViewer])

  const handleMermaidViewerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    updateMermaidViewer((state) => ({
      ...state,
      isDragging: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastTranslateX: state.translateX,
      lastTranslateY: state.translateY,
    }))
  }, [updateMermaidViewer])

  const handleMermaidViewerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    updateMermaidViewer((state) => {
      if (!state.isDragging || state.pointerId !== event.pointerId) return state
      return {
        ...state,
        translateX: state.lastTranslateX + event.clientX - state.startX,
        translateY: state.lastTranslateY + event.clientY - state.startY,
      }
    })
  }, [updateMermaidViewer])

  const handleMermaidViewerPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    updateMermaidViewer((state) => {
      if (state.pointerId !== event.pointerId) return state
      return {
        ...state,
        isDragging: false,
        pointerId: null,
      }
    })
  }, [updateMermaidViewer])

  const resetMermaidViewer = useCallback(() => {
    updateMermaidViewer((state) => ({
      ...state,
      scale: 1,
      translateX: 0,
      translateY: 0,
      isDragging: false,
      pointerId: null,
    }))
  }, [updateMermaidViewer])

  // 根据主题选择样式
  const getThemeClass = () => {
    const themeClass = mdTheme === 'dark' ? 'markdown-body markdown-dark' : 'markdown-body';
    return clawFormat ? `${themeClass} claw-markdown` : themeClass;
  };

  // 应用高亮样式
  const getHighlightStyle = () => {
    return codeTheme || 'github';
  };

  // 检测是否为 macOS
  const isMacOS = () => {
    if (typeof window === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  };

  // 处理文本选中后的拖拽（仅 macOS）
  const handleDragStart = (e: React.DragEvent) => {
    // 非 macOS 系统直接阻止拖拽
    if (!isMacOS()) {
      e.preventDefault();
      return;
    }

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()

    if (selectedText) {
      // 设置拖拽数据为选中的文本
      e.dataTransfer.setData('text/plain', selectedText)
      e.dataTransfer.effectAllowed = 'copy'

      // 创建自定义拖拽预览图像，只显示选中的文本
      const dragPreview = document.createElement('div')
      dragPreview.style.position = 'absolute'
      dragPreview.style.left = '-9999px'
      dragPreview.style.padding = '8px 12px'
      dragPreview.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'
      dragPreview.style.color = 'white'
      dragPreview.style.borderRadius = '4px'
      dragPreview.style.fontSize = '14px'
      dragPreview.style.maxWidth = '300px'
      dragPreview.style.overflowWrap = 'break-word'
      dragPreview.textContent = selectedText.length > 50 ? selectedText.substring(0, 50) + '...' : selectedText

      document.body.appendChild(dragPreview)
      e.dataTransfer.setDragImage(dragPreview, 0, 0)

      // 拖拽结束后移除预览元素
      setTimeout(() => {
        document.body.removeChild(dragPreview)
      }, 0)
    } else {
      // 如果没有选中文本，阻止拖拽
      e.preventDefault()
    }
  }

  // 没有内容时不渲染
  if (!renderText || !renderText.trim()) {
    return null
  }

  // 流式输出时，给最后一个可见内容块加上光标闪烁效果
  const streamCursorClass = streaming && renderText.trim() ? 'streaming-cursor' : ''

  return (
    <div className={className || "flex-1 max-w-[calc(100vw-30px)] md:max-w-[calc(100vw-440px)]"}>
      <div
        ref={previewRef}
        className={cn(getThemeClass(), streamCursorClass)}
        style={previewStyle}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
        data-highlight-style={getHighlightStyle()}
        draggable={isMacOS()}
        onClickCapture={handleMermaidToolbarClick}
        onDragStart={handleDragStart}
      />
      {mermaidViewer && (
        <div
          className="mermaid-viewer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="图表查看器"
        >
          <div className="mermaid-viewer-header">
            <div className="mermaid-viewer-title">{mermaidViewer.title}</div>
            <div className="mermaid-viewer-toolbar">
              <button
                type="button"
                className="mermaid-viewer-btn"
                onClick={() => updateMermaidViewer((state) => ({ ...state, scale: Math.min(6, state.scale + 0.2) }))}
                title="放大"
              >
                +
              </button>
              <button
                type="button"
                className="mermaid-viewer-btn"
                onClick={() => updateMermaidViewer((state) => ({ ...state, scale: Math.max(0.15, state.scale - 0.2) }))}
                title="缩小"
              >
                -
              </button>
              <button
                type="button"
                className="mermaid-viewer-btn"
                onClick={resetMermaidViewer}
                title="重置"
              >
                1:1
              </button>
              <button
                type="button"
                className="mermaid-viewer-btn mermaid-viewer-close"
                onClick={() => setMermaidViewer(null)}
                title="关闭"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="mermaid-viewer-shell">
            <div
              className="mermaid-viewer-stage"
              onWheel={handleMermaidViewerWheel}
              onPointerDown={handleMermaidViewerPointerDown}
              onPointerMove={handleMermaidViewerPointerMove}
              onPointerUp={handleMermaidViewerPointerEnd}
              onPointerCancel={handleMermaidViewerPointerEnd}
            >
              <div
                className="mermaid-viewer-content"
                style={{
                  transform: `translate(calc(-50% + ${mermaidViewer.translateX}px), calc(-50% + ${mermaidViewer.translateY}px)) scale(${mermaidViewer.scale})`,
                }}
                dangerouslySetInnerHTML={{ __html: mermaidViewer.svg }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
