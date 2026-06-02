'use client'

import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import MarkdownIt from 'markdown-it'
import katex from '@traptitech/markdown-it-katex'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { save } from '@tauri-apps/plugin-dialog'
import { readFile, readTextFile, writeFile } from '@tauri-apps/plugin-fs'

import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const PAGE_PADDING_X = 44
const PAGE_PADDING_Y = 48
const PAGE_CONTENT_WIDTH = A4_WIDTH - PAGE_PADDING_X * 2
const PAGE_CONTENT_HEIGHT = A4_HEIGHT - PAGE_PADDING_Y * 2
const PAGE_PIXEL_RATIO = 1.65

let markdownRenderer: MarkdownIt | null = null
let languagesRegistered = false

export interface MarkdownPdfExportResult {
  outputPath: string
  pageCount: number
}

export interface MarkdownPdfExportOptions {
  defaultFileName?: string
  markdownPath?: string
  title?: string
}

function registerLanguages() {
  if (languagesRegistered) return
  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('css', css)
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('js', javascript)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('ts', typescript)
  hljs.registerLanguage('html', xml)
  hljs.registerLanguage('xml', xml)
  languagesRegistered = true
}

function getMarkdownRenderer() {
  if (markdownRenderer) return markdownRenderer
  registerLanguages()
  markdownRenderer = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: (content, lang) => {
      const escaped = markdownRenderer?.utils.escapeHtml(content) || content
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs" data-code-lang="${markdownRenderer?.utils.escapeHtml(lang) || lang}"><code>${hljs.highlight(content, { language: lang, ignoreIllegals: true }).value}</code></pre>`
        } catch {
          return `<pre class="hljs"><code>${escaped}</code></pre>`
        }
      }
      return `<pre class="hljs"><code>${escaped}</code></pre>`
    },
  }).use(katex, {
    throwOnError: false,
    errorColor: '#cc0000',
  })

  markdownRenderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
    return self.renderToken(tokens, idx, options)
  }

  return markdownRenderer
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function splitMarkdownTableRow(row: string) {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let escaped = false

  for (const char of trimmed) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line)
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function normalizeMarkdownTables(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []

  for (let index = 0; index < lines.length;) {
    const headerLine = lines[index]
    const separatorLine = lines[index + 1]

    if (
      headerLine?.includes('|') &&
      separatorLine?.includes('|') &&
      isMarkdownTableSeparator(separatorLine)
    ) {
      const headerCells = splitMarkdownTableRow(headerLine)
      const rows: string[][] = []
      let cursor = index + 2

      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim() !== '') {
        rows.push(splitMarkdownTableRow(lines[cursor]))
        cursor += 1
      }

      output.push('<table>')
      output.push('<thead>')
      output.push(`<tr>${headerCells.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr>`)
      output.push('</thead>')
      if (rows.length > 0) {
        output.push('<tbody>')
        for (const row of rows) {
          output.push(`<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        }
        output.push('</tbody>')
      }
      output.push('</table>')
      index = cursor
      continue
    }

    output.push(lines[index])
    index += 1
  }

  return output.join('\n')
}

function getDefaultPdfPath(markdownPath: string) {
  const normalized = markdownPath.replace(/\\/g, '/')
  const filename = normalized.split('/').pop() || 'document.md'
  return filename.replace(/\.(md|markdown)$/i, '') + '.pdf'
}

function getDefaultPdfNameFromTitle(title?: string) {
  const fallback = 'document.pdf'
  if (!title) return fallback
  const name = title.replace(/\\/g, '/').split('/').pop()?.replace(/\.(md|markdown)$/i, '') || 'document'
  return `${name}.pdf`
}

function getSafeDefaultPdfPath(value?: string) {
  if (!value) return getDefaultPdfNameFromTitle()
  const normalized = value.replace(/\\/g, '/')
  const filename = normalized.split('/').pop() || 'document.pdf'
  return filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`
}

function getMimeType(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  if (extension === 'bmp') return 'image/bmp'
  return 'application/octet-stream'
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return window.btoa(binary)
}

function normalizePathParts(path: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

function resolveRelativeAssetPath(markdownPath: string, assetPath: string) {
  const cleanAssetPath = assetPath.split('#')[0].split('?')[0].replace(/\\/g, '/')
  if (!cleanAssetPath || cleanAssetPath.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/i.test(cleanAssetPath) || cleanAssetPath.startsWith('/')) {
    return null
  }

  const baseDir = markdownPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  return normalizePathParts(`${baseDir}/${decodeURIComponent(cleanAssetPath)}`)
}

async function inlineLocalImages(container: HTMLElement, markdownPath?: string) {
  if (!markdownPath) return

  const workspace = await getWorkspacePath()
  const images = Array.from(container.querySelectorAll('img'))

  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute('src') || ''
    const relativePath = resolveRelativeAssetPath(markdownPath, src)
    if (!relativePath) return

    try {
      const pathOptions = await getFilePathOptions(relativePath)
      const bytes = workspace.isCustom
        ? await readFile(pathOptions.path)
        : await readFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      image.src = `data:${getMimeType(relativePath)};base64,${bytesToBase64(bytes)}`
    } catch {
      image.alt = image.alt || src
    }
  }))
}

async function waitForImages(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll('img'))
  await Promise.all(images.map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return
    try {
      await image.decode()
      return
    } catch {
      // Fall back to load/error listeners below for WebView edge cases.
    }

    await new Promise<void>((resolve) => {
      const finish = () => resolve()
      image.addEventListener('load', finish, { once: true })
      image.addEventListener('error', finish, { once: true })
      window.setTimeout(finish, 5000)
    })
  }))
}

