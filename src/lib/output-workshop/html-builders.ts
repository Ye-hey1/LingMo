/**
 * 输出工坊 HTML 构建器
 * 为每种模板提供独特的视觉风格
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedSection {
  title: string
  body?: string
  bullets?: string[]
  importance?: "low" | "medium" | "high"
}

export interface BuildHtmlOptions {
  title: string
  subtitle?: string
  sections: ExtractedSection[]
  sourceLabel?: string
  generatedAt?: string
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderMarkdown(text: string): string {
  if (!text) return ''

  // 1. 转义安全字符
  let html = escapeHtml(text)

  // 2. 解析简易 Markdown 表格 (由 | 和 - 组成)
  const lines = html.split('\n')
  let inTable = false
  let tableHtml = ''
  let headerCols: string[] = []
  const renderedLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('|') && line.endsWith('|')) {
      const cols = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      const isDivider = cols.every(c => /^[:-]+$/.test(c))

      if (isDivider) {
        continue
      }

      if (!inTable) {
        inTable = true
        tableHtml = '<div style="width: 100%; overflow-x: auto; margin: 16px 0; border-radius: 8px; border: 1px solid rgba(0,0,0,0.08);"><table style="width: 100%; border-collapse: collapse; font-size: 0.85em; text-align: left;"><thead><tr style="background: rgba(0,0,0,0.02);">'
        tableHtml += cols.map(c => `<th style="padding: 10px 14px; font-weight: 600; border-bottom: 2px solid rgba(0,0,0,0.08);">${c}</th>`).join('')
        tableHtml += '</tr></thead><tbody>'
        headerCols = cols
      } else {
        tableHtml += '<tr>'
        for (let j = 0; j < headerCols.length; j++) {
          tableHtml += `<td style="padding: 10px 14px; border-bottom: 1px solid rgba(0,0,0,0.05);">${cols[j] || ''}</td>`
        }
        tableHtml += '</tr>'
      }
    } else {
      if (inTable) {
        inTable = false
        tableHtml += '</tbody></table></div>'
        renderedLines.push(tableHtml)
        tableHtml = ''
      }
      renderedLines.push(lines[i])
    }
  }
  if (inTable) {
    tableHtml += '</tbody></table></div>'
    renderedLines.push(tableHtml)
  }

  html = renderedLines.join('\n')

  // 3. 粗体 (支持 ** 和 __)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>')

  // 4. 斜体 (支持 * 和 _)
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.*?)_/g, '<em>$1</em>')

  // 5. 行内代码 (支持 `code`)
  html = html.replace(/`(.*?)`/g, '<code style="font-family: monospace; background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">$1</code>')

  // 6. 链接 (支持 [text](url))
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: inherit; text-decoration: underline; font-weight: 600;">$1</a>')

  // 7. 换行
  html = html.replace(/\n/g, '<br>')

  return html
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeLabel(value?: string): string {
  return (value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\\/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getContentBrand(options: Pick<BuildHtmlOptions, 'title' | 'sourceLabel' | 'sections'>, fallback = 'LingMo'): string {
  const source = normalizeLabel(options.sourceLabel)
  if (source) return source.slice(0, 28)

  const title = normalizeLabel(options.title)
  if (title) return title.slice(0, 28)

  const sectionTitle = normalizeLabel(options.sections[0]?.title)
  return sectionTitle ? sectionTitle.slice(0, 28) : fallback
}

function getContentInitials(label: string): string {
  const cleaned = normalizeLabel(label)
  if (!cleaned) return 'LM'

  const asciiWords = cleaned.match(/[A-Za-z0-9]+/g)
  if (asciiWords?.length) {
    return asciiWords
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return Array.from(cleaned).slice(0, 2).join('')
}

function getContentCategory(options: Pick<BuildHtmlOptions, 'title' | 'subtitle' | 'sections'>, fallback = '知识手账'): string {
  const haystack = [options.title, options.subtitle, ...options.sections.flatMap((section) => [section.title, section.body || ''])]
    .join(' ')
    .toLowerCase()

  if (/ai|模型|算法|代码|技术|开发|系统|工程|api/.test(haystack)) return '技术笔记'
  if (/产品|商业|增长|用户|市场|运营|策略/.test(haystack)) return '产品洞察'
  if (/学习|课程|知识|复习|考试|方法/.test(haystack)) return '学习卡片'
  if (/研究|报告|数据|分析|趋势|历史/.test(haystack)) return '研究摘要'
  return fallback
}

// ---------------------------------------------------------------------------
// 1. 编辑风格文章
// ---------------------------------------------------------------------------

export function buildEditorialArticle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, 'Editorial')

  const sectionHtml = sections.map((section, i) => {
    const importance = section.importance || 'low'
    const importanceLabel = importance === 'high' ? '重点' : importance === 'medium' ? '核心' : '要点'
    const bullets = section.bullets?.length
      ? `<ul class="bullet-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="section-body">${renderMarkdown(section.body)}</p>`
      : ''

    return `
      <section class="section">
        <div class="section-header">
          <div class="section-badge badge-${importance}">${importanceLabel}</div>
          <h2><span class="num-prefix">0${i + 1}.</span> ${escapeHtml(section.title)}</h2>
        </div>
        <div class="section-content">
          ${body}
          ${bullets}
        </div>
      </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --text: #2a2b2c;
      --text-dark: #1e1f20;
      --muted: #86888c;
      --accent: #b83b30;
      --accent-rgb: 184, 59, 48;
      --bg: #f9f8f5;
      --card-bg: #ffffff;
      --border: #eceae4;
      --shadow: 0 4px 20px -2px rgba(42, 43, 44, 0.03), 0 2px 6px -1px rgba(0, 0, 0, 0.02);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Serif SC', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.85;
      -webkit-font-smoothing: antialiased;
    }
    
    /* 进度条 */
    .progress-bar {
      position: fixed;
      top: 0;
      left: 0;
      height: 4px;
      background: linear-gradient(to right, var(--accent), #e05e55);
      width: 0%;
      z-index: 100;
      transition: width 0.2s;
    }

    .container {
      max-width: 760px;
      margin: 0 auto;
      padding: 80px 24px;
    }
    
    header {
      margin-bottom: 56px;
      padding-bottom: 32px;
      border-bottom: 1px double var(--border);
      position: relative;
    }
    header::after {
      content: "";
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 100%;
      height: 1px;
      background-color: var(--border);
    }
    
    .meta-top {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--accent);
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
    }

    h1 {
      font-size: 2.8rem;
      font-weight: 700;
      line-height: 1.25;
      margin-bottom: 16px;
      color: var(--text-dark);
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      font-size: 1.15rem;
      color: var(--muted);
      font-family: 'Noto Serif SC', serif;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    
    .meta-bottom {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 0.85rem;
      color: var(--muted);
      border-top: 1px solid var(--border);
      padding-top: 16px;
    }
    .meta-bottom span {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .section {
      margin-bottom: 64px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 40px;
      border-radius: 6px;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .section::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 3px;
      background: var(--border);
      transition: background 0.3s ease;
    }
    .section:hover {
      box-shadow: 0 12px 30px -4px rgba(42, 43, 44, 0.08), 0 4px 12px -2px rgba(0,0,0,0.03);
      transform: translateY(-4px);
    }
    .section:hover::before {
      background: var(--accent);
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
    }
    
    .num-prefix {
      font-family: 'Outfit', sans-serif;
      font-weight: 300;
      color: var(--accent);
      margin-right: 8px;
    }
    
    h2 {
      font-size: 1.45rem;
      font-weight: 600;
      color: var(--text-dark);
      line-height: 1.3;
    }
    
    .section-badge {
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 2px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .badge-high {
      background: rgba(var(--accent-rgb), 0.08);
      color: var(--accent);
      border: 1px solid rgba(var(--accent-rgb), 0.15);
    }
    .badge-medium {
      background: rgba(59, 130, 246, 0.08);
      color: #3b82f6;
      border: 1px solid rgba(59, 130, 246, 0.15);
    }
    .badge-low {
      background: rgba(107, 114, 128, 0.08);
      color: #6b7280;
      border: 1px solid rgba(107, 114, 128, 0.15);
    }

    /* 首字下沉效果 */
    .section:first-of-type .section-body::first-letter {
      font-size: 3.5em;
      float: left;
      line-height: 0.9;
      margin-right: 12px;
      margin-top: 6px;
      font-weight: 900;
      background: linear-gradient(135deg, var(--accent), #d44d44);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-family: 'Noto Serif SC', serif;
    }

    .section-body {
      font-size: 1.05rem;
      color: var(--text);
      margin-bottom: 24px;
      text-align: justify;
      text-justify: inter-character;
    }

    /* Markdown 表格和代码特化样式 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.9em;
      background: #ffffff;
      border: 1px solid var(--border);
    }
    th {
      background: rgba(184, 59, 48, 0.04) !important;
      color: var(--text-dark) !important;
      font-weight: 600;
      border-bottom: 2px solid var(--border) !important;
    }
    td {
      border-bottom: 1px solid var(--border) !important;
    }
    code {
      font-family: 'Outfit', monospace;
      background: rgba(184, 59, 48, 0.05) !important;
      color: var(--accent) !important;
      padding: 3px 6px;
      border-radius: 4px;
      font-weight: 500;
    }
    
    .bullet-list {
      list-style-type: none;
      margin: 20px 0;
      padding-left: 8px;
      border-left: 2px solid var(--border);
    }
    .bullet-list li {
      margin-bottom: 12px;
      font-size: 0.98rem;
      position: relative;
      padding-left: 20px;
      color: #4a5568;
    }
    .bullet-list li::before {
      content: "—";
      position: absolute;
      left: 0;
      color: var(--accent);
      font-weight: bold;
    }
    
    footer {
      margin-top: 80px;
      padding-top: 32px;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--muted);
      text-align: center;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="progress-bar" id="progressBar"></div>
  <div class="container">
    <header>
      <div class="meta-top">
        <span>${escapeHtml(contentBrand)}</span>
        <span>ISSUE NO. ${new Date().getFullYear()}</span>
      </div>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
      <div class="meta-bottom">
        ${sourceLabel ? `<span><b>来源:</b> ${escapeHtml(sourceLabel)}</span>` : ''}
        <span><b>时间:</b> ${date}</span>
      </div>
    </header>
    <main>
      ${sectionHtml}
    </main>
    <footer>
      ${sourceLabel ? `来源：${escapeHtml(sourceLabel)} · ` : ''}${date}
    </footer>
  </div>
  <script>
    window.addEventListener('scroll', () => {
      const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
      const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const scrolled = (winScroll / height) * 100;
      document.getElementById('progressBar').style.width = scrolled + '%';
    });
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 2. 暖色羊皮纸风格
// ---------------------------------------------------------------------------

export function buildKamiParchment(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, '手记')

  // 将数字转为中文大写数字
  const toChineseNum = (n: number) => {
    const chars = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾']
    if (n <= 10) return chars[n]
    return n.toString()
  }

  const sectionHtml = sections.map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="classical-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="classical-p">${renderMarkdown(section.body)}</p>`
      : ''

    return `
      <section class="section">
        <h2><span class="chapter-seal">第${toChineseNum(i + 1)}回</span> ${escapeHtml(section.title)}</h2>
        ${body}
        ${bullets}
      </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Serif SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Source Han Serif CN', 'SimSun', serif;
      color: #2c302e;
      background: #faf7ee;
      line-height: 1.95;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.015 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
      word-break: break-all;
      text-align: justify;
      text-justify: inter-character;
    }
    
    .outer-container {
      max-width: 700px;
      margin: 48px auto;
      padding: 16px;
    }

    .classical-frame {
      border: 1px solid #c0a880;
      outline: 4px double #d5c8b3;
      outline-offset: -10px;
      padding: 48px 36px;
      position: relative;
      background: #fdfcf7;
      box-shadow: 0 10px 30px rgba(184,166,135,0.15);
    }
    .classical-frame::before {
      content: "";
      position: absolute;
      top: 14px; left: 14px; right: 14px; bottom: 14px;
      border: 1px dashed #e1d7c6;
      pointer-events: none;
    }
    
    header {
      text-align: center;
      margin-bottom: 56px;
      position: relative;
    }
    
    /* 古典装饰纹理 */
    .cloud-deco {
      width: 100px;
      height: 16px;
      margin: 16px auto;
      opacity: 0.7;
    }
    
    h1 {
      font-size: 2.2rem;
      font-weight: 700;
      margin-bottom: 12px;
      color: #1e2022;
      letter-spacing: 2px;
    }
    
    .subtitle {
      font-size: 1rem;
      color: #7f8c8d;
      font-style: italic;
      letter-spacing: 1px;
    }
    
    .divider {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin: 24px auto;
      color: #b83b30;
    }
    .divider::before, .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: linear-gradient(to right, transparent, #d5c8b3, transparent);
    }

    .meta {
      font-size: 0.8rem;
      color: #888;
      letter-spacing: 1px;
    }

    .section {
      margin-bottom: 48px;
      position: relative;
    }
    
    h2 {
      font-size: 1.35rem;
      font-weight: 600;
      margin-bottom: 20px;
      color: #1e2022;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .chapter-seal {
      background: #b83b30;
      color: #fff;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 3px 2px 4px 2px;
      font-weight: 600;
      letter-spacing: 1px;
      box-shadow: 1px 1px 2px rgba(184,59,48,0.2);
      border: 1px solid #9e2b20;
      font-family: 'Noto Serif SC', serif;
      background-image: linear-gradient(135deg, rgba(255,255,255,0.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 75%, transparent 75%, transparent);
      background-size: 8px 8px;
    }

    .classical-p {
      margin-bottom: 20px;
      text-align: justify;
      text-justify: inter-character;
      text-indent: 2em;
      font-size: 1.05rem;
    }
    
    .classical-list {
      list-style-type: none;
      margin: 20px 0;
      padding-left: 2em;
    }
    .classical-list li {
      margin-bottom: 10px;
      font-size: 1rem;
      position: relative;
      padding-left: 20px;
    }
    .classical-list li::before {
      content: "✦";
      position: absolute;
      left: 0;
      color: #b83b30;
      font-weight: bold;
    }

    /* 古典表格和代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
      font-size: 0.9rem;
      border: 1px solid #d5c8b3 !important;
      background: #faf8f2;
    }
    th {
      background: #f3edd8 !important;
      border-bottom: 2px solid #d5c8b3 !important;
      color: #7a1d12 !important;
      padding: 10px 14px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid #e8decb !important;
      padding: 10px 14px;
    }
    code {
      font-family: inherit;
      background: #f5eedc !important;
      border: 1px solid #e5dcb9;
      color: #a92215 !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    
    footer {
      margin-top: 64px;
      text-align: center;
      font-size: 0.8rem;
      color: #95a5a6;
      border-top: 1px double #eae4d6;
      padding-top: 24px;
    }
  </style>
</head>
<body>
  <div class="outer-container">
    <div class="classical-frame">
      <header>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
        <div class="divider">✦ ✦ ✦</div>
        <div class="meta">${sourceLabel ? `出处：${escapeHtml(sourceLabel)} &nbsp;·&nbsp; ` : ''}撰于 ${date}</div>
      </header>
      <main>${sectionHtml}</main>
      <footer>${escapeHtml(contentBrand)} · ${date}</footer>
    </div>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 3. 极简主义风格
// ---------------------------------------------------------------------------

export function buildBrutalistStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, 'Document')

  const sectionHtml = sections.map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="brutal-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="brutal-body">${renderMarkdown(section.body)}</p>`
      : ''

    const accentColors = ['#ffb3ba', '#bae1ff', '#baffc9', '#ffffba', '#e8ceff', '#ffdfba']
    const badgeColor = accentColors[i % accentColors.length]

    return `
      <section class="section">
        <div class="brutal-index" style="background-color: ${badgeColor}">${String(i + 1).padStart(2, '0')}</div>
        <div class="content">
          <h2>${escapeHtml(section.title)}</h2>
          ${body}
          ${bullets}
        </div>
      </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&family=Lexend+Mega:wght@700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Fira Code', 'Lexend Mega', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111111;
      background: #f4f4f4;
      background-image: radial-gradient(#d0d0d0 1px, transparent 1px);
      background-size: 16px 16px;
      line-height: 1.65;
      padding: 40px 16px;
    }
    
    .container {
      max-width: 780px;
      margin: 0 auto;
    }
    
    header {
      background: #ffffba;
      border: 2.5px solid #111111;
      border-radius: 4px;
      padding: 40px;
      margin-bottom: 48px;
      box-shadow: 4px 4px 0px #111111;
      position: relative;
    }
    
    h1 {
      font-size: 2.6rem;
      font-weight: 900;
      line-height: 1.1;
      text-transform: uppercase;
      letter-spacing: -1px;
      margin-bottom: 12px;
      word-break: break-word;
    }
    
    .subtitle {
      font-size: 1.1rem;
      font-weight: 700;
      color: #111111;
      border-top: 2.5px solid #111111;
      padding-top: 12px;
      margin-top: 16px;
    }
    
    .meta {
      font-size: 0.8rem;
      font-weight: 700;
      margin-top: 16px;
      display: inline-block;
      background: #baffc9;
      padding: 4px 8px;
      border: 2px solid #111111;
      border-radius: 2px;
    }
    
    .section {
      background: #ffffff;
      border: 2.5px solid #111111;
      border-radius: 4px;
      margin-bottom: 40px;
      padding: 32px;
      box-shadow: 4px 4px 0px #111111;
      position: relative;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .section:hover {
      transform: translate(-2px, -2px);
      box-shadow: 6px 6px 0px #111111;
    }
    
    .brutal-index {
      position: absolute;
      top: -20px;
      left: 20px;
      font-size: 1.2rem;
      font-weight: 900;
      color: #111111;
      padding: 4px 12px;
      border: 2.5px solid #111111;
      border-radius: 4px;
      box-shadow: 2px 2px 0px #111111;
    }
    
    .content {
      margin-top: 8px;
    }
    
    h2 {
      font-size: 1.5rem;
      font-weight: 900;
      margin-bottom: 16px;
      text-transform: uppercase;
      display: inline-block;
      background: #ffb3ba;
      padding: 2px 10px;
      border: 2px solid #111111;
      border-radius: 2px;
    }
    
    .brutal-body {
      font-size: 0.95rem;
      font-weight: 500;
      margin-bottom: 16px;
      background: #fafdff;
      padding: 16px;
      border: 2px solid #111111;
      border-radius: 4px;
    }
    
    .brutal-list {
      list-style-type: none;
      margin: 16px 0;
    }
    .brutal-list li {
      margin-bottom: 10px;
      font-size: 0.9rem;
      font-weight: 700;
      padding: 8px 12px;
      background: #bae1ff;
      border: 2px solid #111111;
      border-radius: 4px;
      box-shadow: 2px 2px 0px #111111;
      display: inline-block;
      margin-right: 8px;
    }

    /* 新丑风表格与代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.9rem;
      border: 2.5px solid #111111 !important;
      border-radius: 4px;
      background: #ffffff;
      box-shadow: 3px 3px 0px #111111;
      overflow: hidden;
    }
    th {
      background: #bae1ff !important;
      border-bottom: 2.5px solid #111111 !important;
      color: #111111 !important;
      font-weight: 900;
      padding: 10px 14px;
    }
    td {
      border-bottom: 2px solid #111111 !important;
      padding: 10px 14px;
      font-weight: 700;
    }
    code {
      font-family: inherit;
      background: #ffb3ba !important;
      border: 2px solid #111111 !important;
      color: #111111 !important;
      padding: 2px 6px;
      border-radius: 2px;
      font-weight: 700;
      box-shadow: 1.5px 1.5px 0px #111111;
    }
    
    footer {
      background: #bae1ff;
      border: 2.5px solid #111111;
      border-radius: 4px;
      padding: 20px;
      text-align: center;
      font-weight: 700;
      font-size: 0.85rem;
      box-shadow: 4px 4px 0px #111111;
      margin-top: 64px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
      <div class="meta">
        ${sourceLabel ? `${escapeHtml(sourceLabel)} · ` : ''}${date}
      </div>
    </header>
    <main>${sectionHtml}</main>
    <footer>
      ${escapeHtml(contentBrand)} / ${date}
    </footer>
  </div>
</body>
</html>`
}

export function buildGuizangDeck(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, 'Output')
  const visibleSections = sections.length > 0
    ? sections.slice(0, 8)
    : [{ title: '核心观点', body: subtitle || title, bullets: [] }]

  const agendaItems = visibleSections.slice(0, 6).map((section, index) => `
        <li>
          <span>${String(index + 1).padStart(2, '0')}</span>
          <strong>${escapeHtml(section.title)}</strong>
        </li>`).join('')

  const slidesHtml = visibleSections.map((section, index) => {
    const slideNo = index + 3
    const slideCode = ['S04', 'S09', 'S16'][index % 3]
    const layoutClass = ['layout-statement', 'layout-split', 'layout-evidence'][index % 3]
    const body = section.body
      ? `<p class="slide-body">${renderMarkdown(section.body)}</p>`
      : ''
    const bullets = section.bullets?.length
      ? `<ul class="point-list">${section.bullets.slice(0, 4).map((bullet) => `<li>${renderMarkdown(bullet)}</li>`).join('')}</ul>`
      : ''
    const statement = section.bullets?.[0] || section.body || section.title

    return `
    <section class="gz-deck-slide ${layoutClass}" id="slide-${slideNo}">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">${slideCode}</span>
          <span class="slide-count">${String(slideNo).padStart(2, '0')} / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">${escapeHtml(contentBrand)} / Swiss Locked Mode</p>
          <h2>${escapeHtml(section.title)}</h2>
          <div class="statement">${renderMarkdown(statement)}</div>
          <div class="body-block">${body}</div>
          <div class="evidence-block">${bullets}</div>
          <footer class="slide-footer">
            <span>${escapeHtml(contentBrand)}</span>
            <span>${date}</span>
          </footer>
        </div>
      </div>
    </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&family=Noto+Sans+SC:wght@400;500;700;900&family=Source+Serif+4:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #111111;
      --paper: #f7f6f0;
      --surface: #fdfdfb;
      --muted: #6f6a60;
      --line: rgba(17, 17, 17, 0.32);
      --fine-line: rgba(17, 17, 17, 0.12);
      --accent: #e33e2b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      overflow: hidden;
      color: var(--ink);
      background: #d8d3c8;
      font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
    }
    .deck-progress {
      position: fixed;
      inset: 0 auto auto 0;
      width: 0;
      height: 2px;
      background: var(--accent);
      z-index: 20;
      transition: width 240ms linear;
    }
    .deck {
      width: 100vw;
      height: 100vh;
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      scrollbar-width: none;
    }
    .deck::-webkit-scrollbar { display: none; }
    .gz-deck-slide {
      min-width: 100vw;
      height: 100vh;
      flex-shrink: 0;
      scroll-snap-align: center;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
    }
    .slide-frame {
      width: 1280px;
      height: 720px;
      background: var(--surface);
      border: 1px solid var(--ink);
      transform-origin: center center;
      flex-shrink: 0;
      box-shadow: 0 10px 40px rgba(0,0,0,0.12);
    }
    .slide-grid {
      position: relative;
      height: 100%;
      overflow: hidden;
      display: grid;
      grid-template-columns: repeat(16, minmax(0, 1fr));
      grid-template-rows: repeat(9, minmax(0, 1fr));
      gap: 12px;
      padding: 40px 48px;
      background: var(--paper);
    }
    .slide-grid::before {
      content: "";
      position: absolute;
      inset: 40px 48px;
      pointer-events: none;
      background:
        repeating-linear-gradient(90deg, transparent 0, transparent calc(6.25% - 1px), rgba(17,17,17,0.035) calc(6.25% - 1px), rgba(17,17,17,0.035) 6.25%),
        repeating-linear-gradient(0deg, transparent 0, transparent calc(11.111% - 1px), rgba(17,17,17,0.03) calc(11.111% - 1px), rgba(17,17,17,0.03) 11.111%);
    }
    .template-code,
    .slide-count,
    .kicker,
    .slide-footer {
      position: relative;
      z-index: 1;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .template-code {
      grid-column: 1 / 3;
      grid-row: 1 / 2;
      color: var(--accent);
      font-size: 14px;
    }
    .slide-count {
      grid-column: 14 / 17;
      grid-row: 1 / 2;
      justify-self: end;
    }
    .rule {
      position: relative;
      z-index: 1;
      background: var(--ink);
    }
    .rule-top {
      grid-column: 1 / 17;
      grid-row: 2 / 3;
      align-self: start;
      height: 1px;
    }
    .rule-left {
      grid-column: 3 / 4;
      grid-row: 1 / 10;
      justify-self: start;
      width: 1px;
      background: var(--fine-line);
    }
    .kicker {
      grid-column: 4 / 11;
      grid-row: 1 / 2;
    }
    h1,
    h2 {
      position: relative;
      z-index: 1;
      color: var(--ink);
      font-weight: 300;
      letter-spacing: 0;
      text-wrap: balance;
    }
    h1 {
      grid-column: 4 / 14;
      grid-row: 3 / 6;
      align-self: center;
      font-size: 82px;
      line-height: 0.94;
    }
    h2 {
      grid-column: 2 / 8;
      grid-row: 3 / 6;
      font-size: 52px;
      line-height: 1;
    }
    .subtitle {
      position: relative;
      z-index: 1;
      grid-column: 4 / 10;
      grid-row: 6 / 8;
      color: var(--muted);
      font-size: 22px;
      line-height: 1.55;
      font-weight: 350;
    }
    .statement {
      position: relative;
      z-index: 1;
      grid-column: 8 / 16;
      grid-row: 3 / 6;
      color: var(--accent);
      font-size: 38px;
      line-height: 1.08;
      font-weight: 300;
      text-wrap: balance;
    }
    .body-block {
      position: relative;
      z-index: 1;
      grid-column: 8 / 12;
      grid-row: 6 / 9;
      color: #33302b;
      font-size: 16px;
      line-height: 1.75;
      overflow: hidden;
    }
    .evidence-block {
      position: relative;
      z-index: 1;
      grid-column: 12 / 16;
      grid-row: 6 / 9;
      overflow: hidden;
    }
    .slide-body,
    .point-list li {
      color: #33302b;
      font-size: 15px;
      line-height: 1.62;
      font-weight: 400;
    }
    .point-list {
      list-style: none;
      display: grid;
      gap: 10px;
    }
    .point-list li {
      position: relative;
      padding-left: 22px;
    }
    .point-list li::before {
      content: "—";
      position: absolute;
      left: 0;
      top: 0;
      color: var(--accent);
    }
    .slide-footer {
      grid-column: 1 / 17;
      grid-row: 9 / 10;
      align-self: end;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid var(--fine-line);
      padding-top: 10px;
    }
    .cover .template-code {
      grid-column: 1 / 3;
      grid-row: 1 / 2;
      font-size: 72px;
      line-height: 0.82;
      font-weight: 300;
      letter-spacing: 0;
    }
    .cover .kicker {
      grid-column: 4 / 9;
      grid-row: 1 / 2;
    }
    .cover .cover-meta {
      position: relative;
      z-index: 1;
      grid-column: 11 / 16;
      grid-row: 7 / 9;
      align-self: end;
      display: grid;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .agenda h2 {
      grid-column: 2 / 7;
      grid-row: 3 / 5;
    }
    .agenda-list {
      position: relative;
      z-index: 1;
      grid-column: 8 / 16;
      grid-row: 3 / 8;
      list-style: none;
      display: grid;
      align-content: start;
      gap: 16px;
    }
    .agenda-list li {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr);
      gap: 18px;
      align-items: baseline;
      border-top: 1px solid var(--fine-line);
      padding-top: 14px;
    }
    .agenda-list span {
      color: var(--accent);
      font-size: 15px;
      font-weight: 700;
    }
    .agenda-list strong {
      color: var(--ink);
      font-size: 24px;
      line-height: 1.18;
      font-weight: 300;
    }
    .layout-split h2 { grid-column: 2 / 9; }
    .layout-split .statement {
      grid-column: 2 / 9;
      grid-row: 6 / 8;
      font-size: 28px;
      color: var(--ink);
    }
    .layout-split .body-block {
      grid-column: 10 / 13;
      grid-row: 3 / 8;
    }
    .layout-split .evidence-block {
      grid-column: 13 / 16;
      grid-row: 3 / 8;
    }
    .layout-evidence h2 {
      grid-column: 2 / 15;
      grid-row: 3 / 5;
      font-size: 64px;
    }
    .layout-evidence .statement {
      grid-column: 2 / 8;
      grid-row: 6 / 8;
      font-size: 26px;
      color: var(--accent);
    }
    .layout-evidence .body-block {
      grid-column: 8 / 12;
      grid-row: 6 / 8;
    }
    .layout-evidence .evidence-block {
      grid-column: 12 / 16;
      grid-row: 6 / 8;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 0.82em;
      border-top: 1px solid var(--ink);
      border-bottom: 1px solid var(--ink);
      background: transparent;
    }
    th, td {
      padding: 7px 0;
      border-bottom: 1px solid var(--fine-line);
      text-align: left;
    }
    th { color: var(--accent); font-weight: 700; }
    code {
      border-bottom: 1px solid var(--accent);
      background: transparent;
      color: var(--accent);
      padding: 0 2px;
      font-family: inherit;
      font-weight: 700;
    }
    .nav {
      position: fixed;
      left: 50%;
      bottom: 18px;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 10px;
      transform: translateX(-50%);
      border: 1px solid var(--ink);
      padding: 4px;
      background: var(--paper);
    }
    .nav button {
      border: 1px solid transparent;
      padding: 7px 12px;
      color: var(--ink);
      background: transparent;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      transition: background 160ms ease, color 160ms ease;
    }
    .nav button:hover {
      background: var(--ink);
      color: var(--paper);
    }
    .dots { display: flex; gap: 5px; padding: 0 5px; }
    .dot {
      width: 18px;
      height: 2px;
      background: rgba(17,17,17,0.24);
      transition: background 160ms ease;
    }
    .dot.active { background: var(--accent); }
    @media (max-width: 860px) {
      body { overflow: auto; }
      .deck { height: auto; min-height: 100vh; display: block; overflow: visible; }
      .gz-deck-slide { min-width: 0; height: auto; min-height: 100vh; padding: 18px; display: block; }
      .slide-frame { width: 100%; aspect-ratio: auto; min-height: calc(100vh - 36px); }
      .slide-grid {
        min-height: calc(100vh - 36px);
        display: block;
        padding: 28px 24px;
      }
      .slide-grid::before,
      .rule { display: none; }
      .template-code,
      .slide-count,
      .kicker,
      h1,
      h2,
      .subtitle,
      .statement,
      .body-block,
      .evidence-block,
      .slide-footer,
      .cover .cover-meta,
      .agenda-list {
        display: block;
        margin-bottom: 18px;
      }
      h1 { font-size: 46px; }
      h2,
      .layout-evidence h2 { font-size: 36px; }
      .statement,
      .layout-split .statement,
      .layout-evidence .statement { font-size: 22px; }
      .nav { display: none; }
    }
  </style>
</head>
<body>
  <div class="deck-progress" id="progress"></div>
  <div class="deck">
    <section class="gz-deck-slide cover active" id="slide-1">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">S01</span>
          <span class="slide-count">01 / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">${escapeHtml(contentBrand)} / Electronic Magazine</p>
          <h1>${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
          <div class="cover-meta">
            <span>${escapeHtml(contentBrand)}</span>
            <span>${date}</span>
          </div>
          <footer class="slide-footer">
            <span>Style B / Swiss International</span>
            <span>16 Columns · 16:9</span>
          </footer>
        </div>
      </div>
    </section>
    <section class="gz-deck-slide agenda" id="slide-2">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">S02</span>
          <span class="slide-count">02 / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">Agenda / Content Architecture</p>
          <h2>目录</h2>
          <ol class="agenda-list">
            ${agendaItems}
          </ol>
          <footer class="slide-footer">
            <span>Single Accent · Dense Grid</span>
            <span>${date}</span>
          </footer>
        </div>
      </div>
    </section>
    ${slidesHtml}
    <section class="gz-deck-slide layout-statement" id="slide-${visibleSections.length + 3}">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">S22</span>
          <span class="slide-count">${String(visibleSections.length + 3).padStart(2, '0')} / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">Closing / Discussion</p>
          <h2>谢谢</h2>
          <div class="statement">基于内容结构生成，可继续导出为独立 slide 或截图分享。</div>
          <footer class="slide-footer">
            <span>${escapeHtml(contentBrand)}</span>
            <span>${date}</span>
          </footer>
        </div>
      </div>
    </section>
  </div>
  <nav class="nav" aria-label="Deck navigation">
    <button id="prevBtn">←</button>
    <div class="dots" id="dotsContainer"></div>
    <button id="nextBtn">→</button>
  </nav>
  <script>
    const deck = document.querySelector('.deck');
    const slides = Array.from(document.querySelectorAll('.gz-deck-slide'));
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progress = document.getElementById('progress');
    const dotsContainer = document.getElementById('dotsContainer');
    let activeIndex = 0;
 
    slides.forEach((_, index) => {
      const dot = document.createElement('span');
      dot.className = 'dot' + (index === 0 ? ' active' : '');
      dotsContainer.appendChild(dot);
    });
    const dots = Array.from(document.querySelectorAll('.dot'));
 
    function setActive(index) {
      activeIndex = Math.max(0, Math.min(slides.length - 1, index));
      slides.forEach((slide, i) => slide.classList.toggle('active', i === activeIndex));
      dots.forEach((dot, i) => dot.classList.toggle('active', i === activeIndex));
      progress.style.width = ((activeIndex / Math.max(1, slides.length - 1)) * 100) + '%';
    }
 
    function go(delta) {
      const next = Math.max(0, Math.min(slides.length - 1, activeIndex + delta));
      deck.scrollTo({ left: next * window.innerWidth, behavior: 'smooth' });
      setActive(next);
    }
 
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    });

    function resizeSlides() {
      if (window.innerWidth <= 860) {
        const frames = document.querySelectorAll('.slide-frame');
        frames.forEach(frame => {
          frame.style.transform = '';
        });
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const frames = document.querySelectorAll('.slide-frame');
      frames.forEach(frame => {
        const scaleX = (vw - 80) / 1280;
        const scaleY = (vh - 80) / 720;
        const scale = Math.min(scaleX, scaleY);
        frame.style.transform = \`scale(\${scale})\`;
      });
    }
    window.addEventListener('resize', resizeSlides);
    window.addEventListener('load', resizeSlides);
 
    let scrollFrame = 0;
    deck.addEventListener('scroll', () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        setActive(Math.round(deck.scrollLeft / Math.max(1, window.innerWidth)));
        scrollFrame = 0;
      });
    }, { passive: true });

    // 初始化
    resizeSlides();
    setTimeout(resizeSlides, 100);
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 5. 技术分享风格 (深色主题)
// ---------------------------------------------------------------------------

export function buildTechSharing(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel, generatedAt } = options
  const date = generatedAt || formatDate(new Date())

  const slidesHtml = sections.map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="cyber-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="cyber-body">${renderMarkdown(section.body)}</p>`
      : ''

    return `
    <div class="slide" id="slide-${i + 2}">
      <div class="slide-content">
        <div class="window-header">
          <span class="dot-btn red"></span>
          <span class="dot-btn yellow"></span>
          <span class="dot-btn green"></span>
          <span class="window-title">module_0${i + 2}.log</span>
        </div>
        <div class="slide-meta">
          <span class="slide-index">&gt; _0${i + 2}</span>
          <span class="slide-indicator">/ ${sections.length + 1}</span>
        </div>
        <h2>${escapeHtml(section.title)}</h2>
        ${body}
        ${bullets}
      </div>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Fira Code', Consolas, Monaco, monospace;
      color: #00f2fe;
      background: #07080d;
      overflow: hidden;
      background-image: linear-gradient(0deg, rgba(0, 242, 254, 0.03) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 242, 254, 0.03) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    
    /* 进度条 */
    .deck-progress {
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: linear-gradient(to right, #bd00ff, #00f2fe);
      width: 0%;
      z-index: 100;
      box-shadow: 0 0 10px #00f2fe;
      transition: width 0.3s ease;
    }

    .deck {
      width: 100vw;
      height: 100vh;
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    .deck::-webkit-scrollbar {
      display: none;
    }
    
    .slide {
      min-width: 100vw;
      height: 100vh;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      scroll-snap-align: start;
      padding: 64px 24px;
      position: relative;
    }
    
    .slide-content {
      max-width: 860px;
      width: 100%;
      background: rgba(7, 8, 13, 0.82);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(0, 242, 254, 0.25);
      border-radius: 8px;
      padding: 48px 40px 40px;
      position: relative;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5),
                  0 0 20px rgba(0, 242, 254, 0.05),
                  0 0 40px rgba(189, 0, 255, 0.1),
                  inset 0 0 20px rgba(189, 0, 255, 0.08);
      opacity: 0;
      transform: scale(0.96) translateY(10px);
      transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .slide.active .slide-content {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
    
    /* 终端窗口顶部装饰 */
    .window-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: rgba(0, 242, 254, 0.05);
      border-bottom: 1px solid rgba(0, 242, 254, 0.2);
      border-radius: 7px 7px 0 0;
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 8px;
    }
    .dot-btn {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot-btn.red { background: #ff5f56; }
    .dot-btn.yellow { background: #ffbd2e; }
    .dot-btn.green { background: #27c93f; }
    
    .window-title {
      font-size: 0.75rem;
      color: rgba(0, 242, 254, 0.5);
      margin-left: 8px;
      font-weight: 500;
    }
    
    .slide-meta {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 16px;
    }
    .slide-index {
      font-size: 1.15rem;
      font-weight: 700;
      color: #bd00ff;
      text-shadow: 0 0 8px rgba(189, 0, 255, 0.4);
    }
    .slide-indicator {
      font-size: 0.85rem;
      color: rgba(0, 242, 254, 0.4);
    }
    
    h1 {
      font-size: 3.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #00f2fe, #bd00ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 24px;
      text-align: center;
      filter: drop-shadow(0 0 15px rgba(0, 242, 254, 0.3));
    }
    
    h2 {
      font-size: 2.2rem;
      font-weight: 700;
      color: #00f2fe;
      margin-bottom: 24px;
      line-height: 1.2;
      text-shadow: 0 0 10px rgba(0, 242, 254, 0.3);
    }
    
    .cyber-body {
      font-size: 1.1rem;
      line-height: 1.7;
      margin-bottom: 24px;
      color: #a5b4fc;
    }
    
    .cyber-list {
      list-style: none;
    }
    .cyber-list li {
      font-size: 1rem;
      margin-bottom: 12px;
      color: #e0e7ff;
      position: relative;
      padding-left: 24px;
    }
    .cyber-list li::before {
      content: "$";
      position: absolute;
      left: 0;
      color: #bd00ff;
      font-weight: 700;
      text-shadow: 0 0 6px rgba(189,0,255,0.5);
    }

    /* 赛博朋克深色表格和代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.9em;
      border: 1px solid rgba(0, 242, 254, 0.2) !important;
      background: rgba(10, 11, 18, 0.95);
      box-shadow: 0 0 15px rgba(0, 242, 254, 0.05);
    }
    th {
      background: rgba(0, 242, 254, 0.08) !important;
      border-bottom: 2px solid rgba(0, 242, 254, 0.25) !important;
      color: #00f2fe !important;
      padding: 10px 14px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid rgba(0, 242, 254, 0.1) !important;
      padding: 10px 14px;
      color: #a5b4fc;
    }
    code {
      font-family: inherit;
      background: rgba(189, 0, 255, 0.15) !important;
      border: 1px solid rgba(189, 0, 255, 0.3) !important;
      color: #ff00ff !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      text-shadow: 0 0 4px rgba(255, 0, 255, 0.5);
    }
    
    .title-slide {
      text-align: center;
      background: radial-gradient(circle at center, #0f1026 0%, #07080d 100%);
    }
    .title-slide .subtitle {
      font-size: 1.35rem;
      color: rgba(0, 242, 254, 0.75);
      margin-bottom: 32px;
      text-shadow: 0 0 8px rgba(0, 242, 254, 0.2);
    }
    .title-slide .meta {
      font-size: 0.8rem;
      color: rgba(189, 0, 255, 0.6);
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    
    /* 赛博朋克控制台按钮 */
    .nav {
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(7, 8, 13, 0.9);
      border: 1px solid rgba(0, 242, 254, 0.3);
      padding: 6px 16px;
      border-radius: 4px;
      box-shadow: 0 0 20px rgba(0, 242, 254, 0.1);
      z-index: 99;
    }
    .nav button {
      padding: 6px 16px;
      border: 1px solid rgba(0, 242, 254, 0.4);
      border-radius: 2px;
      background: transparent;
      color: #00f2fe;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 700;
      text-shadow: 0 0 4px rgba(0, 242, 254, 0.5);
      transition: all 0.2s;
    }
    .nav button:hover {
      background: #00f2fe;
      color: #07080d;
      text-shadow: none;
      box-shadow: 0 0 10px #00f2fe;
    }
    .slide-indicator-dot {
      display: flex;
      gap: 6px;
    }
    .dot {
      width: 5px;
      height: 5px;
      background: rgba(0, 242, 254, 0.2);
      transition: all 0.3s;
    }
    .dot.active {
      width: 15px;
      background: #bd00ff;
      box-shadow: 0 0 8px #bd00ff;
    }
  </style>
</head>
<body>
  <div class="deck-progress" id="progress"></div>
  <div class="deck">
    <div class="slide title-slide active" id="slide-1">
      <div class="slide-content" style="border: 1px solid rgba(189, 0, 255, 0.25);">
        <div class="window-header" style="background: rgba(189, 0, 255, 0.05); border-bottom: 1px solid rgba(189, 0, 255, 0.2);">
          <span class="dot-btn red"></span>
          <span class="dot-btn yellow"></span>
          <span class="dot-btn green"></span>
          <span class="window-title" style="color: rgba(189, 0, 255, 0.5);">init_main.exe</span>
        </div>
        <div class="slide-meta" style="justify-content: center;">
          <span class="slide-index">&gt; _01</span>
          <span class="slide-indicator">/ ${sections.length + 1}</span>
        </div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
        ${sourceLabel ? `<div class="meta">SOURCE: ${escapeHtml(sourceLabel)} · ${date}</div>` : ''}
      </div>
    </div>
    ${slidesHtml}
  </div>
  <div class="nav">
    <button id="prevBtn">&lt;&lt; BACK</button>
    <div class="slide-indicator-dot" id="dotsContainer"></div>
    <button id="nextBtn">EXEC &gt;&gt;</button>
  </div>
  <script>
    const deck = document.querySelector('.deck');
    const slides = document.querySelectorAll('.slide');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progress = document.getElementById('progress');
    const dotsContainer = document.getElementById('dotsContainer');
    
    let totalSlides = slides.length;
    
    for(let i=0; i<totalSlides; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dotsContainer.appendChild(dot);
    }
    const dots = document.querySelectorAll('.dot');

    function updateActiveSlide() {
      const scrollLeft = deck.scrollLeft;
      const width = window.innerWidth;
      const index = Math.round(scrollLeft / width);
      
      slides.forEach((slide, i) => {
        if(i === index) {
          slide.classList.add('active');
        } else {
          slide.classList.remove('active');
        }
      });
      
      dots.forEach((dot, i) => {
        if(i === index) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      });
      
      progress.style.width = ((index / (totalSlides - 1)) * 100) + '%';
    }

    deck.addEventListener('scroll', updateActiveSlide);
    window.addEventListener('resize', updateActiveSlide);

    prevBtn.addEventListener('click', () => {
      deck.scrollBy({left: -window.innerWidth, behavior: 'smooth'});
    });
    
    nextBtn.addEventListener('click', () => {
      deck.scrollBy({left: window.innerWidth, behavior: 'smooth'});
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') deck.scrollBy({left: -window.innerWidth, behavior: 'smooth'});
      if (e.key === 'ArrowRight') deck.scrollBy({left: window.innerWidth, behavior: 'smooth'});
    });
    
    setTimeout(updateActiveSlide, 100);
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 6. 杂志海报
// ---------------------------------------------------------------------------

export function buildMagazinePoster(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel } = options
  const contentBrand = getContentBrand(options, 'Weekly Journal')

  const sectionHtml = sections.slice(0, 6).map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="mag-list">${section.bullets.slice(0, 3).map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<div class="mag-body">${renderMarkdown(section.body)}</div>`
      : ''
    
    // 错落样式：第2和第5张卡片为深色强调卡
    const isDarkCard = i === 1 || i === 4;

    return `
      <div class="card ${isDarkCard ? 'card-dark' : 'card-light'}">
        <div class="card-header">
          <span class="card-number">${String(i + 1).padStart(2, '0')}</span>
          <span class="card-category">SECTION</span>
        </div>
        <h3>${escapeHtml(section.title)}</h3>
        ${body}
        ${bullets}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,800;1,400&family=Noto+Serif+SC:wght@600;900&family=Montserrat:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Playfair Display', 'Noto Serif SC', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, serif;
      color: #2b2b2b;
      background: #f4efeb;
      min-height: 100vh;
      padding: 40px 16px;
      background-image: radial-gradient(rgba(220, 209, 196, 0.4) 1.5px, transparent 0);
      background-size: 10px 10px;
    }
    
    .poster {
      max-width: 680px;
      margin: 0 auto;
      background: #faf7f2;
      border: 1px solid #dcd1c4;
      padding: 48px;
      box-shadow: 0 25px 60px rgba(43,33,23,0.08);
      position: relative;
    }
    .poster::before {
      content: "";
      position: absolute;
      top: 12px; left: 12px; right: 12px; bottom: 12px;
      border: 1px solid #e8decb;
      pointer-events: none;
    }
    
    header {
      text-align: center;
      margin-bottom: 40px;
      border-bottom: 2px solid #2b2b2b;
      padding-bottom: 32px;
    }
    
    .mag-tag {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.7rem;
      letter-spacing: 4px;
      text-transform: uppercase;
      font-weight: 600;
      color: #8a6d4d;
      margin-bottom: 16px;
      display: block;
    }

    h1 {
      font-size: 2.8rem;
      font-weight: 900;
      line-height: 1.15;
      margin-bottom: 16px;
      color: #1c1c1c;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      font-size: 1.1rem;
      color: #555;
      font-style: italic;
      font-family: 'Playfair Display', serif;
    }
    
    .mag-meta {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      font-family: 'Montserrat', sans-serif;
      font-size: 0.7rem;
      font-weight: 600;
      color: #8c8273;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 580px) {
      .cards {
        grid-template-columns: 1fr;
      }
    }
    
    .card {
      padding: 24px;
      border: 1px solid #e6dccb;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 16px 32px rgba(138, 109, 77, 0.12);
    }
    
    .card-dark {
      background: #3e3227;
      color: #f7f3ed;
      border-color: #3e3227;
    }
    .card-light {
      background: #ffffff;
      color: #2b2b2b;
    }
    
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      font-family: 'Montserrat', sans-serif;
      font-size: 0.65rem;
      font-weight: 600;
      letter-spacing: 1px;
    }
    
    .card-number {
      font-size: 1.3rem;
      font-weight: 800;
      font-family: 'Playfair Display', serif;
    }
    .card-dark .card-number { color: #d7c5ae; }
    .card-light .card-number { color: #8a6d4d; }
    
    .card-category {
      opacity: 0.6;
    }
    
    h3 {
      font-size: 1.15rem;
      font-weight: 700;
      line-height: 1.35;
      margin-bottom: 12px;
    }

    .mag-body {
      font-size: 0.85rem;
      line-height: 1.5;
      margin-bottom: 12px;
      opacity: 0.85;
      text-align: justify;
    }
    .card-dark .mag-body {
      color: #e6dccb;
    }
    .card-light .mag-body {
      color: #555555;
    }

    /* 杂志卡片内置表格与代码 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 0.8em;
      border: 1px solid #dcd1c4 !important;
    }
    .card-dark table {
      border-color: #5e4f41 !important;
      background: rgba(255, 255, 255, 0.02);
    }
    .card-light table {
      background: #faf7f2;
    }
    th {
      padding: 6px 10px;
      font-weight: 600;
      border-bottom: 2px solid #dcd1c4 !important;
      color: inherit !important;
    }
    .card-dark th {
      background: rgba(255, 255, 255, 0.05) !important;
      border-bottom-color: #5e4f41 !important;
    }
    .card-light th {
      background: rgba(138, 109, 77, 0.05) !important;
    }
    td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05) !important;
    }
    .card-dark td {
      border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
    }
    code {
      font-family: inherit;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 0.85em;
    }
    .card-dark code {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #d7c5ae !important;
    }
    .card-light code {
      background: rgba(138, 109, 77, 0.08) !important;
      color: #8a6d4d !important;
    }
    
    .mag-list {
      list-style-type: none;
    }
    .mag-list li {
      font-size: 0.85rem;
      line-height: 1.45;
      margin-bottom: 8px;
      opacity: 0.8;
      position: relative;
      padding-left: 12px;
    }
    .mag-list li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #8a6d4d;
    }
    .card-dark .mag-list li::before {
      color: #d7c5ae;
    }
    
    /* 底部条形码装饰线 */
    .mag-footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #dcd1c4;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .barcode {
      display: flex;
      gap: 2px;
      height: 30px;
      align-items: flex-end;
      opacity: 0.5;
    }
    .barcode-line {
      width: 1.5px;
      height: 100%;
      background: #2b2b2b;
    }
    .barcode-line.thick {
      width: 3.5px;
    }
    
    .footer-text {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.65rem;
      color: #8c8273;
      text-align: right;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="poster">
    <header>
      <span class="mag-tag">${escapeHtml(contentBrand).toUpperCase()}</span>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
      <div class="mag-meta">
        <span>VOL. ${new Date().getMonth() + 1} / NO. ${new Date().getDate()}</span>
        <span>${sourceLabel ? `FROM: ${escapeHtml(sourceLabel)}` : 'DESIGN FOCUS'}</span>
      </div>
    </header>
    <div class="cards">
      ${sectionHtml}
    </div>
    <div class="mag-footer">
      <div class="barcode">
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
      </div>
      <div class="footer-text">
        ${sourceLabel ? `FROM ${escapeHtml(sourceLabel)}` : escapeHtml(contentBrand)}<br>
        ${new Date().getFullYear()}
      </div>
    </div>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 7. 英雄海报
// ---------------------------------------------------------------------------

export function buildHeroPoster(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options
  const contentBrand = getContentBrand(options, 'Hero Poster')

  const sectionsHtml = sections.map((section, idx) => {
    const bullets = section.bullets?.length
      ? `<ul class="hero-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<div class="hero-body">${renderMarkdown(section.body)}</div>`
      : ''

    return `
      <div class="hero-section">
        <div class="hero-section-title">
          <span class="hero-section-num">0${idx + 1}</span>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        ${body}
        ${bullets}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@300;600;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #e2e8f0;
      background-color: #08090f;
      background-image: radial-gradient(circle at 10% 20%, rgba(13, 16, 27, 0.95) 0%, rgba(7, 8, 12, 1) 90%),
                        radial-gradient(circle at 80% 80%, rgba(212, 175, 55, 0.08) 0%, rgba(0, 0, 0, 0) 60%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 64px 24px;
      overflow-x: hidden;
      overflow-y: auto;
      position: relative;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    /* 极光背景装饰与GPU加速流动动画 */
    @keyframes drift {
      0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); }
      50% { transform: translate3d(40px, -60px, 0) rotate(180deg) scale(1.1); }
      100% { transform: translate3d(0, 0, 0) rotate(360deg) scale(1); }
    }
    @keyframes drift-reverse {
      0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1.1); }
      50% { transform: translate3d(-50px, 40px, 0) rotate(-180deg) scale(0.9); }
      100% { transform: translate3d(0, 0, 0) rotate(-360deg) scale(1.1); }
    }
    .aurora-bg {
      position: fixed;
      width: 700px;
      height: 700px;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.18) 0%, rgba(236, 72, 153, 0.05) 50%, rgba(0,0,0,0) 70%);
      top: -250px;
      left: -250px;
      z-index: 1;
      filter: blur(100px);
      pointer-events: none;
      animation: drift 25s infinite alternate ease-in-out;
      will-change: transform;
    }
    .aurora-bg-2 {
      position: fixed;
      width: 800px;
      height: 800px;
      background: radial-gradient(circle, rgba(212, 175, 55, 0.08) 0%, rgba(59, 130, 246, 0.05) 45%, rgba(0,0,0,0) 70%);
      bottom: -300px;
      right: -300px;
      z-index: 1;
      filter: blur(120px);
      pointer-events: none;
      animation: drift-reverse 30s infinite alternate ease-in-out;
      will-change: transform;
    }

    .poster {
      max-width: 640px;
      width: 100%;
      background: rgba(13, 16, 27, 0.65);
      backdrop-filter: blur(30px);
      -webkit-backdrop-filter: blur(30px);
      border: 1px solid rgba(212, 175, 55, 0.25);
      border-radius: 28px;
      padding: 60px 48px;
      box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8),
                  0 0 50px rgba(212, 175, 55, 0.05),
                  inset 0 1px 0 rgba(255, 255, 255, 0.05);
      z-index: 10;
      position: relative;
      overflow: hidden;
    }
    .poster::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; height: 4px;
      background: linear-gradient(90deg, #aa7c11, #d4af37, #ffe082, #d4af37, #aa7c11);
    }
    
    .quote-icon {
      font-size: 6rem;
      font-family: 'Outfit', sans-serif;
      line-height: 0;
      height: 32px;
      display: block;
      color: rgba(212, 175, 55, 0.25);
      margin-bottom: 12px;
      text-align: center;
    }
    
    h1 {
      font-size: 2.2rem;
      font-weight: 900;
      line-height: 1.3;
      margin-bottom: 16px;
      background: linear-gradient(135deg, #ffe082 0%, #d4af37 50%, #aa7c11 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 30px rgba(212, 175, 55, 0.15);
      letter-spacing: -0.5px;
      text-align: center;
    }
    
    .subtitle {
      font-size: 1.05rem;
      font-weight: 300;
      color: rgba(226, 232, 240, 0.8);
      margin-bottom: 40px;
      text-align: center;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(212, 175, 55, 0.15);
      padding-bottom: 24px;
    }
    
    .sections-container {
      margin-bottom: 40px;
    }

    .hero-section {
      margin-bottom: 28px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(212, 175, 55, 0.08);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      text-align: left;
    }
    .hero-section:last-child {
      margin-bottom: 0;
    }
    .hero-section:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(212, 175, 55, 0.2);
      transform: translateY(-2px);
      box-shadow: 0 12px 30px rgba(0,0,0,0.3);
    }
    
    .hero-section-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .hero-section-num {
      font-size: 0.85rem;
      font-weight: 800;
      color: #d4af37;
      background: rgba(212, 175, 55, 0.1);
      padding: 2px 8px;
      border-radius: 6px;
      border: 1px solid rgba(212, 175, 55, 0.2);
      font-family: monospace;
    }
    .hero-section-title h3 {
      font-size: 1.15rem;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 0.5px;
    }

    .hero-body {
      font-size: 0.95rem;
      color: rgba(226, 232, 240, 0.85);
      margin-bottom: 14px;
      text-align: justify;
      line-height: 1.6;
    }

    .hero-list {
      list-style: none;
      padding-left: 0;
    }
    .hero-list li {
      font-size: 0.92rem;
      color: rgba(226, 232, 240, 0.75);
      margin-bottom: 8px;
      position: relative;
      padding-left: 20px;
      line-height: 1.5;
    }
    .hero-list li::before {
      content: "✦";
      position: absolute;
      left: 0;
      color: #d4af37;
      font-size: 0.8rem;
      text-shadow: 0 0 6px rgba(212, 175, 55, 0.5);
    }
    
    /* 黑金表格与代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 0.85em;
      border: 1px solid rgba(212, 175, 55, 0.15) !important;
      background: rgba(13, 16, 27, 0.4);
      border-radius: 8px;
      overflow: hidden;
    }
    th {
      background: rgba(212, 175, 55, 0.1) !important;
      color: #ffe082 !important;
      border-bottom: 2px solid rgba(212, 175, 55, 0.25) !important;
      padding: 10px 12px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid rgba(212, 175, 55, 0.08) !important;
      padding: 10px 12px;
      color: rgba(226, 232, 240, 0.85);
    }
    code {
      font-family: inherit;
      background: rgba(212, 175, 55, 0.06) !important;
      border: 1px solid rgba(212, 175, 55, 0.2) !important;
      color: #ffe082 !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(212, 175, 55, 0.15);
      padding-top: 24px;
      margin-top: 16px;
    }
    
    .barcode {
      display: flex;
      gap: 2px;
      height: 30px;
      align-items: flex-end;
      opacity: 0.35;
    }
    .barcode-line {
      width: 1px;
      height: 100%;
      background: #ffe082;
    }
    .barcode-line.thick {
      width: 3px;
    }
    
    .footer-info {
      font-size: 0.72rem;
      color: rgba(226, 232, 240, 0.45);
      font-weight: 500;
      text-align: right;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="aurora-bg"></div>
  <div class="aurora-bg-2"></div>
  <div class="poster">
    <span class="quote-icon">“</span>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    <div class="sections-container">
      ${sectionsHtml}
    </div>
    <div class="card-footer">
      <div class="barcode">
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
        <div class="barcode-line thick"></div>
        <div class="barcode-line"></div>
      </div>
      <div class="footer-info">
        ${escapeHtml(contentBrand)}<br>
        ${new Date().getFullYear()}
      </div>
    </div>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 8. 数据仪表盘
// ---------------------------------------------------------------------------

export function buildDataDashboard(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, 'Dashboard')

  // 提取关键指标（从第一个 section 的 bullets 中）
  const kpiSection = sections[0]
  const kpiCards = kpiSection?.bullets?.slice(0, 4).map((bullet, i) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
    const bgColors = ['rgba(59,130,246,0.04)', 'rgba(16,185,129,0.04)', 'rgba(245,158,11,0.04)', 'rgba(239,68,68,0.04)']
    const rawVal = bullet.split(':')[0] || bullet
    const rawLabel = bullet.split(':')[1] || '数据指标'
    
    // 模拟一个小上升趋势的 SVG 迷你折线图
    const miniChartSvg = `<svg class="mini-chart" viewBox="0 0 100 30" width="80" height="24">
      <path d="M 0 ${15 + Math.sin(i)*10} L 20 ${10 + Math.cos(i)*10} L 40 ${18 - Math.sin(i)*5} L 60 ${8 + Math.cos(i)*8} L 80 ${15 - Math.sin(i)*12} L 100 5" fill="none" stroke="${colors[i]}" stroke-width="2" stroke-linecap="round" style="filter: drop-shadow(0 2px 4px ${colors[i]}30)"></path>
    </svg>`

    return `<div class="kpi-card" style="border-top: 4px solid ${colors[i]}; background: ${bgColors[i]}">
      <div class="kpi-header">
        <span class="kpi-label">${escapeHtml(rawLabel)}</span>
        <span class="kpi-pulse" style="background-color: ${colors[i]}"></span>
      </div>
      <div class="kpi-body">
        <span class="kpi-value">${escapeHtml(rawVal)}</span>
        ${miniChartSvg}
      </div>
    </div>`
  }).join('\n') || ''

  const sectionHtml = sections.slice(1).map((section) => {
    const bullets = section.bullets?.length
      ? `<ul class="db-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="db-body">${renderMarkdown(section.body)}</p>`
      : ''

    return `
      <div class="report-section">
        <div class="section-title-wrap">
          <span class="section-decor"></span>
          <h2>${escapeHtml(section.title)}</h2>
        </div>
        ${body}
        ${bullets}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #1e293b;
      background: #f8fafc;
      line-height: 1.6;
      padding: 40px 24px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    
    header {
      margin-bottom: 32px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 24px;
    }
    
    .header-left h1 {
      font-size: 2rem;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.5px;
    }
    .header-left .subtitle {
      font-size: 0.95rem;
      color: #64748b;
      margin-top: 6px;
    }
    
    .header-right {
      text-align: right;
      font-size: 0.8rem;
      color: #64748b;
    }
    .badge-live {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #e2f9ec;
      color: #10b981;
      padding: 4px 10px;
      border-radius: 99px;
      font-weight: 600;
      font-size: 0.75rem;
      margin-bottom: 8px;
    }
    .live-dot {
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.9); opacity: 1; box-shadow: 0 0 0 0 rgba(16,185,129,0.7); }
      70% { transform: scale(1.1); opacity: 0.5; box-shadow: 0 0 0 6px rgba(16,185,129,0); }
      100% { transform: scale(0.9); opacity: 1; box-shadow: 0 0 0 0 rgba(16,185,129,0); }
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    
    .kpi-card {
      padding: 24px;
      background: white;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.02), 0 2px 6px -1px rgba(0, 0, 0, 0.02);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .kpi-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 24px -4px rgba(15, 23, 42, 0.06), 0 4px 12px -2px rgba(0, 0, 0, 0.02);
    }
    
    .kpi-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .kpi-label {
      font-size: 0.8rem;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .kpi-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    
    .kpi-body {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    
    .kpi-value {
      font-size: 1.85rem;
      font-weight: 700;
      color: #0f172a;
      font-variant-numeric: tabular-nums;
    }
    
    .mini-chart {
      opacity: 0.9;
      margin-bottom: 4px;
    }

    .report-section {
      padding: 32px;
      background: white;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.02);
      margin-bottom: 20px;
    }
    
    .section-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 12px;
    }
    .section-decor {
      width: 4px;
      height: 18px;
      background: #3b82f6;
      border-radius: 99px;
    }
    
    h2 {
      font-size: 1.25rem;
      font-weight: 700;
      color: #0f172a;
    }
    
    .db-body {
      margin-bottom: 16px;
      font-size: 0.98rem;
      color: #475569;
      background: #f8fafc;
      padding: 16px;
      border-radius: 8px;
      border-left: 3px solid #cbd5e1;
    }
    
    .db-list {
      list-style: none;
      margin: 16px 0;
    }
    .db-list li {
      margin-bottom: 10px;
      font-size: 0.95rem;
      color: #334155;
      padding-left: 20px;
      position: relative;
    }
    .db-list li::before {
      content: "→";
      position: absolute;
      left: 0;
      color: #3b82f6;
      font-weight: 700;
    }

    /* 数据仪表盘表格与代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.9em;
      border: 1px solid #e2e8f0 !important;
      background: white;
      border-radius: 8px;
      overflow: hidden;
    }
    th {
      background: #f8fafc !important;
      color: #0f172a !important;
      border-bottom: 2px solid #e2e8f0 !important;
      padding: 10px 14px;
      font-weight: 600;
    }
    tr:nth-child(even) {
      background: #f8fafc;
    }
    tr:hover td {
      background: #f1f5f9;
      transition: background 0.2s ease;
    }
    td {
      border-bottom: 1px solid #f1f5f9 !important;
      padding: 10px 14px;
      color: #334155;
    }
    code {
      font-family: inherit;
      background: rgba(59, 130, 246, 0.08) !important;
      color: #2563eb !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      font-weight: 500;
    }
    
    footer {
      margin-top: 48px;
      text-align: center;
      font-size: 0.8rem;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-left">
        <div class="badge-live">
          <span class="live-dot"></span>
          LIVE MONITORING
        </div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      <div class="header-right">
        <div><b>来源:</b> ${sourceLabel ? escapeHtml(sourceLabel) : '主工作区'}</div>
        <div style="margin-top: 4px;"><b>同步:</b> ${date}</div>
      </div>
    </header>
    ${kpiCards ? `<div class="kpi-grid">${kpiCards}</div>` : ''}
    <main>${sectionHtml}</main>
    <footer>
      ${escapeHtml(contentBrand)} · ${date}
    </footer>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 9. 信息图
// ---------------------------------------------------------------------------

export function buildInfographic(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel } = options
  const contentBrand = getContentBrand(options, 'Infographic')

  const sectionHtml = sections.map((section, i) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
    const color = colors[i % colors.length]
    const bullets = section.bullets?.length
      ? `<ul class="info-bullets">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="info-body">${renderMarkdown(section.body)}</p>`
      : ''

    return `
      <div class="timeline-item ${i % 2 === 0 ? 'left' : 'right'}">
        <div class="timeline-node" style="background: ${color}; box-shadow: 0 0 0 4px rgba(255,255,255,1), 0 0 0 8px ${color}40"></div>
        <div class="timeline-card" style="border-top: 4px solid ${color}">
          <div class="item-number" style="background: linear-gradient(135deg, ${color}, ${color}cc)">${String(i + 1).padStart(2, '0')}</div>
          <div class="item-content">
            <h3>${escapeHtml(section.title)}</h3>
            ${body}
            ${bullets}
          </div>
        </div>
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+SC:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #334155;
      background: #f1f5f9;
      min-height: 100vh;
      padding: 60px 16px;
    }
    
    .infographic {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 24px;
      padding: 56px 40px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.05);
      position: relative;
    }
    
    header {
      text-align: center;
      margin-bottom: 56px;
    }
    
    h1 {
      font-size: 2.5rem;
      font-weight: 800;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      font-size: 1.1rem;
      color: #64748b;
      font-weight: 400;
    }

    /* 时间轴布局 */
    .timeline {
      position: relative;
      margin: 40px 0;
      padding: 20px 0;
    }
    
    /* 时间轴中央线：升级为精致渐变虚线 */
    .timeline::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      width: 4px;
      background: repeating-linear-gradient(to bottom, #3b82f6 0px, #3b82f6 8px, transparent 8px, transparent 16px, #8b5cf6 16px, #8b5cf6 24px, transparent 24px, transparent 32px, #ec4899 32px, #ec4899 40px, transparent 40px, transparent 48px);
      border-radius: 99px;
      transform: translateX(-50%);
    }
    
    .timeline-item {
      display: flex;
      justify-content: flex-end;
      width: 50%;
      margin-bottom: 40px;
      position: relative;
    }
    .timeline-item.right {
      align-self: flex-end;
      margin-left: auto;
      justify-content: flex-start;
    }
    .timeline-item.left {
      margin-right: auto;
    }
    
    /* 节点呼吸微动效 */
    @keyframes pulse-node {
      0% { transform: scale(1); opacity: 1; }
      100% { transform: scale(1.2); opacity: 0.8; }
    }
    .timeline-node {
      position: absolute;
      top: 30px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      z-index: 5;
      animation: pulse-node 1.5s infinite alternate ease-in-out;
    }
    .timeline-item.left .timeline-node {
      right: -7px;
    }
    .timeline-item.right .timeline-node {
      left: -7px;
    }
    
    .timeline-card {
      width: calc(100% - 30px);
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.02);
      position: relative;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .timeline-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 16px 32px -4px rgba(15, 23, 42, 0.08), 0 4px 12px -2px rgba(0, 0, 0, 0.02);
    }
    
    .timeline-item.left .timeline-card {
      margin-right: 20px;
    }
    .timeline-item.right .timeline-card {
      margin-left: 20px;
    }
    
    .item-number {
      position: absolute;
      top: -15px;
      font-size: 0.8rem;
      font-weight: 700;
      color: white;
      padding: 2px 10px;
      border-radius: 99px;
    }
    .timeline-item.left .item-number { right: 20px; }
    .timeline-item.right .item-number { left: 20px; }

    .item-content h3 {
      font-size: 1.15rem;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
    }
    
    .info-body {
      font-size: 0.95rem;
      color: #475569;
      line-height: 1.5;
      margin-bottom: 12px;
    }
    
    .info-bullets {
      list-style-type: none;
      padding-left: 0;
    }
    .info-bullets li {
      font-size: 0.9rem;
      color: #64748b;
      margin-bottom: 8px;
      position: relative;
      padding-left: 16px;
    }
    .info-bullets li::before {
      content: "✦";
      position: absolute;
      left: 0;
      color: #3b82f6;
      font-size: 0.8rem;
    }

    /* 信息图内置表格与代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 0.85em;
      border: 1px solid #e2e8f0 !important;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
    }
    th {
      background: #f8fafc !important;
      color: #0f172a !important;
      border-bottom: 2px solid #e2e8f0 !important;
      padding: 8px 12px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid #f1f5f9 !important;
      padding: 8px 12px;
      color: #475569;
    }
    code {
      font-family: inherit;
      background: rgba(59, 130, 246, 0.05) !important;
      color: #2563eb !important;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 0.88em;
    }
    
    footer {
      margin-top: 56px;
      text-align: center;
      font-size: 0.8rem;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 24px;
    }

    /* 移动端响应式适配 */
    @media (max-width: 768px) {
      .timeline::before {
        left: 20px;
        transform: none;
      }
      .timeline-item {
        width: 100%;
        justify-content: flex-start;
      }
      .timeline-item.left .timeline-node,
      .timeline-item.right .timeline-node {
        left: 13px;
      }
      .timeline-item.left .timeline-card,
      .timeline-item.right .timeline-card {
        margin-left: 40px;
        margin-right: 0;
        width: calc(100% - 40px);
      }
      .timeline-item.left .item-number {
        left: 20px;
        right: auto;
      }
    }
  </style>
</head>
<body>
  <div class="infographic">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </header>
    <main class="timeline">
      ${sectionHtml}
    </main>
    <footer>
      ${sourceLabel ? `分析来源: ${escapeHtml(sourceLabel)} · ` : ''}${escapeHtml(contentBrand)}
    </footer>
  </div>
</body>
</html>`
}

export function buildGuizangSocialCard(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, 'Output')
  const visibleSections = sections.length > 0
    ? sections.slice(0, 5)
    : [{ title: '核心观点', body: subtitle || title, bullets: [] }]
  const heroSection = visibleSections[0]
  const coreLine = heroSection?.bullets?.[0]
    || heroSection?.body?.split(/[。.!?！？]/).find(Boolean)?.trim()
    || subtitle
    || heroSection?.title
    || ''

  const sectionCards = visibleSections.map((section, index) => {
    const body = section.body
      ? `<p class="card-copy">${renderMarkdown(section.body)}</p>`
      : ''
    const bullets = section.bullets?.length
      ? `<ul class="card-list">${section.bullets.slice(0, 4).map((bullet) => `<li>${renderMarkdown(bullet)}</li>`).join('')}</ul>`
      : ''
    const templateCode = index % 2 === 0 ? 'S03' : 'S07'

    return `
    <article class="gz-social-card detail-card">
      <div class="card-grid">
        <span class="template-code">${templateCode}</span>
        <span class="series-count">${String(index + 2).padStart(2, '0')} / ${String(visibleSections.length + 1).padStart(2, '0')}</span>
        <span class="vertical-label">${escapeHtml(contentBrand)}</span>
        <div class="rule rule-top"></div>
        <h2>${escapeHtml(section.title)}</h2>
        <div class="detail-index">${String(index + 1).padStart(2, '0')}</div>
        <div class="detail-body">
          ${body}
          ${bullets}
        </div>
        <footer class="card-footer">
          <span>${escapeHtml(contentBrand)}</span>
          <span>${date}</span>
        </footer>
      </div>
    </article>`
  }).join('\n')

  const directoryItems = visibleSections.slice(0, 5).map((section, index) => `
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
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&family=Noto+Sans+SC:wght@400;500;700;900&family=Source+Serif+4:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #f6f5f0;
      --ink: #111111;
      --muted: #706b62;
      --fine-line: rgba(17, 17, 17, 0.14);
      --line: rgba(17, 17, 17, 0.35);
      --accent: #e33e2b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 28px;
      color: var(--ink);
      background: #d8d3c8;
      font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
    }
    .card-stack {
      width: min(100%, 540px);
      display: grid;
      gap: 28px;
    }
    .gz-social-card {
      position: relative;
      width: 100%;
      aspect-ratio: 3 / 4;
      overflow: hidden;
      background: var(--paper);
      border: 1px solid var(--ink);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.06);
    }
    .card-grid {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      grid-template-rows: repeat(16, minmax(0, 1fr));
      gap: 8px;
      padding: 44px 42px 36px;
    }
    .card-grid::before {
      content: "";
      position: absolute;
      inset: 44px 42px 36px;
      pointer-events: none;
      background:
        repeating-linear-gradient(90deg, transparent 0, transparent calc(8.333% - 1px), rgba(17,17,17,0.035) calc(8.333% - 1px), rgba(17,17,17,0.035) 8.333%),
        repeating-linear-gradient(0deg, transparent 0, transparent calc(6.25% - 1px), rgba(17,17,17,0.028) calc(6.25% - 1px), rgba(17,17,17,0.028) 6.25%);
    }
    .template-code,
    .series-count,
    .vertical-label,
    .eyebrow,
    .card-footer {
      position: relative;
      z-index: 1;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .template-code {
      grid-column: 1 / 4;
      grid-row: 1 / 2;
      color: var(--accent);
      font-size: 18px;
    }
    .series-count {
      grid-column: 9 / 13;
      grid-row: 1 / 2;
      justify-self: end;
    }
    .vertical-label {
      grid-column: 12 / 13;
      grid-row: 3 / 12;
      writing-mode: vertical-rl;
      justify-self: end;
      color: rgba(17,17,17,0.38);
    }
    .rule {
      position: relative;
      z-index: 1;
      background: var(--ink);
    }
    .rule-top {
      grid-column: 1 / 13;
      grid-row: 2 / 3;
      align-self: start;
      height: 1px;
    }
    .eyebrow {
      grid-column: 1 / 8;
      grid-row: 3 / 4;
      color: var(--accent);
    }
    h1 {
      position: relative;
      z-index: 1;
      grid-column: 1 / 12;
      grid-row: 4 / 8;
      align-self: end;
      color: var(--ink);
      font-size: 50px;
      line-height: 0.98;
      font-weight: 300;
      letter-spacing: 0;
      text-wrap: balance;
    }
    h2 {
      position: relative;
      z-index: 1;
      grid-column: 1 / 10;
      grid-row: 4 / 8;
      align-self: end;
      color: var(--ink);
      font-size: 42px;
      line-height: 1.02;
      font-weight: 300;
      letter-spacing: 0;
      text-wrap: balance;
    }
    .lead {
      position: relative;
      z-index: 1;
      grid-column: 1 / 8;
      grid-row: 9 / 12;
      color: var(--accent);
      font-size: 22px;
      line-height: 1.35;
      font-weight: 300;
      text-wrap: balance;
    }
    .directory {
      position: relative;
      z-index: 1;
      grid-column: 1 / 12;
      grid-row: 12 / 16;
      list-style: none;
      display: grid;
      align-content: end;
      gap: 10px;
    }
    .directory li {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr);
      gap: 12px;
      align-items: baseline;
      border-top: 1px solid var(--fine-line);
      padding-top: 8px;
    }
    .directory span {
      color: var(--accent);
      font-size: 10px;
      font-weight: 700;
    }
    .directory strong {
      color: var(--ink);
      font-size: 14px;
      line-height: 1.22;
      font-weight: 400;
    }
    .detail-index {
      position: relative;
      z-index: 1;
      grid-column: 1 / 4;
      grid-row: 9 / 13;
      color: var(--accent);
      font-size: 96px;
      line-height: 0.82;
      font-weight: 300;
      letter-spacing: 0;
    }
    .detail-body {
      position: relative;
      z-index: 1;
      grid-column: 5 / 12;
      grid-row: 9 / 15;
      overflow: hidden;
      border-top: 1px solid var(--ink);
      padding-top: 14px;
    }
    .card-copy,
    .card-list li {
      color: #302d29;
      font-size: 15px;
      line-height: 1.62;
      font-weight: 400;
    }
    .card-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 9px;
      margin-top: 12px;
    }
    .card-list li {
      position: relative;
      padding-left: 18px;
    }
    .card-list li::before {
      content: "—";
      position: absolute;
      left: 0;
      color: var(--accent);
    }
    .card-footer {
      grid-column: 1 / 13;
      grid-row: 16 / 17;
      align-self: end;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid var(--fine-line);
      padding-top: 10px;
    }
    .cover-card::after {
      content: "";
      position: absolute;
      right: 42px;
      top: 50%;
      width: 76px;
      height: 76px;
      border: 1px solid var(--accent);
      transform: translateY(-50%);
    }
    .detail-card:nth-of-type(odd) {
      background: #fbfaf6;
    }
    @media (max-width: 560px) {
      body { padding: 12px; }
      .card-stack { width: 100%; gap: 16px; }
      .card-grid { padding: 30px 28px 26px; gap: 6px; }
      .card-grid::before { inset: 30px 28px 26px; }
      h1 { font-size: 36px; }
      h2 { font-size: 30px; }
      .lead { font-size: 18px; }
      .detail-index { font-size: 64px; }
      .card-copy,
      .card-list li { font-size: 14px; }
    }
  </style>
</head>
<body>
  <div class="card-stack">
    <article class="gz-social-card cover-card">
      <div class="card-grid">
        <span class="template-code">M01</span>
        <span class="series-count">01 / ${String(visibleSections.length + 1).padStart(2, '0')}</span>
        <span class="vertical-label">${escapeHtml(contentBrand)}</span>
        <div class="rule rule-top"></div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="lead">${escapeHtml(subtitle)}</p>` : ''}
        ${coreLine ? `<div class="hero-line">${escapeHtml(coreLine)}</div>` : ''}
        <ul class="directory-list">
          ${directoryItems}
        </ul>
        <footer class="card-footer">
          <span>${escapeHtml(contentBrand)}</span>
          <span>1080 × 1440 · 3:4</span>
        </footer>
      </div>
    </article>
    ${sectionCards}
  </div>
</body>
</html>
`
}

export function buildXiaohongshuStyle(options: BuildHtmlOptions): string {
  const { title, sections } = options
  const contentBrand = getContentBrand(options)
  const contentInitials = getContentInitials(contentBrand)
  const contentCategory = getContentCategory(options)

  // 1. 智能标题解析与核心高亮算法：自动分离前置修饰词与核心主干，保证排版优雅不切断词组
  let leadingTag = ''
  let coreTitle = title
  let suffixTag = ''

  // 自动分离前置年份或数字开头的分类标 (如 "2026", "DeepSeek")
  const leadingMatch = title.match(/^([a-zA-Z0-9\s#\-\_]+)([\u4e00-\u9fa5]+.*)/)
  if (leadingMatch) {
    leadingTag = leadingMatch[1].trim()
    coreTitle = leadingMatch[2]
  }

  // 自动剥离常见的中文后缀
  const suffixes = ['终极指南', '极简指南', '深度指南', '指南', '全景图', '知识手账', '手册', '方案', '改进方案', '发展史', '历史', '报告', '分析', '实战', '教程']
  for (const suffix of suffixes) {
    if (coreTitle.endsWith(suffix) && coreTitle.length > suffix.length) {
      coreTitle = coreTitle.slice(0, coreTitle.length - suffix.length)
      suffixTag = suffix
      break
    }
  }

  // 渲染大标题：前置标签 + 核心高亮主标题 + 优雅后缀
  const titleHtml = `
    <h2 class="cover-title">
      ${leadingTag ? `<span style="display: block; font-size: 1.25rem; font-weight: 800; color: #64748b; margin-bottom: 8px; font-family: 'Noto Sans SC', sans-serif; letter-spacing: 1px;">✦ ${escapeHtml(leadingTag)} ✦</span>` : ''}
      <span class="highlight-brush">${escapeHtml(coreTitle)}</span>
      ${suffixTag ? `<span style="display: block; font-size: 1.45rem; font-weight: 900; color: #1e293b; margin-top: 10px; font-family: 'Noto Serif SC', serif; letter-spacing: 0.5px;">${escapeHtml(suffixTag)}</span>` : ''}
    </h2>
  `

  // 2. 智能提取前言导读
  let introDesc = '从创意、MVP、发布到规模化：通过结构化知识大纲，帮您快速理清逻辑，编排系统思维。'
  if (sections[0]?.body) {
    const cleanBody = sections[0].body.replace(/[#*`\n]/g, ' ').trim()
    if (cleanBody.length > 20) {
      introDesc = cleanBody.slice(0, 48) + '...'
    }
  }

  // 3. 自适应 2x2 网格卡片算法，高亮第四格，一比一重塑顶级手账生命地图
  const gridSections = sections.slice(0, 4)
  const gridItemsHtml = []
  
  for (let idx = 0; idx < 4; idx++) {
    const section = gridSections[idx]
    if (section) {
      const isActive = idx === Math.min(gridSections.length - 1, 3)
      gridItemsHtml.push(`
        <div class="grid-card-item ${isActive ? 'active' : ''}">
          ${escapeHtml(section.title)}
        </div>
      `)
    } else {
      const isLast = idx === 3
      gridItemsHtml.push(`
        <div class="grid-card-item ${isLast ? 'active' : ''}" style="opacity: 0.65; font-style: italic;">
          ${isLast ? '深度探索 ✦' : '知识精进 ✦'}
        </div>
      `)
    }
  }

  const gridHtml = `
    <div class="summary-grid-card">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
        ${gridItemsHtml.join('')}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8; font-weight: 700; padding: 0 4px; border-top: 1px dashed #f1f5f9; padding-top: 8px; margin-top: 10px;">
        <span>📖 ${escapeHtml(contentCategory)}</span>
        <span>${escapeHtml((coreTitle || title).slice(0, 10))} ➔</span>
      </div>
    </div>
  `

  const coverCard = `
    <div class="cover-card">
      <!-- 磨砂半透明右上角播放按钮 -->
      <div style="position: absolute; right: 24px; top: 24px; width: 36px; height: 36px; border-radius: 50%; background: rgba(226, 232, 240, 0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.6); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.02); z-index: 10;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#64748b" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>
      </div>

      <!-- 左上角分类微标 -->
      <div style="font-size: 0.78rem; font-weight: 900; color: #334155; margin-bottom: 28px; text-align: left; position: relative; z-index: 2; display: flex; align-items: center; gap: 6px;">
        <span style="color: #c2410c; letter-spacing: 0.5px; font-family: 'Noto Sans SC', sans-serif;">${escapeHtml(contentBrand)}</span>
        <span style="color: #cbd5e1;">|</span>
        <span style="color: #64748b; font-weight: 500;">${escapeHtml(contentCategory)}</span>
      </div>

      <!-- 独特大字排版标题 -->
      ${titleHtml}

      <!-- 导言前言 -->
      <p style="font-size: 0.88rem; line-height: 1.6; color: #475569; margin-bottom: 20px; text-align: justify; word-break: break-all; padding: 0 4px; font-family: 'Noto Sans SC', sans-serif;">
        ${escapeHtml(introDesc)}
      </p>

      <!-- 2x2 网格卡片 -->
      ${gridHtml}
    </div>
  `

  // 4. 原有的各个章节子卡片生成
  const contentHtml = sections.slice(0, 5).map((section, i) => {
    const xhsEmojis = ['✨', '🔥', '💡', '✅', '👉', '📌', '💖', '⭐', '🎈', '🍀']
    const bullets = section.bullets?.slice(0, 5).map((b, idx) => {
      const emoji = xhsEmojis[(i + idx) % xhsEmojis.length]
      return `<li style="padding-left: 20px; position: relative; font-size: 0.95rem; margin-bottom: 8px; color: #475569; line-height: 1.6;"><span style="position: absolute; left: 0; font-size: 0.9rem;">${emoji}</span>${renderMarkdown(b)}</li>`
    }).join('') || ''

    const rotates = ['-1deg', '0.5deg', '-0.5deg', '1deg', '-0.8deg']
    const rotate = rotates[i % rotates.length]

    return `
      <div class="card" style="transform: rotate(${rotate}); margin-bottom: 28px; padding: 24px; background: #ffffff; border-radius: 24px; box-shadow: 0 16px 36px rgba(59, 130, 246, 0.04), 0 2px 6px rgba(0, 0, 0, 0.01), inset 0 1px 0 rgba(255, 255, 255, 0.6); border: 1px dashed rgba(59, 130, 246, 0.2); position: relative; transition: transform 0.2s ease;">
        <div class="card-pin"></div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px; color: #0f172a; display: inline-block; background: linear-gradient(120deg, #e0f2fe 0%, #e0f2fe 100%); background-repeat: no-repeat; background-size: 100% 35%; background-position: 0 90%;">${escapeHtml(section.title)}</h3>
        ${section.body ? `<div style="font-size: 0.95rem; line-height: 1.6; color: #334155; margin-bottom: 14px; text-align: justify; word-break: break-all;">${renderMarkdown(section.body)}</div>` : ''}
        ${bullets ? `<ul style="list-style: none; padding-left: 0;">${bullets}</ul>` : ''}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Noto+Serif+SC:wght@700;900&family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans SC', sans-serif;
      color: #1e293b;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
      min-height: 100vh;
      padding: 32px 16px;
      display: flex;
      justify-content: center;
      align-items: center;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    .container {
      max-width: 440px;
      width: 100%;
      background: #ffffff;
      border-radius: 36px;
      padding: 36px 24px;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.08);
      position: relative;
    }
    
    header {
      text-align: center;
      margin-bottom: 24px;
      display: none; /* 去除原本的外侧大 header */
    }
    
    .card-pin {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%) rotate(-3deg);
      width: 54px;
      height: 16px;
      background: rgba(254, 240, 138, 0.6); /* 胶带半透明暖黄 */
      border: 1px solid rgba(253, 224, 71, 0.3);
      backdrop-filter: blur(1.5px);
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
      z-index: 10;
    }
    
    .cover-card {
      margin-bottom: 28px;
      padding: 32px 24px 24px 24px;
      background-color: #faf6f0; /* 温润奶油黄纸色 */
      background-image: 
        linear-gradient(rgba(37, 99, 235, 0.02) 1.5px, transparent 1.5px),
        linear-gradient(90deg, rgba(37, 99, 235, 0.02) 1.5px, transparent 1.5px);
      background-size: 20px 20px; /* 20px 间距的高级网络纸底纹 */
      border-radius: 32px;
      box-shadow: 0 24px 48px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(0, 0, 0, 0.01), inset 0 1px 1px rgba(255, 255, 255, 0.7);
      border: 1px solid rgba(15, 23, 42, 0.05); /* 去除原本 6px 的厚卡纸外框，改用极其纤细清爽的侧切虚线 */
      position: relative;
      overflow: hidden;
      transition: transform 0.2s ease;
    }
    .cover-card:hover {
      transform: translateY(-2px) scale(1.005);
      box-shadow: 0 22px 45px rgba(15, 23, 42, 0.06), 0 6px 16px rgba(0, 0, 0, 0.015);
    }
 
    .cover-title {
      font-family: 'Noto Serif SC', 'Playfair Display', Georgia, serif;
      font-weight: 900;
      color: #1a202c;
      line-height: 1.4;
      text-align: center;
      margin-bottom: 24px;
      letter-spacing: 0.5px;
      position: relative;
      z-index: 2;
    }
 
    .highlight-brush {
      position: relative;
      display: inline-block;
      z-index: 1;
      padding: 0 6px;
      margin: 0 -2px;
      font-size: 1.85rem;
      color: #0f172a;
      letter-spacing: -0.5px;
    }
    .highlight-brush::after {
      content: "";
      position: absolute;
      bottom: 2px;
      left: 0;
      width: 100%;
      height: 38%; /* 黄色水彩涂鸦色块占半个字高 */
      background: #fef08a; /* 暖黄色水彩涂鸦色块 */
      z-index: -1;
      border-radius: 4px;
      transform: rotate(-0.5deg);
      opacity: 0.85;
    }
 
    .summary-grid-card {
      background: #ffffff;
      border-radius: 20px;
      padding: 20px 16px 14px 16px;
      border: 1px solid rgba(226, 232, 240, 0.8);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.015);
      position: relative;
      z-index: 2;
      margin-top: 24px;
    }
    
    .grid-card-item {
      background: #faf8f5;
      border: 1px solid rgba(226, 232, 240, 0.6);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 0.82rem;
      font-weight: 700;
      color: #334155;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      line-height: 1.3;
      font-family: 'Noto Sans SC', sans-serif;
    }
    
    .grid-card-item.active {
      background: #fde047; /* 醒目黄色 */
      border-color: #fde047;
      color: #1e3a8a;
    }

    .card {
      position: relative;
      background: #ffffff;
      border-radius: 24px;
      border: 1px solid rgba(59, 130, 246, 0.12);
      outline: 1px dashed rgba(59, 130, 246, 0.25);
      outline-offset: -6px; /* 虚线缝线效果 */
      box-shadow: 0 16px 36px rgba(59, 130, 246, 0.04), 0 2px 6px rgba(0, 0, 0, 0.01);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.012 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E"); /* 引入噪点背景 */
    }
    .card:hover {
      transform: translateY(-4px) scale(1.01) !important;
      box-shadow: 0 20px 40px rgba(59, 130, 246, 0.08), 0 4px 12px rgba(0, 0, 0, 0.015) !important;
    }
    
    .xhs-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1.5px dashed #f1f5f9;
    }
    
    .xhs-author {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .xhs-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #60a5fa);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 900;
      border: 2px solid #ffffff;
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.25);
    }
    .xhs-name {
      font-size: 0.82rem;
      font-weight: 700;
      color: #334155;
    }
    
    .xhs-buttons {
      display: flex;
      gap: 16px;
      font-size: 0.8rem;
      color: #64748b;
      font-weight: 600;
    }
    .xhs-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .xhs-btn:hover {
      transform: scale(1.1);
    }
    .xhs-btn.like { color: #3b82f6; }
    .xhs-btn.star { color: #f59e0b; }
  </style>
</head>
<body>
  <div class="container">
    <main>
      ${coverCard}
      ${contentHtml}
    </main>
    <div class="xhs-actions">
      <div class="xhs-author">
        <div class="xhs-avatar">${escapeHtml(contentInitials)}</div>
        <div class="xhs-name">${escapeHtml(contentBrand)}</div>
      </div>
      <div class="xhs-buttons">
        <div class="xhs-btn like">❤️ 99k</div>
        <div class="xhs-btn star">⭐ 88k</div>
      </div>
    </div>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 12. 学习卡片
// ---------------------------------------------------------------------------

export function buildLearningCards(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel } = options
  const contentBrand = getContentBrand(options, '学习卡片')

  const cardsHtml = sections.map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="flashcard-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="flashcard-body">${renderMarkdown(section.body)}</p>`
      : ''

    return `
    <div class="card" onclick="this.classList.toggle('flipped')">
      <div class="card-ring"></div>
      <div class="card-front">
        <div class="card-hole"></div>
        <span class="card-tag">CONCEPT CARD</span>
        <div class="card-number">${String(i + 1).padStart(2, '0')}</div>
        <h3>${escapeHtml(section.title)}</h3>
        <div class="hint">TAP TO REVEAL · 点击翻转</div>
      </div>
      <div class="card-back">
        <div class="card-hole"></div>
        <span class="card-tag-back">EXPLANATION</span>
        <div class="back-scroll">
          ${body}
          ${bullets}
        </div>
      </div>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #334155;
      background: #f1f5f9;
      min-height: 100vh;
      padding: 60px 16px;
    }
    
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    
    header {
      text-align: center;
      margin-bottom: 56px;
    }
    
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    
    .subtitle {
      font-size: 1.1rem;
      color: #64748b;
      font-weight: 400;
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 32px;
      padding: 20px 0;
    }
    
    .card {
      height: 340px;
      perspective: 1500px;
      cursor: pointer;
      position: relative;
      transition: transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .card:hover {
      transform: translateY(-8px) scale(1.02);
    }
    
    .card-front, .card-back {
      position: absolute;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      transition: transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      border-radius: 24px;
      padding: 40px 28px 24px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02);
    }
    
    .card-front {
      background: #faf9f6;
      border: 1px solid rgba(139, 92, 26, 0.15);
      text-align: center;
      justify-content: space-between;
      background-image: 
        linear-gradient(rgba(139, 92, 26, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(139, 92, 26, 0.04) 1px, transparent 1px);
      background-size: 16px 16px;
    }
    
    .card-back {
      background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%);
      color: #f8fafc;
      transform: rotateY(180deg);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 20px 40px rgba(30, 27, 75, 0.25);
      justify-content: flex-start;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.015 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    }
    
    .card.flipped .card-front {
      transform: rotateY(180deg);
    }
    .card.flipped .card-back {
      transform: rotateY(360deg);
    }
    
    /* 物理挂圈 & 挂孔 */
    .card-ring {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      width: 12px;
      height: 28px;
      border-radius: 6px;
      background: linear-gradient(90deg, #64748b 0%, #cbd5e1 30%, #e2e8f0 50%, #94a3b8 70%, #475569 100%);
      box-shadow: 0 4px 6px rgba(0,0,0,0.15);
      z-index: 10;
    }
    .card-hole {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: 16px;
      height: 16px;
      background: #f1f5f9;
      border: 2px solid #94a3b8;
      border-radius: 50%;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
      z-index: 5;
    }
    
    .card-tag {
      font-size: 0.65rem;
      letter-spacing: 2px;
      color: #8c8273;
      font-weight: 700;
      margin-top: 8px;
    }
    .card-tag-back {
      font-size: 0.65rem;
      letter-spacing: 2px;
      color: rgba(255,255,255,0.7);
      font-weight: 700;
      margin-bottom: 12px;
      text-align: center;
    }
    
    .card-number {
      font-family: 'Outfit', sans-serif;
      font-size: 3.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, #4f46e5, #9333ea);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1;
      margin-top: 10px;
    }
    
    h3 {
      font-size: 1.2rem;
      font-weight: 700;
      line-height: 1.4;
      color: #1e293b;
      margin-top: 10px;
      word-break: break-all;
    }
    
    .hint {
      font-size: 0.7rem;
      color: #a8a297;
      font-weight: 600;
      letter-spacing: 1px;
      margin-top: 16px;
    }
    
    .back-scroll {
      flex: 1;
      overflow-y: auto;
      padding-right: 4px;
    }
    /* 自定义背部滚动条 */
    .back-scroll::-webkit-scrollbar {
      width: 4px;
    }
    .back-scroll::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.3);
      border-radius: 99px;
    }
    
    .flashcard-body {
      font-size: 0.95rem;
      line-height: 1.55;
      margin-bottom: 16px;
      font-weight: 300;
      text-align: justify;
    }
    
    .flashcard-list {
      list-style-type: none;
    }
    .flashcard-list li {
      font-size: 0.9rem;
      margin-bottom: 8px;
      position: relative;
      padding-left: 18px;
      color: rgba(255,255,255,0.9);
      font-weight: 300;
      line-height: 1.45;
    }
    .flashcard-list li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #ffd700;
      font-weight: 700;
    }

    /* 抽认卡表格与代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 0.85em;
      border: 1px solid rgba(255,255,255,0.2) !important;
      background: rgba(255,255,255,0.08);
      border-radius: 8px;
    }
    th {
      background: rgba(255, 255, 255, 0.15) !important;
      color: #ffffff !important;
      border-bottom: 2px solid rgba(255,255,255,0.2) !important;
      padding: 8px 12px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid rgba(255,255,255,0.1) !important;
      padding: 8px 12px;
      color: rgba(255,255,255,0.9);
    }
    code {
      font-family: inherit;
      background: rgba(255, 255, 255, 0.25) !important;
      color: #ffd700 !important;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 0.88em;
      font-weight: 600;
    }
    
    footer {
      margin-top: 64px;
      text-align: center;
      font-size: 0.8rem;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </header>
    <div class="grid">${cardsHtml}</div>
    <footer>
      ${sourceLabel ? `学习来源: ${escapeHtml(sourceLabel)} · ` : ''}${escapeHtml(contentBrand)}
    </footer>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 13. 思维导图风格
// ---------------------------------------------------------------------------

export function buildMindmapStyle(options: BuildHtmlOptions): string {
  const { title, sections } = options

  // 左右分布算法：偶数放左边，奇数放右边
  const leftSections = sections.filter((_, idx) => idx % 2 === 0)
  const rightSections = sections.filter((_, idx) => idx % 2 !== 0)

  // 亮丽现代的微光科技配色
  const branchThemes = [
    { main: '#3b82f6', bg: 'rgba(59, 130, 246, 0.04)', border: 'rgba(59, 130, 246, 0.25)' }, // 冰川蓝
    { main: '#10b981', bg: 'rgba(16, 185, 129, 0.04)', border: 'rgba(16, 185, 129, 0.25)' }, // 薄荷绿
    { main: '#f59e0b', bg: 'rgba(245, 158, 11, 0.04)', border: 'rgba(245, 158, 11, 0.25)' }, // 琥珀黄
    { main: '#ec4899', bg: 'rgba(236, 72, 153, 0.04)', border: 'rgba(236, 72, 153, 0.25)' }, // 珊瑚粉
    { main: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.04)', border: 'rgba(139, 92, 246, 0.25)' }, // 丁香紫
    { main: '#ef4444', bg: 'rgba(239, 68, 68, 0.04)', border: 'rgba(239, 68, 68, 0.25)' }  // 绯红
  ]

  // 定义树节点接口
  interface MindmapNode {
    id: string
    text: string
    children: MindmapNode[]
  }

  // 智能树形解析辅助函数
  function parseToTree(bullets?: string[], body?: string, globalIdx: number = 0): MindmapNode[] {
    const lines: { text: string; depth: number }[] = []
    
    if (bullets && bullets.length > 0) {
      bullets.forEach(b => {
        const leadingSpaces = b.match(/^\s*/)?.[0] || ""
        const baseIndent = leadingSpaces.length
        const cleanLine = b.trim()
        if (!cleanLine) return
        
        const textWithoutBullet = cleanLine.replace(/^([-\*\+]\s+)|(^\d+\.\s+)/, '')
        const parts = textWithoutBullet.split(/[:：]/).map(p => p.trim()).filter(p => p.length > 0)
        
        if (parts.length > 1) {
          parts.forEach((part, partIdx) => {
            lines.push({
              text: part,
              depth: baseIndent + partIdx
            })
          })
        } else {
          lines.push({
            text: textWithoutBullet,
            depth: baseIndent
          })
        }
      })
    } else if (body) {
      const rawLines = body.split('\n')
      rawLines.forEach(line => {
        const leadingSpaces = line.match(/^\s*/)?.[0] || ""
        const baseIndent = leadingSpaces.length
        const cleanLine = line.trim()
        if (!cleanLine) return
        
        const textWithoutBullet = cleanLine.replace(/^([-\*\+]\s+)|(^\d+\.\s+)/, '')
        const parts = textWithoutBullet.split(/[:：]/).map(p => p.trim()).filter(p => p.length > 0)
        
        if (parts.length > 1) {
          parts.forEach((part, partIdx) => {
            lines.push({
              text: part,
              depth: baseIndent + partIdx
            })
          })
        } else {
          lines.push({
            text: textWithoutBullet,
            depth: baseIndent
          })
        }
      })
    }
    
    interface StackItem {
      node: MindmapNode
      depth: number
    }
    
    const rootNodes: MindmapNode[] = []
    const stack: StackItem[] = []
    
    lines.forEach((line, lineIdx) => {
      const node: MindmapNode = {
        id: `node-${globalIdx}-${lineIdx}`,
        text: line.text,
        children: []
      }
      
      while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) {
        stack.pop()
      }
      
      if (stack.length === 0) {
        rootNodes.push(node)
      } else {
        stack[stack.length - 1].node.children.push(node)
      }
      
      stack.push({
        node,
        depth: line.depth
      })
    })
    
    return rootNodes
  }

  // 递归树渲染逻辑
  function renderNode(
    node: MindmapNode,
    parentId: string,
    level: number,
    theme: { main: string; bg: string; border: string },
    side: 'left' | 'right',
    globalIdx: number
  ): string {
    let levelClass = `level-${level}`
    if (level >= 3) {
      levelClass = `level-deep level-${level}`
    }
    
    let styleStr = `--hover-color: ${theme.main};`
    if (level === 1) {
      styleStr += ` border: 1px solid ${theme.border}; background: ${theme.bg};`
    } else if (level === 2) {
      styleStr += ` border-bottom: 2px solid ${theme.main}70;`
    } else {
      styleStr += ` border-bottom: 2px solid ${theme.main}60;`
    }
    
    let contentHtml = renderMarkdown(node.text)
    if (level === 1) {
      const numStr = String(globalIdx + 1).padStart(2, '0')
      contentHtml = `
        <div class="branch-header" style="padding: 10px 14px; display: flex; align-items: center; gap: 8px;">
          <span class="branch-number" style="font-size: 0.72rem; font-weight: 700; background: ${theme.main}20; color: ${theme.main}; padding: 1px 6px; border-radius: 99px; border: 1px solid ${theme.border}; font-family: monospace;">${numStr}</span>
          <span class="branch-title" style="font-size: 0.95rem; font-weight: 700; color: #0f172a; letter-spacing: 0.5px;">${renderMarkdown(node.text)}</span>
        </div>`
    }

    const childrenHtml = node.children.length > 0 
      ? `<div class="children-container ${side}">
          ${node.children.map(child => renderNode(child, node.id, level + 1, theme, side, globalIdx)).join('\n')}
         </div>`
      : ''

    return `
      <div class="node-group ${side}">
        <div class="node ${levelClass} ${side}" id="${node.id}" data-parent="${parentId}" data-color="${theme.main}" style="${styleStr}">
          ${contentHtml}
        </div>
        ${childrenHtml}
      </div>`
  }

  const renderSectionToGroup = (section: ExtractedSection, globalIdx: number, side: 'left' | 'right') => {
    const theme = branchThemes[globalIdx % branchThemes.length]
    
    const branchTree: MindmapNode = {
      id: `node-${globalIdx}`,
      text: section.title,
      children: parseToTree(section.bullets, section.body, globalIdx)
    }

    return renderNode(branchTree, 'node-root', 1, theme, side, globalIdx)
  }

  const leftHtml = leftSections.map(s => {
    const globalIdx = sections.indexOf(s)
    return renderSectionToGroup(s, globalIdx, 'left')
  }).join('\n')

  const rightHtml = rightSections.map(s => {
    const globalIdx = sections.indexOf(s)
    return renderSectionToGroup(s, globalIdx, 'right')
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@300;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #1e293b;
      background: #f1f5f9;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }
    
    /* 容器及画布样式 */
    .mindmap-container {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: #f8fafc;
      background-image: 
        radial-gradient(rgba(15, 23, 42, 0.05) 1px, transparent 1px),
        linear-gradient(rgba(15, 23, 42, 0.015) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15, 23, 42, 0.015) 1px, transparent 1px);
      background-size: 20px 20px, 20px 20px, 20px 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: grab;
      user-select: none;
    }
    .mindmap-container:active {
      cursor: grabbing;
    }
    
    .mindmap-canvas {
      position: absolute;
      width: 3200px;
      height: 2400px;
      display: flex;
      justify-content: center;
      align-items: center;
      transform-origin: center center;
      z-index: 10;
    }
    
    /* SVG 连线层 */
    #mindmap-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }
    
    /* 思维导图 Flex 生长包裹器 */
    .mindmap-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 120px; /* 一级节点到根节点的连线空隙 */
      z-index: 5;
    }
    
    .left-side {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 48px;
    }
    .right-side {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 48px;
    }
    
    /* 树节点大组，包裹当前节点和它的所有子节点 */
    .node-group {
      display: flex;
      align-items: center;
      gap: 56px; /* 节点到子节点容器的连线空隙 */
      transition: all 0.3s ease;
    }
    .node-group.left {
      flex-direction: row-reverse; /* 左侧分支向左生长 */
    }
    .node-group.right {
      flex-direction: row; /* 右侧分支向右生长 */
    }
    
    /* 子节点容器，包裹所有子节点大组，垂直排列 */
    .children-container {
      display: flex;
      flex-direction: column;
      gap: 20px; /* 同级子节点之间的垂直间距 */
    }
    .children-container.left {
      align-items: flex-end; /* 左侧子节点右对齐 */
    }
    .children-container.right {
      align-items: flex-start; /* 右侧子节点左对齐 */
    }
    
    /* 统一节点基类 */
    .node {
      z-index: 10;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    /* 根节点 */
    .center-node-wrapper {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 260px;
    }
    .level-root {
      background: #0f172a !important;
      color: #f8fafc !important;
      font-weight: 800;
      font-size: 1.25rem;
      padding: 22px 36px;
      border-radius: 24px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
      border: 1px solid #1e293b;
      letter-spacing: 0.5px;
      line-height: 1.4;
      text-align: center;
      word-break: break-all;
      position: relative;
      overflow: hidden;
    }
    .level-root span {
      position: relative;
      z-index: 1;
    }
    .level-root:hover {
      transform: scale(1.03);
      box-shadow: 0 25px 60px rgba(99, 102, 241, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.2) inset !important;
    }
    
    /* 一级节点：半透明磨砂彩色气泡 */
    .level-1 {
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.04), 0 8px 16px -6px rgba(15, 23, 42, 0.02);
      min-width: 160px;
      max-width: 240px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .level-1:hover {
      transform: translateY(-4px) scale(1.03);
      box-shadow: 0 20px 35px -5px rgba(15, 23, 42, 0.08) !important;
    }
    
    /* 二级节点：轻盈的白色毛玻璃圆角小卡片 */
    .level-2 {
      font-size: 0.9rem;
      font-weight: 600;
      color: #334155;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(15, 23, 42, 0.06);
      border-radius: 10px;
      max-width: 220px;
      word-break: break-all;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.02);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .level-2:hover {
      background: #ffffff;
      border-color: var(--hover-color, #3b82f6);
      color: var(--hover-color, #3b82f6);
      transform: translateY(-2px) scale(1.04);
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.06);
    }
    
    /* 三级及以上：优雅的下划线树枝节点 */
    .level-deep {
      font-size: 0.86rem;
      font-weight: 500;
      color: #475569;
      padding: 6px 12px;
      max-width: 280px;
      word-break: break-all;
      text-align: left;
      transition: all 0.25s ease;
      background: transparent;
      border: none;
      border-radius: 0;
    }
    .level-deep:hover {
      color: var(--hover-color, #0f172a);
    }
    .level-deep.left:hover {
      transform: translateX(-4px);
    }
    .level-deep.right:hover {
      transform: translateX(4px);
    }
    
    /* 表格与代码特化 */
    .node table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 0.8em;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
      background: rgba(0, 0, 0, 0.01);
      border-radius: 6px;
      overflow: hidden;
    }
    .node th {
      background: rgba(0, 0, 0, 0.03) !important;
      color: #0f172a !important;
      border-bottom: 2px solid rgba(15, 23, 42, 0.08) !important;
      padding: 4px 8px;
    }
    .node td {
      border-bottom: 1px solid rgba(15, 23, 42, 0.04) !important;
      padding: 4px 8px;
      color: #334155;
    }
    .node code {
      background: rgba(15, 23, 42, 0.06) !important;
      color: #0f172a !important;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 0.88em;
    }
    
    /* 缩放及平移控制器 */
    .zoom-controls {
      position: fixed;
      top: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: rgba(255, 255, 255, 0.75);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      padding: 8px;
      border-radius: 12px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.05);
      z-index: 100;
    }
    .zoom-controls button {
      width: 36px;
      height: 36px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(0, 0, 0, 0.02);
      color: #334155;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1.2rem;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .zoom-controls button:hover {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
    }

    /* SVG 虚线流动动效 */
    @keyframes dash-flow {
      to {
        stroke-dashoffset: -20;
      }
    }
    .dash-flow-path {
      animation: dash-flow 1.2s linear infinite;
    }
  </style>
</head>
<body>
  <div class="zoom-controls">
    <button id="zoom-in" title="放大">＋</button>
    <button id="zoom-out" title="缩小">－</button>
    <button id="zoom-reset" title="自适应">⊙</button>
  </div>

  <div class="mindmap-container" id="mindmap-container">
    <div class="mindmap-canvas" id="mindmap-canvas">
      <svg id="mindmap-svg"></svg>
      <div class="mindmap-wrapper">
        <!-- 左半区 -->
        <div class="left-side">
          ${leftHtml}
        </div>
        
        <!-- 核心根节点 -->
        <div class="center-node-wrapper">
          <div class="node level-root" id="node-root"><span>${escapeHtml(title.slice(0, 20))}</span></div>
        </div>
        
        <!-- 右半区 -->
        <div class="right-side">
          ${rightHtml}
        </div>
      </div>
    </div>
  </div>

  <script>
    // -------------------------------------------------------------
    // Canvas Pan & Zoom 画布拖拽平移及滚轮缩放
    // -------------------------------------------------------------
    let scale = 1.0;
    let posX = 0;
    let posY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    
    const container = document.getElementById('mindmap-container');
    const canvas = document.getElementById('mindmap-canvas');
    
    function updateTransform() {
      canvas.style.transform = \`translate(\${posX}px, \${posY}px) scale(\${scale})\`;
    }
    
    // 鼠标滚轮缩放
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = 0.06;
      if (e.deltaY < 0) {
        scale = Math.min(scale + zoomFactor, 3.0);
      } else {
        scale = Math.max(scale - zoomFactor, 0.4);
      }
      updateTransform();
    }, { passive: false });
    
    // 画布鼠标拖拽平移
    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node') || e.target.closest('.zoom-controls')) return;
      isDragging = true;
      startX = e.clientX - posX;
      startY = e.clientY - posY;
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      posX = e.clientX - startX;
      posY = e.clientY - startY;
      updateTransform();
    });
    
    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // 悬浮按钮绑定
    document.getElementById('zoom-in').addEventListener('click', () => {
      scale = Math.min(scale + 0.2, 3.0);
      updateTransform();
    });
    
    document.getElementById('zoom-out').addEventListener('click', () => {
      scale = Math.max(scale - 0.2, 0.4);
      updateTransform();
    });
    
    document.getElementById('zoom-reset').addEventListener('click', () => {
      scale = 1.0;
      posX = 0;
      posY = 0;
      updateTransform();
    });
    
    // -------------------------------------------------------------
    // SVG Dynamic Bezier Connections (抗 transform 缩放的自适应连线)
    // -------------------------------------------------------------
    function getCanvasRelativeCenter(element, canvasEl) {
      let offsetLeft = 0;
      let offsetTop = 0;
      let el = element;
      while (el && el !== canvasEl) {
        offsetLeft += el.offsetLeft || 0;
        offsetTop += el.offsetTop || 0;
        el = el.offsetParent;
      }
      return {
        x: offsetLeft + element.offsetWidth / 2,
        y: offsetTop + element.offsetHeight / 2,
        w: element.offsetWidth,
        h: element.offsetHeight,
        left: offsetLeft,
        top: offsetTop
      };
    }
    
    function drawConnections() {
      const svg = document.getElementById('mindmap-svg');
      svg.innerHTML = '';
      
      const root = document.querySelector('.level-root');
      if (!root) return;
      
      const rootInfo = getCanvasRelativeCenter(root, canvas);
      const rx = rootInfo.x;
      const ry = rootInfo.y;
      
      // 遍历所有有 data-parent 的子节点，自适应绘制贝塞尔曲线
      const nodes = document.querySelectorAll('.node[data-parent]');
      nodes.forEach(node => {
        const parentId = node.getAttribute('data-parent');
        const parent = document.getElementById(parentId);
        if (!parent) return;
        
        const parentInfo = getCanvasRelativeCenter(parent, canvas);
        const selfInfo = getCanvasRelativeCenter(node, canvas);
        
        const color = node.getAttribute('data-color') || '#3b82f6';
        const isLeft = node.classList.contains('left');
        
        let startX = 0;
        let startY = parentInfo.y;
        let endX = 0;
        let endY = selfInfo.y;
        
        // 线条样式
        let strokeWidth = '2';
        let opacity = '0.75';
        if (node.classList.contains('level-1')) {
          strokeWidth = '3.5';
          opacity = '0.9';
        } else if (node.classList.contains('level-2')) {
          strokeWidth = '2.2';
          opacity = '0.8';
        } else {
          strokeWidth = '1.5';
          opacity = '0.65';
        }
        
        // 基于左右方向计算起终点端口
        if (isLeft) {
          startX = parentInfo.left;
          endX = selfInfo.left + selfInfo.w;
        } else {
          startX = parentInfo.left + parentInfo.w;
          endX = selfInfo.left;
        }
        
        // 控制点横向偏置，左侧偏负，右侧偏正
        const cpX = (startX + endX) / 2;
        const d = \`M \${startX} \${startY} C \${cpX} \${startY}, \${cpX} \${endY}, \${endX} \${endY}\`;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', strokeWidth);
        path.setAttribute('fill', 'none');
        path.setAttribute('opacity', opacity);
        path.setAttribute('stroke-linecap', 'round');
        
        const isDeep = !node.classList.contains('level-1') && !node.classList.contains('level-2');
        if (isDeep) {
          // 三级及以上深层分支使用虚线流动，显得逻辑清晰且轻盈
          path.setAttribute('stroke-dasharray', '5, 5');
          path.classList.add('dash-flow-path');
        }
        
        svg.appendChild(path);
      });
    }
    
    // 初始化与动态观察
    window.addEventListener('load', () => {
      drawConnections();
      // 在流式收到数据并触发 DOM 长度变动时自动刷新连线
      const observer = new MutationObserver(drawConnections);
      observer.observe(canvas, { childList: true, subtree: true, characterData: true });
    });
    
    window.addEventListener('resize', drawConnections);
  </script>
</body>
</html>`
}

// ===========================================================================
// 模板 2：瀑布流卡片模板 (social-waterfall)
// ===========================================================================
export function buildWaterfallStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options

  // 将 Sections 组装成瀑布流卡片列表
  const cardsHtml = sections.map((section, idx) => {
    // 分支色彩微调
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444']
    const themeColor = colors[idx % colors.length]

    const listHtml = section.bullets && section.bullets.length > 0
      ? `<ul class="waterfall-list">
          ${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('\n')}
         </ul>`
      : ''

    const bodyHtml = section.body ? `<div class="waterfall-body">${renderMarkdown(section.body)}</div>` : ''

    return `
      <div class="waterfall-card" style="border-top: 4px solid ${themeColor}; --theme-color: ${themeColor};">
        <div class="card-badge" style="background: ${themeColor}12; color: ${themeColor};">${String(idx + 1).padStart(2, '0')}</div>
        <h2 class="card-title">${escapeHtml(section.title)}</h2>
        ${bodyHtml}
        ${listHtml}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@300;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #1e293b;
      background: #f8fafc;
      min-height: 100vh;
      padding: 60px 24px;
      background-image: 
        radial-gradient(rgba(15, 23, 42, 0.04) 1px, transparent 1px),
        linear-gradient(rgba(15, 23, 42, 0.01) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15, 23, 42, 0.01) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    .waterfall-header {
      max-width: 1200px;
      margin: 0 auto 56px;
      text-align: center;
    }
    .waterfall-header h1 {
      font-size: clamp(2.2rem, 5vw, 3.2rem);
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
    }
    .waterfall-header p {
      font-size: 1.1rem;
      color: #64748b;
      font-weight: 400;
    }
    
    /* 瀑布流自适应布局 */
    .waterfall-grid {
      max-width: 1200px;
      margin: 0 auto;
      column-count: 3;
      column-gap: 28px;
    }
    @media (max-width: 1024px) {
      .waterfall-grid { column-count: 2; }
    }
    @media (max-width: 640px) {
      .waterfall-grid { column-count: 1; }
    }
    
    .waterfall-card {
      break-inside: avoid;
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.05);
      border-radius: 20px;
      padding: 28px 24px;
      margin-bottom: 28px;
      position: relative;
      box-shadow: 0 4px 20px rgba(15, 23, 42, 0.02), 0 1px 3px rgba(0, 0, 0, 0.01);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .waterfall-card:hover {
      transform: translateY(-8px);
      box-shadow: 0 20px 35px -10px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.02) !important;
    }
    
    .card-badge {
      position: absolute;
      top: 24px;
      right: 24px;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 99px;
      font-family: monospace;
    }
    .card-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 14px;
      padding-right: 32px;
    }
    .waterfall-body {
      font-size: 0.92rem;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 18px;
      text-align: justify;
    }
    .waterfall-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .waterfall-list li {
      font-size: 0.88rem;
      color: #475569;
      line-height: 1.5;
      position: relative;
      padding-left: 18px;
    }
    .waterfall-list li::before {
      content: "";
      position: absolute;
      left: 2px;
      top: 8px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--theme-color, #3b82f6);
    }
    .waterfall-list li strong {
      color: #0f172a;
    }
    
    /* 格式化表格/代码块 */
    .waterfall-card table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 0.8rem;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
    }
    .waterfall-card th {
      background: rgba(15, 23, 42, 0.03) !important;
      padding: 6px 10px;
      font-weight: 600;
      color: #0f172a !important;
      border-bottom: 2px solid rgba(15, 23, 42, 0.08) !important;
    }
    .waterfall-card td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.04) !important;
      color: #475569;
    }
    .waterfall-card code {
      background: rgba(15, 23, 42, 0.06) !important;
      color: #ef4444 !important;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 0.88em;
    }
  </style>
</head>
<body>
  <div class="waterfall-header">
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>
  <div class="waterfall-grid">
    ${cardsHtml}
  </div>
</body>
</html>`
}

// ===========================================================================
// 模板 4：Bento 网格画册模板 (visual-bento)
// ===========================================================================
export function buildBentoStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options

  // 拼接 Bento 格子，根据 sections 索引决定格子大小与排版
  const bentoGridItems = sections.map((sec, idx) => {
    // 渐变色彩系列，用作主图或强调
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
    const gradients = [
      'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', // 深邃灰黑
      'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
      'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)'
    ]

    let sizeClass = 'bento-medium'
    let cardStyle = ''
    const themeColor = colors[idx % colors.length]
    
    if (idx === 0) {
      sizeClass = 'bento-large'
      cardStyle = `background: ${gradients[0]}; color: #ffffff; --theme-color: #60a5fa;`
    } else if (idx === 1 || idx === 4) {
      sizeClass = 'bento-wide'
      cardStyle = `--theme-color: ${themeColor};`
    } else if (idx === 3) {
      cardStyle = `background: ${gradients[3]}08; border: 1px solid ${gradients[3]}20; --theme-color: ${themeColor};`
    } else {
      cardStyle = `--theme-color: ${themeColor};`
    }

    const isWhiteText = idx === 0
    const listHtml = sec.bullets && sec.bullets.length > 0
      ? `<ul class="bento-list" style="${isWhiteText ? 'color: rgba(255,255,255,0.75);' : ''}">
          ${sec.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('\n')}
         </ul>`
      : ''

    const bodyHtml = sec.body ? `<div class="bento-body" style="${isWhiteText ? 'color: rgba(255,255,255,0.85);' : ''}">${renderMarkdown(sec.body)}</div>` : ''

    const numStr = String(idx + 1).padStart(2, '0')
    const numberStyle = isWhiteText ? 'background: rgba(255,255,255,0.15); color: #ffffff;' : 'background: rgba(15, 23, 42, 0.05); color: #64748b;'

    return `
      <div class="bento-item ${sizeClass}" style="${cardStyle}">
        <div class="bento-badge" style="${numberStyle}">${numStr}</div>
        <h2 class="bento-title" style="${isWhiteText ? 'color: #ffffff;' : ''}">${escapeHtml(sec.title)}</h2>
        ${bodyHtml}
        ${listHtml}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@300;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #0f172a;
      background: #f1f5f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 60px 24px;
      overflow-x: hidden;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    header {
      max-width: 1400px;
      margin: 0 auto 48px;
      width: 100%;
      text-align: left;
    }
    header h1 {
      font-size: 2.5rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #0f172a;
      margin-bottom: 8px;
    }
    header p {
      font-size: 1.1rem;
      color: #64748b;
      font-weight: 400;
    }
    
    /* Bento 网格结构，基于 CSS Grid */
    .bento-container {
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-auto-rows: 250px;
      gap: 24px;
    }
    
    @media (max-width: 1024px) {
      .bento-container {
        grid-template-columns: repeat(2, 1fr);
        grid-auto-rows: minmax(220px, auto);
      }
    }
    @media (max-width: 640px) {
      .bento-container {
        grid-template-columns: 1fr;
        grid-auto-rows: auto;
      }
    }
    
    /* Bento 各单元尺寸 */
    .bento-item {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.05);
      border-radius: 28px;
      padding: 32px;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px -10px rgba(15, 23, 42, 0.03), 0 1px 3px rgba(0, 0, 0, 0.01);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .bento-item:hover {
      transform: translateY(-6px);
      box-shadow: 0 25px 45px -10px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.02) !important;
    }
    
    .bento-large {
      grid-column: span 2;
      grid-row: span 2;
    }
    .bento-wide {
      grid-column: span 2;
    }
    .bento-medium {
      grid-column: span 1;
    }
    
    @media (max-width: 1024px) {
      .bento-large, .bento-wide, .bento-medium {
        grid-column: span 1;
        grid-row: span 1;
      }
    }
    
    .bento-badge {
      position: absolute;
      top: 28px;
      right: 28px;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 99px;
      font-family: monospace;
    }
    .bento-title {
      font-size: 1.35rem;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 18px;
      padding-right: 32px;
      letter-spacing: -0.2px;
    }
    .bento-body {
      font-size: 0.92rem;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 18px;
      flex: 1;
      overflow: hidden;
      text-align: justify;
    }
    .bento-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bento-list li {
      font-size: 0.86rem;
      color: #475569;
      line-height: 1.45;
      position: relative;
      padding-left: 18px;
    }
    .bento-list li::before {
      content: "✦";
      position: absolute;
      left: 0;
      color: var(--theme-color, #3b82f6);
      font-size: 0.8rem;
    }
    .bento-list li strong {
      color: inherit;
    }
    
    /* 格式化表格/代码块 */
    .bento-item table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 0.78em;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
    }
    .bento-item th {
      background: rgba(15, 23, 42, 0.03) !important;
      padding: 4px 8px;
      font-weight: 600;
      color: inherit;
      border-bottom: 2px solid rgba(15, 23, 42, 0.08) !important;
    }
    .bento-item td {
      padding: 4px 8px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.04) !important;
      color: inherit;
    }
    .bento-item code {
      background: rgba(15, 23, 42, 0.06) !important;
      color: #ef4444 !important;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 0.88em;
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </header>
  <div class="bento-container">
    ${bentoGridItems}
  </div>
</body>
</html>`
}

// ===========================================================================
// 模板 7：商务简约报告模板 (report-business)
// ===========================================================================
export function buildBusinessReportStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options
  const contentBrand = getContentBrand(options, 'Report')

  // 左侧目录项生成
  const tocHtml = sections.map((sec, idx) => {
    return `<a href="#sec-${idx}" class="toc-link"><span class="toc-num">${String(idx + 1).padStart(2, '0')}</span>${escapeHtml(sec.title)}</a>`
  }).join('\n')

  // 右侧正文项生成
  const contentHtml = sections.map((sec, idx) => {
    const listHtml = sec.bullets && sec.bullets.length > 0
      ? `<ul class="report-list">
          ${sec.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('\n')}
         </ul>`
      : ''

    const bodyHtml = sec.body ? `<div class="report-body-p">${renderMarkdown(sec.body)}</div>` : ''

    return `
      <section id="sec-${idx}" class="report-section">
        <h2 class="section-title">
          <span class="title-num">${String(idx + 1).padStart(2, '0')}</span>
          ${escapeHtml(sec.title)}
        </h2>
        <div class="section-content-wrapper">
          ${bodyHtml}
          ${listHtml}
        </div>
      </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Inter', 'Noto Sans SC', sans-serif;
      color: #334155;
      background: #f8fafc;
      display: grid;
      grid-template-columns: 300px 1fr;
      min-height: 100vh;
    }
    
    /* 左侧固定目录 */
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      width: 300px;
      height: 100vh;
      border-right: 1px solid #e2e8f0;
      background: #ffffff;
      padding: 48px 32px;
      display: flex;
      flex-direction: column;
      z-index: 10;
      box-shadow: 4px 0 20px rgba(0, 0, 0, 0.01);
    }
    .sidebar-header {
      margin-bottom: 36px;
    }
    .sidebar-logo {
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #2563eb;
      margin-bottom: 12px;
    }
    .sidebar-title {
      font-size: 1.15rem;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.4;
    }
    .toc-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      flex: 1;
    }
    .toc-link {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.9rem;
      color: #64748b;
      text-decoration: none;
      font-weight: 500;
      padding: 8px 12px;
      border-radius: 8px;
      transition: all 0.25s ease;
    }
    .toc-link:hover {
      color: #2563eb;
      background: rgba(37, 99, 235, 0.04);
      transform: translateX(4px);
    }
    .toc-num {
      font-family: monospace;
      font-size: 0.75rem;
      font-weight: 700;
      color: #2563eb;
      background: rgba(37, 99, 235, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
    }
    
    /* 右侧正文区域 */
    .main-content {
      grid-column-start: 2;
      padding: 80px 8% 120px;
      max-width: 1000px;
      margin-left: 0;
    }
    
    .report-main-header {
      margin-bottom: 64px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 40px;
      position: relative;
    }
    .report-main-header::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 0;
      width: 80px;
      height: 2px;
      background: #2563eb;
    }
    .report-main-header h1 {
      font-size: 2.8rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -1px;
      margin-bottom: 12px;
      line-height: 1.25;
    }
    .report-main-header p {
      font-size: 1.05rem;
      color: #64748b;
    }
    
    .report-section {
      margin-bottom: 72px;
      scroll-margin-top: 80px;
    }
    .section-title {
      font-size: 1.5rem;
      font-weight: 800;
      color: #0f172a;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 14px;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .title-num {
      font-family: monospace;
      color: #2563eb;
      font-size: 1.2rem;
      font-weight: 800;
    }
    .section-content-wrapper {
      padding-left: 4px;
    }
    .report-body-p {
      font-size: 0.98rem;
      line-height: 1.8;
      color: #475569;
      margin-bottom: 24px;
      text-align: justify;
    }
    
    .report-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .report-list li {
      font-size: 0.95rem;
      color: #475569;
      line-height: 1.6;
      position: relative;
      padding-left: 20px;
    }
    .report-list li::before {
      content: "";
      position: absolute;
      left: 2px;
      top: 10px;
      width: 5px;
      height: 5px;
      background: #2563eb;
      border-radius: 50%;
    }
    .report-list li strong {
      color: #0f172a;
      font-weight: 600;
    }
    
    /* 严格的商务表格与引用块样式 */
    .report-section table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
      font-size: 0.88rem;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px;
      overflow: hidden;
    }
    .report-section th {
      background: #f8fafc !important;
      padding: 10px 14px;
      font-weight: 600;
      color: #0f172a !important;
      border-bottom: 2px solid #e2e8f0 !important;
      border-right: 1px solid #e2e8f0;
    }
    .report-section td {
      padding: 10px 14px;
      border-bottom: 1px solid #e2e8f0 !important;
      border-right: 1px solid #e2e8f0;
      color: #475569;
    }
    .report-section code {
      background: #f1f5f9 !important;
      color: #eb5757 !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      font-family: monospace;
    }
    
    @media (max-width: 860px) {
      body {
        grid-template-columns: 1fr;
      }
      .sidebar {
        display: none;
      }
      .main-content {
        grid-column-start: 1;
        padding: 60px 24px 80px;
      }
      .report-main-header h1 {
        font-size: 2.2rem;
      }
    }
  </style>
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">${escapeHtml(contentBrand)}</div>
      <div class="sidebar-title">${escapeHtml(title.slice(0, 32))}</div>
    </div>
    <nav class="toc-container">
      ${tocHtml}
    </nav>
  </aside>
  
  <main class="main-content">
    <header class="report-main-header">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
    </header>
    
    ${contentHtml}
  </main>
</body>
</html>`
}

// ===========================================================================
// 模板 8：液态玻璃阅读模板 (read-glass)
// ===========================================================================
export function buildLiquidGlassStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options
  const contentBrand = getContentBrand(options, 'Reader')

  // 目录与文章主体
  const tocHtml = sections.map((sec, idx) => {
    return `<a href="#glass-sec-${idx}" class="glass-toc-link">${escapeHtml(sec.title)}</a>`
  }).join('\n')

  const sectionsHtml = sections.map((sec, idx) => {
    const listHtml = sec.bullets && sec.bullets.length > 0
      ? `<ul class="glass-list">
          ${sec.bullets.map(b => `<li>✦ ${renderMarkdown(b)}</li>`).join('\n')}
         </ul>`
      : ''

    const bodyHtml = sec.body ? `<div class="glass-body-p">${renderMarkdown(sec.body)}</div>` : ''

    return `
      <section id="glass-sec-${idx}" class="glass-section">
        <h2 class="glass-section-title">${escapeHtml(sec.title)}</h2>
        ${bodyHtml}
        ${listHtml}
      </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    
    body {
      font-family: 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
      color: #0f172a;
      background: #f8fafc;
      min-height: 100vh;
      overflow-x: hidden;
      position: relative;
      transition: background 0.3s, color 0.3s;
    }
    
    /* 深色护眼模式配置 */
    body.dark-mode {
      background: #090b10 !important;
      color: #e2e8f0 !important;
    }
    
    /* 动态液态流体气泡背景 */
    .liquid-background {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 1;
      overflow: hidden;
      pointer-events: none;
    }
    .bubble {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
      opacity: 0.35;
      animation: float 25s infinite ease-in-out;
    }
    .bubble-1 {
      width: 400px;
      height: 400px;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      top: 10%;
      left: 5%;
    }
    .bubble-2 {
      width: 500px;
      height: 500px;
      background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%);
      bottom: 10%;
      right: 5%;
      animation-delay: -5s;
    }
    .bubble-3 {
      width: 350px;
      height: 350px;
      background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%);
      bottom: 40%;
      left: 45%;
      animation-delay: -10s;
    }
    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
      33% { transform: translate(60px, -80px) scale(1.1) rotate(120deg); }
      66% { transform: translate(-40px, 40px) scale(0.9) rotate(240deg); }
    }
    
    /* 超高透液态玻璃卡片容器 */
    .reader-container {
      position: relative;
      z-index: 2;
      max-width: 1100px;
      margin: 60px auto;
      background: rgba(255, 255, 255, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(30px) saturate(190%);
      -webkit-backdrop-filter: blur(30px) saturate(190%);
      border-radius: 28px;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.06);
      display: grid;
      grid-template-columns: 260px 1fr;
      overflow: hidden;
      transition: background 0.3s, border-color 0.3s;
    }
    body.dark-mode .reader-container {
      background: rgba(15, 23, 42, 0.6) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4) !important;
    }
    
    /* 玻璃左侧侧栏 */
    .glass-sidebar {
      border-right: 1px solid rgba(15, 23, 42, 0.06);
      padding: 48px 28px;
      display: flex;
      flex-direction: column;
      background: rgba(255, 255, 255, 0.15);
    }
    body.dark-mode .glass-sidebar {
      border-right-color: rgba(255, 255, 255, 0.06);
      .glass-section table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.82em;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
    }
    body.dark-mode .glass-section table {
      border-color: rgba(255, 255, 255, 0.08) !important;
    }
    .glass-section th {
      background: rgba(15, 23, 42, 0.03) !important;
      padding: 6px 10px;
      font-weight: 600;
      color: inherit;
      border-bottom: 2px solid rgba(15, 23, 42, 0.08) !important;
    }
    body.dark-mode .glass-section th {
      background: rgba(255, 255, 255, 0.03) !important;
      border-bottom-color: rgba(255, 255, 255, 0.08) !important;
    }
    .glass-section td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.04) !important;
      color: inherit;
    }
    body.dark-mode .glass-section td {
      border-bottom-color: rgba(255, 255, 255, 0.04) !important;
    }
    .glass-section code {
      background: rgba(15, 23, 42, 0.06) !important;
      color: #ef4444 !important;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 0.88em;
    }
    body.dark-mode .glass-section code {
      background: rgba(255, 255, 255, 0.08) !important;
    }
    
    @media (max-width: 768px) {
      .reader-container {
        grid-template-columns: 1fr;
        margin: 16px;
      }
      .glass-sidebar {
        display: none;
      }
      .glass-main {
        padding: 32px 24px;
      }
    }
  </style>
</head>
<body>
  <div class="liquid-background">
    <div class="bubble bubble-1"></div>
    <div class="bubble bubble-2"></div>
    <div class="bubble bubble-3"></div>
  </div>
  
  <div class="reader-container">
    <aside class="glass-sidebar">
      <div class="glass-logo">${escapeHtml(contentBrand)}</div>
      <nav class="glass-toc">
        ${tocHtml}
      </nav>
    </aside>
    
    <main class="glass-main">
      <nav class="glass-header-nav">
        <button class="glass-btn" id="btn-font-dec">A－</button>
        <button class="glass-btn" id="btn-font-inc">A＋</button>
        <button class="glass-btn" id="btn-mode">护眼模式</button>
      </nav>
      
      <header class="glass-title-p">
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </header>
      
      ${sectionsHtml}
    </main>
  </div>
  
  <script>
    // 护眼模式切换
    const modeBtn = document.getElementById('btn-mode');
    modeBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
    });
    
    // 字体无级调节
    let baseSize = 0.98;
    const fontInc = document.getElementById('btn-font-inc');
    const fontDec = document.getElementById('btn-font-dec');
    
    fontInc.addEventListener('click', () => {
      baseSize = Math.min(baseSize + 0.08, 1.4);
      document.documentElement.style.setProperty('--glass-font-size', baseSize + 'rem');
    });
    
    fontDec.addEventListener('click', () => {
      baseSize = Math.max(baseSize - 0.08, 0.8);
      document.documentElement.style.setProperty('--glass-font-size', baseSize + 'rem');
    });
  </script>
</body>
</html>`
}

export function buildAccordionManualStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options

  // 纯 CSS details 手风琴实现，默认只展开第一个，其他折叠
  const accordionsHtml = sections.map((sec, idx) => {
    const listHtml = sec.bullets && sec.bullets.length > 0
      ? `<ul class="accordion-list">
          ${sec.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('\n')}
         </ul>`
      : ''

    const bodyHtml = sec.body ? `<div class="accordion-body-p">${renderMarkdown(sec.body)}</div>` : ''

    const openAttr = idx === 0 ? 'open' : ''

    return `
      <details class="accordion-card" ${openAttr}>
        <summary class="accordion-summary">
          <span class="summary-num">${String(idx + 1).padStart(2, '0')}</span>
          <span class="summary-text">${escapeHtml(sec.title)}</span>
          <span class="summary-arrow"></span>
        </summary>
        <div class="accordion-content">
          ${bodyHtml}
          ${listHtml}
        </div>
      </details>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #334155;
      background: #f8fafc;
      min-height: 100vh;
      padding: 64px 24px;
      background-image: 
        radial-gradient(rgba(15, 23, 42, 0.04) 1px, transparent 1px),
        linear-gradient(rgba(15, 23, 42, 0.01) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15, 23, 42, 0.01) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    
    .manual-wrapper {
      max-width: 800px;
      margin: 0 auto;
    }
    
    header {
      text-align: center;
      margin-bottom: 48px;
    }
    header h1 {
      font-size: 2.5rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    header p {
      font-size: 1.05rem;
      color: #64748b;
    }
    
    .accordion-container {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    
    /* 纯 CSS 手风琴详情标签系统 */
    .accordion-card {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.05);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(15, 23, 42, 0.01), 0 1px 3px rgba(0, 0, 0, 0.01);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .accordion-card:hover {
      border-color: rgba(15, 23, 42, 0.1);
      box-shadow: 0 12px 24px -4px rgba(15, 23, 42, 0.04);
      transform: translateY(-2px);
    }
    
    .accordion-summary {
      display: flex;
      align-items: center;
      padding: 22px 28px;
      list-style: none;
      cursor: pointer;
      font-weight: 700;
      color: #0f172a;
      outline: none;
      user-select: none;
    }
    /* 隐藏原生 summary 三角 */
    .accordion-summary::-webkit-details-marker {
      display: none;
    }
    
    .summary-num {
      font-family: monospace;
      color: #3b82f6;
      font-size: 0.88rem;
      font-weight: 700;
      background: rgba(59, 130, 246, 0.06);
      padding: 3px 8px;
      border-radius: 6px;
      margin-right: 14px;
    }
    .summary-text {
      flex: 1;
      font-size: 1.1rem;
      letter-spacing: -0.2px;
    }
    
    /* 旋转箭头 */
    .summary-arrow {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .summary-arrow::before {
      content: "";
      width: 8px;
      height: 8px;
      border-bottom: 2px solid #64748b;
      border-right: 2px solid #64748b;
      transform: rotate(45deg);
      margin-top: -4px;
      transition: all 0.3s;
    }
    
    /* details 展开状态样式 */
    .accordion-card[open] {
      border-color: rgba(59, 130, 246, 0.3);
      box-shadow: 0 20px 40px -10px rgba(59, 130, 246, 0.08);
    }
    .accordion-card[open] .summary-arrow {
      transform: rotate(-180deg);
    }
    .accordion-card[open] .summary-arrow::before {
      border-color: #3b82f6;
    }
    .accordion-card[open] .accordion-summary {
      border-bottom: 1px solid rgba(15, 23, 42, 0.04);
      background: rgba(59, 130, 246, 0.01);
    }
    
    .accordion-content {
      padding: 28px 32px;
      background: #fafbfc;
      animation: slideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .accordion-body-p {
      font-size: 0.95rem;
      line-height: 1.75;
      color: #475569;
      margin-bottom: 20px;
      text-align: justify;
    }
    .accordion-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .accordion-list li {
      font-size: 0.9rem;
      color: #475569;
      line-height: 1.55;
      position: relative;
      padding-left: 20px;
    }
    .accordion-list li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #3b82f6;
      font-weight: 700;
    }
    .accordion-list li strong {
      color: #0f172a;
      font-weight: 600;
    }
    
    /* 格式化表格/代码块 */
    .accordion-card table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 0.8em;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
    }
    .accordion-card th {
      background: rgba(15, 23, 42, 0.03) !important;
      padding: 6px 10px;
      font-weight: 600;
      color: #0f172a !important;
      border-bottom: 2px solid rgba(15, 23, 42, 0.08) !important;
    }
    .accordion-card td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.04) !important;
      color: #475569;
    }
    .accordion-card code {
      background: rgba(15, 23, 42, 0.06) !important;
      color: #ef4444 !important;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 0.88em;
    }
  </style>
</head>
<body>
  <div class="manual-wrapper">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
    </header>
    <div class="accordion-container">
      ${accordionsHtml}
    </div>
  </div>
</body>
</html>`
}

// ===========================================================================
// 模板 10：暗黑科技专业模板 (read-dark-tech)
// ===========================================================================
export function buildDarkTechStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options

  // 生成科技感区块
  const techBlocksHtml = sections.map((sec, idx) => {
    const listHtml = sec.bullets && sec.bullets.length > 0
      ? `<ul class="tech-list">
          ${sec.bullets.map(b => `<li><span class="tech-dot"></span>${renderMarkdown(b)}</li>`).join('\n')}
         </ul>`
      : ''

    const bodyHtml = sec.body ? `<div class="tech-body-p">${renderMarkdown(sec.body)}</div>` : ''

    return `
      <div class="tech-block">
        <div class="tech-card-meta">
          <span class="tech-meta-id">ID: 0x${String(idx + 1).padStart(2, '0')}</span>
          <span class="tech-meta-line"></span>
          <span class="tech-meta-status">SYS_STATUS: ACTIVE</span>
        </div>
        <div class="tech-block-hdr">
          <span class="tech-num">${String(idx + 1).padStart(2, '0')}</span>
          <h2 class="tech-block-title">${escapeHtml(sec.title)}</h2>
        </div>
        ${bodyHtml}
        ${listHtml}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Plus+Jakarta+Sans:wght@300;400;600;800&family=Noto+Sans+SC:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --neon-blue: #00f2fe;
      --neon-green: #10b981;
      --neon-cyan: #06b6d4;
      --dark-bg: #070913;
      --card-bg: rgba(13, 18, 30, 0.75);
      --border-color: rgba(6, 182, 212, 0.15);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
      color: var(--text-secondary);
      background-color: var(--dark-bg);
      min-height: 100vh;
      padding: 64px 24px;
      position: relative;
      /* 赛博朋克极暗网格背景与发光暗纹 */
      background-image: 
        linear-gradient(rgba(6, 182, 212, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(6, 182, 212, 0.02) 1px, transparent 1px),
        radial-gradient(circle at 50% 25%, rgba(6, 182, 212, 0.06) 0%, transparent 60%);
      background-size: 24px 24px, 24px 24px, 100% 100%;
      background-attachment: fixed;
    }
    
    .tech-wrapper {
      max-width: 860px;
      margin: 0 auto;
      position: relative;
    }
    
    header {
      margin-bottom: 56px;
      border-left: 3px solid var(--neon-cyan);
      padding-left: 24px;
      position: relative;
    }
    header::after {
      content: "";
      position: absolute;
      bottom: -16px;
      left: 24px;
      width: 60px;
      height: 2px;
      background: var(--neon-green);
    }
    header h1 {
      font-size: 2.4rem;
      font-weight: 800;
      color: var(--text-primary);
      letter-spacing: -0.5px;
      margin-bottom: 8px;
      text-shadow: 0 0 20px rgba(6, 182, 212, 0.15);
    }
    header p {
      font-size: 0.95rem;
      color: var(--text-muted);
      font-family: 'Fira Code', monospace;
      letter-spacing: 0.5px;
    }
    
    .tech-container {
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
    
    /* 霓虹极客卡片 */
    .tech-block {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 32px;
      position: relative;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      backdrop-filter: blur(12px);
    }
    /* 四个角的极客微直角护盾点缀 */
    .tech-block::before, .tech-block::after {
      content: "";
      position: absolute;
      width: 8px;
      height: 8px;
      border-color: var(--neon-cyan);
      border-style: solid;
      pointer-events: none;
      opacity: 0.5;
      transition: all 0.3s ease;
    }
    .tech-block::before {
      top: 8px; left: 8px;
      border-width: 2px 0 0 2px;
    }
    .tech-block::after {
      bottom: 8px; right: 8px;
      border-width: 0 2px 2px 0;
    }
    
    .tech-block:hover {
      border-color: rgba(6, 182, 212, 0.35);
      box-shadow: 
        0 20px 40px -15px rgba(6, 182, 212, 0.15),
        inset 0 0 15px rgba(6, 182, 212, 0.05);
      transform: translateY(-2px);
    }
    .tech-block:hover::before, .tech-block:hover::after {
      opacity: 1;
      border-color: var(--neon-green);
    }
    
    /* 元数据控制行 */
    .tech-card-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: 'Fira Code', monospace;
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-bottom: 16px;
      opacity: 0.8;
    }
    .tech-meta-line {
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, rgba(6, 182, 212, 0.15), transparent);
    }
    .tech-meta-id {
      color: var(--neon-cyan);
    }
    .tech-meta-status {
      letter-spacing: 0.5px;
    }
    
    .tech-block-hdr {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 20px;
    }
    .tech-num {
      font-family: 'Fira Code', monospace;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--neon-green);
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    .tech-block-title {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.2px;
    }
    
    .tech-body-p {
      font-size: 0.95rem;
      line-height: 1.8;
      color: var(--text-secondary);
      margin-bottom: 20px;
      text-align: justify;
    }
    
    .tech-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .tech-list li {
      font-size: 0.9rem;
      color: var(--text-secondary);
      line-height: 1.6;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .tech-dot {
      width: 6px;
      height: 6px;
      background: var(--neon-cyan);
      box-shadow: 0 0 8px var(--neon-cyan);
      border-radius: 1px; /* 科技感方点 */
      margin-top: 8px;
      flex-shrink: 0;
    }
    .tech-list li strong {
      color: var(--text-primary);
      font-weight: 600;
    }
    
    /* 表格极客重绘 */
    .tech-block table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.82em;
      border: 1px solid rgba(6, 182, 212, 0.18) !important;
      background: rgba(5, 7, 12, 0.35);
      border-radius: 8px;
      overflow: hidden;
    }
    .tech-block th {
      background: rgba(6, 182, 212, 0.05) !important;
      padding: 10px 14px;
      font-weight: 600;
      color: var(--text-primary) !important;
      border-bottom: 2px solid rgba(6, 182, 212, 0.18) !important;
      text-align: left;
    }
    .tech-block td {
      padding: 10px 14px;
      border-bottom: 1px solid rgba(6, 182, 212, 0.06) !important;
      color: var(--text-secondary);
    }
    .tech-block tr:hover td {
      background: rgba(6, 182, 212, 0.02);
      color: var(--text-primary);
    }
    
    /* 行内代码与代码块 */
    .tech-block code {
      font-family: 'Fira Code', monospace;
      background: rgba(6, 182, 212, 0.08) !important;
      color: #22d3ee !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      border: 1px solid rgba(6, 182, 212, 0.15);
    }
    
    .tech-block pre {
      position: relative;
      background: #05070c !important;
      border: 1px solid rgba(6, 182, 212, 0.2) !important;
      border-radius: 8px;
      padding: 38px 16px 16px 16px !important;
      margin: 20px 0;
      overflow-x: auto;
      box-shadow: inset 0 0 12px rgba(6, 182, 212, 0.05);
    }
    /* 终端样式控制点 */
    .tech-block pre::before {
      content: "";
      position: absolute;
      top: 14px;
      left: 16px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 
        0 0 4px #ef4444,
        14px 0 0 #f59e0b, 14px 0 4px rgba(245, 158, 11, 0.4),
        28px 0 0 #10b981, 28px 0 4px rgba(16, 185, 129, 0.4);
    }
    .tech-block pre code {
      background: none !important;
      border: none !important;
      color: #e2e8f0 !important;
      padding: 0 !important;
      font-size: 0.85rem !important;
      line-height: 1.6;
      display: block;
    }
    
    /* 响应式适配 */
    @media (max-width: 768px) {
      body {
        padding: 40px 16px;
      }
      header {
        margin-bottom: 40px;
      }
      header h1 {
        font-size: 1.8rem;
      }
      .tech-block {
        padding: 24px 20px;
      }
      .tech-block-title {
        font-size: 1.1rem;
      }
    }
  </style>
</head>
<body>
  <div class="tech-wrapper">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
    </header>
    <div class="tech-container">
      ${techBlocksHtml}
    </div>
  </div>
</body>
</html>`
}
