import type { ExtractedSection } from "./shared/builder-utils"

/**
 * 思维导图的结构化树节点。
 * mindmap 策略下 AI 直接输出嵌套树，而非把树编码进 body 字符串，
 * 使模板侧零猜测直接渲染，避免「数空格推断深度」的脆弱机制。
 */
export interface MindmapChild {
  /** 子节点关键词（≤ 20 字） */
  text: string
  /** 孙节点（可选，最深 3 层） */
  children?: MindmapChild[]
}

export interface MindmapBranch {
  /** 一级分支主题（≤ 16 字） */
  title: string
  /** 二级子节点（2-4 个） */
  children?: MindmapChild[]
}

export interface OutputExtractionResult {
  title: string
  subtitle: string
  sections: ExtractedSection[]
  /** 思维导图策略专用的结构化树（其他策略为空，回退用 sections） */
  mindmap?: MindmapBranch[]
  usedFallback: boolean
  warning?: string
}

type UnknownRecord = Record<string, unknown>

/**
 * 内容解析策略：按模板类型差异化，让 AI 提炼出的结构更贴合每个模板的展示形态。
 * 不同策略注入不同的解析规则块（见 getStrategyRulesBlock）。
 */
export type ExtractionStrategy = "mindmap" | "flashcard" | "data" | "article" | "social"

/**
 * 按 templateId 归类到解析策略。归类依据是模板的展示形态而非 mode 字段：
 * 思维导图要树形精炼、闪卡要知识点原子化、数据类要指标提炼、社媒类要吸睛短句、文章类要分段摘要。
 */
const STRATEGY_BY_TEMPLATE: Record<string, ExtractionStrategy> = {
  // 树形精炼：每个 section 是一级分支，body 用缩进列表表达子分支
  "learning-mindmap": "mindmap",
  // 知识点原子化：每个 section 是一张卡的正面主题
  "learning-flashcard": "flashcard",
  "read-accordion": "flashcard",
  // 指标提炼：第一个 section 必须是 KPI/指标
  "data-infographic": "data",
  "data-dashboard": "data",
  "report-business": "data",
  // 吸睛短句：每个 section 是一张分享卡的标题
  "social-card": "social",
  "social-xiaohongshu": "social",
  "social-waterfall": "social",
  "poster-magazine": "social",
  "poster-hero": "social",
  "visual-bento": "social",
  // 7 个主题化社交卡片模板：同样按社媒金句式要点提炼，走 buildThemedSocialCards 组图管线
  "social-editorial": "social",
  "social-geek-report": "social",
  "social-consulting-report": "social",
  "social-clean-review": "social",
  "social-terminal": "social",
  "social-story-field": "social",
  "social-dot-matrix": "social",
}

export function getExtractionStrategy(templateId: string): ExtractionStrategy {
  return STRATEGY_BY_TEMPLATE[templateId] || "article"
}

/**
 * 各策略的差异化解析规则块。通用规则（提炼核心、限制搬运等）在 buildOutputExtractionPrompt
 * 中独立拼接，与这里的策略块叠加。
 */
