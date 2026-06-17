import { escapeHtml, renderMarkdown, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildLiquidGlassStyle(options: BuildHtmlOptions): string {
  const { title, subtitle, sections } = options
  const contentBrand = getContentBrand(options, 'Reader')

  // 目录与文章主体
  const tocHtml = sections.map((sec, idx) => {
    return `<a href="#glass-sec-${idx}" class="glass-toc-link">${escapeHtml(sec.title)}</a>`
  }).join('\n')

  const sectionsHtml = sections.map((sec, idx) => {
    const listHtml = sec.bullets && sec.bullets.length > 0
      ? `<ul class="glass-list">
          ${sec.bullets.map(b => `<li>✦ ${renderMarkdown(b)}</li>`).join('\n')}
         </ul>`
      : ''

    const bodyHtml = sec.body ? `<div class="glass-body-p">${renderMarkdown(sec.body)}</div>` : ''

    return `
      <section id="glass-sec-${idx}" class="glass-section">
        <h2 class="glass-section-title">${escapeHtml(sec.title)}</h2>
        ${bodyHtml}
        ${listHtml}
      </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    
    body {
      font-family: 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
      color: #0f172a;
      background: #f8fafc;
      min-height: 100vh;
      overflow-x: hidden;
      position: relative;
      transition: background 0.3s, color 0.3s;
    }
    
    /* 深色护眼模式配置 */
    body.dark-mode {
      background: #090b10 !important;
      color: #e2e8f0 !important;
    }
    
    /* 动态液态流体气泡背景 */
    .liquid-background {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 1;
      overflow: hidden;
      pointer-events: none;
    }
    .bubble {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
      opacity: 0.35;
      animation: float 25s infinite ease-in-out;
    }
    .bubble-1 {
      width: 400px;
      height: 400px;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      top: 10%;
      left: 5%;
    }
    .bubble-2 {
      width: 500px;
      height: 500px;
      background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%);
      bottom: 10%;
      right: 5%;
      animation-delay: -5s;
    }
    .bubble-3 {
      width: 350px;
      height: 350px;
      background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%);
      bottom: 40%;
      left: 45%;
      animation-delay: -10s;
    }
    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
      33% { transform: translate(60px, -80px) scale(1.1) rotate(120deg); }
      66% { transform: translate(-40px, 40px) scale(0.9) rotate(240deg); }
    }
    
    /* 超高透液态玻璃卡片容器 */
    .reader-container {
      position: relative;
      z-index: 2;
      max-width: 1100px;
      margin: 60px auto;
      background: rgba(255, 255, 255, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(30px) saturate(190%);
      -webkit-backdrop-filter: blur(30px) saturate(190%);
      border-radius: 28px;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.06);
      display: grid;
      grid-template-columns: 260px 1fr;
      overflow: hidden;
      transition: background 0.3s, border-color 0.3s;
    }
    body.dark-mode .reader-container {
      background: rgba(15, 23, 42, 0.6) !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4) !important;
    }
    
    /* 玻璃左侧侧栏 */
    .glass-sidebar {
      border-right: 1px solid rgba(15, 23, 42, 0.06);
      padding: 48px 28px;
      display: flex;
      flex-direction: column;
      background: rgba(255, 255, 255, 0.15);
    }
    body.dark-mode .glass-sidebar {
      border-right-color: rgba(255, 255, 255, 0.06);
      .glass-section table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.82em;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
    }
    body.dark-mode .glass-section table {
      border-color: rgba(255, 255, 255, 0.08) !important;
    }
    .glass-section th {
      background: rgba(15, 23, 42, 0.03) !important;
      padding: 6px 10px;
      font-weight: 600;
      color: inherit;
      border-bottom: 2px solid rgba(15, 23, 42, 0.08) !important;
    }
    body.dark-mode .glass-section th {
      background: rgba(255, 255, 255, 0.03) !important;
      border-bottom-color: rgba(255, 255, 255, 0.08) !important;
    }
    .glass-section td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.04) !important;
      color: inherit;
    }
    body.dark-mode .glass-section td {
      border-bottom-color: rgba(255, 255, 255, 0.04) !important;
    }
    .glass-section code {
      background: rgba(15, 23, 42, 0.06) !important;
      color: #ef4444 !important;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 0.88em;
    }
    body.dark-mode .glass-section code {
      background: rgba(255, 255, 255, 0.08) !important;
    }
    
    @media (max-width: 768px) {
      .reader-container {
        grid-template-columns: 1fr;
        margin: 16px;
      }
      .glass-sidebar {
        display: none;
      }
      .glass-main {
        padding: 32px 24px;
      }
    }
  </style>
</head>
<body>
  <div class="liquid-background">
    <div class="bubble bubble-1"></div>
    <div class="bubble bubble-2"></div>
    <div class="bubble bubble-3"></div>
  </div>
  
  <div class="reader-container">
    <aside class="glass-sidebar">
      <div class="glass-logo">${escapeHtml(contentBrand)}</div>
      <nav class="glass-toc">
        ${tocHtml}
      </nav>
    </aside>
    
    <main class="glass-main">
      <nav class="glass-header-nav">
        <button class="glass-btn" id="btn-font-dec">A－</button>
        <button class="glass-btn" id="btn-font-inc">A＋</button>
        <button class="glass-btn" id="btn-mode">护眼模式</button>
      </nav>
      
      <header class="glass-title-p">
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </header>
      
      ${sectionsHtml}
    </main>
  </div>
  
  <script>
    // 护眼模式切换
    const modeBtn = document.getElementById('btn-mode');
    modeBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
    });
    
    // 字体无级调节
    let baseSize = 0.98;
    const fontInc = document.getElementById('btn-font-inc');
    const fontDec = document.getElementById('btn-font-dec');
    
    fontInc.addEventListener('click', () => {
      baseSize = Math.min(baseSize + 0.08, 1.4);
      document.documentElement.style.setProperty('--glass-font-size', baseSize + 'rem');
    });
    
    fontDec.addEventListener('click', () => {
      baseSize = Math.max(baseSize - 0.08, 0.8);
      document.documentElement.style.setProperty('--glass-font-size', baseSize + 'rem');
    });
  </script>
</body>
</html>`
}
