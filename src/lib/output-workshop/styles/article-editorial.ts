import { escapeHtml, renderMarkdown, formatDate, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

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
