import { escapeHtml, renderMarkdown, type BuildHtmlOptions } from "../shared/builder-utils"

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
