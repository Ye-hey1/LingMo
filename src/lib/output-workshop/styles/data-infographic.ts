import { escapeHtml, renderMarkdown, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

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
