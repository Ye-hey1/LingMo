import { getMokaStyleId, getMokaTemplateKind, isMokaWechatLeaningStyle } from "./constants"
import type { MokaTemplateKind } from "./types"

const JSON_FORMAT_REQUIREMENTS = `【输出要求】
1. 必须返回有效 JSON，不能返回 Markdown 代码块或解释文字
2. 所有字符串值必须用双引号包裹
3. 属性之间必须有逗号分隔，最后一个属性后不能有逗号
4. 不要编造用户材料中不存在的事实、数字、人物、引用或案例
5. JSON 字段名只用于结构，不得作为任何可见文案输出；title、titel、styleConfig、slides、sections、content、heading、text、subtitle、tags 等字段名绝不能出现在卡片文字里`

const SAFETY_REQUIREMENTS_ZH = `【内容安全要求】
- 不包含血腥、暴力、色情、低俗、引流联系方式、二维码、极限营销词、医疗/金融违规承诺、封建迷信或政治敏感内容
- 不使用平台审核相关术语作为可见内容
- 保持健康、积极、真实、可发布`

const NEWS_CONTENT_REQUIREMENTS_ZH = `【新闻/事实类内容要求】
- 如果输入是新闻或事实材料，必须聚焦具体事件、时间、地点、关键人物和可核实细节
- 避免空泛宏观总结，不写“体现了”“反映了”这类套话
- 只压缩与重组用户材料，不补不存在的信息`

const MOKA_STUDY_NOTE_REQUIREMENTS = `【学习笔记内容质量要求】
- 先完整理解原文，再提炼“核心逻辑、关键观点、因果链、阶段变化、方法论和可记住的结论”
- 生成前在心里完成洞察抽取：核心命题、问题起点、关键转折、证据细节、方法启发、最终结论；不要把这一步写出来
- 每一页从一个洞察出发重写，不要把原文目录项、段落标题或编号当成正文
- 每一页必须让读者获得一个明确收获：观点是什么、为什么重要、原文证据/细节是什么
- 不要照搬目录、大纲编号、Markdown 标题或原文段落；必须改写成自然、可吸收的短笔记
- 不要生成空泛互动文案、通用收藏文案、平台宣传语或占位话术
- content.text 采用“结论 + 解释 + 关键细节”的写法；extra 只放原文中最值得记住的观点、转折或提醒
- end 页要总结原文的核心收获，而不是“收藏/分享/继续输出”
- 可见文案中不要出现模板名、内部模式名或字段名，例如 Moka、moka-ai-split、Moka mode、title、titel、styleConfig、slides、sections、content`

const MOKA_AI_SPEED_REQUIREMENTS = `【速度与 JSON 长度要求】
- 必须完整表达视觉设计，但 styleConfig 只写共享视觉骨架，不要逐页重复无差异 CSS
- 单页只提供 container/header/lead/sections/tip/tags/decorations 的必要样式；sections 只写 1 个通用样式
- 分页只提供 cover/content/end/decorations 的必要样式；不要给每一页单独复制样式
- decorations 最多 2 个，优先用简单 shape/circle；不要输出复杂、冗长、不可渲染的装饰配置`

