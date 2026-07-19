import type { Mark } from '@/db/marks'
import { createOpenAIClient, getAISettings, prepareMessages } from '@/lib/ai/utils'

export interface VideoTranscriptMeta {
  platform?: string
  title?: string
  sourceUrl?: string
  transcriptSource?: string
  extractedAt?: number
  summary?: string
  chapters?: Array<{ time?: string; title: string; points: string[] }>
  highlights?: string[]
  viewpoints?: string[]
  reflections?: string[]
  terms?: Array<{ term: string; explanation: string }>
  notes?: string[]
  actionItems?: string[]
  questions?: string[]
}

export interface VideoTranscriptRecord {
  meta: VideoTranscriptMeta
  title: string
  description: string
  timeline: string
  body: string
  summaryMarkdown: string
  rawTimeline?: string
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function cleanTranscriptText(value?: string | null) {
  return cleanText(value?.replace(/[🎼♪♫♬]+/g, ' '))
}

function normalizeBodyParagraphs(value: string) {
  const blocks: string[] = []
  let paragraphBuffer: string[] = []

  function flushParagraph() {
    const paragraph = cleanTranscriptText(paragraphBuffer.join(' ').replace(/^[-*]\s*/, ''))
    if (paragraph) {
      blocks.push(paragraph)
    }
    paragraphBuffer = []
  }

  value
    .replace(/```(?:markdown|md)?/gi, '')
    .replace(/```/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .forEach((line) => {
      if (!line) {
        flushParagraph()
        return
      }

      const headingMatch = line.match(/^#{2,4}\s+(.+)$/)
      if (headingMatch) {
        flushParagraph()
        blocks.push(`### ${cleanTranscriptText(headingMatch[1])}`)
        return
      }

      paragraphBuffer.push(line.replace(/^[-*]\s*/, ''))
    })

  flushParagraph()
  return blocks.join('\n\n')
}

function extractVideoMeta(content?: string | null): VideoTranscriptMeta {
  const match = content?.match(/<!--\s*lingmo:video-transcript\s+({[\s\S]*?})\s*-->/)
  if (!match?.[1]) {
    return {}
  }

  try {
    return JSON.parse(match[1]) as VideoTranscriptMeta
  } catch {
    return {}
  }
}

function extractSection(content: string, heading: string) {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'm')
  const match = content.match(pattern)
  if (!match || typeof match.index !== 'number') {
    return ''
  }

  const start = match.index + match[0].length
  const rest = content.slice(start)
  const next = rest.search(/^##\s+/m)
  return (next >= 0 ? rest.slice(0, next) : rest).trim()
}

function stripMetaComment(content: string) {
  return content.replace(/<!--\s*lingmo:video-transcript\s+{[\s\S]*?}\s*-->\s*/g, '').trim()
}

function extractBody(content: string) {
  const section = extractSection(content, '结构化正文')
    || extractSection(content, '整理正文')
    || extractSection(content, '正文整理')
    || extractSection(content, '转写正文')
    || extractSection(content, '正文')
  return section || stripMetaComment(content)
}

function extractTimeline(content: string) {
  return extractSection(content, '视频时间线')
    || extractSection(content, '转写时间线')
    || extractSection(content, '时间线')
    || extractSection(content, '转写正文')
    || extractSection(content, '正文')
    || stripMetaComment(content)
}

function timelineToBody(timeline: string) {
  const paragraphs: string[] = []
  let buffer: string[] = []

  function flush() {
    const text = cleanTranscriptText(buffer.join(' '))
    if (text) {
      paragraphs.push(text)
    }
    buffer = []
  }

  timeline
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s*(?:\d{1,2}:)?\d{2}:\d{2}\s*(?:[🎼♪♫♬]\s*)?/, '').trim())
    .map(cleanTranscriptText)
    .filter(Boolean)
    .forEach((line) => {
      buffer.push(line)
      const shouldBreak = /[。！？!?]$/.test(line) || cleanTranscriptText(buffer.join(' ')).length >= 180
      if (shouldBreak) {
        flush()
      }
    })

  flush()
  return paragraphs.join('\n\n')
}

function buildTimelineOutline(timeline: string) {
  const lines = timeline
    .split(/\r?\n/)
    .map(line => {
      const match = line.match(/^[-*]\s*((?:\d{1,2}:)?\d{2}:\d{2})\s*(?:[🎼♪♫♬]\s*)?(.*)$/)
      return match ? `- ${match[1]} ${cleanTranscriptText(match[2])}` : cleanTranscriptText(line)
    })
    .filter(Boolean)

  if (lines.length === 0) {
    return ''
  }

  const grouped: string[] = []
  let current: string[] = []
  let currentStart = ''

  lines.forEach((line, index) => {
    const match = line.match(/^[-*]\s*((?:\d{1,2}:)?\d{2}:\d{2})\s*(.*)$/)
    const time = match?.[1] || ''
    const text = cleanTranscriptText(match?.[2] || line.replace(/^[-*]\s*/, ''))
    if (current.length === 0) {
      currentStart = time || `片段 ${Math.floor(index / 6) + 1}`
    }
    current.push(text)
    if (current.length >= 6 || index === lines.length - 1) {
      grouped.push(`### ${currentStart}\n\n${current.map(item => `- ${item}`).join('\n')}`)
      current = []
    }
  })

  return grouped.join('\n\n')
}

function buildSummaryMarkdown(meta: VideoTranscriptMeta, fallbackDescription: string) {
  const sections: string[] = []
  const summary = cleanText(meta.summary)
  if (summary) {
    sections.push('## 摘要', summary, '')
  }
  if (meta.chapters?.length) {
    sections.push(
      '## 章节导读',
      ...meta.chapters.flatMap(item => [
        `### ${item.time ? `${item.time} ` : ''}${item.title}`,
        ...(item.points || []).map(point => `- ${point}`),
        '',
      ])
    )
  }
  if (meta.highlights?.length) {
    sections.push('## 核心要点', ...meta.highlights.map(item => `- ${item}`), '')
  }
  if (meta.viewpoints?.length) {
    sections.push('## 关键观点', ...meta.viewpoints.map(item => `- ${item}`), '')
  }
  if (meta.reflections?.length) {
    sections.push('## 启发与思考', ...meta.reflections.map(item => `- ${item}`), '')
  }
  if (meta.terms?.length) {
    sections.push('## 术语解释', ...meta.terms.map(item => `- **${item.term}**：${item.explanation}`), '')
  }
  if (meta.notes?.length) {
    sections.push('## 笔记沉淀', ...meta.notes.map(item => `- ${item}`), '')
  }
  if (meta.actionItems?.length) {
    sections.push('## 可行动清单', ...meta.actionItems.map(item => `- ${item}`), '')
  }
  if (meta.questions?.length) {
    sections.push('## 复盘问题', ...meta.questions.map(item => `- ${item}`), '')
  }
  if (sections.length === 0 && fallbackDescription) {
    sections.push(
      '## 待生成',
      '点击“生成总结”后，将从摘要、章节、核心要点、关键观点、术语、行动清单和复盘问题等角度整理这条视频。',
      ''
    )
  }
  return sections.join('\n').trim()
}

export function isVideoTranscriptMark(mark: Mark) {
  return mark.type === 'link' && /lingmo:video-transcript/.test(mark.content || '')
}

export function parseVideoTranscriptRecord(mark: Mark): VideoTranscriptRecord {
  const content = mark.content || ''
  const meta = extractVideoMeta(content)
  const title = cleanText(meta.title) || cleanText(mark.desc?.split('\n')[0]) || '视频转写'
  const timeline = extractTimeline(content)
  const bodySection = extractBody(content)
  const body = bodySection ? normalizeBodyParagraphs(bodySection) : timelineToBody(timeline)
  const description = cleanText(meta.summary) || cleanText(body).slice(0, 180) || cleanText(mark.desc?.split('\n').slice(1).join(' '))
  const summaryMarkdown = buildSummaryMarkdown(meta, description)

  return {
    meta,
    title,
    description,
    timeline: buildTimelineOutline(timeline),
    body,
    summaryMarkdown,
    rawTimeline: timeline,
  }
}

// 提取模型输出中的 JSON 对象：兼容 ```json``` 代码块包裹与前后说明文字
function extractJsonBlock(text: string): string | null {
  const trimmed = text.trim()
  // 优先匹配 ```json ... ``` / ``` ... ``` 代码块
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    const inner = fenceMatch[1].trim()
    const firstBrace = inner.indexOf('{')
    const lastBrace = inner.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return inner.slice(firstBrace, lastBrace + 1)
    }
  }
  // 回退到首个 { 到末个 } 之间的内容
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }
  return null
}

