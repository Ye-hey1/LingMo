import { escapeHtml, renderMarkdown, type BuildHtmlOptions } from "../shared/builder-utils"

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
