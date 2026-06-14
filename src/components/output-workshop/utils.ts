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
import { buildWechatArticle, buildWechatPreviewMarkdown } from "@/lib/output-workshop/wechat-builder"
import { isWechatStyleId } from "@/lib/output-workshop/wechat-styles"
import { buildMokaTemplatePreviewHtml, isMokaTemplateId } from "@/lib/output-workshop/moka"

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

export const CREATIVE_DESIGN_PROMPT = `你是一个内容驱动的资深视觉编辑、信息架构师和前端网页交互设计师。
你的任务不是套用固定网页模板，而是先阅读材料，再为这份材料定制一个独特的自包含 HTML 视觉成品。

**内容驱动创意策略（必须先在内部完成，不要输出分析文字）**:
1. 判断材料的真实类型：研究报告、产品复盘、教程、人物故事、会议纪要、数据解读、观点宣言、清单、时间线、案例拆解等。
2. 判断目标读者与阅读场景：快速扫读、深度阅读、社媒传播、课堂讲解、汇报展示、个人知识库复习等。
3. 从材料中提取一个视觉隐喻或结构母题：流程、地图、档案、剧本、仪表盘、标本册、展览墙、航线、棋盘、时间轴、实验记录、目录索引等。母题必须来自输入内容，不要凭空装饰。
4. 依据内容结构选择版式，而不是默认 hero + card grid。可以采用但不限于：编辑部专题、田野笔记、交互目录、分镜叙事、横向时间轴、双栏论文批注、地图式导览、卡片组图、PPT 单页、数据看板、问答卡、流程仪表、案例卷宗。
5. 为这次输入生成专属的信息层级：哪些内容做标题、哪些做主视觉、哪些做证据、哪些做脚注、哪些做导航。不要把所有章节渲染成相同卡片。
6. 如果输入包含数字、时间、对比、步骤或实体关系，必须把这些结构转成相应的视觉组织方式；如果没有数据，不要伪造指标。

**反模板要求（非常重要）**:
- 严禁每次都生成同一种大标题 hero、三四张圆角卡片、统一渐变背景的固定套路。
- 严禁只替换文字但保持相同布局骨架；布局、节奏、导航和重点呈现方式必须随内容变化。
- 不要为了“高端感”堆砌装饰。视觉选择必须能解释材料，而不是覆盖材料。
- 可以做强视觉，但必须让用户看得出这是为当前内容特别设计的页面。

**视觉与排版核心规范（必须严格遵守）**:
1. **对比度第一原则 (Strict Contrast)**:
   - 文字颜色与背景色必须具有超高对比度，确保文字清晰可读，绝不模糊！
   - 如果使用深色背景（例如 OLED 纯黑 #050505 或深 Slate 蓝 #0F172A），文字必须使用纯白 (#FFFFFF) 或亮灰 (#F1F5F9)；段落文字也必须在 #CBD5E1 以上。
   - 如果使用浅色背景（如 Warm Cream #FDFBF7 或银白 #F8FAFC），文字必须使用炭黑 (#0F172A) 或深 Slate 灰 (#1E293B)。
2. **产品级排版 (Premium Typography)**:
   - 在 head 标签中，必须静态引入 Google Fonts 顶级字体：
     <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet">
   - 主 headings 优先使用 'Playfair Display' (Serif) 或 'Plus Jakarta Sans' (Sans)。
   - 中文部分必须显式定义 CJK 中日韩字体栈：'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif。
   - 正文不小于 1rem；长文行高 1.55-1.75；标题使用 text-wrap: balance，段落使用 text-wrap: pretty。
 3. **精确布局与容器节制**:
    - 使用 4px/8px 基线间距，相关元素紧密分组，不同区块用更大留白区分。
    - Grid 负责二维结构，Flex 负责横向/纵向一维排列；固定比例卡片必须有安全区，表格、代码块和长标题不得横向溢出。
    - 卡片圆角优先 8px/12px/16px；不要使用 24px 以上大圆角、普通卡片套卡片、渐变文字或装饰性玻璃拟态。
4. **精细的时间轴/列表对齐**:
   - 列表、步骤、时间轴的图标或圆点必须与右侧标题首行文字进行数学上的居中/对齐，严禁粗糙错位。
   - 连接线使用极细的 1px 线段（如 border-l border-muted 或者是渐变背景），保持极高精度。
5. **单文件自包含与体积控制**:
   - 可以引入 <script src="https://cdn.tailwindcss.com"></script> 以获得强大的 Tailwind CSS 渲染能力。
   - 所有图标请直接使用文字、精美 Emoji 或极简 CSS 绘制，**严禁生成庞大冗长的 SVG 代码**（以防触发 6000 字符的体积限制导致截断）。
6. **状态型动效 (Purposeful Motion)**:
   - 动效只用于 hover、press、展开折叠、加载、切换和内容关系提示；常规状态变化 150-250ms，布局变化不超过 350ms。
   - 使用 ease-out quart/quint/expo 曲线，避免 bounce/elastic；必须写入 @media (prefers-reduced-motion: reduce) 降级。

**输出要求**:
- 只输出完整的 HTML 页面代码
- HTML 中必须包含一个简短的内联注释 \`<!-- creative-brief: ... -->\`，用一句话记录本次页面采用的内容母题与版式策略，便于调试；不要在页面可见区域显示这句说明。
- 不要使用任何 Markdown 代码块包裹，也不要有任何前置或后置的文本说明（如果系统强制需要代码块，可以使用 \`\`\`html ... \`\`\` 包裹）`

