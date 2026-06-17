import { escapeHtml, renderMarkdown, formatDate, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

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
