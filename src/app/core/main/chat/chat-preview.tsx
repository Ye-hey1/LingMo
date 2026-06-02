'use client'
import useSettingStore from "@/stores/setting";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes'
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

function preprocessMarkdown(text: string): string {
  let processed = text;

  const codeBlockCount = (processed.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    processed += '\n```\n';
  }

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

type MermaidRenderCacheEntry = {
  svg?: string;
  error?: string;
}

type MermaidRenderResult = {
  svg: string;
  repaired: boolean;
}

const MERMAID_RENDER_CACHE_PREFIX = 'lingmo:chat:mermaid:';
const MAX_STORED_MERMAID_SVG_LENGTH = 500_000;
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
  return `${theme}:${source}`;
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
    container.querySelector<SVGSVGElement>('.mermaid-canvas-render > svg') ||
    container.querySelector<SVGSVGElement>('.mermaid-canvas-render svg')
  );
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
    '<div class="mermaid-canvas-container" data-mermaid-encoded="' + encoded + '">',
    '<div class="mermaid-canvas-render" data-mermaid-source="' + encoded + '"' + renderStateAttrs + '>',
    renderContent,
    '</div>',
    '<div class="mermaid-canvas-controls">',
    '<button class="mermaid-canvas-btn mermaid-canvas-zoom-in" title="放大">',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    '</button>',
    '<button class="mermaid-canvas-btn mermaid-canvas-zoom-out" title="缩小">',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    '</button>',
    '<button class="mermaid-canvas-btn mermaid-canvas-reset" title="重置视图">',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    '</button>',
    '<div class="mermaid-canvas-divider"></div>',
    '<button class="mermaid-canvas-btn mermaid-canvas-open" title="展开查看">',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
    '</button>',
    '<button class="mermaid-canvas-btn mermaid-canvas-copy" title="复制 SVG">',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    '</button>',
    '<button class="mermaid-canvas-btn mermaid-canvas-export" title="导出 PNG">',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    '</button>',
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
};

const MIN_RENDER_INTERVAL_MS = 33;
const MIN_CONTENT_TEXT_SCALE = 75;
const MAX_CONTENT_TEXT_SCALE = 150;

function getContentTextScaleRatio(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_CONTENT_TEXT_SCALE, Math.max(MIN_CONTENT_TEXT_SCALE, scale)) / 100;
}