export const REFINE_PROMPT = `你是一个 HTML 网页代码微调与修补专家。
请根据用户最新的【微调修补指令】，对当前已有的【旧 HTML 页面代码】进行精确的样式、排版或微量内容的修改。

**修改准则（必须严格遵守）**:
1. **只返回修改后的完整 HTML 页面代码**，不需要任何多余的 Markdown 代码块包裹或前置、后置的自然语言解释（如果系统强制，可以用 \`\`\`html ... \`\`\` 块包裹）。
2. **主动修复设计缺陷**：如果旧页面存在文字与背景对比度低（文字模糊）、画面杂乱、组件未对齐、缺乏呼吸感、横向溢出、动效过慢或无 reduced-motion 降级等问题，你必须在微调时主动修复。
3. 必须保留用户原本的核心文字与数据内容，严格保持中日韩字体栈、8px 网格比例、清晰安全区、高对比度色彩搭配与高保真自适应设计。
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

  if (isWechatStyleId(template.id)) {
    const html = buildWechatArticle({
      styleId: template.id,
      title: template.name,
      subtitle: template.description,
      markdown: buildWechatPreviewMarkdown(template.name),
      sourceLabel: "公众号模板示例",
      generatedAt: "Preview",
    })
    return makeStaticTemplatePreview(normalizeOutputWorkshopHtml(html))
  }

  if (isMokaTemplateId(template.id)) {
    return makeStaticTemplatePreview(normalizeOutputWorkshopHtml(buildMokaTemplatePreviewHtml(template.id)))
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
    case "creative-huashu-design":
    case "huashu-prototype":
    case "huashu-deck":
    case "huashu-timeline-animation":
    case "huashu-variants":
    case "huashu-infographic":
    case "huashu-direction-advisor":
    case "huashu-expert-review":
      html = buildCreativeSeriesTemplatePreview(template)
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
    overflow: auto !important;
  }
</style>`

  if (/<\/head>/i.test(withoutScripts)) {
    return withoutScripts.replace(/<\/head>/i, `${previewStyle}</head>`)
  }

  return `${previewStyle}${withoutScripts}`
}

interface CreativePreviewModule {
  title: string
  body?: string
  bullets?: string[]
}

interface CreativePreviewConfig {
  title: string
  routeTitle: string
  routeCopy: string
  quality: string
  steps: string[]
  pills: string[]
  modules: CreativePreviewModule[]
  ruleTitle: string
  ruleBody: string
  ruleMeta: string
}

