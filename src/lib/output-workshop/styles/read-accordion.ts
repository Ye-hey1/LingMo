import { escapeHtml, renderMarkdown, type BuildHtmlOptions } from "../shared/builder-utils"

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
