import { escapeHtml, renderMarkdown, formatDate, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

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
