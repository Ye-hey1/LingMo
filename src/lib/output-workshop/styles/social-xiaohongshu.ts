import { escapeHtml, renderMarkdown, getContentBrand, getContentInitials, getContentCategory, type BuildHtmlOptions } from "../shared/builder-utils"

export function buildXiaohongshuStyle(options: BuildHtmlOptions): string {
  const { title, sections } = options
  const contentBrand = getContentBrand(options)
  const contentInitials = getContentInitials(contentBrand)
  const contentCategory = getContentCategory(options)

  // 1. 智能标题解析与核心高亮算法：自动分离前置修饰词与核心主干，保证排版优雅不切断词组
  let leadingTag = ''
  let coreTitle = title
  let suffixTag = ''

  // 自动分离前置年份或数字开头的分类标 (如 "2026", "DeepSeek")
  const leadingMatch = title.match(/^([a-zA-Z0-9\s#\-\_]+)([\u4e00-\u9fa5]+.*)/)
  if (leadingMatch) {
    leadingTag = leadingMatch[1].trim()
    coreTitle = leadingMatch[2]
  }

  // 自动剥离常见的中文后缀
  const suffixes = ['终极指南', '极简指南', '深度指南', '指南', '全景图', '知识手账', '手册', '方案', '改进方案', '发展史', '历史', '报告', '分析', '实战', '教程']
  for (const suffix of suffixes) {
    if (coreTitle.endsWith(suffix) && coreTitle.length > suffix.length) {
      coreTitle = coreTitle.slice(0, coreTitle.length - suffix.length)
      suffixTag = suffix
      break
    }
  }

  // 渲染大标题：前置标签 + 核心高亮主标题 + 优雅后缀
  const titleHtml = `
    <h2 class="cover-title">
      ${leadingTag ? `<span style="display: block; font-size: 1.25rem; font-weight: 800; color: #64748b; margin-bottom: 8px; font-family: 'Noto Sans SC', sans-serif; letter-spacing: 1px;">✦ ${escapeHtml(leadingTag)} ✦</span>` : ''}
      <span class="highlight-brush">${escapeHtml(coreTitle)}</span>
      ${suffixTag ? `<span style="display: block; font-size: 1.45rem; font-weight: 900; color: #1e293b; margin-top: 10px; font-family: 'Noto Serif SC', serif; letter-spacing: 0.5px;">${escapeHtml(suffixTag)}</span>` : ''}
    </h2>
  `

  // 2. 智能提取前言导读
  let introDesc = '从创意、MVP、发布到规模化：通过结构化知识大纲，帮您快速理清逻辑，编排系统思维。'
  if (sections[0]?.body) {
    const cleanBody = sections[0].body.replace(/[#*`\n]/g, ' ').trim()
    if (cleanBody.length > 20) {
      introDesc = cleanBody.slice(0, 48) + '...'
    }
  }

  // 3. 自适应 2x2 网格卡片算法，高亮第四格，一比一重塑顶级手账生命地图
  const gridSections = sections.slice(0, 4)
  const gridItemsHtml = []
  
  for (let idx = 0; idx < 4; idx++) {
    const section = gridSections[idx]
    if (section) {
      const isActive = idx === Math.min(gridSections.length - 1, 3)
      gridItemsHtml.push(`
        <div class="grid-card-item ${isActive ? 'active' : ''}">
          ${escapeHtml(section.title)}
        </div>
      `)
    } else {
      const isLast = idx === 3
      gridItemsHtml.push(`
        <div class="grid-card-item ${isLast ? 'active' : ''}" style="opacity: 0.65; font-style: italic;">
          ${isLast ? '深度探索 ✦' : '知识精进 ✦'}
        </div>
      `)
    }
  }

  const gridHtml = `
    <div class="summary-grid-card">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
        ${gridItemsHtml.join('')}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8; font-weight: 700; padding: 0 4px; border-top: 1px dashed #f1f5f9; padding-top: 8px; margin-top: 10px;">
        <span>📖 ${escapeHtml(contentCategory)}</span>
        <span>${escapeHtml((coreTitle || title).slice(0, 10))} ➔</span>
      </div>
    </div>
  `

  const coverCard = `
    <div class="cover-card">
      <!-- 磨砂半透明右上角播放按钮 -->
      <div style="position: absolute; right: 24px; top: 24px; width: 36px; height: 36px; border-radius: 50%; background: rgba(226, 232, 240, 0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.6); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.02); z-index: 10;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#64748b" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>
      </div>

      <!-- 左上角分类微标 -->
      <div style="font-size: 0.78rem; font-weight: 900; color: #334155; margin-bottom: 28px; text-align: left; position: relative; z-index: 2; display: flex; align-items: center; gap: 6px;">
        <span style="color: #c2410c; letter-spacing: 0.5px; font-family: 'Noto Sans SC', sans-serif;">${escapeHtml(contentBrand)}</span>
        <span style="color: #cbd5e1;">|</span>
        <span style="color: #64748b; font-weight: 500;">${escapeHtml(contentCategory)}</span>
      </div>

      <!-- 独特大字排版标题 -->
      ${titleHtml}

      <!-- 导言前言 -->
      <p style="font-size: 0.88rem; line-height: 1.6; color: #475569; margin-bottom: 20px; text-align: justify; word-break: break-all; padding: 0 4px; font-family: 'Noto Sans SC', sans-serif;">
        ${escapeHtml(introDesc)}
      </p>

      <!-- 2x2 网格卡片 -->
      ${gridHtml}
    </div>
  `

  // 4. 原有的各个章节子卡片生成
  const contentHtml = sections.slice(0, 5).map((section, i) => {
    const xhsEmojis = ['✨', '🔥', '💡', '✅', '👉', '📌', '💖', '⭐', '🎈', '🍀']
    const bullets = section.bullets?.slice(0, 5).map((b, idx) => {
      const emoji = xhsEmojis[(i + idx) % xhsEmojis.length]
      return `<li style="padding-left: 20px; position: relative; font-size: 0.95rem; margin-bottom: 8px; color: #475569; line-height: 1.6;"><span style="position: absolute; left: 0; font-size: 0.9rem;">${emoji}</span>${renderMarkdown(b)}</li>`
    }).join('') || ''

    const rotates = ['-1deg', '0.5deg', '-0.5deg', '1deg', '-0.8deg']
    const rotate = rotates[i % rotates.length]

    return `
      <div class="card" style="transform: rotate(${rotate}); margin-bottom: 28px; padding: 24px; background: #ffffff; border-radius: 24px; box-shadow: 0 16px 36px rgba(59, 130, 246, 0.04), 0 2px 6px rgba(0, 0, 0, 0.01), inset 0 1px 0 rgba(255, 255, 255, 0.6); border: 1px dashed rgba(59, 130, 246, 0.2); position: relative; transition: transform 0.2s ease;">
        <div class="card-pin"></div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px; color: #0f172a; display: inline-block; background: linear-gradient(120deg, #e0f2fe 0%, #e0f2fe 100%); background-repeat: no-repeat; background-size: 100% 35%; background-position: 0 90%;">${escapeHtml(section.title)}</h3>
        ${section.body ? `<div style="font-size: 0.95rem; line-height: 1.6; color: #334155; margin-bottom: 14px; text-align: justify; word-break: break-all;">${renderMarkdown(section.body)}</div>` : ''}
        ${bullets ? `<ul style="list-style: none; padding-left: 0;">${bullets}</ul>` : ''}
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Noto+Serif+SC:wght@700;900&family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans SC', sans-serif;
      color: #1e293b;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
      min-height: 100vh;
      padding: 32px 16px;
      display: flex;
      justify-content: center;
      align-items: center;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    .container {
      max-width: 440px;
      width: 100%;
      background: #ffffff;
      border-radius: 36px;
      padding: 36px 24px;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.08);
      position: relative;
    }
    
    header {
      text-align: center;
      margin-bottom: 24px;
      display: none; /* 去除原本的外侧大 header */
    }
    
    .card-pin {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%) rotate(-3deg);
      width: 54px;
      height: 16px;
      background: rgba(254, 240, 138, 0.6); /* 胶带半透明暖黄 */
      border: 1px solid rgba(253, 224, 71, 0.3);
      backdrop-filter: blur(1.5px);
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
      z-index: 10;
    }
    
    .cover-card {
      margin-bottom: 28px;
      padding: 32px 24px 24px 24px;
      background-color: #faf6f0; /* 温润奶油黄纸色 */
      background-image: 
        linear-gradient(rgba(37, 99, 235, 0.02) 1.5px, transparent 1.5px),
        linear-gradient(90deg, rgba(37, 99, 235, 0.02) 1.5px, transparent 1.5px);
      background-size: 20px 20px; /* 20px 间距的高级网络纸底纹 */
      border-radius: 32px;
      box-shadow: 0 24px 48px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(0, 0, 0, 0.01), inset 0 1px 1px rgba(255, 255, 255, 0.7);
      border: 1px solid rgba(15, 23, 42, 0.05); /* 去除原本 6px 的厚卡纸外框，改用极其纤细清爽的侧切虚线 */
      position: relative;
      overflow: hidden;
      transition: transform 0.2s ease;
    }
    .cover-card:hover {
      transform: translateY(-2px) scale(1.005);
      box-shadow: 0 22px 45px rgba(15, 23, 42, 0.06), 0 6px 16px rgba(0, 0, 0, 0.015);
    }
 
    .cover-title {
      font-family: 'Noto Serif SC', 'Playfair Display', Georgia, serif;
      font-weight: 900;
      color: #1a202c;
      line-height: 1.4;
      text-align: center;
      margin-bottom: 24px;
      letter-spacing: 0.5px;
      position: relative;
      z-index: 2;
    }
 
    .highlight-brush {
      position: relative;
      display: inline-block;
      z-index: 1;
      padding: 0 6px;
      margin: 0 -2px;
      font-size: 1.85rem;
      color: #0f172a;
      letter-spacing: -0.5px;
    }
    .highlight-brush::after {
      content: "";
      position: absolute;
      bottom: 2px;
      left: 0;
      width: 100%;
      height: 38%; /* 黄色水彩涂鸦色块占半个字高 */
      background: #fef08a; /* 暖黄色水彩涂鸦色块 */
      z-index: -1;
      border-radius: 4px;
      transform: rotate(-0.5deg);
      opacity: 0.85;
    }
 
    .summary-grid-card {
      background: #ffffff;
      border-radius: 20px;
      padding: 20px 16px 14px 16px;
      border: 1px solid rgba(226, 232, 240, 0.8);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.015);
      position: relative;
      z-index: 2;
      margin-top: 24px;
    }
    
    .grid-card-item {
      background: #faf8f5;
      border: 1px solid rgba(226, 232, 240, 0.6);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 0.82rem;
      font-weight: 700;
      color: #334155;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      line-height: 1.3;
      font-family: 'Noto Sans SC', sans-serif;
    }
    
    .grid-card-item.active {
      background: #fde047; /* 醒目黄色 */
      border-color: #fde047;
      color: #1e3a8a;
    }

    .card {
      position: relative;
      background: #ffffff;
      border-radius: 24px;
      border: 1px solid rgba(59, 130, 246, 0.12);
      outline: 1px dashed rgba(59, 130, 246, 0.25);
      outline-offset: -6px; /* 虚线缝线效果 */
      box-shadow: 0 16px 36px rgba(59, 130, 246, 0.04), 0 2px 6px rgba(0, 0, 0, 0.01);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.012 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E"); /* 引入噪点背景 */
    }
    .card:hover {
      transform: translateY(-4px) scale(1.01) !important;
      box-shadow: 0 20px 40px rgba(59, 130, 246, 0.08), 0 4px 12px rgba(0, 0, 0, 0.015) !important;
    }
    
    .xhs-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1.5px dashed #f1f5f9;
    }
    
    .xhs-author {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .xhs-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #60a5fa);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 900;
      border: 2px solid #ffffff;
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.25);
    }
    .xhs-name {
      font-size: 0.82rem;
      font-weight: 700;
      color: #334155;
    }
    
    .xhs-buttons {
      display: flex;
      gap: 16px;
      font-size: 0.8rem;
      color: #64748b;
      font-weight: 600;
    }
    .xhs-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .xhs-btn:hover {
      transform: scale(1.1);
    }
    .xhs-btn.like { color: #3b82f6; }
    .xhs-btn.star { color: #f59e0b; }
  </style>
</head>
<body>
  <div class="container">
    <main>
      ${coverCard}
      ${contentHtml}
    </main>
    <div class="xhs-actions">
      <div class="xhs-author">
        <div class="xhs-avatar">${escapeHtml(contentInitials)}</div>
        <div class="xhs-name">${escapeHtml(contentBrand)}</div>
      </div>
      <div class="xhs-buttons">
        <div class="xhs-btn like">❤️ 99k</div>
        <div class="xhs-btn star">⭐ 88k</div>
      </div>
    </div>
  </div>
</body>
</html>`
}