// 修复大模型常见的 JSON 格式瑕疵：字符串内未转义的双引号、裸露换行、尾随逗号等
function repairJson(raw: string): string {
  let result = raw

  // 1. 去除尾部多余的逗号（}, ] 之前）
  result = result.replace(/,\s*([}\]])/g, '$1')

  // 2. 移除单行注释与块注释（部分模型会注入）
  result = result.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  // 3. 逐字符扫描，仅在「字符串字面量内部」修复未转义的控制字符与双引号
  //    思路：遍历字符，遇到 " 进入字符串模式；在字符串内遇到原始换行用 \n 替换，
  //    遇到可能未转义的 " 时用启发式判断（后接 , : ] } 或换行结尾才认定为字符串结束）
  let out = ''
  let inString = false
  for (let i = 0; i < result.length; i++) {
    const ch = result[i]
    if (inString) {
      if (ch === '\\') {
        // 转义序列原样保留（连同下一字符）
        out += ch + (result[i + 1] || '')
        i += 1
        continue
      }
      if (ch === '"') {
        // 判断这个引号是字符串结束，还是字符串内部未转义的引号：
        // 若其后的首个非空白字符是 JSON 结构符（, } ] :）或已到末尾，则视为字符串结束
        const rest = result.slice(i + 1).trimStart()
        if (/^([,}\]:]|$)/.test(rest)) {
          out += '"'
          inString = false
        } else {
          // 字符串内部的裸引号 → 转义
          out += '\\"'
        }
        continue
      }
      if (ch === '\n') {
        out += '\\n'
        continue
      }
      if (ch === '\r') {
        out += '\\r'
        continue
      }
      if (ch === '\t') {
        out += '\\t'
        continue
      }
      out += ch
    } else {
      if (ch === '"') {
        inString = true
      }
      out += ch
    }
  }
  return out
}