export const MOKA_CONTENT_PROMPTS = {
  singleXhs: `你是小红书爆款文案排版专家。将用户材料转成一张 3:4 单页卡片的结构化内容。
${NEWS_CONTENT_REQUIREMENTS_ZH}
${SAFETY_REQUIREMENTS_ZH}
${MOKA_STUDY_NOTE_REQUIREMENTS}

【字数限制】
- emoji: 1 个
- category: 最多 6 个字
- title: 最多 36 个字
- lead: 最多 50 个字
- sections: 4-5 个，每个 heading 最多 16 个字，text 最多 140 个字
- tip: 最多 60 个字
- tags: 5 个标签，每个最多 10 个字

严格只返回 JSON：
{
  "emoji": "🎉",
  "category": "主题词",
  "title": "从材料提炼的主标题",
  "lead": "一句话概括文章主线",
  "sections": [
    {"heading": "核心观点", "text": "用原文事实解释观点"},
    {"heading": "关键转折", "text": "说明变化原因和影响"},
    {"heading": "可记住结论", "text": "沉淀读者能带走的收获"}
  ],
  "tip": "从材料提炼的提醒",
  "tags": ["主题词1", "主题词2", "主题词3", "主题词4", "主题词5"]
}`,

  splitXhs: `你是小红书爆款内容策划专家。根据用户材料拆分为多页 3:4 图文卡片。
【小红书风格】情绪化标题、口语化表达、适度 emoji 点缀。
${NEWS_CONTENT_REQUIREMENTS_ZH}
${SAFETY_REQUIREMENTS_ZH}
${MOKA_STUDY_NOTE_REQUIREMENTS}

【页数要求】
- 默认生成 4-6 页：1 个封面 + 2-4 个内容页 + 1 个结尾页
- 如果用户明确要求生成 N 页，严格按用户要求页数生成
- 内容丰富时可增加页数，但最多 10 页

【字数限制】
- cover: title 最多 30 字，subtitle 最多 50 字
- content: heading 最多 16 字，text 最多 100 字，extra 最多 40 字
- end: cta 最多 30 字，sub 最多 40 字，tags 5 个

严格只返回 JSON：
{
  "slides": [
    {"type": "cover", "emoji": "🎉", "title": "从材料提炼的封面标题", "subtitle": "一句话说明文章主线"},
    {"type": "content", "heading": "✨核心观点", "text": "结论 + 解释 + 原文关键细节", "extra": "原文中的关键提醒"},
    {"type": "content", "heading": "✨关键转折", "text": "说明变化原因和影响", "extra": "值得记住的判断"},
    {"type": "end", "cta": "总结原文核心收获", "sub": "用一句话收束主线", "tags": ["主题词1", "主题词2", "主题词3", "主题词4", "主题词5"]}
  ]
}`,

  splitWechat: `你是微信公众号编辑。根据用户材料拆分为多页专业图文卡片。
【微信风格】专业理性、结构清晰、heading 不使用 emoji。
${NEWS_CONTENT_REQUIREMENTS_ZH}
${SAFETY_REQUIREMENTS_ZH}
${MOKA_STUDY_NOTE_REQUIREMENTS}

【页数要求】
- 默认生成 4-6 页：1 个封面 + 2-4 个内容页 + 1 个结尾页
- 如果用户明确要求生成 N 页，严格按用户要求页数生成
- 内容丰富时可增加页数，但最多 10 页

【字数限制】
- cover: title 最多 30 字，subtitle 最多 50 字
- content: heading 最多 16 字，text 最多 100 字，extra 最多 40 字
- end: cta 最多 30 字，sub 最多 40 字，tags 5 个

严格只返回 JSON：
{
  "slides": [
    {"type": "cover", "emoji": "📊", "title": "从材料提炼的专业标题", "subtitle": "一句话说明文章主线"},
    {"type": "content", "heading": "核心观点", "text": "结论 + 解释 + 原文关键细节", "extra": "原文中的关键提醒"},
    {"type": "content", "heading": "关键转折", "text": "说明变化原因和影响", "extra": "值得记住的判断"},
    {"type": "end", "cta": "总结原文核心收获", "sub": "用一句话收束主线", "tags": ["主题词1", "主题词2", "主题词3", "主题词4", "主题词5"]}
  ]
}`,
}

const COLOR_SCHEMES = `【丰富多样的配色方向】
- 温柔系：莫兰迪紫、雾霾蓝、奶油粉、燕麦米
- 活力系：糖果色、马卡龙、彩虹糖、热带水果
- 高级感：莫兰迪灰、雾霭灰、石墨黑、低饱和中性色
- 复古系：怀旧棕、胶片色、老照片、日系昭和
- 自然系：森林绿、海洋蓝、樱花粉、薰衣草
- 对比系：红蓝、橙紫、粉绿、黄紫
- 深色模式：午夜蓝、深空灰、墨绿夜`

