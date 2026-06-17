import { escapeHtml, renderMarkdown, formatDate, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildTechSharing(options: BuildHtmlOptions): string {
  const { title, subtitle, sections, sourceLabel, generatedAt } = options
  const date = generatedAt || formatDate(new Date())

  const slidesHtml = sections.map((section, i) => {
    const bullets = section.bullets?.length
      ? `<ul class="cyber-list">${section.bullets.map(b => `<li>${renderMarkdown(b)}</li>`).join('')}</ul>`
      : ''
    const body = section.body
      ? `<p class="cyber-body">${renderMarkdown(section.body)}</p>`
      : ''

    return `
    <div class="slide" id="slide-${i + 2}">
      <div class="slide-content">
        <div class="window-header">
          <span class="dot-btn red"></span>
          <span class="dot-btn yellow"></span>
          <span class="dot-btn green"></span>
          <span class="window-title">module_0${i + 2}.log</span>
        </div>
        <div class="slide-meta">
          <span class="slide-index">&gt; _0${i + 2}</span>
          <span class="slide-indicator">/ ${sections.length + 1}</span>
        </div>
        <h2>${escapeHtml(section.title)}</h2>
        ${body}
        ${bullets}
      </div>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Fira Code', Consolas, Monaco, monospace;
      color: #00f2fe;
      background: #07080d;
      overflow: hidden;
      background-image: linear-gradient(0deg, rgba(0, 242, 254, 0.03) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 242, 254, 0.03) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    
    /* 进度条 */
    .deck-progress {
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: linear-gradient(to right, #bd00ff, #00f2fe);
      width: 0%;
      z-index: 100;
      box-shadow: 0 0 10px #00f2fe;
      transition: width 0.3s ease;
    }

    .deck {
      width: 100vw;
      height: 100vh;
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    .deck::-webkit-scrollbar {
      display: none;
    }
    
    .slide {
      min-width: 100vw;
      height: 100vh;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      scroll-snap-align: start;
      padding: 64px 24px;
      position: relative;
    }
    
    .slide-content {
      max-width: 860px;
      width: 100%;
      background: rgba(7, 8, 13, 0.82);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(0, 242, 254, 0.25);
      border-radius: 8px;
      padding: 48px 40px 40px;
      position: relative;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5),
                  0 0 20px rgba(0, 242, 254, 0.05),
                  0 0 40px rgba(189, 0, 255, 0.1),
                  inset 0 0 20px rgba(189, 0, 255, 0.08);
      opacity: 0;
      transform: scale(0.96) translateY(10px);
      transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .slide.active .slide-content {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
    
    /* 终端窗口顶部装饰 */
    .window-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: rgba(0, 242, 254, 0.05);
      border-bottom: 1px solid rgba(0, 242, 254, 0.2);
      border-radius: 7px 7px 0 0;
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 8px;
    }
    .dot-btn {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot-btn.red { background: #ff5f56; }
    .dot-btn.yellow { background: #ffbd2e; }
    .dot-btn.green { background: #27c93f; }
    
    .window-title {
      font-size: 0.75rem;
      color: rgba(0, 242, 254, 0.5);
      margin-left: 8px;
      font-weight: 500;
    }
    
    .slide-meta {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 16px;
    }
    .slide-index {
      font-size: 1.15rem;
      font-weight: 700;
      color: #bd00ff;
      text-shadow: 0 0 8px rgba(189, 0, 255, 0.4);
    }
    .slide-indicator {
      font-size: 0.85rem;
      color: rgba(0, 242, 254, 0.4);
    }
    
    h1 {
      font-size: 3.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #00f2fe, #bd00ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 24px;
      text-align: center;
      filter: drop-shadow(0 0 15px rgba(0, 242, 254, 0.3));
    }
    
    h2 {
      font-size: 2.2rem;
      font-weight: 700;
      color: #00f2fe;
      margin-bottom: 24px;
      line-height: 1.2;
      text-shadow: 0 0 10px rgba(0, 242, 254, 0.3);
    }
    
    .cyber-body {
      font-size: 1.1rem;
      line-height: 1.7;
      margin-bottom: 24px;
      color: #a5b4fc;
    }
    
    .cyber-list {
      list-style: none;
    }
    .cyber-list li {
      font-size: 1rem;
      margin-bottom: 12px;
      color: #e0e7ff;
      position: relative;
      padding-left: 24px;
    }
    .cyber-list li::before {
      content: "$";
      position: absolute;
      left: 0;
      color: #bd00ff;
      font-weight: 700;
      text-shadow: 0 0 6px rgba(189,0,255,0.5);
    }

    /* 赛博朋克深色表格和代码块 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 0.9em;
      border: 1px solid rgba(0, 242, 254, 0.2) !important;
      background: rgba(10, 11, 18, 0.95);
      box-shadow: 0 0 15px rgba(0, 242, 254, 0.05);
    }
    th {
      background: rgba(0, 242, 254, 0.08) !important;
      border-bottom: 2px solid rgba(0, 242, 254, 0.25) !important;
      color: #00f2fe !important;
      padding: 10px 14px;
      font-weight: 600;
    }
    td {
      border-bottom: 1px solid rgba(0, 242, 254, 0.1) !important;
      padding: 10px 14px;
      color: #a5b4fc;
    }
    code {
      font-family: inherit;
      background: rgba(189, 0, 255, 0.15) !important;
      border: 1px solid rgba(189, 0, 255, 0.3) !important;
      color: #ff00ff !important;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      text-shadow: 0 0 4px rgba(255, 0, 255, 0.5);
    }
    
    .title-slide {
      text-align: center;
      background: radial-gradient(circle at center, #0f1026 0%, #07080d 100%);
    }
    .title-slide .subtitle {
      font-size: 1.35rem;
      color: rgba(0, 242, 254, 0.75);
      margin-bottom: 32px;
      text-shadow: 0 0 8px rgba(0, 242, 254, 0.2);
    }
    .title-slide .meta {
      font-size: 0.8rem;
      color: rgba(189, 0, 255, 0.6);
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    
    /* 赛博朋克控制台按钮 */
    .nav {
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(7, 8, 13, 0.9);
      border: 1px solid rgba(0, 242, 254, 0.3);
      padding: 6px 16px;
      border-radius: 4px;
      box-shadow: 0 0 20px rgba(0, 242, 254, 0.1);
      z-index: 99;
    }
    .nav button {
      padding: 6px 16px;
      border: 1px solid rgba(0, 242, 254, 0.4);
      border-radius: 2px;
      background: transparent;
      color: #00f2fe;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 700;
      text-shadow: 0 0 4px rgba(0, 242, 254, 0.5);
      transition: all 0.2s;
    }
    .nav button:hover {
      background: #00f2fe;
      color: #07080d;
      text-shadow: none;
      box-shadow: 0 0 10px #00f2fe;
    }
    .slide-indicator-dot {
      display: flex;
      gap: 6px;
    }
    .dot {
      width: 5px;
      height: 5px;
      background: rgba(0, 242, 254, 0.2);
      transition: all 0.3s;
    }
    .dot.active {
      width: 15px;
      background: #bd00ff;
      box-shadow: 0 0 8px #bd00ff;
    }
  </style>
</head>
<body>
  <div class="deck-progress" id="progress"></div>
  <div class="deck">
    <div class="slide title-slide active" id="slide-1">
      <div class="slide-content" style="border: 1px solid rgba(189, 0, 255, 0.25);">
        <div class="window-header" style="background: rgba(189, 0, 255, 0.05); border-bottom: 1px solid rgba(189, 0, 255, 0.2);">
          <span class="dot-btn red"></span>
          <span class="dot-btn yellow"></span>
          <span class="dot-btn green"></span>
          <span class="window-title" style="color: rgba(189, 0, 255, 0.5);">init_main.exe</span>
        </div>
        <div class="slide-meta" style="justify-content: center;">
          <span class="slide-index">&gt; _01</span>
          <span class="slide-indicator">/ ${sections.length + 1}</span>
        </div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
        ${sourceLabel ? `<div class="meta">SOURCE: ${escapeHtml(sourceLabel)} · ${date}</div>` : ''}
      </div>
    </div>
    ${slidesHtml}
  </div>
  <div class="nav">
    <button id="prevBtn">&lt;&lt; BACK</button>
    <div class="slide-indicator-dot" id="dotsContainer"></div>
    <button id="nextBtn">EXEC &gt;&gt;</button>
  </div>
  <script>
    const deck = document.querySelector('.deck');
    const slides = document.querySelectorAll('.slide');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progress = document.getElementById('progress');
    const dotsContainer = document.getElementById('dotsContainer');
    
    let totalSlides = slides.length;
    
    for(let i=0; i<totalSlides; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dotsContainer.appendChild(dot);
    }
    const dots = document.querySelectorAll('.dot');

    function updateActiveSlide() {
      const scrollLeft = deck.scrollLeft;
      const width = window.innerWidth;
      const index = Math.round(scrollLeft / width);
      
      slides.forEach((slide, i) => {
        if(i === index) {
          slide.classList.add('active');
        } else {
          slide.classList.remove('active');
        }
      });
      
      dots.forEach((dot, i) => {
        if(i === index) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      });
      
      progress.style.width = ((index / (totalSlides - 1)) * 100) + '%';
    }

    deck.addEventListener('scroll', updateActiveSlide);
    window.addEventListener('resize', updateActiveSlide);

    prevBtn.addEventListener('click', () => {
      deck.scrollBy({left: -window.innerWidth, behavior: 'smooth'});
    });
    
    nextBtn.addEventListener('click', () => {
      deck.scrollBy({left: window.innerWidth, behavior: 'smooth'});
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') deck.scrollBy({left: -window.innerWidth, behavior: 'smooth'});
      if (e.key === 'ArrowRight') deck.scrollBy({left: window.innerWidth, behavior: 'smooth'});
    });
    
    setTimeout(updateActiveSlide, 100);
  </script>
</body>
</html>`
}
