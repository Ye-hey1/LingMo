/**
 * 风格化文档改写模块
 *
 * 灵感来自开源项目 AI-Media2Doc（hanshuaikang/AI-Media2Doc）的 6 种风格分类：
 * 小红书 / 公众号 / 知识笔记 / 思维导图 / 视频字幕 / 内容摘要。
 *
 * 注意：由于工作区网络隔离，无法读取 AI-Media2Doc 仓库源码原文，本文件中的
 * 提示词为参考该项目的公开风格说明与社区惯例后自撰实现，非逐字复制。
 *
 * 定位：LingMo 的 output-workshop 负责「视觉排版」（HTML 模板渲染）；
 * 本模块负责「内容改写」——把抓取/转写得到的原始文本重写为指定风格的
 * Markdown 文本产物，作为 mark 保存或送入 output-workshop 继续视觉化。
 */

export type StyleDocId =
  | 'xiaohongshu'
  | 'wechat'
  | 'knowledge'
  | 'mindmap'
  | 'subtitle'
  | 'summary'

export interface StyleDocMeta {
  id: StyleDocId
  /** 中文展示名 */
  name: string
  /** 一句话说明 */
  description: string
  /** emoji 图标，用于弹窗选择器 */
  icon: string
  /** 强调的输出形态，便于在 output-workshop 中匹配视觉模板 */
  suggestedOutputTemplateIds: string[]
}

export const STYLE_DOCS: readonly StyleDocMeta[] = [
  {
    id: 'xiaohongshu',
    name: '小红书文案',
    description: '标题党 + emoji 点缀 + 标签话题，移动端分享向',
    icon: '📕',
    suggestedOutputTemplateIds: ['social-xiaohongshu', 'social-card'],
  },
  {
    id: 'wechat',
    name: '公众号文章',
    description: '结构化正文 + 小标题分层，适合图文阅读',
    icon: '✍️',
    suggestedOutputTemplateIds: ['wechat-default', 'latepost-depth', 'wechat-elegant'],
  },
  {
    id: 'knowledge',
    name: '知识笔记',
    description: '三级大纲 + 要点加粗，便于检索复习',
    icon: '📝',
    suggestedOutputTemplateIds: ['article-editorial', 'read-accordion', 'learning-flashcard'],
  },
  {
    id: 'mindmap',
    name: '思维导图',
    description: 'Mermaid mindmap 代码块，层级化关键词',
    icon: '🧠',
    suggestedOutputTemplateIds: ['learning-mindmap'],
  },
  {
    id: 'subtitle',
    name: '字幕清理',
    description: '去除口水词、按语义分段、保留时间戳（如有）',
    icon: '🎬',
    suggestedOutputTemplateIds: ['article-editorial'],
  },
  {
    id: 'summary',
    name: '内容摘要',
    description: '压缩到原文 10-30% 的结构化要点',
    icon: '🔍',
    suggestedOutputTemplateIds: ['article-editorial', 'data-dashboard'],
  },
] as const

export const DEFAULT_STYLE_DOC: StyleDocId = 'xiaohongshu'

export function getStyleDoc(id: StyleDocId): StyleDocMeta {
  return STYLE_DOCS.find(item => item.id === id) || STYLE_DOCS[0]
}

// ---------------------------------------------------------------------------
// 提示词构造
// ---------------------------------------------------------------------------

export interface StylePromptInput {
  /** 原始文本（转写/抓取结果），可能很长 */
  sourceContent: string
  /** 来源标题，用于上下文（可选） */
  sourceTitle?: string
  /** 来源 URL（可选） */
  sourceUrl?: string
  /** 额外用户指令（可选，例如"重点突出第二段"） */
  extraInstruction?: string
}

export interface StylePromptResult {
  /** 系统提示词 */
  systemPrompt: string
  /** 用户提示词 */
  userPrompt: string
  /** 建议温度：创意类高一些，结构化类低一些 */
  temperature: number
  /** 输出上限（字符），用于截断超长产物 */
  maxOutputChars: number
}

const COMMON_RULES = [
  '只使用原文中存在的事实、观点、数据、人物、引用，禁止编造。',
  '若原文为英文/其他语言，输出统一为简体中文；专有名词、命令、代码保留原文。',
  '不要输出任何前置说明、致谢、解释，只输出最终的 Markdown 正文本身。',
]