export const MOKA_AI_DESIGN_PROMPT_SINGLE = `你是顶级的小红书视觉设计师，擅长创作精美、高转化率的 3:4 单页内容卡片。

你的任务是根据用户材料生成完整 AI 视觉设计方案。输出工坊会根据你的 JSON 设计方案渲染成自包含 HTML 卡片。
${JSON_FORMAT_REQUIREMENTS}
${COLOR_SCHEMES}
${MOKA_STUDY_NOTE_REQUIREMENTS}
${MOKA_AI_SPEED_REQUIREMENTS}

【设计核心原则】
1. 视觉层次清晰：通过大小、颜色、间距建立标题、导语、正文和标签层级
2. 呼吸感充足：优先使用 28-40px 安全留白，不要让信息挤满画面
3. 配色要大胆但和谐：每次生成都尝试不同的主色、辅助色和背景关系
4. 精致细节：可以使用线条、形状、图案、纹理、阴影和小装饰强化记忆点
5. 内容先行：所有标题、正文、提示和标签必须来自用户材料的理解与重写，必须像一张能帮助别人理解文章的精华笔记

【如果本轮附带参考图】
- 先分析参考图的配色、布局、留白、字体层级、装饰元素、整体氛围
- 借鉴风格特征，但不要照抄图片内容
- 根据用户材料重组文案，让视觉风格和内容主题自然匹配

【输出 JSON 格式】
{
  "styleConfig": {
    "container": {
      "background": "背景样式",
      "padding": "28px",
      "borderRadius": "16px",
      "boxShadow": "0 18px 50px rgba(0,0,0,0.12)"
    },
    "header": {
      "emoji": "✨",
      "category": "分类",
      "title": {
        "fontSize": "28px",
        "fontWeight": "800",
        "color": "#1a1a1a",
        "marginBottom": "12px"
      }
    },
    "lead": {
      "fontSize": "14px",
      "color": "#555555",
      "fontStyle": "normal",
      "marginBottom": "18px"
    },
    "sections": [
      {
        "heading": {"fontSize": "16px", "color": "#333333", "fontWeight": "700", "before": "🌟"},
        "text": {"fontSize": "14px", "color": "#555555", "lineHeight": "1.7"},
        "background": "#ffffff",
        "borderLeft": "4px solid #667eea",
        "marginBottom": "14px"
      }
    ],
    "tip": {"background": "#fff3cd", "color": "#856404", "fontSize": "13px", "padding": "12px 16px", "borderRadius": "8px"},
    "tags": {"background": "#e9ecef", "color": "#495057", "fontSize": "12px", "padding": "6px 12px", "borderRadius": "16px"},
    "decorations": [
      {"type": "circle", "position": "top-right", "style": {"width": "100px", "height": "100px", "background": "rgba(102,126,234,0.12)"}}
    ]
  },
  "content": {
    "emoji": "✨",
    "category": "主题词",
    "title": "从材料提炼的主标题",
    "lead": "一句话概括文章主线",
    "sections": [
      {"heading": "核心观点", "text": "用原文事实解释观点"},
      {"heading": "关键转折", "text": "说明变化原因和影响"}
    ],
    "tip": "从材料提炼的提醒",
    "tags": ["主题词1", "主题词2", "主题词3", "主题词4", "主题词5"]
  }
}`

export const MOKA_AI_DESIGN_PROMPT_SPLIT = `你是顶级的小红书视觉设计师，擅长创作精美的多页 3:4 图文卡片。

你的任务是根据用户材料生成完整 AI 分页视觉设计方案。输出工坊会将每一页渲染成可单独导出的 moka-card。
${JSON_FORMAT_REQUIREMENTS}
${COLOR_SCHEMES}
${MOKA_STUDY_NOTE_REQUIREMENTS}
${MOKA_AI_SPEED_REQUIREMENTS}

【分页设计核心原则】
1. 封面吸引力：第一页必须抓住眼球，标题强、主视觉明确
2. 内容页清晰：每页只承载一个重点，文字短、层级明确、安全区充足，但必须包含真实观点和关键细节
3. 结尾总结感：最后一页收束全文主线，帮助读者记住核心收获
4. 视觉一致性：整套卡片风格统一，但封面、内容页、结尾页要有节奏差异
5. 内容先行：必须基于用户材料提炼事实和观点，不生成通用占位文案

【如果本轮附带参考图】
- 先分析参考图的色彩、构图、封面/内容页节奏、纹理、装饰元素和字体层级
- 迁移参考图的视觉语言，但不要复制图中具体文字或图片主体
- 保证每页都有清晰安全区，可用于小红书多图或微信图文卡片

【输出 JSON 格式】
{
  "styleConfig": {
    "cover": {
      "background": "linear-gradient(135deg,#667eea,#764ba2)",
      "emoji": {"fontSize": "48px", "marginBottom": "16px"},
      "title": {"fontSize": "30px", "fontWeight": "800", "color": "#ffffff"},
      "subtitle": {"fontSize": "15px", "color": "rgba(255,255,255,0.88)"}
    },
    "content": {
      "background": "#ffffff",
      "heading": {"fontSize": "22px", "fontWeight": "700", "color": "#1a1a1a"},
      "text": {"fontSize": "15px", "color": "#333333", "lineHeight": "1.8"},
      "extra": {"fontSize": "13px", "color": "#666666", "fontStyle": "italic"}
    },
    "end": {
      "background": "#f8f9fa",
      "cta": {"fontSize": "24px", "fontWeight": "800", "color": "#1a1a1a"},
      "sub": {"fontSize": "14px", "color": "#666666"},
      "tags": {"background": "#e9ecef", "color": "#495057", "fontSize": "12px", "padding": "6px 12px", "borderRadius": "16px"}
    },
    "decorations": [
      {"type": "circle", "slide": "all", "position": "top-right", "style": {"width": "96px", "height": "96px", "background": "rgba(102,126,234,0.12)"}}
    ]
  },
  "slides": [
    {"type": "cover", "emoji": "✨", "title": "从材料提炼的封面标题", "subtitle": "一句话说明文章主线"},
    {"type": "content", "heading": "核心观点", "text": "结论 + 解释 + 原文关键细节", "extra": "原文中的关键提醒"},
    {"type": "end", "cta": "总结原文核心收获", "sub": "用一句话收束主线", "tags": ["主题词1", "主题词2", "主题词3", "主题词4", "主题词5"]}
  ]
}`

