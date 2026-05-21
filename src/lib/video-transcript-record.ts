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
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
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
  const section = extractSection(content, '转写正文') || extractSection(content, '正文')
  return section || stripMetaComment(content)
}

function timelineToBody(timeline: string) {
  const paragraphs: string[] = []
  let buffer: string[] = []

  function flush() {
    const text = cleanText(buffer.join(' '))
    if (text) {
      paragraphs.push(text)
    }
    buffer = []
  }

  timeline
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s*(?:\d{1,2}:)?\d{2}:\d{2}\s*/, '').trim())
    .filter(Boolean)
    .forEach((line) => {
      buffer.push(line)
      const shouldBreak = /[。！？!?]$/.test(line) || cleanText(buffer.join(' ')).length >= 180
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
    .map(line => cleanText(line))
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
    const text = match?.[2] || line.replace(/^[-*]\s*/, '')
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
  const timeline = extractBody(content)
  const body = timelineToBody(timeline)
  const description = cleanText(meta.summary) || cleanText(body).slice(0, 180) || cleanText(mark.desc?.split('\n').slice(1).join(' '))
  const summaryMarkdown = buildSummaryMarkdown(meta, description)

  return {
    meta,
    title,
    description,
    timeline: buildTimelineOutline(timeline),
    body,
    summaryMarkdown,
  }
}

function parseSummaryJson(text: string): Partial<VideoTranscriptMeta> | null {
  const match = text.trim().match(/\{[\s\S]*\}/)
  if (!match) {
    return null
  }
  try {
    return JSON.parse(match[0]) as Partial<VideoTranscriptMeta>
  } catch {
    return null
  }
}

export async function summarizeVideoTranscript(input: {
  title: string
  transcript: string
  sourceUrl: string
}): Promise<Partial<VideoTranscriptMeta> | null> {
  try {
    const aiConfig = await getAISettings('markDescModel')
    if (!aiConfig?.model) {
      return null
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
  } catch {
    return null
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
