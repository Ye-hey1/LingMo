import { escapeHtml, renderMarkdown, formatDate, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildKamiParchment(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, '手记')

  // 将数字转为中文大写数字
  const toChineseNum = (n: number) => {
    const chars = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾']
    if (n <= 10) return chars[n]
    return n.toString()
  }

  const sectionHtml = sections.map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="classical-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="classical-p">${renderMarkdown(section.body)}</p>`
      : ''

    return `
      <section class="section">
        <h2><span class="chapter-seal">第${toChineseNum(i + 1)}回</span> ${escapeHtml(section.title)}</h2>
        ${body}
        ${bullets}
      </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Serif SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Source Han Serif CN', 'SimSun', serif;
      color: #2c302e;
      background: #faf7ee;
      line-height: 1.95;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.015 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
      word-break: break-all;
      text-align: justify;
      text-justify: inter-character;
    }
    
    .outer-container {
      max-width: 700px;
      margin: 48px auto;
      padding: 16px;
    }

    .classical-frame {
      border: 1px solid #c0a880;
      outline: 4px double #d5c8b3;
      outline-offset: -10px;
      padding: 48px 36px;
      position: relative;
      background: #fdfcf7;
      box-shadow: 0 10px 30px rgba(184,166,135,0.15);
    }
    .classical-frame::before {
      content: "";
      position: absolute;
      top: 14px; left: 14px; right: 14px; bottom: 14px;
      border: 1px dashed #e1d7c6;
      pointer-events: none;
    }
    
    header {
      text-align: center;
      margin-bottom: 56px;
      position: relative;
    }
    
    /* 古典装饰纹理 */
    .cloud-deco {
      width: 100px;
      height: 16px;
      margin: 16px auto;
      opacity: 0.7;
    }
    
    h1 {
      font-size: 2.2rem;
      font-weight: 700;
      margin-bottom: 12px;
      color: #1e2022;
      letter-spacing: 2px;
    }
    
    .subtitle {
      font-size: 1rem;
      color: #7f8c8d;
      font-style: italic;
      letter-spacing: 1px;
    }
    
    .divider {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin: 24px auto;
      color: #b83b30;
    }
    .divider::before, .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: linear-gradient(to right, transparent, #d5c8b3, transparent);
    }

    .meta {
      font-size: 0.8rem;
      color: #888;
      letter-spacing: 1px;
    }

    .section {
      margin-bottom: 48px;
      position: relative;
    }
    
    h2 {
      font-size: 1.35rem;
      font-weight: 600;
      margin-bottom: 20px;
      color: #1e2022;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .chapter-seal {
      background: #b83b30;
      color: #fff;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 3px 2px 4px 2px;
      font-weight: 600;
      letter-spacing: 1px;
      box-shadow: 1px 1px 2px rgba(184,59,48,0.2);
      border: 1px solid #9e2b20;
      font-family: 'Noto Serif SC', serif;
      background-image: linear-gradient(135deg, rgba(255,255,255,0.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 75%, transparent 75%, transparent);
      background-size: 8px 8px;
    }

    .classical-p {
      margin-bottom: 20px;
      text-align: justify;
      text-justify: inter-character;
      text-indent: 2em;
      font-size: 1.05rem;
    }
    
    .classical-list {
      list-style-type: none;
      margin: 20px 0;
      padding-left: 2em;
    }
    .classical-list li {
      margin-bottom: 10px;
      font-size: 1rem;
      position: relative;
      padding-left: 20px;
    }
    .classical-list li::before {
      content: "✦";
      position: absolute;
      left: 0;
      color: #b83b30;
      font-weight: bold;
    }

    /* 古典表格和代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
      font-size: 0.9rem;
      border: 1px solid #d5c8b3 !important;
      background: #faf8f2;
    }
    th {
      background: #f3edd8 !important;
      border-bottom: 2px solid #d5c8b3 !important;
      color: #7a1d12 !important;
      padding: 10px 14px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid #e8decb !important;
      padding: 10px 14px;
    }
    code {
      font-family: inherit;
      background: #f5eedc !important;
      border: 1px solid #e5dcb9;
      color: #a92215 !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    
    footer {
      margin-top: 64px;
      text-align: center;
      font-size: 0.8rem;
      color: #95a5a6;
      border-top: 1px double #eae4d6;
      padding-top: 24px;
    }
  </style>
</head>
<body>
  <div class="outer-container">
    <div class="classical-frame">
      <header>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
        <div class="divider">✦ ✦ ✦</div>
        <div class="meta">${sourceLabel ? `出处：${escapeHtml(sourceLabel)} &nbsp;·&nbsp; ` : ''}撰于 ${date}</div>
      </header>
      <main>${sectionHtml}</main>
      <footer>${escapeHtml(contentBrand)} · ${date}</footer>
    </div>
  </div>
</body>
</html>`
}
