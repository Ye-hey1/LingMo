import type { ArtifactInputFormat, ArtifactTemplateId } from './artifacts/types'

export type VisualReportType = 'general' | 'note' | 'project' | 'diff' | 'research' | 'plan'

export interface VisualReportSection {
  title: string
  body?: string
  bullets?: string[]
  importance?: 'low' | 'medium' | 'high'
}

export interface BuildVisualReportOptions {
  title: string
  subtitle?: string
  content?: string
  sections?: VisualReportSection[]
  reportType?: VisualReportType
  templateId?: ArtifactTemplateId | string
  sourceFormat?: ArtifactInputFormat | string
  sourceLabel?: string
  generatedAt?: Date
}

const REPORT_TYPE_LABELS: Record<VisualReportType, string> = {
  general: '可视化解释',
  note: '笔记解释',
  project: '项目解读',
  diff: '变更评审',
  research: '研究综述',
  plan: '执行计划',
}

const REPORT_ACCENTS: Record<VisualReportType, { primary: string; secondary: string; soft: string }> = {
  general: { primary: '#2563eb', secondary: '#0f766e', soft: '#eff6ff' },
  note: { primary: '#7c3aed', secondary: '#0891b2', soft: '#f5f3ff' },
  project: { primary: '#0f766e', secondary: '#2563eb', soft: '#ecfdf5' },
  diff: { primary: '#dc2626', secondary: '#9333ea', soft: '#fef2f2' },
  research: { primary: '#1d4ed8', secondary: '#7c3aed', soft: '#eef2ff' },
  plan: { primary: '#ca8a04', secondary: '#0f766e', soft: '#fefce8' },
}

const TEMPLATE_LABELS: Record<ArtifactTemplateId, string> = {
  'article-report': '视觉报告',
  'data-report': '数据报告',
  'deck-brief': '演示简报',
  'poster-card': '海报卡片',
}