function escapePreviewText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function getCreativePreviewConfig(templateId: string): CreativePreviewConfig {
  switch (templateId) {
    case "huashu-prototype":
      return {
        title: "真机状态流，不是静态截图",
        routeTitle: "Device frame + Clickable path",
        routeCopy: "围绕 App/Web 的真实任务路径生成 3 个以上 screen/state，并保留 Playwright 检查线索。",
        quality: "44px",
        steps: ["Screen", "State", "Test"],
        pills: ["iPhone 15 Pro", "data-testid", "Playwright", "安全区"],
        modules: [
          { title: "真 iPhone bezel", body: "Dynamic Island、状态栏、Home Indicator 和内容安全区都进入版式约束。" },
          { title: "可点击主流程", body: "按钮、tab、详情页或状态切换是真交互，不用静态 mockup 冒充原型。" },
          { title: "验证清单", bullets: ["进入详情", "关键按钮", "tab/状态切换", "pageerror=0"] },
          { title: "内容优先", body: "用材料里的真实功能组织界面；缺素材时用诚实 placeholder。" },
        ],
        ruleTitle: "交付物",
        ruleBody: "单文件 HTML，可点击，可截图，可附最小 Playwright 验证路径。",
        ruleMeta: "prototype ready",
      }
    case "huashu-deck":
      return {
        title: "一张一张居中演讲",
        routeTitle: "16:9 stage with keyboard control",
        routeCopy: "按浏览器演讲 Deck 生成，每页一个记忆点，居中显示，不再像网页长滚动。",
        quality: "16:9",
        steps: ["Point", "Slide", "Export"],
        pills: ["HTML deck", "Speaker notes", "PPTX-ready", "PDF"],
        modules: [
          { title: "逐页舞台", body: "所有 slide 锁定 16:9 居中舞台，左右键翻页，页码清楚。" },
          { title: "演讲可读", body: "正文不低于 24px，每页只承担一个核心观点。" },
          { title: "PPTX 友好", bullets: ["h/p 文本", "少复杂 SVG", "少渐变", "可编辑文本框约束"] },
          { title: "导出路径", body: "HTML 可直接演讲，也保留 PPTX/PDF 下游导出提示。" },
        ],
        ruleTitle: "交付物",
        ruleBody: "HTMLdeck 浏览器演讲源文件，可走 PDF/PPTX 导出链路。",
        ruleMeta: "deck centered",
      }
    case "huashu-timeline-animation":
      return {
        title: "时间片段驱动的动画稿",
        routeTitle: "Stage / Sprite / Timeline",
        routeCopy: "用 scene、sprite、start/end、easing 组织动画，不做几页 PPT 的淡入淡出。",
        quality: "25/60",
        steps: ["Scene", "Motion", "Export"],
        pills: ["Scrubber", "MP4 25fps", "60fps 插帧", "palette GIF", "BGM cues"],
        modules: [
          { title: "可播放时间轴", body: "play/pause、scrubber、当前时间和总时长构成最小控制台。" },
          { title: "信息逐步揭示", body: "运动用于解释关系、节奏和因果，不用装饰性乱动。" },
          { title: "导出配方", bullets: ["25fps MP4", "60fps 插帧", "palette 优化 GIF", "BGM/SFX cue list"] },
          { title: "降级安全", body: "prefers-reduced-motion 下保留清晰的静态阅读路径。" },
        ],
        ruleTitle: "交付物",
        ruleBody: "单文件动画 HTML 源，附视频、GIF 与音频 cue 的下游配方。",
        ruleMeta: "motion source",
      }
    case "huashu-variants":
      return {
        title: "并排比较，而不是换个颜色",
        routeTitle: "3+ directions with live Tweaks",
        routeCopy: "跨视觉方向、布局密度、交互节奏探索多个方案，并给出 tradeoff。",
        quality: "3+",
        steps: ["Explore", "Compare", "Tune"],
        pills: ["Variants", "Tweaks", "localStorage", "跨维度探索"],
        modules: [
          { title: "三套以上方向", body: "方向之间拉开距离：可信、表达、实验，而不是同骨架换皮。" },
          { title: "Tweaks 面板", body: "主题、密度、布局或动效强度可实时调参，并持久化。" },
          { title: "清楚取舍", bullets: ["适合什么", "风险是什么", "下一步怎么收敛"] },
          { title: "真实变化", body: "参数切换必须改变 DOM/状态，不只改说明文字。" },
        ],
        ruleTitle: "交付物",
        ruleBody: "3+ 并排对比 Demo，带可折叠 Tweaks 和可操作取舍说明。",
        ruleMeta: "compare mode",
      }
    case "huashu-infographic":
      return {
        title: "印刷级网格信息图",
        routeTitle: "Print grid + annotation system",
        routeCopy: "把数据、流程或概念地图组织成可导出的高对比信息图，而不是堆普通卡片。",
        quality: "PDF",
        steps: ["Data", "Grid", "Export"],
        pills: ["图例", "注释", "PDF/PNG/SVG", "数据来源"],
        modules: [
          { title: "精确画布", body: "明确安全区、标题层级、图例、来源和脚注。" },
          { title: "真实数据", body: "有数据就用真实数据，无数据就做结构图、流程图或概念地图。" },
          { title: "矢量友好", bullets: ["高对比", "少装饰", "SVG 用于图表/连线", "可整页导出"] },
          { title: "卡片导出", body: "声明关键选择器，方便输出工坊智能卡片导出。" },
        ],
        ruleTitle: "交付物",
        ruleBody: "印刷级信息图 HTML，可走 PDF、PNG 或 SVG 友好导出。",
        ruleMeta: "print grid",
      }
    case "huashu-direction-advisor":
      return {
        title: "先选设计方向，再深挖方案",
        routeTitle: "5 schools × 20 philosophies",
        routeCopy: "需求模糊时推荐 3 个差异化方向，并并行生成轻量 Demo 让用户选择。",
        quality: "3x",
        steps: ["Map", "Recommend", "Demo"],
        pills: ["5 流派", "20 种哲学", "3 方向", "风险提示"],
        modules: [
          { title: "设计空间", body: "从信息建筑、运动诗学、东方极简、实验先锋等哲学中选择。" },
          { title: "三种推荐", body: "保守可信、表达性强、实验前沿，三者要有真实差异。" },
          { title: "Demo 面板", bullets: ["视觉语法", "适用理由", "不适合场景", "风险"] },
          { title: "避免盲做", body: "没有上下文时先给方向顾问板，而不是直接押一个固定风格。" },
        ],
        ruleTitle: "交付物",
        ruleBody: "方向顾问页，包含 3 个可比较 Demo 和收敛建议。",
        ruleMeta: "advisor mode",
      }
    case "huashu-expert-review":
      return {
        title: "5 维度设计评审",
        routeTitle: "Radar + Keep / Fix / Quick Wins",
        routeCopy: "围绕哲学一致性、视觉层级、细节执行、功能性、创新性给出证据化评分。",
        quality: "5D",
        steps: ["Score", "Diagnose", "Fix"],
        pills: ["Radar", "Keep", "Fix", "Quick Wins", "修复清单"],
        modules: [
          { title: "五维雷达", body: "每个维度 0-10 分，总分、证据句和雷达图一起出现。" },
          { title: "Keep / Fix", body: "保留项和修复项分栏，Fix 按严重程度排序。" },
          { title: "Quick Wins", bullets: ["5-15 分钟内可做", "明确位置", "明确操作", "避免空泛赞美"] },
          { title: "评设计，不评人", body: "语气具体、可执行，直接面向下一轮修改。" },
        ],
        ruleTitle: "交付物",
        ruleBody: "专家评审 artifact，含雷达图、分数、Keep/Fix/Quick Wins。",
        ruleMeta: "review board",
      }
    default:
      return {
        title: "内容决定媒介，不套固定模板",
        routeTitle: "Input-driven artifact routing",
        routeCopy: "根据输入自动选择 prototype、deck、infographic、animation、variants 或 review 等交付形态。",
        quality: "AI",
        steps: ["Context", "Direction", "Artifact"],
        pills: ["Pentagram", "Takram", "Fathom / Stamen", "Kenya Hara", "Information Architects"],
        modules: [
          { title: "Junior Designer brief", body: "先写假设、受众、内容类型、风险和视觉方向，再生成页面。" },
          { title: "交付形态路由", body: "材料适合什么，就生成什么；不是所有内容都套网页骨架。" },
          { title: "可选 Tweaks", bullets: ["主题", "密度", "字号", "布局或动效强度"] },
          { title: "Anti AI slop", body: "拒绝紫蓝大渐变、hero 三卡片、假数据指标和廉价装饰。" },
        ],
        ruleTitle: "输出约束",
        ruleBody: "顶部注释记录 assumptions、chosen philosophy、artifact type、content structure 和 known limitations。",
        ruleMeta: "reduced motion ready",
      }
  }
}