// 规范化解析结果：确保字段类型符合 VideoTranscriptMeta，丢弃畸形片段
function normalizeSummaryJson(parsed: any): Partial<VideoTranscriptMeta> {
  const result: Partial<VideoTranscriptMeta> = {}
  if (typeof parsed?.summary === 'string' && parsed.summary.trim()) {
    result.summary = parsed.summary.trim()
  }
  if (Array.isArray(parsed?.chapters)) {
    result.chapters = parsed.chapters
      .map((item: any) => {
        if (!item || typeof item !== 'object') return null
        const points = Array.isArray(item.points)
          ? item.points.map((p: any) => String(p ?? '').trim()).filter(Boolean)
          : []
        return {
          time: typeof item.time === 'string' ? item.time.trim() : '',
          title: String(item.title ?? '').trim(),
          points,
        }
      })
      .filter((item: any): item is { time: string; title: string; points: string[] } =>
        Boolean(item) && Boolean(item.title))
  }
  const toStringArray = (value: any): string[] =>
    Array.isArray(value)
      ? value.map((v: any) => (typeof v === 'string' ? v : String(v ?? '')).trim()).filter(Boolean)
      : []
  result.highlights = toStringArray(parsed?.highlights)
  result.viewpoints = toStringArray(parsed?.viewpoints)
  result.reflections = toStringArray(parsed?.reflections)
  result.notes = toStringArray(parsed?.notes)
  result.actionItems = toStringArray(parsed?.actionItems)
  result.questions = toStringArray(parsed?.questions)
  if (Array.isArray(parsed?.terms)) {
    result.terms = parsed.terms
      .map((item: any) => {
        if (!item || typeof item !== 'object') return null
        return {
          term: String(item.term ?? '').trim(),
          explanation: String(item.explanation ?? '').trim(),
        }
      })
      .filter((item: any): item is { term: string; explanation: string } =>
        Boolean(item) && (Boolean(item.term) || Boolean(item.explanation)))
  }
  return result
}

