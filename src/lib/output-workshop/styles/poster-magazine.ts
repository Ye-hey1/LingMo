import { escapeHtml, renderMarkdown, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildMagazinePoster(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel } = options
  const contentBrand = getContentBrand(options, 'Weekly Journal')

  const sectionHtml = sections.slice(0, 6).map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="mag-list">${section.bullets.slice(0, 3).map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<div class="mag-body">${renderMarkdown(section.body)}</div>`
      : ''
    
    // 错落样式：第2和第5张卡片为深色强调卡
    const isDarkCard = i === 1 || i === 4;

    return `
      <div class="card ${isDarkCard ? 'card-dark' : 'card-light'}">
        <div class="card-header">
          <span class="card-number">${String(i + 1).padStart(2, '0')}</span>
          <span class="card-category">SECTION</span>
        </div>
        <h3>${escapeHtml(section.title)}</h3>
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
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,800;1,400&family=Noto+Serif+SC:wght@600;900&family=Montserrat:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Playfair Display', 'Noto Serif SC', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, serif;
      color: #2b2b2b;
      background: #f4efeb;
      min-height: 100vh;
      padding: 40px 16px;
      background-image: radial-gradient(rgba(220, 209, 196, 0.4) 1.5px, transparent 0);
      background-size: 10px 10px;
    }
    
    .poster {
      max-width: 680px;
      margin: 0 auto;
      background: #faf7f2;
      border: 1px solid #dcd1c4;
      padding: 48px;
      box-shadow: 0 25px 60px rgba(43,33,23,0.08);
      position: relative;
    }
    .poster::before {
      content: "";
      position: absolute;
      top: 12px; left: 12px; right: 12px; bottom: 12px;
      border: 1px solid #e8decb;
      pointer-events: none;
    }
    
    header {
      text-align: center;
      margin-bottom: 40px;
      border-bottom: 2px solid #2b2b2b;
      padding-bottom: 32px;
    }
    
    .mag-tag {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.7rem;
      letter-spacing: 4px;
      text-transform: uppercase;
      font-weight: 600;
      color: #8a6d4d;
      margin-bottom: 16px;
      display: block;
    }

    h1 {
      font-size: 2.8rem;
      font-weight: 900;
      line-height: 1.15;
      margin-bottom: 16px;
      color: #1c1c1c;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      font-size: 1.1rem;
      color: #555;
      font-style: italic;
      font-family: 'Playfair Display', serif;
    }
    
    .mag-meta {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      font-family: 'Montserrat', sans-serif;
      font-size: 0.7rem;
      font-weight: 600;
      color: #8c8273;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 580px) {
      .cards {
        grid-template-columns: 1fr;
      }
    }
    
    .card {
      padding: 24px;
      border: 1px solid #e6dccb;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 16px 32px rgba(138, 109, 77, 0.12);
    }
    
    .card-dark {
      background: #3e3227;
      color: #f7f3ed;
      border-color: #3e3227;
    }
    .card-light {
      background: #ffffff;
      color: #2b2b2b;
    }
    
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      font-family: 'Montserrat', sans-serif;
      font-size: 0.65rem;
      font-weight: 600;
      letter-spacing: 1px;
    }
    
    .card-number {
      font-size: 1.3rem;
      font-weight: 800;
      font-family: 'Playfair Display', serif;
    }
    .card-dark .card-number { color: #d7c5ae; }
    .card-light .card-number { color: #8a6d4d; }
    
    .card-category {
      opacity: 0.6;
    }
    
    h3 {
      font-size: 1.15rem;
      font-weight: 700;
      line-height: 1.35;
      margin-bottom: 12px;
    }

    .mag-body {
      font-size: 0.85rem;
      line-height: 1.5;
      margin-bottom: 12px;
      opacity: 0.85;
      text-align: justify;
    }
    .card-dark .mag-body {
      color: #e6dccb;
    }
    .card-light .mag-body {
      color: #555555;
    }

    /* 杂志卡片内置表格与代码 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 0.8em;
      border: 1px solid #dcd1c4 !important;
    }
    .card-dark table {
      border-color: #5e4f41 !important;
      background: rgba(255, 255, 255, 0.02);
    }
    .card-light table {
      background: #faf7f2;
    }
    th {
      padding: 6px 10px;
      font-weight: 600;
      border-bottom: 2px solid #dcd1c4 !important;
      color: inherit !important;
    }
    .card-dark th {
      background: rgba(255, 255, 255, 0.05) !important;
      border-bottom-color: #5e4f41 !important;
    }
    .card-light th {
      background: rgba(138, 109, 77, 0.05) !important;
    }
    td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05) !important;
    }
    .card-dark td {
      border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
    }
    code {
      font-family: inherit;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 0.85em;
    }
    .card-dark code {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #d7c5ae !important;
    }
    .card-light code {
      background: rgba(138, 109, 77, 0.08) !important;
      color: #8a6d4d !important;
    }
    
    .mag-list {
      list-style-type: none;
    }
    .mag-list li {
      font-size: 0.85rem;
      line-height: 1.45;
      margin-bottom: 8px;
      opacity: 0.8;
      position: relative;
      padding-left: 12px;
    }
    .mag-list li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: #8a6d4d;
    }
    .card-dark .mag-list li::before {
      color: #d7c5ae;
    }
    
    /* 底部条形码装饰线 */
    .mag-footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #dcd1c4;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .barcode {
      display: flex;
      gap: 2px;
      height: 30px;
      align-items: flex-end;
      opacity: 0.5;
    }
    .barcode-line {
      width: 1.5px;
      height: 100%;
      background: #2b2b2b;
    }
    .barcode-line.thick {
      width: 3.5px;
    }
    
    .footer-text {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.65rem;
      color: #8c8273;
      text-align: right;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="poster">
    <header>
      <span class="mag-tag">${escapeHtml(contentBrand).toUpperCase()}</span>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
      <div class="mag-meta">
        <span>VOL. ${new Date().getMonth() + 1} / NO. ${new Date().getDate()}</span>
        <span>${sourceLabel ? `FROM: ${escapeHtml(sourceLabel)}` : 'DESIGN FOCUS'}</span>
      </div>
    </header>
    <div class="cards">
      ${sectionHtml}
    </div>
    <div class="mag-footer">
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
      <div class="footer-text">
        ${sourceLabel ? `FROM ${escapeHtml(sourceLabel)}` : escapeHtml(contentBrand)}<br>
        ${new Date().getFullYear()}
      </div>
    </div>
  </div>
</body>
</html>`
}
