import { escapeHtml, renderMarkdown, formatDate, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildGuizangSocialCard(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, 'Output')
  const visibleSections = sections.length > 0
    ? sections.slice(0, 5)
    : [{ title: '核心观点', body: subtitle || title, bullets: [] }]
  const heroSection = visibleSections[0]
  const coreLine = heroSection?.bullets?.[0]
    || heroSection?.body?.split(/[。.!?！？]/).find(Boolean)?.trim()
    || subtitle
    || heroSection?.title
    || ''

  const sectionCards = visibleSections.map((section, index) => {
    const body = section.body
      ? `<p class="card-copy">${renderMarkdown(section.body)}</p>`
      : ''
    const bullets = section.bullets?.length
      ? `<ul class="card-list">${section.bullets.slice(0, 4).map((bullet) => `<li>${renderMarkdown(bullet)}</li>`).join('')}</ul>`
      : ''
    const templateCode = index % 2 === 0 ? 'S03' : 'S07'

    return `
    <article class="gz-social-card detail-card">
      <div class="card-grid">
        <span class="template-code">${templateCode}</span>
        <span class="series-count">${String(index + 2).padStart(2, '0')} / ${String(visibleSections.length + 1).padStart(2, '0')}</span>
        <span class="vertical-label">${escapeHtml(contentBrand)}</span>
        <div class="rule rule-top"></div>
        <h2>${escapeHtml(section.title)}</h2>
        <div class="detail-index">${String(index + 1).padStart(2, '0')}</div>
        <div class="detail-body">
          ${body}
          ${bullets}
        </div>
        <footer class="card-footer">
          <span>${escapeHtml(contentBrand)}</span>
          <span>${date}</span>
        </footer>
      </div>
    </article>`
  }).join('\n')

  const directoryItems = visibleSections.slice(0, 5).map((section, index) => `
            <li>
              <span>${String(index + 1).padStart(2, '0')}</span>
              <strong>${escapeHtml(section.title)}</strong>
            </li>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&family=Noto+Sans+SC:wght@400;500;700;900&family=Source+Serif+4:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #f6f5f0;
      --ink: #111111;
      --muted: #706b62;
      --fine-line: rgba(17, 17, 17, 0.14);
      --line: rgba(17, 17, 17, 0.35);
      --accent: #e33e2b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 28px;
      color: var(--ink);
      background: #d8d3c8;
      font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
    }
    .card-stack {
      width: min(100%, 520px);
      display: grid;
      gap: 28px;
    }
    .gz-social-card {
      position: relative;
      width: 100%;
      aspect-ratio: 3 / 4;
      overflow: hidden;
      background: var(--paper);
      border: 1px solid var(--ink);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.06);
    }
    .card-grid {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      grid-template-rows: repeat(16, minmax(0, 1fr));
      gap: 8px;
      padding: 36px 38px 32px;
    }
    .card-grid::before {
      content: "";
      position: absolute;
      inset: 36px 38px 32px;
      pointer-events: none;
      background:
        repeating-linear-gradient(90deg, transparent 0, transparent calc(8.333% - 1px), rgba(17,17,17,0.035) calc(8.333% - 1px), rgba(17,17,17,0.035) 8.333%),
        repeating-linear-gradient(0deg, transparent 0, transparent calc(6.25% - 1px), rgba(17,17,17,0.028) calc(6.25% - 1px), rgba(17,17,17,0.028) 6.25%);
    }
    .template-code,
    .series-count,
    .vertical-label,
    .eyebrow,
    .card-footer {
      position: relative;
      z-index: 1;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .template-code {
      grid-column: 1 / 4;
      grid-row: 1 / 2;
      color: var(--accent);
      font-size: 18px;
    }
    .series-count {
      grid-column: 9 / 13;
      grid-row: 1 / 2;
      justify-self: end;
    }
    .vertical-label {
      grid-column: 12 / 13;
      grid-row: 3 / 12;
      writing-mode: vertical-rl;
      justify-self: end;
      color: rgba(17,17,17,0.38);
    }
    .rule {
      position: relative;
      z-index: 1;
      background: var(--ink);
    }
    .rule-top {
      grid-column: 1 / 13;
      grid-row: 2 / 3;
      align-self: start;
      height: 1px;
    }
    .eyebrow {
      grid-column: 1 / 8;
      grid-row: 3 / 4;
      color: var(--accent);
    }
    h1 {
      position: relative;
      z-index: 1;
      grid-column: 1 / 11;
      grid-row: 3 / 7;
      align-self: start;
      color: var(--ink);
      min-height: 0;
      overflow: hidden;
      font-size: 42px;
      line-height: 1.04;
      font-weight: 300;
      letter-spacing: 0;
      text-wrap: balance;
    }
    h2 {
      position: relative;
      z-index: 1;
      grid-column: 1 / 10;
      grid-row: 3 / 6;
      align-self: start;
      color: var(--ink);
      min-height: 0;
      overflow: hidden;
      font-size: 34px;
      line-height: 1.1;
      font-weight: 300;
      letter-spacing: 0;
      text-wrap: balance;
    }
    .lead {
      position: relative;
      z-index: 1;
      grid-column: 1 / 8;
      grid-row: 7 / 9;
      color: var(--accent);
      min-height: 0;
      overflow: hidden;
      font-size: 18px;
      line-height: 1.42;
      font-weight: 300;
      text-wrap: balance;
    }
    .hero-line {
      position: relative;
      z-index: 1;
      grid-column: 8 / 12;
      grid-row: 7 / 9;
      min-height: 0;
      overflow: hidden;
      align-self: start;
      border-top: 1px solid var(--ink);
      padding-top: 12px;
      color: #302d29;
      font-size: 15px;
      line-height: 1.55;
      font-weight: 500;
      text-wrap: pretty;
    }
    .directory,
    .directory-list {
      position: relative;
      z-index: 1;
      grid-column: 1 / 12;
      grid-row: 10 / 15;
      list-style: none;
      display: grid;
      align-content: start;
      gap: 8px;
      min-height: 0;
      overflow: hidden;
    }
    .directory li,
    .directory-list li {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr);
      gap: 12px;
      align-items: baseline;
      border-top: 1px solid var(--fine-line);
      padding-top: 8px;
    }
    .directory span,
    .directory-list span {
      color: var(--accent);
      font-size: 10px;
      font-weight: 700;
    }
    .directory strong,
    .directory-list strong {
      color: var(--ink);
      font-size: 14px;
      line-height: 1.22;
      font-weight: 400;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .detail-index {
      position: relative;
      z-index: 1;
      grid-column: 10 / 13;
      grid-row: 3 / 5;
      justify-self: end;
      align-self: start;
      color: var(--accent);
      font-size: 56px;
      line-height: 0.9;
      font-weight: 300;
      letter-spacing: 0;
    }
    .detail-body {
      position: relative;
      z-index: 1;
      grid-column: 1 / 12;
      grid-row: 7 / 15;
      overflow: hidden;
      border-top: 1px solid var(--ink);
      padding-top: 12px;
      display: grid;
      align-content: start;
      gap: 12px;
    }
    .card-copy,
    .card-list li {
      color: #302d29;
      font-size: 14px;
      line-height: 1.58;
      font-weight: 400;
    }
    .card-copy {
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
    }
    .card-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 0;
      min-height: 0;
      overflow: hidden;
    }
    .card-list li {
      position: relative;
      padding-left: 18px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .card-list li::before {
      content: "—";
      position: absolute;
      left: 0;
      color: var(--accent);
    }
    .card-footer {
      grid-column: 1 / 13;
      grid-row: 15 / 17;
      align-self: end;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid var(--fine-line);
      padding-top: 8px;
      line-height: 1.2;
    }
    .cover-card::after {
      content: "";
      position: absolute;
      right: 42px;
      top: 92px;
      width: 40px;
      height: 40px;
      border: 1px solid var(--accent);
      opacity: 0.45;
      pointer-events: none;
    }
    .detail-card:nth-of-type(odd) {
      background: #fbfaf6;
    }
    @media (max-width: 560px) {
      body { padding: 12px; }
      .card-stack { width: 100%; gap: 16px; }
      .card-grid { padding: 28px 26px 24px; gap: 6px; }
      .card-grid::before { inset: 28px 26px 24px; }
      h1 { font-size: 32px; }
      h2 { font-size: 26px; }
      .lead,
      .hero-line { font-size: 14px; }
      .directory-list { gap: 5px; }
      .directory-list li { grid-template-columns: 30px minmax(0, 1fr); gap: 8px; padding-top: 5px; }
      .directory-list strong { font-size: 12px; -webkit-line-clamp: 1; }
      .detail-index { font-size: 42px; }
      .card-copy,
      .card-list li { font-size: 13px; }
      .card-footer { font-size: 8px; padding-top: 6px; }
    }
  </style>
</head>
<body>
  <div class="card-stack">
    <article class="gz-social-card cover-card">
      <div class="card-grid">
        <span class="template-code">M01</span>
        <span class="series-count">01 / ${String(visibleSections.length + 1).padStart(2, '0')}</span>
        <span class="vertical-label">${escapeHtml(contentBrand)}</span>
        <div class="rule rule-top"></div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="lead">${escapeHtml(subtitle)}</p>` : ''}
        ${coreLine ? `<div class="hero-line">${escapeHtml(coreLine)}</div>` : ''}
        <ul class="directory-list">
          ${directoryItems}
        </ul>
        <footer class="card-footer">
          <span>${escapeHtml(contentBrand)}</span>
          <span>1080 × 1440 · 3:4</span>
        </footer>
      </div>
    </article>
    ${sectionCards}
  </div>
</body>
</html>
`
}