function buildUserPrompt(input: StylePromptInput, header: string): string {
  const parts: string[] = []
  if (header) parts.push(header)
  if (input.sourceTitle) parts.push(`来源标题：${input.sourceTitle}`)
  if (input.sourceUrl) parts.push(`来源链接：${input.sourceUrl}`)
  if (input.extraInstruction && input.extraInstruction.trim()) {
    parts.push(`附加要求：${input.extraInstruction.trim()}`)
  }
  parts.push('---- 原始内容开始 ----')
  parts.push(input.sourceContent)
  parts.push('---- 原始内容结束 ----')
  return parts.join('\n')
}

function buildPrompt(
  input: StylePromptInput,
  opts: {
    system: string
    userHeader: string
    temperature: number
    maxOutputChars: number
  },
): StylePromptResult {
  return {
    systemPrompt: opts.system,
    userPrompt: buildUserPrompt(input, opts.userHeader),
    temperature: opts.temperature,
    maxOutputChars: opts.maxOutputChars,
  }
}

// 估算输入字符上限（避免把 50k 字转写一股脑塞给模型）
const SOURCE_CHAR_LIMIT = 18_000

function clampSource(text: string): string {
  if (!text) return ''
  if (text.length <= SOURCE_CHAR_LIMIT) return text
  return `${text.slice(0, SOURCE_CHAR_LIMIT)}\n\n[注：原始内容超过 ${SOURCE_CHAR_LIMIT} 字，已截断，请基于以上内容完成改写。]`
}

/**
 * 按风格构造提示词
 */
