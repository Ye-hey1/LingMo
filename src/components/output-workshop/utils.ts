/**
 * 输出工坊纯工具函数与 Prompt 常量
 */

import type { OutputTemplate } from "@/lib/output-workshop/templates"
import type { ExtractedSection } from "./types"
import {
  buildEditorialArticle,
  buildKamiParchment,
  buildBrutalistStyle,
  buildGuizangDeck,
  buildTechSharing,
  buildMagazinePoster,
  buildHeroPoster,
  buildDataDashboard,
  buildInfographic,
  buildGuizangSocialCard,
  buildXiaohongshuStyle,
  buildLearningCards,
  buildMindmapStyle,
  buildWaterfallStyle,
  buildBentoStyle,
  buildBusinessReportStyle,
  buildLiquidGlassStyle,
  buildAccordionManualStyle,
  buildDarkTechStyle,
} from "@/lib/output-workshop/html-builders"
import { normalizeOutputWorkshopHtml } from "@/lib/output-workshop/html-normalizer"

// ---------------------------------------------------------------------------
// Prompt 常量
// ---------------------------------------------------------------------------

export const EXTRACTION_PROMPT = `你是数据提取专家。从用户材料中提取结构化数据，用于生成可视化报告。

**输出格式（严格 JSON）**:
\`\`\`json
{
  "title": "报告标题",
  "subtitle": "副标题（可选）",
  "sections": [
    {
      "title": "章节标题",
      "body": "正文内容（2-4句话）",
      "bullets": ["要点1", "要点2"],
      "importance": "high/medium/low"
    }
  ]
}
\`\`\`

**规则**:
- 提取 3-8 个章节
- 每个章节 2-5 个要点
- 使用用户的真实数据，不编造
- 输出纯 JSON，不要解释`

export const CREATIVE_DESIGN_PROMPT = `你是一个顶级的前端网页交互设计师和开发专家。
请根据用户提供的输入材料和标题，直接输出一个具有 Awwwards 殿堂级高端设计感、精致无比、视觉张力极强的完整自包含 HTML 页面。

**视觉与排版核心规范（必须严格遵守）**:
1. **对比度第一原则 (Strict Contrast)**:
   - 文字颜色与背景色必须具有超高对比度，确保文字清晰可读，绝不模糊！
   - 如果使用深色背景（例如 OLED 纯黑 #050505 或深 Slate 蓝 #0F172A），文字必须使用纯白 (#FFFFFF) 或亮灰 (#F1F5F9)；段落文字也必须在 #CBD5E1 以上。
   - 如果使用浅色背景（如 Warm Cream #FDFBF7 或银白 #F8FAFC），文字必须使用炭黑 (#0F172A) 或深 Slate 灰 (#1E293B)。
2. **高端字体栈 (Premium Typography)**:
   - 在 head 标签中，必须静态引入 Google Fonts 顶级字体：
     <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet">
   - 主 headings 优先使用 'Playfair Display' (Serif) 或 'Plus Jakarta Sans' (Sans)。
   - 中文部分必须显式定义 CJK 中日韩字体栈：'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif。
3. **双层嵌套结构 (Double-Bezel Card)**:
   - 所有的主卡片、列表容器严禁采用普通的 1px 粗糙灰色边框，必须使用 Double-Bezel 结构实现精致工业质感：
     - 外层 Shell: 带有 p-1.5 到 p-2.5 的 padding，外层大圆角 rounded-[2rem]，配上微量对比度的环线（深色：border border-white/10 bg-white/5；浅色：border border-black/5 bg-black/5）。
     - 内层 Content: 拥有 concentric 对齐的较小圆角 rounded-[calc(2rem-0.5rem)]，以及独立的背景与 shadow (如 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] 或者是柔和衰减阴影 shadow-sm)。
4. **精细的时间轴/列表对齐**:
   - 列表、步骤、时间轴的图标或圆点必须与右侧标题首行文字进行数学上的居中/对齐，严禁粗糙错位。
   - 连接线使用极细的 1px 线段（如 border-l border-muted 或者是渐变背景），保持极高精度。
5. **单文件自包含与体积控制**:
   - 可以引入 <script src="https://cdn.tailwindcss.com"></script> 以获得强大的 Tailwind CSS 渲染能力。
   - 所有图标请直接使用文字、精美 Emoji 或极简 CSS 绘制，**严禁生成庞大冗长的 SVG 代码**（以防触发 6000 字符的体积限制导致截断）。
6. **流畅动效 (Fluid Motion)**:
   - 所有交互、Hover 状态均需使用自定义 cubic-bezier 缓动：transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]。

**输出要求**:
- 只输出完整的 HTML 页面代码
- 不要使用任何 Markdown 代码块包裹，也不要有任何前置或后置的文本说明（如果系统强制需要代码块，可以使用 \`\`\`html ... \`\`\` 包裹）`

