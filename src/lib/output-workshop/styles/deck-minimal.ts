import { escapeHtml, renderMarkdown, formatDate, getContentBrand, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildGuizangDeck(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, generatedAt } = options
  const date = generatedAt || formatDate(new Date())
  const contentBrand = getContentBrand(options, 'Output')
  const visibleSections = sections.length > 0
    ? sections.slice(0, 8)
    : [{ title: '核心观点', body: subtitle || title, bullets: [] }]

  const agendaItems = visibleSections.slice(0, 6).map((section, index) => `
        <li>
          <span>${String(index + 1).padStart(2, '0')}</span>
          <strong>${escapeHtml(section.title)}</strong>
        </li>`).join('')

  const slidesHtml = visibleSections.map((section, index) => {
    const slideNo = index + 3
    const slideCode = ['S04', 'S09', 'S16'][index % 3]
    const layoutClass = ['layout-statement', 'layout-split', 'layout-evidence'][index % 3]
    const body = section.body
      ? `<p class="slide-body">${renderMarkdown(section.body)}</p>`
      : ''
    const bullets = section.bullets?.length
      ? `<ul class="point-list">${section.bullets.slice(0, 4).map((bullet) => `<li>${renderMarkdown(bullet)}</li>`).join('')}</ul>`
      : ''
    const statement = section.bullets?.[0] || section.body || section.title

    return `
    <section class="gz-deck-slide ${layoutClass}" id="slide-${slideNo}">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">${slideCode}</span>
          <span class="slide-count">${String(slideNo).padStart(2, '0')} / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">${escapeHtml(contentBrand)} / Swiss Locked Mode</p>
          <div class="slide-title-block">
            <span class="slide-section-index">${String(index + 1).padStart(2, '0')}</span>
            <h2>${escapeHtml(section.title)}</h2>
          </div>
          <div class="statement">${renderMarkdown(statement)}</div>
          <div class="body-block">${body}</div>
          <div class="evidence-block">${bullets}</div>
          <footer class="slide-footer">
            <span>${escapeHtml(contentBrand)}</span>
            <span>${date}</span>
          </footer>
        </div>
      </div>
    </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700;900&family=Noto+Sans+SC:wght@400;500;700;900&family=Source+Serif+4:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #111111;
      --paper: #f7f6f0;
      --surface: #fdfdfb;
      --muted: #6f6a60;
      --line: rgba(17, 17, 17, 0.32);
      --fine-line: rgba(17, 17, 17, 0.12);
      --accent: #e33e2b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      overflow: hidden;
      color: var(--ink);
      background: #d8d3c8;
      font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
    }
    .deck-progress {
      position: fixed;
      inset: 0 auto auto 0;
      width: 0;
      height: 3px;
      background: var(--accent);
      z-index: 20;
      transition: width 180ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .deck {
      width: 100vw;
      height: 100vh;
      position: relative;
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .gz-deck-slide {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 28px 28px 88px;
      opacity: 0;
      pointer-events: none;
      transform: translateY(10px);
      transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .gz-deck-slide.active {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }
    .slide-frame {
      width: 1280px;
      height: 720px;
      background: var(--surface);
      border: 1px solid var(--ink);
      transform-origin: center center;
      flex-shrink: 0;
      box-shadow: 0 4px 8px rgba(0,0,0,0.08);
    }
    .slide-grid {
      position: relative;
      height: 100%;
      overflow: hidden;
      display: grid;
      grid-template-columns: repeat(16, minmax(0, 1fr));
      grid-template-rows: repeat(9, minmax(0, 1fr));
      gap: 12px;
      padding: 40px 48px;
      background: var(--paper);
    }
    .slide-grid::before {
      content: "";
      position: absolute;
      inset: 40px 48px;
      pointer-events: none;
      background:
        repeating-linear-gradient(90deg, transparent 0, transparent calc(6.25% - 1px), rgba(17,17,17,0.035) calc(6.25% - 1px), rgba(17,17,17,0.035) 6.25%),
        repeating-linear-gradient(0deg, transparent 0, transparent calc(11.111% - 1px), rgba(17,17,17,0.03) calc(11.111% - 1px), rgba(17,17,17,0.03) 11.111%);
    }
    .template-code,
    .slide-count,
    .kicker,
    .slide-footer {
      position: relative;
      z-index: 1;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .template-code {
      grid-column: 1 / 3;
      grid-row: 1 / 2;
      color: var(--accent);
      font-size: 14px;
    }
    .slide-count {
      grid-column: 14 / 17;
      grid-row: 1 / 2;
      justify-self: end;
    }
    .rule {
      position: relative;
      z-index: 1;
      background: var(--ink);
    }
    .rule-top {
      grid-column: 1 / 17;
      grid-row: 2 / 3;
      align-self: start;
      height: 1px;
    }
    .rule-left {
      grid-column: 3 / 4;
      grid-row: 1 / 10;
      justify-self: start;
      width: 1px;
      background: var(--fine-line);
    }
    .kicker {
      grid-column: 4 / 11;
      grid-row: 1 / 2;
    }
    .slide-title-block {
      position: relative;
      z-index: 1;
      grid-column: 2 / 8;
      grid-row: 3 / 7;
      min-height: 0;
      display: grid;
      grid-template-rows: auto auto;
      align-content: start;
      gap: 18px;
      overflow: hidden;
    }
    .slide-section-index {
      width: max-content;
      color: var(--accent);
      border-top: 1px solid var(--accent);
      padding-top: 8px;
      font-size: 14px;
      line-height: 1;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    h1,
    h2 {
      position: relative;
      z-index: 1;
      color: var(--ink);
      font-weight: 300;
      letter-spacing: 0;
      text-wrap: balance;
    }
    h1 {
      grid-column: 4 / 14;
      grid-row: 3 / 6;
      align-self: center;
      font-size: 82px;
      line-height: 0.94;
    }
    h2 {
      min-height: 0;
      overflow: hidden;
      font-size: 42px;
      line-height: 1.08;
    }
    .subtitle {
      position: relative;
      z-index: 1;
      grid-column: 4 / 10;
      grid-row: 6 / 8;
      color: var(--muted);
      font-size: 22px;
      line-height: 1.55;
      font-weight: 350;
    }
    .statement {
      position: relative;
      z-index: 1;
      grid-column: 8 / 16;
      grid-row: 3 / 6;
      color: var(--accent);
      min-height: 0;
      overflow: hidden;
      font-size: 30px;
      line-height: 1.18;
      font-weight: 300;
      text-wrap: balance;
    }
    .body-block {
      position: relative;
      z-index: 1;
      grid-column: 8 / 12;
      grid-row: 6 / 9;
      color: #33302b;
      font-size: 16px;
      line-height: 1.75;
      overflow: hidden;
      min-height: 0;
    }
    .evidence-block {
      position: relative;
      z-index: 1;
      grid-column: 12 / 16;
      grid-row: 6 / 9;
      overflow: hidden;
      min-height: 0;
    }
    .slide-body,
    .point-list li {
      color: #33302b;
      font-size: 15px;
      line-height: 1.62;
      font-weight: 400;
    }
    .point-list {
      list-style: none;
      display: grid;
      gap: 10px;
    }
    .point-list li {
      position: relative;
      padding-left: 22px;
    }
    .point-list li::before {
      content: "—";
      position: absolute;
      left: 0;
      top: 0;
      color: var(--accent);
    }
    .slide-footer {
      grid-column: 1 / 17;
      grid-row: 9 / 10;
      align-self: end;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid var(--fine-line);
      padding-top: 10px;
    }
    .cover .template-code {
      grid-column: 1 / 3;
      grid-row: 1 / 2;
      font-size: 62px;
      line-height: 0.82;
      font-weight: 300;
      letter-spacing: 0;
    }
    .cover .kicker {
      grid-column: 4 / 9;
      grid-row: 1 / 2;
    }
    .cover .cover-meta {
      position: relative;
      z-index: 1;
      grid-column: 11 / 16;
      grid-row: 7 / 9;
      align-self: end;
      display: grid;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .agenda h2 {
      grid-column: 2 / 7;
      grid-row: 3 / 5;
      font-size: 48px;
    }
    .agenda-list {
      position: relative;
      z-index: 1;
      grid-column: 8 / 16;
      grid-row: 3 / 8;
      list-style: none;
      display: grid;
      align-content: start;
      gap: 16px;
    }
    .agenda-list li {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr);
      gap: 18px;
      align-items: baseline;
      border-top: 1px solid var(--fine-line);
      padding-top: 14px;
    }
    .agenda-list span {
      color: var(--accent);
      font-size: 15px;
      font-weight: 700;
    }
    .agenda-list strong {
      color: var(--ink);
      font-size: 24px;
      line-height: 1.18;
      font-weight: 300;
    }
    .layout-split .slide-title-block {
      grid-column: 2 / 9;
      grid-row: 3 / 6;
    }
    .layout-split .statement {
      grid-column: 2 / 9;
      grid-row: 6 / 9;
      font-size: 26px;
      color: var(--ink);
      border-top: 1px solid var(--fine-line);
      padding-top: 14px;
    }
    .layout-split .body-block {
      grid-column: 10 / 13;
      grid-row: 3 / 8;
    }
    .layout-split .evidence-block {
      grid-column: 13 / 16;
      grid-row: 3 / 8;
    }
    .layout-evidence .slide-title-block {
      grid-column: 2 / 15;
      grid-row: 3 / 5;
    }
    .layout-evidence h2 {
      font-size: 44px;
    }
    .layout-evidence .statement {
      grid-column: 2 / 8;
      grid-row: 6 / 8;
      font-size: 26px;
      color: var(--accent);
    }
    .layout-evidence .body-block {
      grid-column: 8 / 12;
      grid-row: 6 / 8;
    }
    .layout-evidence .evidence-block {
      grid-column: 12 / 16;
      grid-row: 6 / 8;
    }
    .layout-statement:last-child h2 {
      grid-column: 2 / 8;
      grid-row: 3 / 5;
    }
    .layout-statement:last-child .statement {
      grid-column: 8 / 16;
      grid-row: 3 / 7;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 0.82em;
      border-top: 1px solid var(--ink);
      border-bottom: 1px solid var(--ink);
      background: transparent;
    }
    th, td {
      padding: 7px 0;
      border-bottom: 1px solid var(--fine-line);
      text-align: left;
    }
    th { color: var(--accent); font-weight: 700; }
    code {
      border-bottom: 1px solid var(--accent);
      background: transparent;
      color: var(--accent);
      padding: 0 2px;
      font-family: inherit;
      font-weight: 700;
    }
    .nav {
      position: fixed;
      left: 50%;
      bottom: 18px;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 10px;
      transform: translateX(-50%);
      border: 1px solid var(--ink);
      padding: 5px;
      background: var(--paper);
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
    }
    .nav button {
      border: 1px solid transparent;
      min-width: 68px;
      padding: 8px 12px;
      color: var(--ink);
      background: transparent;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      transition: background 160ms cubic-bezier(0.22, 1, 0.36, 1), color 160ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .nav button:hover {
      background: var(--ink);
      color: var(--paper);
    }
    .nav button:disabled {
      cursor: not-allowed;
      opacity: 0.38;
    }
    .nav button:disabled:hover {
      background: transparent;
      color: var(--ink);
    }
    .dots { display: flex; gap: 5px; padding: 0 5px; }
    .dot {
      width: 18px;
      height: 2px;
      background: rgba(17,17,17,0.24);
      transition: background 160ms ease;
    }
    .dot.active { background: var(--accent); }
    @media (max-width: 860px) {
      body { overflow: hidden; }
      .deck { height: 100vh; overflow: hidden; }
      .gz-deck-slide { padding: 14px 12px 74px; }
      .slide-frame { width: 1280px; height: 720px; min-height: 0; }
      .slide-grid {
        height: 100%;
        display: grid;
        padding: 40px 48px;
      }
      .nav { bottom: 12px; transform: translateX(-50%) scale(0.88); transform-origin: bottom center; }
    }
    @media (prefers-reduced-motion: reduce) {
      .deck-progress,
      .gz-deck-slide,
      .nav button,
      .dot {
        transition: none;
      }
    }
  </style>
</head>
<body>
  <div class="deck-progress" id="progress"></div>
  <div class="deck">
    <section class="gz-deck-slide cover active" id="slide-1">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">S01</span>
          <span class="slide-count">01 / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">${escapeHtml(contentBrand)} / Electronic Magazine</p>
          <h1>${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
          <div class="cover-meta">
            <span>${escapeHtml(contentBrand)}</span>
            <span>${date}</span>
          </div>
          <footer class="slide-footer">
            <span>Style B / Swiss International</span>
            <span>16 Columns · 16:9</span>
          </footer>
        </div>
      </div>
    </section>
    <section class="gz-deck-slide agenda" id="slide-2">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">S02</span>
          <span class="slide-count">02 / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">Agenda / Content Architecture</p>
          <h2>目录</h2>
          <ol class="agenda-list">
            ${agendaItems}
          </ol>
          <footer class="slide-footer">
            <span>Single Accent · Dense Grid</span>
            <span>${date}</span>
          </footer>
        </div>
      </div>
    </section>
    ${slidesHtml}
    <section class="gz-deck-slide layout-statement" id="slide-${visibleSections.length + 3}">
      <div class="slide-frame">
        <div class="slide-grid">
          <span class="template-code">S22</span>
          <span class="slide-count">${String(visibleSections.length + 3).padStart(2, '0')} / ${String(visibleSections.length + 3).padStart(2, '0')}</span>
          <div class="rule rule-top"></div>
          <div class="rule rule-left"></div>
          <p class="kicker">Closing / Discussion</p>
          <h2>谢谢</h2>
          <div class="statement">基于内容结构生成，可继续导出为独立 slide 或截图分享。</div>
          <footer class="slide-footer">
            <span>${escapeHtml(contentBrand)}</span>
            <span>${date}</span>
          </footer>
        </div>
      </div>
    </section>
  </div>
  <nav class="nav" aria-label="Deck navigation">
    <button id="prevBtn" aria-label="上一页">Prev</button>
    <div class="dots" id="dotsContainer"></div>
    <button id="nextBtn" aria-label="下一页">Next</button>
  </nav>
  <script>
    const slides = Array.from(document.querySelectorAll('.gz-deck-slide'));
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progress = document.getElementById('progress');
    const dotsContainer = document.getElementById('dotsContainer');
    let activeIndex = 0;
 
    slides.forEach((_, index) => {
      const dot = document.createElement('span');
      dot.className = 'dot' + (index === 0 ? ' active' : '');
      dotsContainer.appendChild(dot);
    });
    const dots = Array.from(document.querySelectorAll('.dot'));
 
    function setActive(index) {
      activeIndex = Math.max(0, Math.min(slides.length - 1, index));
      slides.forEach((slide, i) => slide.classList.toggle('active', i === activeIndex));
      dots.forEach((dot, i) => dot.classList.toggle('active', i === activeIndex));
      progress.style.width = ((activeIndex / Math.max(1, slides.length - 1)) * 100) + '%';
      prevBtn.disabled = activeIndex === 0;
      nextBtn.disabled = activeIndex === slides.length - 1;
      prevBtn.setAttribute('aria-disabled', String(prevBtn.disabled));
      nextBtn.setAttribute('aria-disabled', String(nextBtn.disabled));
    }
 
    function go(delta) {
      const next = Math.max(0, Math.min(slides.length - 1, activeIndex + delta));
      if (next === activeIndex) return;
      setActive(next);
    }
 
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    });

    function resizeSlides() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const frames = document.querySelectorAll('.slide-frame');
      frames.forEach(frame => {
        const scaleX = (vw - 56) / 1280;
        const scaleY = (vh - 126) / 720;
        const scale = Math.max(0.12, Math.min(1, scaleX, scaleY));
        frame.style.transform = \`scale(\${scale})\`;
      });
    }
    window.addEventListener('resize', resizeSlides);
    window.addEventListener('load', resizeSlides);
 
    // 初始化
    resizeSlides();
    setTimeout(resizeSlides, 100);
  </script>
</body>
</html>`
}