export function buildMokaGenerationPrompt(params: {
  templateId: string
  templateName: string
  mokaMode?: "single" | "split"
  mokaPlatform?: "xhs" | "wechat"
  mokaStyleId?: string
  mokaPaletteLabel?: string
  forceAiDesign?: boolean
  title: string
  sourceLabel: string
  customInstructions?: string
  sourceContent: string
  hasReferenceImage?: boolean
}): string {
  const originalKind = getMokaTemplateKind(params.templateId)
  const kind: MokaTemplateKind | null = params.forceAiDesign
    ? params.mokaMode === "single" ? "ai-single" : "ai-split"
    : originalKind === "ai-single" ? "single"
      : originalKind === "ai-split" ? "split"
        : originalKind
  const styleId = params.mokaStyleId || getMokaStyleId(params.templateId)
  const isAiDesignKind = kind === "ai-single" || kind === "ai-split"
  const basePrompt =
    kind === "ai-single" ? MOKA_AI_DESIGN_PROMPT_SINGLE :
    kind === "ai-split" ? MOKA_AI_DESIGN_PROMPT_SPLIT :
    kind === "split" && (params.mokaPlatform === "wechat" || isMokaWechatLeaningStyle(styleId)) ? MOKA_CONTENT_PROMPTS.splitWechat :
    kind === "split" ? MOKA_CONTENT_PROMPTS.splitXhs :
    MOKA_CONTENT_PROMPTS.singleXhs

  const referenceNote = params.hasReferenceImage && isAiDesignKind
    ? "本轮附带了一张参考图，请严格先分析参考图的视觉风格，并将风格迁移到输出 JSON 的 styleConfig 中。"
    : isAiDesignKind
      ? "本轮没有参考图，请依据材料主题自行选择适合的视觉方向，并用紧凑 styleConfig 表达。"
      : "本轮使用固定模板结构，请只提炼内容 JSON，视觉版式由本地模板渲染，不要输出 styleConfig。"
  const generationTypeLabel =
    kind === "ai-single" ? "AI 单页视觉设计" :
    kind === "ai-split" ? "AI 分页视觉设计" :
    kind === "split" ? "分页内容结构" :
    "单页内容结构"
  const outputRequirement = isAiDesignKind
    ? "输出必须是完整 moka AI 设计 JSON，包含 styleConfig 与 content/slides；styleConfig 只写必要共享样式，避免冗长重复"
    : "输出必须是 moka 内容 JSON，只包含卡片内容结构，不要输出 styleConfig 或任何视觉 CSS"

  return `${basePrompt}

【当前 moka 模板】
- 模板: ${params.templateName}
- 风格 ID: ${styleId}
- 平台口吻: ${params.mokaPlatform === "wechat" ? "微信公众号：专业、理性、清晰" : "小红书：真实、抓人、口语化"}
- 目标配色: ${params.mokaPaletteLabel || "由 AI 根据材料选择"}
- 生成类型: ${generationTypeLabel}

【内容改写硬要求】
- 你必须理解并重写用户材料，输出适合卡片阅读的自然文案
- 不能把 Markdown 标题、井号、星号、列表符号、原始文件结构原样塞进 title、text、lead、subtitle
- 如果材料是大纲，提炼为短标题和短段落；如果材料是长文，拆成可读的卡片叙事
- 不能把章节目录直接搬到卡片里；要提炼每个阶段/论点背后的“为什么、怎么变、意味着什么”
- 不要输出“封面标题、正文内容、小标题、金句、互动语、标签1”等示例占位字样
- end 页不能写“收藏这组卡片、继续输出、用输出工坊微调导出分享”等泛用话术
- 可见文案不得出现模板名、内部模式名或 JSON 字段名，例如 Moka、moka-ai-split、Moka mode、title、titel、styleConfig、slides、sections、content
- ${outputRequirement}
- 直接返回 JSON，不要解释过程

【参考图状态】
${referenceNote}

${params.customInstructions ? `【用户额外要求】\n${params.customInstructions}\n` : ""}

【主标题】
${params.title || params.templateName}

【来源】
${params.sourceLabel || "手动输入"}

【输入材料】
---
${params.sourceContent.slice(0, 15000)}
---`
}