export const REFINE_PROMPT = `你是一个 HTML 网页代码微调与修补专家。
请根据用户最新的【微调修补指令】，对当前已有的【旧 HTML 页面代码】进行精确的样式、排版或微量内容的修改。

**修改准则（必须严格遵守）**:
1. **只返回修改后的完整 HTML 页面代码**，不需要任何多余的 Markdown 代码块包裹或前置、后置的自然语言解释（如果系统强制，可以用 \`\`\`html ... \`\`\` 块包裹）。
2. **主动修复设计缺陷**：如果旧页面存在文字与背景对比度低（文字模糊）、画面杂乱、组件未对齐、缺乏呼吸感等问题，你必须在微调时**主动予以重构和精细化美化**，将其升级为 Awwwards 高端设计品质。
3. 必须保留用户原本的核心文字与数据内容，严格保持中日韩字体栈、8px 网格比例、双层嵌套卡片（Double-Bezel）、高对比度色彩搭配与高保真自适应设计。
4. 保证修改后的 HTML 代码在语法上是完整且无损的。`

// ---------------------------------------------------------------------------
// HTML 清洗与截断修复
// ---------------------------------------------------------------------------

export function cleanStreamingHtml(text: string): string {
  let cleaned = text.trim()

  cleaned = cleaned
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")

  // 1. 优先尝试匹配 fenced code block 内部的网页代码或样式片段
  const markdownCodeBlockRegex = /```(?:html|htm|css)?\s*([\s\S]*?)(?:```|$)/i
  const match = cleaned.match(markdownCodeBlockRegex)
  if (match && match[1]) {
    return match[1].trim()
  }

  // 2. 如果未被代码块包裹，但找到了完整文档或常见 HTML 片段起点
  const htmlStartRegex = /(<!DOCTYPE html>|<html[\s\S]*?>|<head[\s\S]*?>|<body[\s\S]*?>|<style[\s\S]*?>|<main[\s\S]*?>|<section[\s\S]*?>|<article[\s\S]*?>|<div[\s\S]*?>)/i
  const startMatch = cleaned.match(htmlStartRegex)
  if (startMatch) {
    const startIndex = cleaned.indexOf(startMatch[1])
    if (startIndex !== -1) {
      let htmlContent = cleaned.slice(startIndex)
      const endIndex = htmlContent.toLowerCase().lastIndexOf("</html>")
      if (endIndex !== -1) {
        htmlContent = htmlContent.slice(0, endIndex + 7)
      }
      return htmlContent.trim()
    }
  }

  // 3. 后备选择
  cleaned = cleaned.replace(/^```html\s*/i, "")
  cleaned = cleaned.replace(/^```\s*/, "")
  cleaned = cleaned.replace(/```\s*$/, "")
  return cleaned.trim()
}

/**
 * 自动修复大模型流式输出被截断时的 HTML 代码
 */
export function repairTruncatedHtml(html: string): string {
  if (!html) return ""

  if (html.toLowerCase().includes("</html>") && html.toLowerCase().includes("</body>")) {
    return html
  }

  const lastGreaterThan = html.lastIndexOf(">")
  let cutHtml = html
  if (lastGreaterThan !== -1) {
    cutHtml = html.substring(0, lastGreaterThan + 1)
  }

  const voidElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr"
  ])

  const stack: string[] = []
  const tagRegex = /<(?:\/([a-zA-Z0-9]+)|([a-zA-Z0-9]+)(?:\s+[^>]*)?(\/)?|!--[\s\S]*?--|!DOCTYPE[^>]*?)>/g

  let match
  while ((match = tagRegex.exec(cutHtml)) !== null) {
    const closeTagName = match[1]
    const openTagName = match[2]
    const isSelfClosing = !!match[3]

    if (closeTagName) {
      const lowerClose = closeTagName.toLowerCase()
      const idx = stack.lastIndexOf(lowerClose)
      if (idx !== -1) {
        stack.splice(idx)
      }
    } else if (openTagName) {
      const lowerOpen = openTagName.toLowerCase()
      if (!voidElements.has(lowerOpen) && !isSelfClosing) {
        stack.push(lowerOpen)
      }
    }
  }

  const scriptIdx = stack.lastIndexOf("script")
  if (scriptIdx !== -1) {
    const lastScriptStart = cutHtml.toLowerCase().lastIndexOf("<script")
    if (lastScriptStart !== -1) {
      cutHtml = cutHtml.substring(0, lastScriptStart)
    }
    stack.splice(scriptIdx)
  }

  let repaired = cutHtml
  while (stack.length > 0) {
    const tag = stack.pop()
    if (tag) {
      repaired += `</${tag}>`
    }
  }

  const lowerRep = repaired.toLowerCase()
  if (!lowerRep.includes("</body>")) {
    repaired += "</body>"
  }
  if (!lowerRep.includes("</html>")) {
    repaired += "</html>"
  }

  return repaired
}

export function prepareOutputHtml(text: string): string {
  const cleaned = cleanStreamingHtml(text)
  if (!cleaned) return ""
  return repairTruncatedHtml(normalizeOutputWorkshopHtml(cleaned))
}

// ---------------------------------------------------------------------------
// 模板预览
// ---------------------------------------------------------------------------

const WORKSHOP_SAMPLE_SECTIONS: ExtractedSection[] = [
  {
    title: "洞察入口",
    body: "把零散笔记整理为可阅读、可演示、可分享的视觉页面。模板决定版式骨架，内容决定叙事重点。",
    bullets: ["自动提取章节结构", "保留原始材料语义", "适配桌面与移动端预览"],
    importance: "high",
  },
  {
    title: "视觉节奏",
    body: "标题、数据、段落和注释会按模板规则重新组织，形成适合发布或汇报的完整页面。",
    bullets: ["清晰层级", "固定比例预览", "支持后续微调"],
    importance: "medium",
  },
  {
    title: "交付动作",
    body: "生成后可复制为图文、下载图片或 HTML，也可以继续导出 Deck、PPTX、PDF 或部署到公网。",
    bullets: ["预览", "源码", "日志", "大纲"],
    importance: "low",
  },
]

export function buildTemplatePreviewHtml(template: OutputTemplate): string {
  const options = {
    title: template.name,
    subtitle: template.description,
    sections: WORKSHOP_SAMPLE_SECTIONS,
    sourceLabel: "模板示例",
    generatedAt: "Preview",
  }

  let html: string

  switch (template.id) {
    case "article-editorial":
      html = buildEditorialArticle(options)
      break
    case "article-kami":
      html = buildKamiParchment(options)
      break
    case "article-brutalist":
      html = buildBrutalistStyle(options)
      break
    case "deck-minimal":
      html = buildGuizangDeck(options)
      break
    case "deck-tech":
      html = buildTechSharing(options)
      break
    case "poster-magazine":
      html = buildMagazinePoster(options)
      break
    case "poster-hero":
      html = buildHeroPoster(options)
      break
    case "data-dashboard":
      html = buildDataDashboard(options)
      break
    case "data-infographic":
      html = buildInfographic(options)
      break
    case "social-card":
      html = buildGuizangSocialCard(options)
      break
    case "social-xiaohongshu":
      html = buildXiaohongshuStyle(options)
      break
    case "social-waterfall":
      html = buildWaterfallStyle(options)
      break
    case "visual-bento":
      html = buildBentoStyle(options)
      break
    case "report-business":
      html = buildBusinessReportStyle(options)
      break
    case "read-glass":
      html = buildLiquidGlassStyle(options)
      break
    case "read-accordion":
      html = buildAccordionManualStyle(options)
      break
    case "read-dark-tech":
      html = buildDarkTechStyle(options)
      break
    case "learning-flashcard":
      html = buildLearningCards(options)
      break
    case "learning-mindmap":
      html = buildMindmapStyle(options)
      break
    default:
      html = buildFallbackTemplatePreview(template)
  }

  return makeStaticTemplatePreview(normalizeOutputWorkshopHtml(html))
}

function makeStaticTemplatePreview(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<link\b[^>]*rel=["']?(?:preconnect|preload|modulepreload)["']?[^>]*>/gi, "")

  const previewStyle = `
<style>
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
  html, body {
    overflow: hidden !important;
  }
</style>`

  if (/<\/head>/i.test(withoutScripts)) {
    return withoutScripts.replace(/<\/head>/i, `${previewStyle}</head>`)
  }

  return `${previewStyle}${withoutScripts}`
}

function buildFallbackTemplatePreview(template: OutputTemplate): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${template.name}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      color: #1f2937;
      background: #f7f7f4;
      padding: 48px;
    }
    .shell {
      max-width: 860px;
      min-height: calc(100vh - 96px);
      margin: 0 auto;
      display: grid;
      grid-template-rows: auto 1fr auto;
      border: 1px solid #d8d6ce;
      background: #fffefa;
    }
    header { padding: 44px 48px 28px; border-bottom: 1px solid #e5e2d8; }
    .kicker { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7280; }
    h1 { margin: 18px 0 12px; font-size: clamp(38px, 7vw, 86px); line-height: 0.95; letter-spacing: -0.04em; }
    p { margin: 0; color: #5f6470; line-height: 1.7; }
    main { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 0; }
    .brief { padding: 40px 48px; border-right: 1px solid #e5e2d8; }
    .brief h2 { margin: 0 0 16px; font-size: 22px; }
    .stack { display: grid; gap: 12px; padding: 40px; }
    .card { border: 1px solid #e5e2d8; padding: 18px; background: #f8fafc; }
    .card b { display: block; margin-bottom: 8px; font-size: 13px; }
    footer { display: flex; justify-content: space-between; padding: 18px 48px; border-top: 1px solid #e5e2d8; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="kicker">${template.mode} / ${template.scenario}</div>
      <h1>${template.name}</h1>
      <p>${template.description}</p>
    </header>
    <main>
      <section class="brief">
        <h2>${template.bestFor}</h2>
        <p>${template.outputHint}</p>
      </section>
      <section class="stack">
        <div class="card"><b>模板规则</b><p>会把输入内容转译成该风格下的页面结构。</p></div>
        <div class="card"><b>适用内容</b><p>适合笔记、汇报、分享稿和结构化材料。</p></div>
        <div class="card"><b>工作流</b><p>选模板后直接编辑内容并生成，无需切换面板。</p></div>
      </section>
    </main>
    <footer><span>LingMo Workshop Preview</span><span>${template.nameEn}</span></footer>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

export function getStatusText(status: string): string {
  switch (status) {
    case "generating":
      return "分析中"
    case "streaming":
      return "生成中"
    case "done":
      return "已就绪"
    case "error":
      return "有错误"
    default:
      return "待构建"
  }
}

export function splitContentIntoSections(content: string): ExtractedSection[] {
  const normalized = content.trim()
  if (!normalized) return []

  const baseOffset = content.indexOf(normalized)
  const lineAt = (offset: number) => content.slice(0, Math.max(0, offset)).split(/\r?\n/).length
  const withPosition = (section: Omit<ExtractedSection, "startLine" | "endLine">): ExtractedSection => ({
    ...section,
    startLine: section.startOffset === undefined ? undefined : lineAt(section.startOffset),
    endLine: section.endOffset === undefined ? undefined : lineAt(section.endOffset),
  })

  const headingRegex = /^#{1,6}\s+.+$/gm
  const headings = Array.from(normalized.matchAll(headingRegex))
  if (headings.length > 0) {
    return headings
      .map((block) => {
        return block
      })
      .map((heading, index) => {
        const start = heading.index ?? 0
        const end = index + 1 < headings.length ? headings[index + 1].index ?? normalized.length : normalized.length
        const block = normalized.slice(start, end)
        const lines = block.trim().split(/\r?\n/)
        const rawTitle = lines.shift() || ""
        const title = rawTitle.replace(/^#{1,6}\s+/, "").trim()
        const bodyLines = lines.filter(Boolean)
        const bullets = bodyLines
          .filter((line) => /^\s*[-*+]\s+/.test(line))
          .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
        const body = bodyLines
          .filter((line) => !/^\s*[-*+]\s+/.test(line))
          .join("\n")
          .trim()

        return withPosition({
          title: title || "未命名章节",
          body,
          bullets: bullets.length > 0 ? bullets : undefined,
          importance: inferImportance(`${title}\n${body}`),
          startOffset: baseOffset + start,
          endOffset: baseOffset + end,
        })
      })
      .filter((section) => section.body || section.bullets?.length)
  }

  const paragraphMatches = Array.from(normalized.matchAll(/[^\n](?:[\s\S]*?)(?=\n{2,}|\s*$)/g))
  return paragraphMatches
    .map((match, index) => {
      const paragraph = match[0].trim()
      const start = match.index ?? 0
      const end = start + match[0].length
      return withPosition({
        title: index === 0 ? "核心概览" : `要点 ${index + 1}`,
        body: paragraph,
        bullets: extractBullets(paragraph),
        importance: inferImportance(paragraph),
        startOffset: baseOffset + start,
        endOffset: baseOffset + end,
      })
    })
    .filter((section) => section.body || section.bullets?.length)
}

function extractBullets(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
    .slice(0, 8)
}

function inferImportance(content: string): "low" | "medium" | "high" {
  if (/关键|核心|重要|风险|阻塞|失败|必须|high|critical|risk|block/i.test(content)) {
    return "high"
  }
  if (/建议|注意|计划|下一步|优化|medium|todo|next/i.test(content)) {
    return "medium"
  }
  return "low"
}