function getPdfStyles() {
  return `
    .markdown-pdf-root,
    .markdown-pdf-root * {
      box-sizing: border-box;
    }

    .markdown-pdf-root {
      width: ${PAGE_CONTENT_WIDTH}px;
      color: #20242a;
      background: #ffffff;
      font-family: "Segoe UI", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 13px;
      line-height: 1.72;
      overflow-wrap: break-word;
    }

    .markdown-pdf-page {
      position: fixed;
      left: -10000px;
      top: 0;
      width: ${A4_WIDTH}px;
      min-height: ${A4_HEIGHT}px;
      padding: ${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px;
      background: #ffffff;
      color: #20242a;
      font-family: "Segoe UI", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
      box-shadow: none;
      overflow: visible;
    }

    .markdown-pdf-page-content {
      width: ${PAGE_CONTENT_WIDTH}px;
      min-height: ${PAGE_CONTENT_HEIGHT}px;
    }

    .markdown-pdf-root > :first-child,
    .markdown-pdf-page-content > :first-child {
      margin-top: 0 !important;
    }

    .markdown-pdf-root > :last-child,
    .markdown-pdf-page-content > :last-child {
      margin-bottom: 0 !important;
    }

    .markdown-pdf-root h1,
    .markdown-pdf-root h2,
    .markdown-pdf-root h3,
    .markdown-pdf-root h4,
    .markdown-pdf-root h5,
    .markdown-pdf-root h6 {
      color: #111827;
      line-height: 1.32;
      letter-spacing: 0;
      page-break-after: avoid;
      break-after: avoid;
    }

    .markdown-pdf-root h1 {
      margin: 0 0 22px;
      padding-bottom: 14px;
      border-bottom: 1px solid #d8dee4;
      font-size: 27px;
      font-weight: 750;
    }

    .markdown-pdf-root h2 {
      margin: 30px 0 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 21px;
      font-weight: 700;
    }

    .markdown-pdf-root h3 {
      margin: 24px 0 10px;
      font-size: 17px;
      font-weight: 700;
    }

    .markdown-pdf-root h4 {
      margin: 20px 0 8px;
      font-size: 14px;
      font-weight: 700;
    }

    .markdown-pdf-root h5,
    .markdown-pdf-root h6 {
      margin: 18px 0 8px;
      color: #374151;
      font-size: 13px;
      font-weight: 700;
    }

    .markdown-pdf-root p {
      margin: 0 0 12px;
    }

    .markdown-pdf-root a {
      color: #0969da;
      text-decoration: none;
      overflow-wrap: anywhere;
    }

    .markdown-pdf-root strong {
      font-weight: 700;
    }

    .markdown-pdf-root ul,
    .markdown-pdf-root ol {
      margin: 0 0 14px 24px;
      padding: 0;
    }

    .markdown-pdf-root li {
      margin: 4px 0;
      padding-left: 2px;
    }

    .markdown-pdf-root li > p {
      margin: 0 0 6px;
    }

    .markdown-pdf-root blockquote {
      margin: 15px 0;
      padding: 1px 0 1px 14px;
      color: #4b5563;
      border-left: 4px solid #d0d7de;
      background: linear-gradient(90deg, #f8fafc 0, #ffffff 96%);
    }

    .markdown-pdf-root code {
      padding: 0.16em 0.36em;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      background: #f6f8fa;
      color: #24292f;
      font-family: "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 0.91em;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .markdown-pdf-root pre {
      position: relative;
      margin: 16px 0;
      padding: 14px 16px;
      overflow: visible;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere;
      word-break: break-word;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f6f8fa;
      color: #24292f;
      line-height: 1.58;
      page-break-inside: auto;
      break-inside: auto;
    }

    .markdown-pdf-root pre[data-code-lang]::before {
      content: attr(data-code-lang);
      position: absolute;
      top: 7px;
      right: 10px;
      color: #7b8494;
      font-size: 10px;
      line-height: 1;
      text-transform: uppercase;
    }

    .markdown-pdf-root pre code {
      display: block;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font-size: 11.2px;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .markdown-pdf-table-wrap,
    .markdown-pdf-root .tableWrapper {
      display: block;
      width: 100%;
      max-width: 100%;
      margin: 16px 0;
      overflow: visible !important;
    }

    .markdown-pdf-root table {
      width: 100%;
      max-width: 100%;
      margin: 0;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 11.4px;
      line-height: 1.52;
      display: table !important;
      page-break-inside: auto;
      break-inside: auto;
    }

    .markdown-pdf-root colgroup,
    .markdown-pdf-root col {
      width: auto !important;
    }

    .markdown-pdf-root th,
    .markdown-pdf-root td {
      border: 1px solid #d8dee4;
      padding: 7px 8px;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal !important;
      min-width: 0 !important;
      height: auto !important;
    }

    .markdown-pdf-root th > *,
    .markdown-pdf-root td > * {
      margin-top: 0;
      margin-bottom: 0;
    }

    .markdown-pdf-root th {
      background: #f3f4f6;
      color: #111827;
      font-weight: 700;
    }

    .markdown-pdf-root tr:nth-child(2n) td {
      background: #fafafa;
    }

    .markdown-pdf-root img {
      display: block;
      max-width: 100%;
      max-height: 520px;
      width: auto;
      height: auto;
      margin: 16px auto;
      border-radius: 6px;
    }

    .markdown-pdf-root hr {
      height: 1px;
      margin: 26px 0;
      border: 0;
      background: #d8dee4;
    }

    .markdown-pdf-root .katex-display {
      margin: 16px 0;
      overflow: hidden;
    }

    .markdown-pdf-root .hljs-comment,
    .markdown-pdf-root .hljs-quote {
      color: #6a737d;
    }

    .markdown-pdf-root .hljs-keyword,
    .markdown-pdf-root .hljs-selector-tag {
      color: #d73a49;
    }

    .markdown-pdf-root .hljs-string,
    .markdown-pdf-root .hljs-symbol,
    .markdown-pdf-root .hljs-bullet,
    .markdown-pdf-root .hljs-addition {
      color: #032f62;
    }

    .markdown-pdf-root .hljs-title,
    .markdown-pdf-root .hljs-section,
    .markdown-pdf-root .hljs-attribute {
      color: #6f42c1;
    }

    .markdown-pdf-root .hljs-number,
    .markdown-pdf-root .hljs-built_in,
    .markdown-pdf-root .hljs-literal,
    .markdown-pdf-root .hljs-type,
    .markdown-pdf-root .hljs-params,
    .markdown-pdf-root .hljs-meta,
    .markdown-pdf-root .hljs-link {
      color: #0366d6;
    }
  `
}

