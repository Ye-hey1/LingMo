import { escapeHtml, renderMarkdown, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

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