function getStrategyRulesBlock(strategy: ExtractionStrategy): string {
  switch (strategy) {
    case "mindmap":
      return [
        "## 思维导图专属规则（当前模板）",
        "- **必须输出 `mindmap` 嵌套树数组**，不要输出 sections/body/bullets。",
        "- 结构：一级分支（title）→ 二级子节点（children[].text）→ 三级孙节点（children[].children[].text），最深 3 层。",
        "- 每个一级分支必须有 2-4 个二级子节点；二级子节点可有 0-3 个三级孙节点。",
        "- 所有节点文字 ≤ 20 字，必须是关键词或概念名词，严禁整句、解释、标点堆砌。",
        "- 先通读全文，提炼出 4-7 条核心脉络作为一级分支，按主题聚类（而非按原文顺序平铺）。",
        "- 解释性长文必须拆成「概念 → 子概念 → 关键词」的层级，禁止把整段说明放进单个节点。",
        "- title 取全文核心主题（≤ 16 字），subtitle 用一句话概括脉络。",
      ].join("\n")
    case "flashcard":
      return [
        "## 学习卡片专属规则（当前模板）",
        "- 每个 section 是一张知识卡片的正面主题；section.title 是卡片标题（≤ 20 字）。",
        "- section.bullets 是可独立考核的知识要点，每条 ≤ 40 字，一条只讲一个知识点。",
        "- 每张卡片 3-5 个要点，剔除铺垫、过渡和重复表述。",
        "- section.body 留空或仅放该卡片的一句话补充说明（≤ 50 字）。",
        "- 卡片总数控制在 4-8 张，按知识模块分组，不要按原文段落顺序堆砌。",
      ].join("\n")
    case "data":
      return [
        "## 数据/报告专属规则（当前模板）",
        "- 第一个 section 必须是关键指标/KPI：title 为「核心指标」，bullets 格式严格为 `数值: 说明`（如 `同比增长 23%: 较上季度`）。",
        "- 其余 section 按维度/主题分组（如趋势分析、结构拆解、对比结论），不要按原文段落顺序。",
        "- 必须保留所有数字、百分比、金额、时间、对比关系，不要模糊化或丢弃量化信息。",
        "- section.body 是该维度的结论性摘要（≤ 120 字），不要罗列原始数据；原始数据进 bullets。",
        "- bullets 每条 ≤ 50 字，一个要点只表达一个结论或对比。",
      ].join("\n")
    case "social":
      return [
        "## 社媒分享专属规则（当前模板）",
        "- 每个 section 是一张分享卡的内容单元；section.title 要有传播力和信息密度（≤ 18 字）。",
        "- section.bullets 是短句金句式要点，每条 ≤ 30 字，口语化、可独立传播，禁止书面长句。",
        "- section.body 留空或仅放一句钩子文案（≤ 40 字）。",
        "- 卡片数量控制在 3-6 张，只保留最有传播价值的核心观点，果断丢弃铺垫和背景。",
        "- 标题和要点要让读者「扫一眼就想看完」，不要平铺直叙。",
      ].join("\n")
    case "article":
    default:
      return [
        "## 文章/阅读专属规则（当前模板）",
        "- 每个 section 是一个主题段落；section.title 是该段核心论点（≤ 24 字）。",
        "- section.body 是该论点的摘要阐述（≤ 150 字），提炼核心而非复制原文。",
        "- section.bullets 是支撑该论点的关键证据、数据或案例，每条 ≤ 60 字。",
        "- 按重要性重排 sections：最核心的论点放最前，无关铺垫移除。",
        "- 严禁整段原文搬运；长段落必须压缩为「摘要 body + 证据 bullets」结构。",
      ].join("\n")
  }
}

export interface BuildOutputExtractionPromptOptions {
  templateId: string
  templateName: string
  outputHint: string
  bestFor: string
  title: string
  sourceContent: string
  sourceLabel?: string
  customInstructions?: string
  /** 解析策略，决定差异化规则块；默认按 templateId 自动推断 */
  strategy?: ExtractionStrategy
}

export function buildOutputExtractionPrompt(options: BuildOutputExtractionPromptOptions): string {
  const normalizedTitle = options.title.trim()
  const normalizedSource = options.sourceContent.trim()
  const normalizedInstructions = options.customInstructions?.trim()
  const normalizedSourceLabel = options.sourceLabel?.trim()
  const strategy = options.strategy || getExtractionStrategy(options.templateId)

  // 思维导图策略使用专用的嵌套树 schema，其余策略用扁平 sections schema
  const isMindmap = strategy === "mindmap"
  const schemaBlock = isMindmap
    ? `{
  "title": "中心主题（全文核心，≤ 16 字）",
  "subtitle": "一句话概括全文脉络",
  "mindmap": [
    {
      "title": "一级分支主题（≤ 16 字）",
      "children": [
        { "text": "二级子概念（≤ 20 字）", "children": [ { "text": "三级关键词（≤ 20 字）" } ] },
        { "text": "二级子概念" }
      ]
    }
  ]
}`
    : `{
  "title": "适合模板展示的标题",
  "subtitle": "一句话副标题或摘要，可为空字符串",
  "sections": [
    {
      "title": "一级分支或模块标题",
      "body": "该模块的正文、说明或带缩进的 Markdown 列表",
      "bullets": ["可选要点 1", "可选要点 2"],
      "importance": "low | medium | high"
    }
  ]
}`

  return [
    "你是 LingMo 智能排版的内容结构解析器。你的任务不是设计网页，也不是输出 HTML/CSS，而是把输入材料**提炼**成本地模板可以稳定渲染的 JSON 数据。",
    "",
    "## 输出格式要求",
    "只输出一个 JSON 对象，不要 Markdown 代码块，不要解释文字。",
    "JSON schema:",
    schemaBlock,
    "",
    "## 提炼核心规则（必须严格遵守）",
    "- 你的首要任务是**提炼核心**，不是搬运原文。每个 body/text 必须是摘要或关键词，不是原文复制。",
    isMindmap
      ? "- 必须输出 `mindmap` 数组，不要输出 sections。每个节点必须是关键词/概念，禁止整句。"
      : "- 总 sections 数量控制在 3-8 个；超出时按 importance 合并同类项或丢弃 low 级内容。",
    isMindmap
      ? ""
      : "- 严禁把超过 3 行的连续原文放入 body；长内容必须压缩为「摘要 + bullets」结构。",
    "- 如果材料很长，先果断丢弃铺垫、过渡、客套、重复内容，只保留支撑核心的事实、结论和证据。",
    "- 必须保留输入材料中的真实事实、术语、时间、人物、公司和因果关系，不要编造。",
    isMindmap
      ? "- 先通读全文提炼核心脉络，再按主题聚类组织成树（4-7 条一级分支），不要按原文段落顺序平铺。"
      : "- 层级关系优先写入 body，使用 Markdown 列表缩进表达，例如 `- 一级\\n  - 二级\\n    - 三级`。",
    "- 根据当前模板用途重排内容：先提炼主题，再分组，再保留关键证据。",
    getStrategyRulesBlock(strategy),
    normalizedInstructions ? `## 用户额外要求\n${normalizedInstructions}` : "",
    "## 当前本地模板",
    `- ID: ${options.templateId}`,
    `- 名称: ${options.templateName}`,
    `- 输出目标: ${options.outputHint}`,
    `- 适用场景: ${options.bestFor}`,
    "",
    "## 输入材料",
    `来源: ${normalizedSourceLabel || "手动输入材料"}`,
    `标题: ${normalizedTitle || options.templateName}`,
    "",
    "---",
    normalizedSource.slice(0, 12000),
    "---",
  ].filter(Boolean).join("\n")
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function toStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value
    .map((item) => typeof item === "string" ? item.replace(/\s+$/g, "") : "")
    .filter((item) => item.trim())
  return list.length > 0 ? list : undefined
}