function createStyleElement() {
  const style = document.createElement('style')
  style.textContent = getPdfStyles()
  return style
}

function createSourceContainer(html: string) {
  const container = document.createElement('article')
  container.className = 'markdown-pdf-root'
  container.innerHTML = html
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = `${PAGE_CONTENT_WIDTH}px`
  container.style.background = '#ffffff'
  container.style.visibility = 'hidden'
  return container
}

function createPageElement() {
  const page = document.createElement('section')
  page.className = 'markdown-pdf-page'
  page.style.position = 'fixed'
  page.style.left = '-10000px'
  page.style.top = '0'

  const content = document.createElement('article')
  content.className = 'markdown-pdf-root markdown-pdf-page-content'
  page.appendChild(content)

  return { page, content }
}

function cloneElementForMeasurement(element: Element) {
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.heading-collapse-toggle, .tableResizeHandle, .column-resize-handle').forEach((node) => node.remove())
  clone.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'))
  normalizeExportDom(clone)
  return clone
}

function normalizeExportDom(container: HTMLElement) {
  container.querySelectorAll('.heading-collapse-toggle, .tableResizeHandle, .column-resize-handle').forEach((node) => node.remove())
  container.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'))

  container.querySelectorAll('pre').forEach((pre) => {
    const element = pre as HTMLElement
    element.style.whiteSpace = 'pre-wrap'
    element.style.overflow = 'visible'
  })

  container.querySelectorAll('pre code').forEach((code) => {
    const element = code as HTMLElement
    element.style.display = 'block'
    element.style.whiteSpace = 'pre-wrap'
    element.style.overflowWrap = 'anywhere'
    element.style.wordBreak = 'break-word'
  })

  container.querySelectorAll('table').forEach((table) => {
    const tableElement = table as HTMLTableElement
    tableElement.style.display = 'table'
    tableElement.style.width = '100%'
    tableElement.style.maxWidth = '100%'
    tableElement.style.tableLayout = 'fixed'
    tableElement.style.borderCollapse = 'collapse'
    tableElement.querySelectorAll('col').forEach((col) => col.removeAttribute('style'))

    if (!tableElement.parentElement?.classList.contains('markdown-pdf-table-wrap') && !tableElement.parentElement?.classList.contains('tableWrapper')) {
      const wrapper = document.createElement('div')
      wrapper.className = 'markdown-pdf-table-wrap'
      tableElement.parentNode?.insertBefore(wrapper, tableElement)
      wrapper.appendChild(tableElement)
    }
  })
}

