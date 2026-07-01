export type OutputLintSeverity = 'error' | 'warning' | 'info'

export interface OutputLintFinding {
  severity: OutputLintSeverity
  id: string
  message: string
  fix: string
  category?: 'structure' | 'content' | 'style' | 'accessibility'
}

export interface OutputLintResult {
  findings: OutputLintFinding[]
  severeFindings: OutputLintFinding[]
  repairPrompt: string
}

export interface OutputLintOptions {
  templateId?: string
}

const DEFAULT_AI_GRADIENT_RE = /linear-gradient\([^)]*(#(?:6366f1|4f46e5|7c3aed|8b5cf6|a855f7|ec4899)|purple|violet|indigo|pink)[^)]*\)/i
const FILLER_RE = /\b(lorem ipsum|dolor sit amet|placeholder text|sample content|feature one|feature two|feature three)\b/i
const FAKE_METRIC_RE = /\b(?:10x|10×|100x|100×|99\.\d+%|zero[- ]downtime|3x|3×)\b/i
const EXTERNAL_PLACEHOLDER_IMAGE_RE = /<img[^>]+src=["']https?:\/\/(?:images\.unsplash\.com|placehold\.co|via\.placeholder\.com|picsum\.photos|loremflickr\.com)/i
const VIEWPORT_META_RE = /<meta[^>]+name=["']viewport["'][^>]*>/i
const CHARSET_META_RE = /<meta[^>]+charset=["'][^"']+["'][^>]*>/i
const H1_RE = /<h1\b/gi
const HEADING_RE = /<h[1-6]\b/gi
const CARD_LIKE_RE = /class=["'][^"']*(?:\bcard\b|\bpanel\b|\bblock\b|\bmodule\b|\btile\b)[^"']*["']/gi
const AUTO_REDBOOK_TEMPLATE_RE = /^social-redbook-/
const AUTO_REDBOOK_COVER_RE = /class=["'][^"']*\bcover-container\b[^"']*["'][^>]*data-redbook-card=["']cover["']|data-redbook-card=["']cover["'][^>]*class=["'][^"']*\bcover-container\b/gi
const AUTO_REDBOOK_BODY_CARD_RE = /class=["'][^"']*\bcard-container\b[^"']*["'][^>]*data-redbook-card=["']\d+["']|data-redbook-card=["']\d+["'][^>]*class=["'][^"']*\bcard-container\b/gi

function hasDocumentShell(html: string): boolean {
  return /<!doctype\s+html\b/i.test(html) && /<html\b/i.test(html) && /<head\b/i.test(html) && /<body\b/i.test(html)
}

function hasReducedMotion(html: string): boolean {
  return /prefers-reduced-motion\s*:\s*reduce/i.test(html)
}

function isProbablyCssOnly(html: string): boolean {
  const trimmed = html.trim()
  return !/<(?:html|body|main|section|article|div|h1|p)\b/i.test(trimmed)
    && /[.#:\]\w-]+\s*\{[^{}]*:[^{}]+;?[^{}]*\}/.test(trimmed)
}

function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  const matches = text.match(re)
  return matches?.length ?? 0
}

function extractBodyText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasHeadingHierarchy(html: string): boolean {
  return countMatches(html, H1_RE) > 0 || countMatches(html, HEADING_RE) > 2
}

function hasLikelyOverdenseLayout(html: string): boolean {
  const cardLikeCount = countMatches(html, CARD_LIKE_RE)
  const headingCount = countMatches(html, HEADING_RE)
  return cardLikeCount >= 14 || headingCount >= 18
}

function hasLikelyMissingViewport(html: string): boolean {
  return hasDocumentShell(html) && !VIEWPORT_META_RE.test(html)
}

function hasLikelyMissingCharset(html: string): boolean {
  return hasDocumentShell(html) && !CHARSET_META_RE.test(html)
}

function isAutoRedbookTemplate(templateId?: string): boolean {
  return Boolean(templateId && AUTO_REDBOOK_TEMPLATE_RE.test(templateId))
}

function hasAutoRedbookCardStructure(html: string): boolean {
  const coverCount = countMatches(html, AUTO_REDBOOK_COVER_RE)
  const bodyCardCount = countMatches(html, AUTO_REDBOOK_BODY_CARD_RE)
  return /class=["'][^"']*\bredbook-deck\b/i.test(html)
    && /class=["'][^"']*\bcover-container\b/i.test(html)
    && /class=["'][^"']*\bcard-content-scale\b/i.test(html)
    && coverCount >= 1
    && bodyCardCount >= 3
}

function buildAutoRedbookRepairInstruction(): string {
  return [
    '必须重构为 Auto-Redbook 组图结构：body 内使用 .redbook-deck，包含 1 张 .cover-container 与至少 3 张 .card-container。',
    '每张卡都必须带 data-redbook-card，并固定为 1080px × 1440px。',
    '每张卡内部必须是 .card-inner > .card-content > .card-content-scale。',
    '不要输出普通 .container 长网页、桌面报告、瀑布流或平铺 section。',
  ].join(' ')
}

function buildRepairPrompt(findings: OutputLintFinding[]): string {
  if (findings.length === 0) return ''

  const severe = findings.filter((finding) => finding.severity === 'error')
  const warnings = findings.filter((finding) => finding.severity === 'warning')
  const infos = findings.filter((finding) => finding.severity === 'info')

  const sections: string[] = []

  if (severe.length) {
    sections.push([
      '【必须修复】',
      ...severe.map((finding) => `- ${finding.id}：${finding.message}｜修复：${finding.fix}`),
    ].join('\n'))
  }

  if (warnings.length) {
    sections.push([
      '【建议修复】',
      ...warnings.map((finding) => `- ${finding.id}：${finding.message}｜修复：${finding.fix}`),
    ].join('\n'))
  }

  if (infos.length) {
    sections.push([
      '【补充优化】',
      ...infos.map((finding) => `- ${finding.id}：${finding.message}｜修复：${finding.fix}`),
    ].join('\n'))
  }

  return sections.join('\n\n')
}

export function lintOutputWorkshopHtml(html: string, options: OutputLintOptions = {}): OutputLintResult {
  const findings: OutputLintFinding[] = []
  const trimmed = html.trim()
  const bodyText = extractBodyText(trimmed)
  const autoRedbook = isAutoRedbookTemplate(options.templateId)

  if (trimmed.length < 500) {
    findings.push({
      severity: 'error',
      id: 'too-short',
      category: 'structure',
      message: '生成结果过短，可能是残缺片段。',
      fix: '返回完整自包含 HTML，包含真实内容、样式和主体结构。',
    })
  }

  if (!hasDocumentShell(trimmed)) {
    findings.push({
      severity: 'error',
      id: 'missing-shell',
      category: 'structure',
      message: '缺少完整 HTML 文档外壳。',
      fix: '补齐 <!DOCTYPE html>、html、head、meta viewport、style 和 body。',
    })
  }

  if (hasDocumentShell(trimmed) && !hasHeadingHierarchy(trimmed) && bodyText.length > 240) {
    findings.push({
      severity: 'warning',
      id: 'missing-heading-hierarchy',
      category: 'structure',
      message: '页面内容较多，但标题层级不明显。',
      fix: '补齐 h1/h2/h3 的层级关系，让页面先有标题骨架再展开内容。',
    })
  }

  if (hasLikelyMissingCharset(trimmed)) {
    findings.push({
      severity: 'warning',
      id: 'missing-charset',
      category: 'structure',
      message: '缺少字符集声明，可能影响中文或特殊符号渲染。',
      fix: '在 head 中加入 <meta charset="utf-8">。',
    })
  }

  if (hasLikelyMissingViewport(trimmed)) {
    findings.push({
      severity: 'warning',
      id: 'missing-viewport',
      category: 'structure',
      message: '缺少 viewport 配置，移动端缩放与安全区可能不稳定。',
      fix: '在 head 中加入 <meta name="viewport" content="width=device-width, initial-scale=1">。',
    })
  }

  if (isProbablyCssOnly(trimmed)) {
    findings.push({
      severity: 'error',
      id: 'css-only',
      category: 'structure',
      message: '生成结果像 CSS 片段而不是页面。',
      fix: '保留 CSS，但必须补齐 HTML 主体内容。',
    })
  }

  if (bodyText.length < 120) {
    findings.push({
      severity: 'error',
      id: 'body-too-empty',
      category: 'content',
      message: '页面主体文字过少，像是未完成的骨架。',
      fix: '补足标题、正文、说明或结构性模块，让页面信息可直接阅读。',
    })
  }

  if (!autoRedbook && hasLikelyOverdenseLayout(trimmed)) {
    findings.push({
      severity: 'warning',
      id: 'overdense-layout',
      category: 'structure',
      message: '模块数量偏多，页面可能过密。',
      fix: '合并同类区块，减少重复卡片，优先保留一层清晰的信息主次。',
    })
  }

  if (autoRedbook && !hasAutoRedbookCardStructure(trimmed)) {
    findings.push({
      severity: 'error',
      id: 'missing-auto-redbook-cards',
      category: 'structure',
      message: '当前社交传播模板没有生成 Auto-Redbook 的独立卡片组结构。',
      fix: buildAutoRedbookRepairInstruction(),
    })
  }

  if (!hasReducedMotion(trimmed)) {
    findings.push({
      severity: 'warning',
      id: 'missing-reduced-motion',
      category: 'accessibility',
      message: '缺少 prefers-reduced-motion 降级。',
      fix: '为所有动画和 transition 添加 reduced-motion 降级。',
    })
  }

  if (DEFAULT_AI_GRADIENT_RE.test(trimmed)) {
    findings.push({
      severity: 'warning',
      id: 'default-ai-gradient',
      category: 'style',
      message: '检测到常见 AI 紫蓝粉渐变套路。',
      fix: '改为模板 profile 中的单一强调色、清晰表面色或与内容相关的克制色板。',
    })
  }

  if (FILLER_RE.test(trimmed)) {
    findings.push({
      severity: 'error',
      id: 'filler-copy',
      category: 'content',
      message: '检测到占位或样本文字。',
      fix: '全部替换为用户材料中的真实内容，缺失内容应删掉对应区块。',
    })
  }

  if (FAKE_METRIC_RE.test(trimmed)) {
    findings.push({
      severity: 'warning',
      id: 'possible-fake-metric',
      category: 'content',
      message: '检测到疑似无来源的大数字卖点。',
      fix: '只有输入材料明确给出数字时才能展示；否则改成定性描述或删除。',
    })
  }

  if (EXTERNAL_PLACEHOLDER_IMAGE_RE.test(trimmed)) {
    findings.push({
      severity: 'warning',
      id: 'external-placeholder-image',
      category: 'content',
      message: '检测到外部占位图。',
      fix: '改为 CSS 占位、纯排版或用户材料中的真实图片说明，不依赖易失效 CDN。',
    })
  }

  const severeFindings = findings.filter((finding) => finding.severity === 'error')
  const repairPrompt = buildRepairPrompt(findings)

  return { findings, severeFindings, repairPrompt }
}

export function shouldRepairOutputHtml(result: OutputLintResult): boolean {
  return result.severeFindings.length > 0
}