function toImportance(value: unknown): ExtractedSection["importance"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined
}

export function splitPlainTextIntoSections(source: string): ExtractedSection[] {
  const trimmed = source.trim()
  if (!trimmed) return []

  const lines = trimmed.split(/\r?\n/)
  const sections: ExtractedSection[] = []
  let currentTitle = "核心内容"
  let currentLines: string[] = []

  const pushCurrent = () => {
    const body = currentLines.join("\n").trim()
    if (!body && sections.length > 0) return
    sections.push({
      title: currentTitle,
      body: body || trimmed.slice(0, 800),
    })
  }

  for (const line of lines) {
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (headingMatch) {
      if (currentLines.length > 0 || sections.length > 0) {
        pushCurrent()
      }
      currentTitle = headingMatch[1].trim() || "未命名章节"
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  pushCurrent()
  return sections
}

function extractJsonCandidate(input: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(input)
  const candidate = fenced?.[1]?.trim() || input.trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

/**
 * 尝试修复被截断的 JSON（通常发生在 max_tokens 用尽、流式中断时）。
 *
 * 策略：截断几乎总发生在数组/对象尾部，即「最后一个完整元素之后」。
 * 1. 找到最后一个完整的 `}`（对象元素闭合）或 `]`（数组元素闭合）。
 * 2. 截断到此处，再按括号栈补全所有未闭合的 `[`/`{`。
 * 3. 同时处理字符串内截断：若末尾有未闭合的引号，先截掉半截字符串。
 *
 * 修复成功返回可解析的 JSON 字符串；无法修复返回 null。
 */
function tryRepairTruncatedJson(input: string): string | null {
  // 去掉末尾可能的不完整片段：找最后一个完整值结束位置
  // 完整值结束标志：`}`、`]`、`"`(字符串)、数字/true/false/null 后的逗号或空白
  const lastComplete = Math.max(
    input.lastIndexOf("}"),
    input.lastIndexOf("]")
  )
  if (lastComplete <= 0) return null

  let trimmed = input.slice(0, lastComplete + 1)

  // 处理字符串内截断：若倒数存在未配对的引号，回退到上一个值边界
  // 粗略统计未转义引号数量，奇数说明字符串未闭合
  const quoteCount = (trimmed.match(/(?<!\\)"/g) || []).length
  if (quoteCount % 2 !== 0) {
    // 找到最后一个配对引号后的位置
    const lastEvenQuote = trimmed.lastIndexOf('"')
    if (lastEvenQuote > 0) {
      // 截到该引号，再加一个配对引号闭合字符串
      trimmed = trimmed.slice(0, lastEvenQuote + 1) + '"'
      // 重新找值边界
      const boundary = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"), trimmed.lastIndexOf('"'))
      if (boundary <= 0) return null
      trimmed = trimmed.slice(0, boundary + 1)
    }
  }

  // 去掉末尾可能残留的逗号（trailing comma 会让 JSON.parse 失败）
  trimmed = trimmed.replace(/,\s*$/, "")

  // 按括号栈补全未闭合的 `[` 和 `{`
  const stack: Array<"[" | "{"> = []
  let inString = false
  let escaped = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "[" || ch === "{") {
      stack.push(ch)
    } else if (ch === "]" || ch === "}") {
      // 弹出匹配的开括号（忽略不匹配的闭括号，它们可能是多余字符）
      const last = stack[stack.length - 1]
      if ((ch === "]" && last === "[") || (ch === "}" && last === "{")) {
        stack.pop()
      }
    }
  }

  // 栈中剩余的就是未闭合的开括号，逆序补全
  const closers = stack
    .slice()
    .reverse()
    .map((open) => (open === "[" ? "]" : "}"))
    .join("")

  const repaired = trimmed + closers

  // 验证修复结果确实可解析
  try {
    JSON.parse(repaired)
    return repaired
  } catch {
    return null
  }
}

function normalizeSections(value: unknown): ExtractedSection[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item, index): ExtractedSection[] => {
    if (typeof item === "string") {
      const body = item.trim()
      return body ? [{ title: `第 ${index + 1} 节`, body }] : []
    }
    if (!isRecord(item)) return []

    const title = toText(item.title) || toText(item.heading) || toText(item.name) || `第 ${index + 1} 节`
    const body = toText(item.body) || toText(item.content) || toText(item.summary) || undefined
    const bullets = toStringList(item.bullets) || toStringList(item.points) || toStringList(item.items)
    const importance = toImportance(item.importance)

    if (!body && !bullets?.length) return []
    const section: ExtractedSection = { title, body, bullets }
    if (importance) section.importance = importance
    return [section]
  })
}

/**
 * 解析思维导图的嵌套树结构（AI 输出的 mindmap 数组）。
 * 与 normalizeSections 互补：mindmap 策略下 AI 直接输出嵌套树，模板侧零猜测渲染。
 * 容错：兼容 text/label/title 等字段名变体；丢弃空节点。
 */
function normalizeMindmapChild(value: unknown): MindmapChild | null {
  if (typeof value === "string") {
    const text = value.trim()
    return text ? { text } : null
  }
  if (!isRecord(value)) return null
  const text = toText(value.text) || toText(value.label) || toText(value.title) || toText(value.name)
  if (!text) return null
  const children = Array.isArray(value.children)
    ? value.children.map(normalizeMindmapChild).filter((c): c is MindmapChild => c !== null)
    : undefined
  return children?.length ? { text, children } : { text }
}

function normalizeMindmap(value: unknown): MindmapBranch[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): MindmapBranch[] => {
    if (!isRecord(item)) return []
    const title = toText(item.title) || toText(item.label) || toText(item.name)
    if (!title) return []
    const children = Array.isArray(item.children)
      ? item.children.map(normalizeMindmapChild).filter((c): c is MindmapChild => c !== null)
      : undefined
    return [{ title, children: children?.length ? children : undefined }]
  })
}