export function buildStylePrompt(
  styleId: StyleDocId,
  rawInput: StylePromptInput,
): StylePromptResult {
  const input: StylePromptInput = {
    ...rawInput,
    sourceContent: clampSource(rawInput.sourceContent),
  }

  switch (styleId) {
    case 'xiaohongshu':
      return buildPrompt(input, {
        temperature: 0.8,
        maxOutputChars: 4_000,
        userHeader: '请把以下原始内容改写为一篇可以直接发布的小红书笔记。',
        system: [
          '你是一名资深小红书内容创作者，擅长把视频/音频/网页的原始内容改写为高互动的小红书笔记。',
          '输出必须严格遵守：',
          '1. 第一行是标题：20 字以内，使用标题党写法（数字/身份/反差/情绪任选其一），标题首尾可加 1-2 个相关 emoji；',
          '2. 正文 600-1200 字，使用二级标题（##）分成 3-5 个段落，每段聚焦一个观点；',
          '3. 合理使用 emoji 作为段落标记或情绪点缀（✨⚠️⁉️⭕️❌☑️✔️🔥💡📌），但单段不超过 3 个；',
          '4. 语气口语化、第一人称、有真实感受，避免书面化官话；',
          '5. 文末空一行，给出 3-6 个 # 开头的话题标签，标签与内容相关；',
          '6. 不输出图片占位、不输出 HTML、不输出代码块；纯 Markdown 文本。',
          ...COMMON_RULES,
        ].join('\n'),
      })

    case 'wechat':
      return buildPrompt(input, {
        temperature: 0.55,
        maxOutputChars: 8_000,
        userHeader: '请把以下原始内容改写为一篇结构清晰、可直接复制到微信公众号的中文长文。',
        system: [
          '你是一名微信公众号主编，擅长把零散的音视频转写或网页内容整理为有阅读节奏的中文长文。',
          '输出必须严格遵守：',
          '1. 第一行是 H1 标题：15-28 字，有信息量、不空洞，可适度使用问句或观点句；',
          '2. 开头 80-150 字引入：用现象、问题或冲突快速勾住读者，不要套话空话；',
          '3. 正文使用 H2 分 3-6 个小节，每节有小标题；小标题应承载信息增量，不要"背景介绍 / 具体分析"这种空标题；',
          '4. 段落 2-4 行为宜，适合手机阅读；关键句可使用 **加粗**；引用原文金句使用 > 引用块；',
          '5. 涉及步骤、命令、参数、代码时，保留为代码块或行内代码；',
          '6. 结尾给一段 50-120 字的总结 + 一个开放性思考或互动问题；不要硬广；',
          '7. 不输出 HTML、不输出图片、不输出"点赞收藏转发"这类营销废话作为单独段落；纯 Markdown。',
          ...COMMON_RULES,
        ].join('\n'),
      })

    case 'knowledge':
      return buildPrompt(input, {
        temperature: 0.3,
        maxOutputChars: 8_000,
        userHeader: '请把以下原始内容整理为一份结构化、便于检索和复习的中文知识笔记。',
        system: [
          '你是一名擅长做知识管理的笔记整理师，把音视频转写或网页内容整理为层次清晰的知识笔记。',
          '输出必须严格遵守：',
          '1. 第一行是 H1 主题标题；',
          '2. 使用 H2 划分 3-7 个一级主题；每个一级主题下可使用 H3 划分二级要点；',
          '3. 关键概念使用 **加粗**，定义、术语、公式、命令使用行内代码或代码块；',
          '4. 列举要点时使用有序或无序列表，不要写大段连续散文；',
          '5. 在文末添加一个 "## 关键术语" 小节，把 3-8 个核心术语用一句话解释清楚；',
          '6. 在文末添加一个 "## 一句话回顾" 小节，用 1-2 句话总结全文核心；',
          '7. 不输出图片、不输出 HTML；纯 Markdown。',
          ...COMMON_RULES,
        ].join('\n'),
      })

    case 'mindmap':
      return buildPrompt(input, {
        temperature: 0.35,
        maxOutputChars: 4_000,
        userHeader: '请把以下原始内容提炼为一份思维导图，输出 Mermaid mindmap 代码块。',
        system: [
          '你是一名知识结构化专家，擅长把原始内容提炼为层级清晰的思维导图。',
          '输出必须严格遵守：',
          '1. 只输出一个 mermaid 代码块，代码块外不要有任何说明文字；',
          '2. 使用 mindmap 语法：',
          '```mermaid',
          'mindmap',
          '  root((主题))',
          '    一级分支 A',
          '      二级要点 A1',
          '      二级要点 A2',
          '    一级分支 B',
          '      二级要点 B1',
          '```',
          '3. 一级分支控制在 3-7 个，每个一级分支下 2-5 个二级要点，必要时可加三级；',
          '4. 节点标签为简短关键词（2-8 字），不要写完整句子；',
          '5. 标签含标点、括号、斜杠时用双引号包裹，例如 A["输入(数据)"]；',
          '6. 节点标签统一使用简体中文；',
          '7. root 主题用 4-10 字概括全文。',
          ...COMMON_RULES,
        ].join('\n'),
      })

    case 'subtitle':
      return buildPrompt(input, {
        temperature: 0.25,
        maxOutputChars: 8_000,
        userHeader: '请把以下语音转写/视频字幕内容清理为可读的干净文稿。',
        system: [
          '你是一名专业的字幕清理与文稿整理师，把充满口语、重复、错字的转写文本整理为可读文稿。',
          '输出必须严格遵守：',
          '1. 若原文带有形如 `00:00:42` 或 `[00:42]` 的时间戳，**保留**这些时间戳，并按时间顺序组织；',
          '2. 若原文没有时间戳，按语义自然分段，每段 1-3 句，段间用空行分隔；',
          '3. 删除口头禅、重复短语、无意义语气词（嗯、那个、就是说、然后然后）；',
          '4. 修正明显的同音错字、专有名词拼写错误；不确定的地方保持原文，不要瞎改；',
          '5. 不要重新组织叙事顺序，不要补充原文没有的解释；只做"清理"不做"改写"；',
          '6. 输出纯文本或带时间戳的 Markdown，不要加自己的标题、不要加总结。',
          ...COMMON_RULES,
        ].join('\n'),
      })

    case 'summary':
      return buildPrompt(input, {
        temperature: 0.3,
        maxOutputChars: 4_000,
        userHeader: '请把以下原始内容压缩为一份结构化摘要，篇幅控制在原文的 10-30%。',
        system: [
          '你是一名信息密度极高的内容摘要师，擅长把长内容压缩为结构化要点。',
          '输出必须严格遵守：',
          '1. 第一行是 H1 标题，使用 8-20 字概括全文主题；',
          '2. 紧接着一段 "TL;DR"，用 1-3 句话（不超过 120 字）回答"这篇内容核心讲什么"；',
          '3. 使用 "## 核心观点" 列出 3-6 条观点，每条以加粗短句开头 + 一句话展开；',
          '4. 若原文涉及数据、步骤、对比、时间线，使用 "## 关键事实/步骤" 用列表呈现；',
          '5. 若原文有明显结论或立场，使用 "## 结论" 用 1-2 句话点明；',
          '6. 不输出原文没有的信息，不输出 HTML、图片。',
          ...COMMON_RULES,
        ].join('\n'),
      })
  }
}