function paginateSourceElements(source: HTMLElement) {
  const children = Array.from(source.children)
  const pages: HTMLElement[][] = []
  let currentPage: HTMLElement[] = []

  const style = createStyleElement()
  const { page, content: measureContent } = createPageElement()
  document.body.appendChild(style)
  document.body.appendChild(page)

  try {
    for (const child of children) {
      const clone = cloneElementForMeasurement(child)
      measureContent.appendChild(clone)
      const overflowsPage = measureContent.scrollHeight > PAGE_CONTENT_HEIGHT + 2

      if (overflowsPage && currentPage.length > 0) {
        measureContent.removeChild(clone)
        pages.push(currentPage)
        currentPage = [clone]
        measureContent.innerHTML = ''
        measureContent.appendChild(clone)
        continue
      }

      currentPage.push(clone)
    }

    if (currentPage.length > 0) {
      pages.push(currentPage)
    }
  } finally {
    page.remove()
    style.remove()
  }

  return pages.length > 0 ? pages : [[]]
}

function addCanvasPagesToPdf(pdf: jsPDF, canvas: HTMLCanvasElement, shouldAddFirstPage: boolean) {
  const pagePixelHeight = Math.floor((A4_HEIGHT / A4_WIDTH) * canvas.width)
  let sourceY = 0
  let firstSlice = true

  while (sourceY < canvas.height) {
    const sliceHeight = Math.min(pagePixelHeight, canvas.height - sourceY)
    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = canvas.width
    sliceCanvas.height = pagePixelHeight

    const context = sliceCanvas.getContext('2d')
    if (!context) {
      throw new Error('无法创建 PDF 页面画布')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    )

    if (shouldAddFirstPage || !firstSlice) {
      pdf.addPage()
    }

    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92)
    pdf.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH, A4_HEIGHT)

    sourceY += sliceHeight
    firstSlice = false
  }
}