function normalizeTemplateId(value: unknown): ArtifactTemplateId {
  return value === 'data-report' ||
    value === 'deck-brief' ||
    value === 'poster-card'
    ? value
    : 'article-report'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function splitContentIntoSections(content: string): VisualReportSection[] {
  const normalized = content.trim()
  if (!normalized) {
    return []
  }

  const headingBlocks = normalized.split(/\n(?=#{1,3}\s+)/g)
  if (headingBlocks.length > 1) {
    return headingBlocks
      .map((block) => {
        const lines = block.trim().split(/\r?\n/)
        const rawTitle = lines.shift() || ''
        const title = rawTitle.replace(/^#{1,3}\s+/, '').trim()
        const bodyLines = lines.filter(Boolean)
        const bullets = bodyLines
          .filter((line) => /^\s*[-*+]\s+/.test(line))
          .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim())
        const body = bodyLines
          .filter((line) => !/^\s*[-*+]\s+/.test(line))
          .join('\n')
          .trim()

        return {
          title: title || '未命名章节',
          body,
          bullets,
          importance: inferImportance(`${title}\n${body}\n${bullets.join('\n')}`),
        }
      })
      .filter((section) => section.body || section.bullets?.length)
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  return paragraphs.slice(0, 8).map((paragraph, index) => ({
    title: index === 0 ? '核心概览' : `要点 ${index + 1}`,
    body: paragraph,
    bullets: extractBullets(paragraph),
    importance: inferImportance(paragraph),
  }))
}

function extractBullets(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim())
    .slice(0, 8)
}

function inferImportance(content: string): VisualReportSection['importance'] {
  if (/关键|核心|重要|风险|阻塞|失败|必须|high|critical|risk|block/i.test(content)) {
    return 'high'
  }
  if (/建议|注意|计划|下一步|优化|medium|todo|next/i.test(content)) {
    return 'medium'
  }
  return 'low'
}

function normalizeSections(sections: unknown, content: string): VisualReportSection[] {
  if (Array.isArray(sections)) {
    const normalized = sections
      .map((section): VisualReportSection | null => {
        if (!section || typeof section !== 'object') {
          return null
        }

        const item = section as Record<string, unknown>
        const title = normalizeText(item.title)
        if (!title) {
          return null
        }

        const bullets = Array.isArray(item.bullets)
          ? item.bullets.map(normalizeText).filter(Boolean).slice(0, 10)
          : undefined
        const body = normalizeText(item.body)
        const rawImportance = normalizeText(item.importance)
        const importance = rawImportance === 'high' || rawImportance === 'medium' || rawImportance === 'low'
          ? rawImportance
          : inferImportance(`${title}\n${body}\n${bullets?.join('\n') || ''}`)

        return { title, body, bullets, importance }
      })
      .filter((section): section is VisualReportSection => Boolean(section))

    if (normalized.length > 0) {
      return normalized
    }
  }

  return splitContentIntoSections(content)
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getSectionIcon(section: VisualReportSection, index: number): string {
  if (section.importance === 'high') return '!'
  if (section.importance === 'medium') return '>'
  return String(index + 1)
}

function buildSummaryMetrics(sections: VisualReportSection[]) {
  const high = sections.filter((section) => section.importance === 'high').length
  const medium = sections.filter((section) => section.importance === 'medium').length
  const bullets = sections.reduce((sum, section) => sum + (section.bullets?.length || 0), 0)
  return { high, medium, bullets }
}

export function buildVisualReportHtml(options: BuildVisualReportOptions): string {
  const reportType = options.reportType || 'general'
  const accent = REPORT_ACCENTS[reportType] || REPORT_ACCENTS.general
  const templateId = normalizeTemplateId(options.templateId)
  const templateLabel = TEMPLATE_LABELS[templateId]
  const title = normalizeText(options.title) || '可视化解释页'
  const subtitle = normalizeText(options.subtitle)
  const sourceLabel = normalizeText(options.sourceLabel)
  const sourceFormat = normalizeText(options.sourceFormat)
  const content = normalizeText(options.content)
  const sections = normalizeSections(options.sections, content)
  const metrics = buildSummaryMetrics(sections)
  const generatedAt = formatDate(options.generatedAt || new Date())
  const fallbackBody = content || '暂无正文内容。'
  const countLabel = templateId === 'deck-brief' ? '页数' : templateId === 'poster-card' ? '模块' : '章节'

  const sectionCards = (sections.length > 0 ? sections : [{
    title: '核心内容',
    body: fallbackBody,
    bullets: extractBullets(fallbackBody),
    importance: inferImportance(fallbackBody),
  } satisfies VisualReportSection]).map((section, index) => {
    const importance = section.importance || 'low'
    const bullets = section.bullets?.length
      ? `<ul>${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p>${escapeHtml(section.body).replace(/\n/g, '<br>')}</p>`
      : ''

    return `
      <article class="section-card importance-${importance}">
        <div class="section-index">${escapeHtml(getSectionIcon(section, index))}</div>
        <div>
          <div class="section-meta">${importance === 'high' ? '重点' : importance === 'medium' ? '关注' : '信息'}</div>
          <h2>${escapeHtml(section.title)}</h2>
          ${body}
          ${bullets}
        </div>
      </article>`
  }).join('\n')

  const timelineItems = sections.slice(0, 6).map((section, index) => `
    <li>
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong>${escapeHtml(section.title)}</strong>
    </li>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --primary: ${accent.primary};
      --secondary: ${accent.secondary};
      --soft: ${accent.soft};
      --text: #111827;
      --muted: #667085;
      --line: #e5e7eb;
      --panel: rgba(255, 255, 255, 0.92);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: linear-gradient(135deg, #f8fafc 0%, var(--soft) 46%, #ffffff 100%);
      letter-spacing: 0;
    }
    .page {
      width: min(1180px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 40px 0 56px;
    }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 28px;
      align-items: end;
      padding: 34px;
      border: 1px solid rgba(17, 24, 39, 0.08);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      color: var(--primary);
      font-size: 13px;
      font-weight: 700;
    }
    .eyebrow::before {
      content: "";
      width: 22px;
      height: 3px;
      border-radius: 999px;
      background: var(--primary);
    }
    h1 {
      margin: 0;
      max-width: 860px;
      font-size: clamp(34px, 6vw, 72px);
      line-height: 0.96;
      letter-spacing: 0;
    }
    .subtitle {
      max-width: 780px;
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.7;
    }
    .meta {
      min-width: 210px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.8;
      text-align: right;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .metric {
      min-height: 96px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.74);
    }
    .metric span {
      color: var(--muted);
      font-size: 12px;
    }
    .metric strong {
      display: block;
      margin-top: 8px;
      font-size: 30px;
      line-height: 1;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 18px;
      margin-top: 18px;
    }
    .section-stack {
      display: grid;
      gap: 12px;
    }
    .section-card {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 16px;
      padding: 22px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.05);
    }
    .section-index {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      color: #fff;
      background: var(--primary);
      font-weight: 800;
    }
    .importance-high .section-index { background: #dc2626; }
    .importance-medium .section-index { background: #ca8a04; }
    .section-meta {
      margin-bottom: 8px;
      color: var(--secondary);
      font-size: 12px;
      font-weight: 800;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #344054;
      font-size: 14px;
      line-height: 1.8;
    }
    ul {
      margin: 14px 0 0;
      padding-left: 19px;
      color: #344054;
      line-height: 1.75;
      font-size: 14px;
    }
    aside {
      position: sticky;
      top: 16px;
      align-self: start;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .aside-head {
      padding: 18px;
      color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
    }
    .aside-head strong {
      display: block;
      font-size: 18px;
    }
    .timeline {
      margin: 0;
      padding: 12px 18px 18px;
      list-style: none;
    }
    .timeline li {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
    }
    .timeline li:last-child { border-bottom: 0; }
    .timeline span {
      color: var(--primary);
      font-size: 12px;
      font-weight: 800;
    }
    .timeline strong {
      font-size: 13px;
      line-height: 1.45;
    }
    footer {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }
    body.template-data-report .metric-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    body.template-data-report .layout {
      grid-template-columns: 1fr;
    }
    body.template-data-report .section-stack {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    body.template-data-report .section-card {
      min-height: 210px;
    }
    body.template-deck-brief {
      background: #f4f7fb;
    }
    body.template-deck-brief .page {
      width: min(1280px, calc(100vw - 40px));
    }
    body.template-deck-brief .section-stack {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    body.template-deck-brief .section-card {
      min-height: 300px;
      align-content: start;
    }
    body.template-deck-brief .section-card h2 {
      font-size: 28px;
    }
    body.template-poster-card {
      color: #f8fafc;
      background: radial-gradient(circle at 20% 10%, rgba(37, 99, 235, 0.28), transparent 30%),
        linear-gradient(135deg, #111827 0%, #172033 54%, #0f172a 100%);
    }
    body.template-poster-card .page {
      width: min(960px, calc(100vw - 32px));
      padding-top: 28px;
    }
    body.template-poster-card header,
    body.template-poster-card .metric,
    body.template-poster-card .section-card,
    body.template-poster-card aside {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.16);
      box-shadow: none;
    }
    body.template-poster-card h1,
    body.template-poster-card h2,
    body.template-poster-card .timeline strong {
      color: #f8fafc;
    }
    body.template-poster-card p,
    body.template-poster-card ul,
    body.template-poster-card .subtitle,
    body.template-poster-card .meta,
    body.template-poster-card .metric span,
    body.template-poster-card footer {
      color: #cbd5e1;
    }
    body.template-poster-card .section-stack {
      grid-template-columns: 1fr;
    }
    body.template-poster-card .section-card:first-child {
      min-height: 280px;
    }
    @media (max-width: 860px) {
      .page { width: min(100vw - 24px, 720px); padding-top: 20px; }
      header { grid-template-columns: 1fr; padding: 24px; }
      .meta { text-align: left; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .layout { grid-template-columns: 1fr; }
      body.template-data-report .section-stack,
      body.template-deck-brief .section-stack {
        grid-template-columns: 1fr;
      }
      aside { position: static; }
    }
    @media (max-width: 520px) {
      .metric-grid { grid-template-columns: 1fr; }
      .section-card { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body class="template-${escapeHtml(templateId)}">
  <main class="page">
    <header>
      <div>
        <div class="eyebrow">${escapeHtml(templateLabel)} · ${escapeHtml(REPORT_TYPE_LABELS[reportType] || REPORT_TYPE_LABELS.general)}</div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <div class="meta">
        <div>生成时间：${escapeHtml(generatedAt)}</div>
        ${sourceLabel ? `<div>来源：${escapeHtml(sourceLabel)}</div>` : ''}
        ${sourceFormat ? `<div>输入：${escapeHtml(sourceFormat)}</div>` : ''}
        <div>模板：${escapeHtml(templateLabel)}</div>
        <div>格式：Self-contained HTML</div>
      </div>
    </header>

    <section class="metric-grid" aria-label="报告指标">
      <div class="metric"><span>${escapeHtml(countLabel)}</span><strong>${sections.length || 1}</strong></div>
      <div class="metric"><span>重点</span><strong>${metrics.high}</strong></div>
      <div class="metric"><span>关注项</span><strong>${metrics.medium}</strong></div>
      <div class="metric"><span>要点</span><strong>${metrics.bullets}</strong></div>
    </section>

    <section class="layout">
      <div class="section-stack">
        ${sectionCards}
      </div>
      <aside>
        <div class="aside-head">
          <strong>阅读路径</strong>
          <span>按重要程度快速扫描</span>
        </div>
        <ol class="timeline">${timelineItems}</ol>
      </aside>
    </section>

    <footer>Generated by LingMo Visual Report</footer>
  </main>
</body>
</html>`
}

export function ensureVisualReportFileName(fileName: string | undefined, title: string): string {
  const raw = normalizeText(fileName) || normalizeText(title) || 'visual-report'
  const withoutExtension = raw.replace(/\.html?$/i, '')
  const safe = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'visual-report'

  return `${safe}.html`
}
