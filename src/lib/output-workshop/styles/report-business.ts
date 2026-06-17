import { escapeHtml, renderMarkdown, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

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