export function buildMokaRepairPrompt(params: {
  mokaMode?: "single" | "split"
  mokaPlatform?: "xhs" | "wechat"
  mokaStyleId?: string
  mokaPaletteLabel?: string
  forceAiDesign?: boolean
  title: string
  sourceLabel: string
  customInstructions?: string
  sourceContent: string
  previousWarning?: string
}): string {
  const styleId = params.mokaStyleId || "ai"
  const kind: MokaTemplateKind = params.forceAiDesign
    ? params.mokaMode === "single" ? "ai-single" : "ai-split"
    : params.mokaMode === "single" ? "single" : "split"
  const basePrompt =
    kind === "ai-single" ? MOKA_AI_DESIGN_PROMPT_SINGLE :
    kind === "ai-split" ? MOKA_AI_DESIGN_PROMPT_SPLIT :
    kind === "split" && (params.mokaPlatform === "wechat" || isMokaWechatLeaningStyle(styleId)) ? MOKA_CONTENT_PROMPTS.splitWechat :
    kind === "split" ? MOKA_CONTENT_PROMPTS.splitXhs :
    MOKA_CONTENT_PROMPTS.singleXhs
  const outputRequirement = params.forceAiDesign
    ? "必须返回完整 AI 设计 JSON，包含 styleConfig 与 content/slides；styleConfig 保持紧凑，不要为每页重复无差异 CSS"
    : "必须返回内容 JSON，视觉模板由本地渲染，不要输出 styleConfig 或 CSS"

  return `${basePrompt}

【重新生成原因】
上一轮结果没有形成可用的真实内容：${params.previousWarning || "内容为空、解析失败或出现占位文案"}。

【本轮必须修正】
- 只输出一个完整 JSON 对象，不能输出 Markdown 代码块或解释
- 必须从原文中提炼核心逻辑、观点、阶段变化和关键细节
- 不要复述目录，不要复制原文大纲编号，不要写泛用收藏/分享/输出工坊话术
- 不要把 Moka、moka-ai-split、Moka mode、title、titel、styleConfig、slides、sections、content 等模板名或字段名写入任何可见文案
- 每个 content 页都要像读书笔记：一个清晰观点 + 一句解释 + 一个来自原文的关键细节
- ${params.mokaMode === "single" ? "content.sections 至少 4 条" : "slides 必须包含 1 个 cover、至少 4 个 content、1 个 end"}
- ${outputRequirement}

【当前设置】
- 风格 ID: ${styleId}
- 平台口吻: ${params.mokaPlatform === "wechat" ? "微信公众号：专业、理性、清晰" : "小红书：真实、抓人、口语化"}
- 目标配色: ${params.mokaPaletteLabel || "由 AI 根据材料选择"}

${params.customInstructions ? `【用户额外要求】\n${params.customInstructions}\n` : ""}

【主标题】
${params.title}

【来源】
${params.sourceLabel}

【输入材料】
---
${params.sourceContent.slice(0, 15000)}
---`
}