function parseSummaryJson(text: string): Partial<VideoTranscriptMeta> {
  const jsonText = extractJsonBlock(text)
  if (!jsonText) {
    throw new Error('AI 返回的内容不是有效的 JSON 结构。')
  }

  // 1. 先尝试直接解析（大多数情况下模型输出的 JSON 是合法的）
  try {
    return normalizeSummaryJson(JSON.parse(jsonText))
  } catch {
    // 进入修复流程
  }

  // 2. 尝试修复常见 JSON 瑕疵后解析
  try {
    const repaired = repairJson(jsonText)
    return normalizeSummaryJson(JSON.parse(repaired))
  } catch (error) {
    throw new Error(`AI 返回的 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function summarizeVideoTranscript(input: {
  title: string
  transcript: string
  sourceUrl: string
}): Promise<Partial<VideoTranscriptMeta>> {
  const trySummarize = async (modelType: 'markDescModel' | 'primaryModel') => {
    const aiConfig = await getAISettings(modelType)
    if (!aiConfig?.model) {
      throw new Error(`未启用或未配置 ${modelType === 'markDescModel' ? 'AI整理' : '主要聊天'} 模型。`)
    }

    const prompt = [
      '你是视频内容分析与学习整理助手。请基于字幕/转写内容生成中文结构化总结，帮助用户快速吸收、理解、归纳和复盘。',
      '输出严格 JSON，不要 Markdown，不要额外解释。',
      'JSON 字段：',
      '{"summary":"","chapters":[{"time":"","title":"","points":[""]}],"highlights":[""],"viewpoints":[""],"reflections":[""],"terms":[{"term":"","explanation":""}],"notes":[""],"actionItems":[""],"questions":[""]}',
      '要求：',
      '- summary：120-220 字，说明视频在讲什么、核心结论是什么、适合谁看。',
      '- chapters：按内容推进拆成 4-8 个章节，time 尽量使用字幕中的时间点，points 每章 2-4 条。',
      '- highlights：5-8 条，提炼最重要的信息增量，不要空泛。',
      '- viewpoints：3-6 条，提炼作者/视频表达的关键判断或立场。',
      '- reflections：3-5 条，写出对学习、工作或决策有帮助的启发。',
      '- terms：0-10 个，解释影响理解的术语、缩写、人物、工具或概念。',
      '- notes：5-10 条，适合沉淀到长期笔记的原子化知识点。',
      '- actionItems：3-6 条，用户看完后可以做什么。',
      '- questions：3-6 条，帮助用户复盘和自测。',
      '不要编造字幕中没有依据的事实；如果转写质量不足，要在 summary 中提示不确定性。',
      '',
      `标题：${input.title}`,
      `链接：${input.sourceUrl}`,
      '转写内容：',
      input.transcript.slice(0, 18000),
    ].join('\n')

    const { messages } = await prepareMessages(prompt)
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig.model,
      messages,
      temperature: 0.2,
      top_p: aiConfig.topP || 1,
    })
    return parseSummaryJson(completion.choices[0]?.message?.content || '')
  }

  try {
    return await trySummarize('markDescModel')
  } catch (firstError: any) {
    console.warn('[video-transcript-record] 优先记录整理模型调用失败，正在尝试使用主要聊天模型回退机制...', firstError)
    try {
      return await trySummarize('primaryModel')
    } catch (secondError: any) {
      console.error('[video-transcript-record] 主要聊天模型回退调用同样失败:', secondError)
      const firstMsg = firstError?.body?.message || firstError?.message || String(firstError)
      const secondMsg = secondError?.body?.message || secondError?.message || String(secondError)
      throw new Error(`视频 AI 深度分析失败。\n[整理模型错误]: ${firstMsg}\n[备用模型错误]: ${secondMsg}`)
    }
  }
}

export function mergeVideoTranscriptSummary(content: string, summary: Partial<VideoTranscriptMeta>) {
  const meta = extractVideoMeta(content)
  const nextMeta: VideoTranscriptMeta = {
    ...meta,
    summary: summary.summary || meta.summary || '',
    chapters: summary.chapters || meta.chapters || [],
    highlights: summary.highlights || meta.highlights || [],
    viewpoints: summary.viewpoints || meta.viewpoints || [],
    reflections: summary.reflections || meta.reflections || [],
    terms: summary.terms || meta.terms || [],
    notes: summary.notes || meta.notes || [],
    actionItems: summary.actionItems || meta.actionItems || [],
    questions: summary.questions || meta.questions || [],
  }
  if (/<!--\s*lingmo:video-transcript\s+{[\s\S]*?}\s*-->/.test(content)) {
    return content.replace(/<!--\s*lingmo:video-transcript\s+{[\s\S]*?}\s*-->/, `<!-- lingmo:video-transcript ${JSON.stringify(nextMeta)} -->`)
  }
  return `<!-- lingmo:video-transcript ${JSON.stringify(nextMeta)} -->\n${content}`
}
