import type { Mark } from '@/db/marks'
import { createOpenAIClient, getAISettings, prepareMessages } from '@/lib/ai/utils'

export interface AudioRecordingMeta {
  summary?: string
  highlights?: string[]
  takeaways?: string[]
  notes?: string[]
}

export interface AudioRecordingRecord {
  title: string
  body: string
  summaryMarkdown: string
  meta: AudioRecordingMeta
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

export function extractAudioRecordingMeta(content?: string | null): AudioRecordingMeta {
  const match = content?.match(/<!--\s*lingmo:audio-recording\s+({[\s\S]*?})\s*-->/)
  if (!match?.[1]) {
    return {}
  }

  try {
    return JSON.parse(match[1]) as AudioRecordingMeta
  } catch {
    return {}
  }
}

export function isAudioRecordingMark(mark: Mark) {
  return mark.type === 'recording'
}

function stripMetaComment(content: string) {
  return content.replace(/<!--\s*lingmo:audio-recording\s+{[\s\S]*?}\s*-->\s*/g, '').trim()
}

export function parseAudioRecordingRecord(mark: Mark): AudioRecordingRecord {
  const content = mark.content || ''
  const meta = extractAudioRecordingMeta(content)
  const title = mark.desc?.trim()?.split('\n')[0] || '录音记录'
  const body = stripMetaComment(content)
  const summaryMarkdown = buildAudioRecordingSummaryMarkdown(meta)

  return {
    title,
    body,
    summaryMarkdown,
    meta,
  }
}

function buildAudioRecordingSummaryMarkdown(meta: AudioRecordingMeta) {
  const sections: string[] = []
  const summary = cleanText(meta.summary)
  if (summary) {
    sections.push('## AI 随笔与心流脑暴备忘', summary, '')
  }
  if (meta.highlights?.length) {
    sections.push('## 核心讨论论点与干货大纲', ...meta.highlights.map(item => `- ${item}`), '')
  }
  if (meta.takeaways?.length) {
    sections.push('## 启发与下一步行动指南', ...meta.takeaways.map(item => `- ${item}`), '')
  }
  if (meta.notes?.length) {
    sections.push('## 独立心流笔记与高光概念沉淀', ...meta.notes.map(item => `- ${item}`), '')
  }
  return sections.join('\n').trim()
}

export async function summarizeAudioRecording(input: {
  title: string
  content: string
  url: string
}): Promise<Partial<AudioRecordingMeta>> {
  const cleanJsonString = (str: string): string => {
    let inString = false
    let escaped = false
    let result = ''
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i]
      
      if (inString) {
        if (escaped) {
          if (char === '"' || char === '\\' || char === '/' || char === 'b' || char === 'f' || char === 'n' || char === 'r' || char === 't') {
            result += '\\' + char
          } else if (char === 'u') {
            const hex = str.slice(i + 1, i + 5)
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              result += '\\u'
            } else {
              result += '\\\\u'
            }
          } else {
            result += '\\\\' + char
          }
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          inString = false
          result += '"'
        } else if (char === '\n') {
          result += '\\n'
        } else if (char === '\r') {
          result += '\\r'
        } else {
          result += char
        }
      } else {
        if (char === '"') {
          inString = true
        }
        result += char
      }
    }
    
    if (escaped) {
      result += '\\\\'
    }
    
    return result
  }

  const parseSafeJson = (jsonStr: string): Partial<AudioRecordingMeta> => {
    try {
      return JSON.parse(jsonStr) as Partial<AudioRecordingMeta>
    } catch (err) {
      console.warn('[audio-recording-record] 标准 JSON 解析失败，尝试容错清洗机制...', err)
      try {
        const sanitized = cleanJsonString(jsonStr)
        return JSON.parse(sanitized) as Partial<AudioRecordingMeta>
      } catch (err2) {
        console.error('[audio-recording-record] 深度容错清洗依然失败:', err2)
        throw err
      }
    }
  }

  const trySummarize = async (modelType: 'markDescModel' | 'primaryModel') => {
    const aiConfig = await getAISettings(modelType)
    if (!aiConfig?.model) {
      throw new Error(`未启用或未配置 ${modelType === 'markDescModel' ? 'AI整理' : '主要聊天'} 模型。`)
    }

    const prompt = [
      '你是专业的录音转写分析与深度会议/脑暴干货提炼专家。请基于录音转写的口语化文本生成中文结构化总结，帮助用户提炼会议精要和行动项。',
      '输出严格 JSON，不要 Markdown，不要额外解释。',
      'JSON 字段：',
      '{"summary":"","highlights":[""],"takeaways":[""],"notes":[""]}',
      '要求：',
      '- summary：100-200 字，提炼这段录音转写口语化内容的核心讨论、心流思考或会议关键决议，适合快速复盘。',
      '- highlights：4-6 条，梳理会议/脑暴的核心讨论论点、关键数据、实操大纲或决策。',
      '- takeaways：3-5 条，下一步行动指南（To-Do List）或核心启发行动项。',
      '- notes：4-8 条，转写口语文本中包含的高价值金句或适合沉淀为独立笔记的原子化概念卡片。',
      '- 核心要求：生成的 JSON 字符串本身必须是标准的、无畸变的 JSON。如果总结和 highlights 内容中包含双引号，必须使用标准反斜杠转义为 \\" ；绝不能含有任何未转义的控制性字符或硬换行。',
      '',
      `录音标题：${input.title}`,
      `录音文件：${input.url}`,
      '语音转写文本：',
      input.content.slice(0, 18000),
    ].join('\n')

    const { messages } = await prepareMessages(prompt)
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig.model,
      messages,
      temperature: 0.2,
      top_p: aiConfig.topP || 1,
    })
    
    const text = completion.choices[0]?.message?.content || ''
    const match = text.trim().match(/\{[\s\S]*\}/)
    if (!match) {
      throw new Error('AI 返回的内容不是有效的 JSON 结构。')
    }
    return parseSafeJson(match[0])
  }

  try {
    return await trySummarize('markDescModel')
  } catch (firstError: any) {
    console.warn('[audio-recording-record] 优先记录整理模型调用失败，正在尝试使用主要聊天模型回退机制...', firstError)
    try {
      return await trySummarize('primaryModel')
    } catch (secondError: any) {
      console.error('[audio-recording-record] 主要聊天模型回退调用同样失败:', secondError)
      const firstMsg = firstError?.body?.message || firstError?.message || String(firstError)
      const secondMsg = secondError?.body?.message || secondError?.message || String(secondError)
      throw new Error(`录音 AI 总结失败。\n[整理模型错误]: ${firstMsg}\n[备用模型错误]: ${secondMsg}`)
    }
  }
}

export function mergeAudioRecordingSummary(content: string, summary: Partial<AudioRecordingMeta>) {
  const meta = extractAudioRecordingMeta(content)
  const nextMeta: AudioRecordingMeta = {
    ...meta,
    summary: summary.summary || meta.summary || '',
    highlights: summary.highlights || meta.highlights || [],
    takeaways: summary.takeaways || meta.takeaways || [],
    notes: summary.notes || meta.notes || [],
  }
  if (/<!--\s*lingmo:audio-recording\s+{[\s\S]*?}\s*-->/.test(content)) {
    return content.replace(/<!--\s*lingmo:audio-recording\s+{[\s\S]*?}\s*-->/, `<!-- lingmo:audio-recording ${JSON.stringify(nextMeta)} -->`)
  }
  return `<!-- lingmo:audio-recording ${JSON.stringify(nextMeta)} -->\n${content}`
}
