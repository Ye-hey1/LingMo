import { escapeHtml, renderMarkdown, type BuildHtmlOptions, type ExtractedSection } from "../shared/builder-utils"

export function buildMindmapStyle(options: BuildHtmlOptions): string {
  const { title, sections } = options

  // 左右分布算法：偶数放左边，奇数放右边
  const leftSections = sections.filter((_, idx) => idx % 2 === 0)
  const rightSections = sections.filter((_, idx) => idx % 2 !== 0)

  // 亮丽现代的微光科技配色
  const branchThemes = [
    { main: '#3b82f6', bg: 'rgba(59, 130, 246, 0.04)', border: 'rgba(59, 130, 246, 0.25)' }, // 冰川蓝
    { main: '#10b981', bg: 'rgba(16, 185, 129, 0.04)', border: 'rgba(16, 185, 129, 0.25)' }, // 薄荷绿
    { main: '#f59e0b', bg: 'rgba(245, 158, 11, 0.04)', border: 'rgba(245, 158, 11, 0.25)' }, // 琥珀黄
    { main: '#ec4899', bg: 'rgba(236, 72, 153, 0.04)', border: 'rgba(236, 72, 153, 0.25)' }, // 珊瑚粉
    { main: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.04)', border: 'rgba(139, 92, 246, 0.25)' }, // 丁香紫
    { main: '#ef4444', bg: 'rgba(239, 68, 68, 0.04)', border: 'rgba(239, 68, 68, 0.25)' }  // 绯红
  ]

  // 定义树节点接口
  interface MindmapNode {
    id: string
    text: string
    children: MindmapNode[]
  }

  // 智能树形解析辅助函数
  function parseToTree(bullets?: string[], body?: string, globalIdx: number = 0): MindmapNode[] {
    const lines: { text: string; depth: number }[] = []
    
    if (bullets && bullets.length > 0) {
      bullets.forEach(b => {
        const leadingSpaces = b.match(/^\s*/)?.[0] || ""
        const baseIndent = leadingSpaces.length
        const cleanLine = b.trim()
        if (!cleanLine) return
        
        const textWithoutBullet = cleanLine.replace(/^([-\*\+]\s+)|(^\d+\.\s+)/, '')
        const parts = textWithoutBullet.split(/[:：]/).map(p => p.trim()).filter(p => p.length > 0)
        
        if (parts.length > 1) {
          parts.forEach((part, partIdx) => {
            lines.push({
              text: part,
              depth: baseIndent + partIdx
            })
          })
        } else {
          lines.push({
            text: textWithoutBullet,
            depth: baseIndent
          })
        }
      })
    } else if (body) {
      const rawLines = body.split('\n')
      rawLines.forEach(line => {
        const leadingSpaces = line.match(/^\s*/)?.[0] || ""
        const baseIndent = leadingSpaces.length
        const cleanLine = line.trim()
        if (!cleanLine) return
        
        const textWithoutBullet = cleanLine.replace(/^([-\*\+]\s+)|(^\d+\.\s+)/, '')
        const parts = textWithoutBullet.split(/[:：]/).map(p => p.trim()).filter(p => p.length > 0)
        
        if (parts.length > 1) {
          parts.forEach((part, partIdx) => {
            lines.push({
              text: part,
              depth: baseIndent + partIdx
            })
          })
        } else {
          lines.push({
            text: textWithoutBullet,
            depth: baseIndent
          })
        }
      })
    }
    
    interface StackItem {
      node: MindmapNode
      depth: number
    }
    
    const rootNodes: MindmapNode[] = []
    const stack: StackItem[] = []
    
    lines.forEach((line, lineIdx) => {
      const node: MindmapNode = {
        id: `node-${globalIdx}-${lineIdx}`,
        text: line.text,
        children: []
      }
      
      while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) {
        stack.pop()
      }
      
      if (stack.length === 0) {
        rootNodes.push(node)
      } else {
        stack[stack.length - 1].node.children.push(node)
      }
      
      stack.push({
        node,
        depth: line.depth
      })
    })
    
    return rootNodes
  }

  // 递归树渲染逻辑
  function renderNode(
    node: MindmapNode,
    parentId: string,
    level: number,
    theme: { main: string; bg: string; border: string },
    side: 'left' | 'right',
    globalIdx: number
  ): string {
    let levelClass = `level-${level}`
    if (level >= 3) {
      levelClass = `level-deep level-${level}`
    }
    
    let styleStr = `--hover-color: ${theme.main};`
    if (level === 1) {
      styleStr += ` border: 1px solid ${theme.border}; background: ${theme.bg};`
    } else if (level === 2) {
      styleStr += ` border-bottom: 2px solid ${theme.main}70;`
    } else {
      styleStr += ` border-bottom: 2px solid ${theme.main}60;`
    }
    
    let contentHtml = renderMarkdown(node.text)
    if (level === 1) {
      const numStr = String(globalIdx + 1).padStart(2, '0')
      contentHtml = `
        <div class="branch-header" style="padding: 10px 14px; display: flex; align-items: center; gap: 8px;">
          <span class="branch-number" style="font-size: 0.72rem; font-weight: 700; background: ${theme.main}20; color: ${theme.main}; padding: 1px 6px; border-radius: 99px; border: 1px solid ${theme.border}; font-family: monospace;">${numStr}</span>
          <span class="branch-title" style="font-size: 0.95rem; font-weight: 700; color: #0f172a; letter-spacing: 0.5px;">${renderMarkdown(node.text)}</span>
        </div>`
    }

    const childrenHtml = node.children.length > 0 
      ? `<div class="children-container ${side}">
          ${node.children.map(child => renderNode(child, node.id, level + 1, theme, side, globalIdx)).join('\n')}
         </div>`
      : ''

    return `
      <div class="node-group ${side}">
        <div class="node ${levelClass} ${side}" id="${node.id}" data-parent="${parentId}" data-color="${theme.main}" style="${styleStr}">
          ${contentHtml}
        </div>
        ${childrenHtml}
      </div>`
  }

  const renderSectionToGroup = (section: ExtractedSection, globalIdx: number, side: 'left' | 'right') => {
    const theme = branchThemes[globalIdx % branchThemes.length]
    
    const branchTree: MindmapNode = {
      id: `node-${globalIdx}`,
      text: section.title,
      children: parseToTree(section.bullets, section.body, globalIdx)
    }

    return renderNode(branchTree, 'node-root', 1, theme, side, globalIdx)
  }

  const leftHtml = leftSections.map(s => {
    const globalIdx = sections.indexOf(s)
    return renderSectionToGroup(s, globalIdx, 'left')
  }).join('\n')

  const rightHtml = rightSections.map(s => {
    const globalIdx = sections.indexOf(s)
    return renderSectionToGroup(s, globalIdx, 'right')
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@300;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      color: #1e293b;
      background: #f1f5f9;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }
    
    /* 容器及画布样式 */
    .mindmap-container {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: #f8fafc;
      background-image: 
        radial-gradient(rgba(15, 23, 42, 0.05) 1px, transparent 1px),
        linear-gradient(rgba(15, 23, 42, 0.015) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15, 23, 42, 0.015) 1px, transparent 1px);
      background-size: 20px 20px, 20px 20px, 20px 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: grab;
      user-select: none;
    }
    .mindmap-container:active {
      cursor: grabbing;
    }
    
    .mindmap-canvas {
      position: absolute;
      width: 3200px;
      height: 2400px;
      display: flex;
      justify-content: center;
      align-items: center;
      transform-origin: center center;
      z-index: 10;
    }
    
    /* SVG 连线层 */
    #mindmap-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }
    
    /* 思维导图 Flex 生长包裹器 */
    .mindmap-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 120px; /* 一级节点到根节点的连线空隙 */
      z-index: 5;
    }
    
    .left-side {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 48px;
    }
    .right-side {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 48px;
    }
    
    /* 树节点大组，包裹当前节点和它的所有子节点 */
    .node-group {
      display: flex;
      align-items: center;
      gap: 56px; /* 节点到子节点容器的连线空隙 */
      transition: all 0.3s ease;
    }
    .node-group.left {
      flex-direction: row-reverse; /* 左侧分支向左生长 */
    }
    .node-group.right {
      flex-direction: row; /* 右侧分支向右生长 */
    }
    
    /* 子节点容器，包裹所有子节点大组，垂直排列 */
    .children-container {
      display: flex;
      flex-direction: column;
      gap: 20px; /* 同级子节点之间的垂直间距 */
    }
    .children-container.left {
      align-items: flex-end; /* 左侧子节点右对齐 */
    }
    .children-container.right {
      align-items: flex-start; /* 右侧子节点左对齐 */
    }
    
    /* 统一节点基类 */
    .node {
      z-index: 10;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    /* 根节点 */
    .center-node-wrapper {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 260px;
    }
    .level-root {
      background: #0f172a !important;
      color: #f8fafc !important;
      font-weight: 800;
      font-size: 1.25rem;
      padding: 22px 36px;
      border-radius: 24px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
      border: 1px solid #1e293b;
      letter-spacing: 0.5px;
      line-height: 1.4;
      text-align: center;
      word-break: break-all;
      position: relative;
      overflow: hidden;
    }
    .level-root span {
      position: relative;
      z-index: 1;
    }
    .level-root:hover {
      transform: scale(1.03);
      box-shadow: 0 25px 60px rgba(99, 102, 241, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.2) inset !important;
    }
    
    /* 一级节点：半透明磨砂彩色气泡 */
    .level-1 {
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.04), 0 8px 16px -6px rgba(15, 23, 42, 0.02);
      min-width: 160px;
      max-width: 240px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .level-1:hover {
      transform: translateY(-4px) scale(1.03);
      box-shadow: 0 20px 35px -5px rgba(15, 23, 42, 0.08) !important;
    }
    
    /* 二级节点：轻盈的白色毛玻璃圆角小卡片 */
    .level-2 {
      font-size: 0.9rem;
      font-weight: 600;
      color: #334155;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(15, 23, 42, 0.06);
      border-radius: 10px;
      max-width: 220px;
      word-break: break-all;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.02);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .level-2:hover {
      background: #ffffff;
      border-color: var(--hover-color, #3b82f6);
      color: var(--hover-color, #3b82f6);
      transform: translateY(-2px) scale(1.04);
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.06);
    }
    
    /* 三级及以上：优雅的下划线树枝节点 */
    .level-deep {
      font-size: 0.86rem;
      font-weight: 500;
      color: #475569;
      padding: 6px 12px;
      max-width: 280px;
      word-break: break-all;
      text-align: left;
      transition: all 0.25s ease;
      background: transparent;
      border: none;
      border-radius: 0;
    }
    .level-deep:hover {
      color: var(--hover-color, #0f172a);
    }
    .level-deep.left:hover {
      transform: translateX(-4px);
    }
    .level-deep.right:hover {
      transform: translateX(4px);
    }
    
    /* 表格与代码特化 */
    .node table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 0.8em;
      border: 1px solid rgba(15, 23, 42, 0.08) !important;
      background: rgba(0, 0, 0, 0.01);
      border-radius: 6px;
      overflow: hidden;
    }
    .node th {
      background: rgba(0, 0, 0, 0.03) !important;
      color: #0f172a !important;
      border-bottom: 2px solid rgba(15, 23, 42, 0.08) !important;
      padding: 4px 8px;
    }
    .node td {
      border-bottom: 1px solid rgba(15, 23, 42, 0.04) !important;
      padding: 4px 8px;
      color: #334155;
    }
    .node code {
      background: rgba(15, 23, 42, 0.06) !important;
      color: #0f172a !important;
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 0.88em;
    }
    
    /* 缩放及平移控制器 */
    .zoom-controls {
      position: fixed;
      top: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: rgba(255, 255, 255, 0.75);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      padding: 8px;
      border-radius: 12px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.05);
      z-index: 100;
    }
    .zoom-controls button {
      width: 36px;
      height: 36px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(0, 0, 0, 0.02);
      color: #334155;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1.2rem;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .zoom-controls button:hover {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
    }

    /* SVG 虚线流动动效 */
    @keyframes dash-flow {
      to {
        stroke-dashoffset: -20;
      }
    }
    .dash-flow-path {
      animation: dash-flow 1.2s linear infinite;
    }
  </style>
</head>
<body>
  <div class="zoom-controls">
    <button id="zoom-in" title="放大">＋</button>
    <button id="zoom-out" title="缩小">－</button>
    <button id="zoom-reset" title="自适应">⊙</button>
  </div>

  <div class="mindmap-container" id="mindmap-container">
    <div class="mindmap-canvas" id="mindmap-canvas">
      <svg id="mindmap-svg"></svg>
      <div class="mindmap-wrapper">
        <!-- 左半区 -->
        <div class="left-side">
          ${leftHtml}
        </div>
        
        <!-- 核心根节点 -->
        <div class="center-node-wrapper">
          <div class="node level-root" id="node-root"><span>${escapeHtml(title.slice(0, 20))}</span></div>
        </div>
        
        <!-- 右半区 -->
        <div class="right-side">
          ${rightHtml}
        </div>
      </div>
    </div>
  </div>

  <script>
    // -------------------------------------------------------------
    // Canvas Pan & Zoom 画布拖拽平移及滚轮缩放
    // -------------------------------------------------------------
    let scale = 1.0;
    let posX = 0;
    let posY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    
    const container = document.getElementById('mindmap-container');
    const canvas = document.getElementById('mindmap-canvas');
    
    function updateTransform() {
      canvas.style.transform = \`translate(\${posX}px, \${posY}px) scale(\${scale})\`;
    }
    
    // 鼠标滚轮缩放
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = 0.06;
      if (e.deltaY < 0) {
        scale = Math.min(scale + zoomFactor, 3.0);
      } else {
        scale = Math.max(scale - zoomFactor, 0.4);
      }
      updateTransform();
    }, { passive: false });
    
    // 画布鼠标拖拽平移
    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node') || e.target.closest('.zoom-controls')) return;
      isDragging = true;
      startX = e.clientX - posX;
      startY = e.clientY - posY;
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      posX = e.clientX - startX;
      posY = e.clientY - startY;
      updateTransform();
    });
    
    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // 悬浮按钮绑定
    document.getElementById('zoom-in').addEventListener('click', () => {
      scale = Math.min(scale + 0.2, 3.0);
      updateTransform();
    });
    
    document.getElementById('zoom-out').addEventListener('click', () => {
      scale = Math.max(scale - 0.2, 0.4);
      updateTransform();
    });
    
    document.getElementById('zoom-reset').addEventListener('click', () => {
      scale = 1.0;
      posX = 0;
      posY = 0;
      updateTransform();
    });
    
    // -------------------------------------------------------------
    // SVG Dynamic Bezier Connections (抗 transform 缩放的自适应连线)
    // -------------------------------------------------------------
    function getCanvasRelativeCenter(element, canvasEl) {
      let offsetLeft = 0;
      let offsetTop = 0;
      let el = element;
      while (el && el !== canvasEl) {
        offsetLeft += el.offsetLeft || 0;
        offsetTop += el.offsetTop || 0;
        el = el.offsetParent;
      }
      return {
        x: offsetLeft + element.offsetWidth / 2,
        y: offsetTop + element.offsetHeight / 2,
        w: element.offsetWidth,
        h: element.offsetHeight,
        left: offsetLeft,
        top: offsetTop
      };
    }
    
    function drawConnections() {
      const svg = document.getElementById('mindmap-svg');
      svg.innerHTML = '';
      
      const root = document.querySelector('.level-root');
      if (!root) return;
      
      const rootInfo = getCanvasRelativeCenter(root, canvas);
      const rx = rootInfo.x;
      const ry = rootInfo.y;
      
      // 遍历所有有 data-parent 的子节点，自适应绘制贝塞尔曲线
      const nodes = document.querySelectorAll('.node[data-parent]');
      nodes.forEach(node => {
        const parentId = node.getAttribute('data-parent');
        const parent = document.getElementById(parentId);
        if (!parent) return;
        
        const parentInfo = getCanvasRelativeCenter(parent, canvas);
        const selfInfo = getCanvasRelativeCenter(node, canvas);
        
        const color = node.getAttribute('data-color') || '#3b82f6';
        const isLeft = node.classList.contains('left');
        
        let startX = 0;
        let startY = parentInfo.y;
        let endX = 0;
        let endY = selfInfo.y;
        
        // 线条样式
        let strokeWidth = '2';
        let opacity = '0.75';
        if (node.classList.contains('level-1')) {
          strokeWidth = '3.5';
          opacity = '0.9';
        } else if (node.classList.contains('level-2')) {
          strokeWidth = '2.2';
          opacity = '0.8';
        } else {
          strokeWidth = '1.5';
          opacity = '0.65';
        }
        
        // 基于左右方向计算起终点端口
        if (isLeft) {
          startX = parentInfo.left;
          endX = selfInfo.left + selfInfo.w;
        } else {
          startX = parentInfo.left + parentInfo.w;
          endX = selfInfo.left;
        }
        
        // 控制点横向偏置，左侧偏负，右侧偏正
        const cpX = (startX + endX) / 2;
        const d = \`M \${startX} \${startY} C \${cpX} \${startY}, \${cpX} \${endY}, \${endX} \${endY}\`;
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', strokeWidth);
        path.setAttribute('fill', 'none');
        path.setAttribute('opacity', opacity);
        path.setAttribute('stroke-linecap', 'round');
        
        const isDeep = !node.classList.contains('level-1') && !node.classList.contains('level-2');
        if (isDeep) {
          // 三级及以上深层分支使用虚线流动，显得逻辑清晰且轻盈
          path.setAttribute('stroke-dasharray', '5, 5');
          path.classList.add('dash-flow-path');
        }
        
        svg.appendChild(path);
      });
    }
    
    // 初始化与动态观察
    window.addEventListener('load', () => {
      drawConnections();
      // 在流式收到数据并触发 DOM 长度变动时自动刷新连线
      const observer = new MutationObserver(drawConnections);
      observer.observe(canvas, { childList: true, subtree: true, characterData: true });
    });
    
    window.addEventListener('resize', drawConnections);
  </script>
</body>
</html>`
}
