import { escapeHtml, renderMarkdown, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildLearningCards(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel } = options
  const contentBrand = getContentBrand(options, '学习卡片')

  const cardsHtml = sections.map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="flashcard-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="flashcard-body">${renderMarkdown(section.body)}</p>`
      : ''

    return `
    <div class="card" onclick="this.classList.toggle('flipped')">
      <div class="card-ring"></div>
      <div class="card-front">
        <div class="card-hole"></div>
        <span class="card-tag">CONCEPT CARD</span>
        <div class="card-number">${String(i + 1).padStart(2, '0')}</div>
        <h3>${escapeHtml(section.title)}</h3>
        <div class="hint">TAP TO REVEAL · 点击翻转</div>
      </div>
      <div class="card-back">
        <div class="card-hole"></div>
        <span class="card-tag-back">EXPLANATION</span>
        <div class="back-scroll">
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
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #334155;
      background: #f1f5f9;
      min-height: 100vh;
      padding: 60px 16px;
    }
    
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    
    header {
      text-align: center;
      margin-bottom: 56px;
    }
    
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    
    .subtitle {
      font-size: 1.1rem;
      color: #64748b;
      font-weight: 400;
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 32px;
      padding: 20px 0;
    }
    
    .card {
      height: 340px;
      perspective: 1500px;
      cursor: pointer;
      position: relative;
      transition: transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .card:hover {
      transform: translateY(-8px) scale(1.02);
    }
    
    .card-front, .card-back {
      position: absolute;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      transition: transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      border-radius: 24px;
      padding: 40px 28px 24px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02);
    }
    
    .card-front {
      background: #faf9f6;
      border: 1px solid rgba(139, 92, 26, 0.15);
      text-align: center;
      justify-content: space-between;
      background-image: 
        linear-gradient(rgba(139, 92, 26, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(139, 92, 26, 0.04) 1px, transparent 1px);
      background-size: 16px 16px;
    }
    
    .card-back {
      background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%);
      color: #f8fafc;
      transform: rotateY(180deg);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 20px 40px rgba(30, 27, 75, 0.25);
      justify-content: flex-start;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.015 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    }
    
    .card.flipped .card-front {
      transform: rotateY(180deg);
    }
    .card.flipped .card-back {
      transform: rotateY(360deg);
    }
    
    /* 物理挂圈 & 挂孔 */
    .card-ring {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      width: 12px;
      height: 28px;
      border-radius: 6px;
      background: linear-gradient(90deg, #64748b 0%, #cbd5e1 30%, #e2e8f0 50%, #94a3b8 70%, #475569 100%);
      box-shadow: 0 4px 6px rgba(0,0,0,0.15);
      z-index: 10;
    }
    .card-hole {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: 16px;
      height: 16px;
      background: #f1f5f9;
      border: 2px solid #94a3b8;
      border-radius: 50%;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
      z-index: 5;
    }
    
    .card-tag {
      font-size: 0.65rem;
      letter-spacing: 2px;
      color: #8c8273;
      font-weight: 700;
      margin-top: 8px;
    }
    .card-tag-back {
      font-size: 0.65rem;
      letter-spacing: 2px;
      color: rgba(255,255,255,0.7);
      font-weight: 700;
      margin-bottom: 12px;
      text-align: center;
    }
    
    .card-number {
      font-family: 'Outfit', sans-serif;
      font-size: 3.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, #4f46e5, #9333ea);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1;
      margin-top: 10px;
    }
    
    h3 {
      font-size: 1.2rem;
      font-weight: 700;
      line-height: 1.4;
      color: #1e293b;
      margin-top: 10px;
      word-break: break-all;
    }
    
    .hint {
      font-size: 0.7rem;
      color: #a8a297;
      font-weight: 600;
      letter-spacing: 1px;
      margin-top: 16px;
    }
    
    .back-scroll {
      flex: 1;
      overflow-y: auto;
      padding-right: 4px;
    }
    /* 自定义背部滚动条 */
    .back-scroll::-webkit-scrollbar {
      width: 4px;
    }
    .back-scroll::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.3);
      border-radius: 99px;
    }
    
    .flashcard-body {
      font-size: 0.95rem;
      line-height: 1.55;
      margin-bottom: 16px;
      font-weight: 300;
      text-align: justify;
    }
    
    .flashcard-list {
      list-style-type: none;
    }
    .flashcard-list li {
      font-size: 0.9rem;
      margin-bottom: 8px;
      position: relative;
      padding-left: 18px;
      color: rgba(255,255,255,0.9);
      font-weight: 300;
      line-height: 1.45;
    }
    .flashcard-list li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #ffd700;
      font-weight: 700;
    }

    /* 抽认卡表格与代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 0.85em;
      border: 1px solid rgba(255,255,255,0.2) !important;
      background: rgba(255,255,255,0.08);
      border-radius: 8px;
    }
    th {
      background: rgba(255, 255, 255, 0.15) !important;
      color: #ffffff !important;
      border-bottom: 2px solid rgba(255,255,255,0.2) !important;
      padding: 8px 12px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid rgba(255,255,255,0.1) !important;
      padding: 8px 12px;
      color: rgba(255,255,255,0.9);
    }
    code {
      font-family: inherit;
      background: rgba(255, 255, 255, 0.25) !important;
      color: #ffd700 !important;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 0.88em;
      font-weight: 600;
    }
    
    footer {
      margin-top: 64px;
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
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </header>
    <div class="grid">${cardsHtml}</div>
    <footer>
      ${sourceLabel ? `学习来源: ${escapeHtml(sourceLabel)} · ` : ''}${escapeHtml(contentBrand)}
    </footer>
  </div>
</body>
</html>`
}