export function parseOutputExtractionResult(
  raw: string,
  fallbackSource: string,
  fallbackTitle = "可视化输出",
): OutputExtractionResult {
  const fallbackSections = () => splitPlainTextIntoSections(fallbackSource)

  /** 把 JSON 字符串解析为 { title, subtitle, sections, mindmap }，失败返回 null */
  const tryParse = (jsonStr: string): {
    title: string
    subtitle: string
    sections: ExtractedSection[]
    mindmap?: MindmapBranch[]
  } | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return null
    }
    if (!isRecord(parsed)) return null
    const sections = normalizeSections(parsed.sections)
    const mindmap = normalizeMindmap(parsed.mindmap)
    // mindmap 策略下 mindmap 数组即可；其余策略需要 sections
    if (sections.length === 0 && mindmap.length === 0) return null
    return {
      title: toText(parsed.title) || fallbackTitle,
      subtitle: toText(parsed.subtitle) || "",
      sections,
      mindmap: mindmap.length > 0 ? mindmap : undefined,
    }
  }

  const candidate = extractJsonCandidate(raw)
  if (!candidate) {
    return {
      title: fallbackTitle,
      subtitle: "",
      sections: fallbackSections(),
      usedFallback: true,
      warning: "未找到可解析的 JSON 内容",
    }
  }

  // 第一次：直接解析完整 JSON
  const direct = tryParse(candidate)
  if (direct) {
    return { ...direct, usedFallback: false }
  }

  // 第二次：JSON.parse 失败，尝试修复截断的 JSON（max_tokens 用尽/流式中断场景）
  const repaired = tryRepairTruncatedJson(candidate)
  if (repaired) {
    const repairedResult = tryParse(repaired)
    if (repairedResult) {
      // 修复成功：保留已修复的 sections，远优于纯文本回退
      return {
        ...repairedResult,
        usedFallback: false,
        warning: "AI 输出疑似被截断，已自动修复部分内容，建议核对完整性",
      }
    }
  }

  // 最终回退：纯文本分段
  return {
    title: fallbackTitle,
    subtitle: "",
    sections: fallbackSections(),
    usedFallback: true,
    warning: "JSON 解析失败且无法自动修复，已回退纯文本分段",
  }
}