async function renderPageToCanvas(elements: HTMLElement[]) {
  const style = createStyleElement()
  const { page, content } = createPageElement()
  document.body.appendChild(style)
  document.body.appendChild(page)

  try {
    for (const element of elements) {
      content.appendChild(element.cloneNode(true))
    }

    await new Promise(requestAnimationFrame)
    const contentHeight = Math.ceil(Math.max(
      PAGE_CONTENT_HEIGHT,
      content.scrollHeight,
      content.getBoundingClientRect().height,
    ))
    const pageHeight = contentHeight + PAGE_PADDING_Y * 2
    page.style.height = `${pageHeight}px`
    page.style.minHeight = `${pageHeight}px`

    return await html2canvas(page, {
      scale: PAGE_PIXEL_RATIO,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: '#ffffff',
      imageTimeout: 8000,
      windowWidth: A4_WIDTH,
      windowHeight: pageHeight,
      width: A4_WIDTH,
      height: pageHeight,
    })
  } finally {
    page.remove()
    style.remove()
  }
}

async function renderMarkdownToPdfBytes(markdown: string, options: MarkdownPdfExportOptions = {}) {
  const html = getMarkdownRenderer().render(normalizeMarkdownTables(markdown))
  const source = createSourceContainer(html)
  const style = createStyleElement()
  document.body.appendChild(style)
  document.body.appendChild(source)

  try {
    await inlineLocalImages(source, options.markdownPath)
    await waitForImages(source)
    normalizeExportDom(source)
    await new Promise(requestAnimationFrame)

    source.style.visibility = 'visible'
    const pages = paginateSourceElements(source)

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
      compress: true,
    })

    let pageCount = 0
    for (let index = 0; index < pages.length; index += 1) {
      const canvas = await renderPageToCanvas(pages[index])
      const pagesBefore = pdf.getNumberOfPages()
      addCanvasPagesToPdf(pdf, canvas, index > 0)
      pageCount += pdf.getNumberOfPages() - pagesBefore + (index === 0 ? 1 : 0)
    }

    return {
      bytes: new Uint8Array(pdf.output('arraybuffer')),
      pageCount: Math.max(1, pageCount),
    }
  } finally {
    source.remove()
    style.remove()
  }
}

export async function exportMarkdownToPdf(markdown: string, options: MarkdownPdfExportOptions = {}): Promise<MarkdownPdfExportResult | null> {
  const selectedPath = await save({
    title: '另存为 PDF',
    defaultPath: options.defaultFileName ? getSafeDefaultPdfPath(options.defaultFileName) : getDefaultPdfNameFromTitle(options.title),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  if (!selectedPath) {
    return null
  }

  const outputPath = selectedPath.toLowerCase().endsWith('.pdf') ? selectedPath : `${selectedPath}.pdf`
  const result = await renderMarkdownToPdfBytes(markdown, options)
  await writeFile(outputPath, result.bytes)
  return {
    outputPath,
    pageCount: result.pageCount,
  }
}

export async function exportMarkdownFileToPdf(markdownPath: string) {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(markdownPath)
  const markdown = workspace.isCustom
    ? await readTextFile(pathOptions.path)
    : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

  return exportMarkdownToPdf(markdown, {
    defaultFileName: getDefaultPdfPath(markdownPath),
    markdownPath,
    title: markdownPath,
  })
}