function buildCreativeSeriesTemplatePreview(template: OutputTemplate): string {
  const config = getCreativePreviewConfig(template.id)
  const moduleHtml = config.modules.map((module) => {
    const bodyHtml = module.bullets?.length
      ? `<ul>${module.bullets.map((bullet) => `<li>${escapePreviewText(bullet)}</li>`).join("")}</ul>`
      : `<p>${escapePreviewText(module.body || "")}</p>`
    return `<section class="module">
            <h3>${escapePreviewText(module.title)}</h3>
            ${bodyHtml}
          </section>`
  }).join("")

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${template.name}</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      --ink: #111111;
      --muted: #5e625f;
      --line: #d8d8d2;
      --paper: #fbfbf8;
      --field: #eeeeea;
      --accent: #c43d18;
      --blue: #1f4f73;
      --olive: #586a42;
    }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 30px;
      color: var(--ink);
      background:
        linear-gradient(90deg, rgba(17, 17, 17, 0.045) 1px, transparent 1px),
        linear-gradient(180deg, rgba(17, 17, 17, 0.035) 1px, transparent 1px),
        #f2f2ee;
      background-size: 56px 56px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      overflow: hidden;
    }
    .creative-series-shell {
      width: min(100%, 1040px);
      min-height: calc(100vh - 60px);
      margin: 0 auto;
      background: var(--paper);
      border: 1px solid var(--line);
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    .topbar,
    .footbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 22px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.2;
    }
    .footbar {
      border-top: 1px solid var(--line);
      border-bottom: 0;
    }
    .brand {
      color: var(--ink);
      font-weight: 700;
      letter-spacing: 0;
    }
    .stage {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
      min-height: 560px;
    }
    .intro {
      padding: 34px 34px 28px;
      border-right: 1px solid var(--line);
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 30px;
    }
    h1 {
      max-width: 680px;
      margin: 0;
      font-size: 54px;
      line-height: 0.98;
      letter-spacing: -0.028em;
      text-wrap: balance;
    }
    .lead {
      max-width: 56ch;
      margin: 16px 0 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.65;
      text-wrap: pretty;
    }
    .pipeline {
      align-self: end;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      border: 1px solid var(--line);
      background: #ffffff;
    }
    .step {
      min-height: 122px;
      padding: 18px;
      border-right: 1px solid var(--line);
      display: grid;
      align-content: space-between;
      gap: 16px;
    }
    .step:last-child { border-right: 0; }
    .step small {
      color: var(--muted);
      font-size: 12px;
    }
    .step strong {
      display: block;
      font-size: 18px;
      line-height: 1.16;
      text-wrap: balance;
    }
    .console {
      padding: 26px;
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 18px;
      background: #f8f8f5;
    }
    .route {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: start;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    .route h2 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.15;
      text-wrap: balance;
    }
    .route p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .quality {
      min-width: 74px;
      min-height: 74px;
      border: 1px solid var(--ink);
      display: grid;
      place-items: center;
      font-size: 20px;
      font-weight: 800;
    }
    .philosophy {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pill {
      border: 1px solid var(--line);
      background: #ffffff;
      padding: 8px 10px;
      color: var(--ink);
      font-size: 12px;
      line-height: 1;
      border-radius: 999px;
      white-space: nowrap;
    }
    .pill.hot {
      border-color: rgba(196, 61, 24, 0.45);
      color: var(--accent);
      background: rgba(196, 61, 24, 0.07);
    }
    .modules {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      align-content: end;
    }
    .module {
      min-height: 128px;
      border: 1px solid var(--line);
      background: #ffffff;
      padding: 16px;
      display: grid;
      align-content: space-between;
      gap: 18px;
    }
    .module:nth-child(2) { border-color: rgba(31, 79, 115, 0.36); }
    .module:nth-child(3) { border-color: rgba(88, 106, 66, 0.42); }
    .module h3 {
      margin: 0;
      font-size: 15px;
      line-height: 1.2;
    }
    .module p,
    .module ul {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }
    .module ul {
      padding-left: 16px;
    }
    .module li + li {
      margin-top: 4px;
    }
    .rule {
      grid-column: 1 / -1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-color: var(--ink);
      background: var(--ink);
      color: #ffffff;
    }
    .rule p {
      max-width: 48ch;
      color: rgba(255, 255, 255, 0.72);
    }
    .rule span {
      color: #ffffff;
      font-size: 12px;
      white-space: nowrap;
    }
    @media (max-width: 760px) {
      body { padding: 14px; overflow: auto; }
      .creative-series-shell { min-height: calc(100vh - 28px); }
      .stage { grid-template-columns: 1fr; }
      .intro { border-right: 0; border-bottom: 1px solid var(--line); padding: 24px; }
      h1 { font-size: 36px; }
      .pipeline { grid-template-columns: 1fr; }
      .step { border-right: 0; border-bottom: 1px solid var(--line); min-height: 92px; }
      .step:last-child { border-bottom: 0; }
      .console { padding: 20px; }
      .modules { grid-template-columns: 1fr; }
      .rule { align-items: flex-start; flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <article class="creative-series-shell">
    <header class="topbar">
      <span class="brand">Creative Output Lab</span>
      <span>content-driven HTML artifact</span>
    </header>
    <main class="stage">
      <section class="intro">
        <div>
          <h1>${escapePreviewText(config.title)}</h1>
          <p class="lead">${escapePreviewText(template.description)}</p>
        </div>
        <div class="pipeline" aria-label="Creative output workflow">
          ${config.steps.map((step, index) => `<div class="step"><small>${String(index + 1).padStart(2, "0")}</small><strong>${escapePreviewText(step)}</strong></div>`).join("")}
        </div>
      </section>
      <section class="console">
        <div class="route">
          <div>
            <h2>${escapePreviewText(config.routeTitle)}</h2>
            <p>${escapePreviewText(config.routeCopy)}</p>
          </div>
          <div class="quality">${escapePreviewText(config.quality)}</div>
        </div>
        <div class="philosophy" aria-label="Creative output capabilities">
          ${config.pills.map((pill, index) => `<span class="pill${index === 0 ? " hot" : ""}">${escapePreviewText(pill)}</span>`).join("")}
        </div>
        <div class="modules">
          ${moduleHtml}
          <section class="module rule">
            <h3>${escapePreviewText(config.ruleTitle)}</h3>
            <p>${escapePreviewText(config.ruleBody)}</p>
            <span>${escapePreviewText(config.ruleMeta)}</span>
          </section>
        </div>
      </section>
    </main>
    <footer class="footbar">
      <span>${template.outputHint}</span>
      <span>${template.nameEn}</span>
    </footer>
  </article>
</body>
</html>`
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
      .map((heading, index) => {
        const start = heading.index ?? 0
        const end = index + 1 < headings.length ? headings[index + 1].index ?? normalized.length : normalized.length
        const block = normalized.slice(start, end)
        const lines = block.trim().split(/\r?\n/)
        const rawTitle = lines.shift() || ""
        const level = rawTitle.match(/^#{1,6}/)?.[0].length ?? 1
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
          level,
          body,
          bullets: bullets.length > 0 ? bullets : undefined,
          importance: inferImportance(`${title}\n${body}`),
          startOffset: baseOffset + start,
          endOffset: baseOffset + end,
        })
      })
      .filter((section) => section.title)
  }

  const paragraphMatches = Array.from(normalized.matchAll(/[^\n](?:[\s\S]*?)(?=\n{2,}|\s*$)/g))
  return paragraphMatches
    .map((match, index) => {
      const paragraph = match[0].trim()
      const start = match.index ?? 0
      const end = start + match[0].length
      return withPosition({
        title: index === 0 ? "核心概览" : `要点 ${index + 1}`,
        level: 1,
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