export default function ChatPreview({text, streaming = false, highlightQuery, className}: ChatPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme()
  const [mdTheme, setMdTheme] = useState<ThemeType>('light')
  const { codeTheme, contentTextScale } = useSettingStore()
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [, setDisplayedText] = useState<string>('');
  const animationRef = useRef<number | null>(null);
  const displayedTextRef = useRef('');
  const targetTextRef = useRef('');
  const carryCharsRef = useRef(0);
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastRenderTimeRef = useRef(0);
  const md = useRef<MarkdownIt | null>(null);
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
  const previewStyle = useMemo<React.CSSProperties & Record<'--chat-content-font-size', string>>(
    () => ({
      fontSize: chatContentFontSize,
      '--chat-content-font-size': chatContentFontSize,
    }),
    [chatContentFontSize],
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
      typographer: true,
      highlight: function (str, lang): string {
        if (lang && hljs.getLanguage(lang)) {
          try {
            const themeClass = mdTheme === 'dark' ? 'hljs-dark' : 'hljs-light';
            return `<pre class="hljs ${themeClass}"><code>` +
              hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            '</code></pre>';
          } catch {}
        }
        const themeClass = mdTheme === 'dark' ? 'hljs-dark' : 'hljs-light';
        return `<pre class="hljs ${themeClass}"><code>` +
          markdown.utils.escapeHtml(str) +
          '</code></pre>';
      }
    }).use(katex, {
      throwOnError: false,
      errorColor: '#cc0000'
    });

    const defaultFence = markdown.renderer.rules.fence!;
    markdown.renderer.rules.fence = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      const lang = getFenceLanguage(token.info);

      if (!streaming && (lang === 'mermaid' || lang === 'mmd')) {
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

    markdown.renderer.rules.link_open = function (tokens, idx, options, _env, self) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      return self.renderToken(tokens, idx, options);
    }

    md.current = markdown;

    if (displayedTextRef.current) {
      setHtmlContent(md.current.render(preprocessMarkdown(displayedTextRef.current)));
    } else {
      setHtmlContent('');
    }
  }, [mdTheme, streaming]);

  const renderDisplayedText = useCallback((nextText: string, force = false) => {
    displayedTextRef.current = nextText;

    if (!force) {
      const now = performance.now();
      if (now - lastRenderTimeRef.current < MIN_RENDER_INTERVAL_MS) {
        return;
      }
      lastRenderTimeRef.current = now;
    } else {
      lastRenderTimeRef.current = performance.now();
    }

    setDisplayedText(nextText);
    if (md.current) {
      setHtmlContent(md.current.render(preprocessMarkdown(nextText)));
    } else {
      setHtmlContent(nextText);
    }
  }, []);

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
      renderDisplayedText(targetTextRef.current, true);
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
      targetTextRef.current = text;
      renderDisplayedText(text, true);
      return;
    }

    targetTextRef.current = text;

    if (text.length < displayedTextRef.current.length) {
      stopAnimation();
      renderDisplayedText(text, true);
      return;
    }

    if (text.length === displayedTextRef.current.length) {
      if (text !== displayedTextRef.current) {
        renderDisplayedText(text, true);
      }
      return;
    }

    ensureStreamingAnimation();
  }, [text, streaming, ensureStreamingAnimation, renderDisplayedText, stopAnimation]);

  // 清理动画
  useEffect(() => {
    return () => {
      stopAnimation();
    };
  }, [stopAnimation]);

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

  const getMermaidContainer = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return null
    return target.closest<HTMLDivElement>('.mermaid-canvas-container')
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
    const viewport = container.querySelector<HTMLDivElement>('.mermaid-canvas-viewport')
    if (!viewport) return
    viewport.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`
  }, [getMermaidViewState])

  const handleMermaidToolbarClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest<HTMLButtonElement>('.mermaid-canvas-btn')
    if (!button) return

    const container = getMermaidContainer(button)
    if (!container) return

    event.preventDefault()
    event.stopPropagation()

    const state = getMermaidViewState(container)
    const svg = getMermaidDiagramSvg(container)

    if (button.classList.contains('mermaid-canvas-zoom-in')) {
      state.scale = Math.min(4, state.scale + 0.2)
      applyMermaidTransform(container)
      return
    }

    if (button.classList.contains('mermaid-canvas-zoom-out')) {
      state.scale = Math.max(0.25, state.scale - 0.2)
      applyMermaidTransform(container)
      return
    }

    if (button.classList.contains('mermaid-canvas-reset')) {
      state.scale = 1
      state.translateX = 0
      state.translateY = 0
      applyMermaidTransform(container)
      return
    }

    if (button.classList.contains('mermaid-canvas-open')) {
      if (!svg) return
      setMermaidViewer({
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

    if (button.classList.contains('mermaid-canvas-copy')) {
      if (!svg) return
      try {
        await navigator.clipboard.writeText(svg.outerHTML)
        button.classList.add('copied')
        setTimeout(() => button.classList.remove('copied'), 1500)
      } catch (err) {
        console.error('复制失败:', err)
      }
      return
    }

    if (button.classList.contains('mermaid-canvas-export')) {
      if (!svg) return
      try {
        const svgData = new XMLSerializer().serializeToString(svg)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const img = new Image()

        img.onload = () => {
          canvas.width = img.width * 2
          canvas.height = img.height * 2
          ctx?.scale(2, 2)
          ctx?.drawImage(img, 0, 0)
          const url = canvas.toDataURL('image/png')
          const link = document.createElement('a')
          link.href = url
          link.download = 'mermaid-chart.png'
          link.click()
          URL.revokeObjectURL(url)
          button.classList.add('exported')
          setTimeout(() => button.classList.remove('exported'), 1500)
        }

        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
      } catch (err) {
        console.error('导出失败:', err)
      }
    }
  }, [applyMermaidTransform, getMermaidContainer, getMermaidViewState])

  useEffect(() => {
    const el = previewRef.current
    if (!el) return

    const handleWheel = (event: WheelEvent) => {
      const container = getMermaidContainer(event.target)
      if (!container) return

      event.preventDefault()
      const state = getMermaidViewState(container)
      const delta = event.deltaY > 0 ? -0.1 : 0.1
      state.scale = Math.min(4, Math.max(0.25, state.scale + delta))
      applyMermaidTransform(container)
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.mermaid-canvas-controls')) return

      const container = getMermaidContainer(target)
      if (!container || event.button !== 0) return

      const renderArea = container.querySelector<HTMLDivElement>('.mermaid-canvas-render')
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
      const renderArea = container.querySelector<HTMLDivElement>('.mermaid-canvas-render')
      renderArea?.releasePointerCapture?.(event.pointerId)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', endPointerDrag)
    el.addEventListener('pointercancel', endPointerDrag)

    return () => {
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('pointerdown', handlePointerDown)
      el.removeEventListener('pointermove', handlePointerMove)
      el.removeEventListener('pointerup', endPointerDrag)
      el.removeEventListener('pointercancel', endPointerDrag)
    }
  }, [
    applyMermaidTransform,
    getMermaidContainer,
    getMermaidViewState,
  ])

  // 渲染 Mermaid 图表并添加交互控制
  useLayoutEffect(() => {
    if (streaming) return

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
            const { svg, repaired } = await renderMermaidSvg(mermaid, source, id)
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
            renderArea.innerHTML = `<div class="chat-mermaid-error">${md.current ? md.current.utils.escapeHtml(msg) : msg}</div>`
          }
        }
        if (renderedFreshDiagram && !cancelled && md.current) {
          setHtmlContent(md.current.render(preprocessMarkdown(displayedTextRef.current)));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        containers.forEach((container) => {
          const renderArea = container.querySelector('.mermaid-canvas-render') as HTMLDivElement;
          if (renderArea) {
            renderArea.innerHTML = `<div class="chat-mermaid-error">${md.current ? md.current.utils.escapeHtml(msg) : msg}</div>`
          }
        })
      }
    })()

    return () => {
      cancelled = true;
    }
  }, [applyMermaidTransform, getMermaidViewState, htmlContent, mdTheme, streaming])

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
    if (mdTheme === 'dark') {
      return 'markdown-body markdown-dark';
    }
    return 'markdown-body';
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
  if (!text || !text.trim()) {
    return null
  }

  return (
    <div className={className || "flex-1 max-w-[calc(100vw-30px)] md:max-w-[calc(100vw-440px)]"}>
      <div 
        ref={previewRef}
        className={getThemeClass()}
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
          aria-label="Mermaid 图表查看器"
        >
          <div className="mermaid-viewer-header">
            <div className="mermaid-viewer-title">Mermaid 图表</div>
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
