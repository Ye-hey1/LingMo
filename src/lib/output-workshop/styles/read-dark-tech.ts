import { escapeHtml, renderMarkdown, type BuildHtmlOptions } from "../shared/builder-utils"

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
