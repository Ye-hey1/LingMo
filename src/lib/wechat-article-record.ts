import type { Mark } from '@/db/marks'
import { createOpenAIClient, getAISettings, prepareMessages } from '@/lib/ai/utils'

export interface WechatArticleMeta {
  url?: string
  title?: string
  accountName?: string
  author?: string
  publishedAt?: string
  extractedAt?: number
  summary?: string
  highlights?: string[]
  takeaways?: string[]
  notes?: string[]
}

export interface WechatArticleRecord {
  meta: WechatArticleMeta
  title: string
  body: string
  summaryMarkdown: string
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

export function extractWechatMeta(content?: string | null): WechatArticleMeta {
  const match = content?.match(/<!--\s*lingmo:wechat-article\s+({[\s\S]*?})\s*-->/)
  if (!match?.[1]) {
    return {}
  }

  try {
    return JSON.parse(match[1]) as WechatArticleMeta
  } catch {
    return {}
  }
}

export function isWechatArticleMark(mark: Mark) {
  return mark.type === 'link' && /lingmo:wechat-article/.test(mark.content || '')
}

function stripMetaComment(content: string) {
  return content.replace(/<!--\s*lingmo:wechat-article\s+{[\s\S]*?}\s*-->\s*/g, '').trim()
}

export function parseWechatArticleRecord(mark: Mark): WechatArticleRecord {
  const content = mark.content || ''
  const meta = extractWechatMeta(content)
  const title = meta.title || cleanText(mark.desc?.split('\n')[0]) || '微信文章'
  const body = stripMetaComment(content)
  const summaryMarkdown = buildWechatSummaryMarkdown(meta)

  return {
    meta,
    title,
    body,
    summaryMarkdown,
  }
}

function buildWechatSummaryMarkdown(meta: WechatArticleMeta) {
  const sections: string[] = []
  const summary = cleanText(meta.summary)
  if (summary) {
    sections.push('## AI 摘要', summary, '')
  }
  if (meta.highlights?.length) {
    sections.push('## 核心要点', ...meta.highlights.map(item => `- ${item}`), '')
  }
  if (meta.takeaways?.length) {
    sections.push('## 深度启发与行动建议', ...meta.takeaways.map(item => `- ${item}`), '')
  }
  if (meta.notes?.length) {
    sections.push('## 核心知识点沉淀', ...meta.notes.map(item => `- ${item}`), '')
  }
  return sections.join('\n').trim()
}

export async function summarizeWechatArticle(input: {
  title: string
  content: string
  url: string
}): Promise<Partial<WechatArticleMeta>> {
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

  const parseSafeJson = (jsonStr: string): Partial<WechatArticleMeta> => {
    try {
      return JSON.parse(jsonStr) as Partial<WechatArticleMeta>
    } catch (err) {
      console.warn('[wechat-article-record] 标准 JSON 解析失败，尝试容错清洗机制...', err)
      try {
        const sanitized = cleanJsonString(jsonStr)
        return JSON.parse(sanitized) as Partial<WechatArticleMeta>
      } catch (err2) {
        console.error('[wechat-article-record] 深度容错清洗依然失败:', err2)
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
      '你是专业的深度内容分析和阅读总结专家。请基于微信公众号文章正文内容生成中文结构化总结，帮助用户快速吸收深度知识。',
      '输出严格 JSON，不要 Markdown，不要额外解释。',
      'JSON 字段：',
      '{"summary":"","highlights":[""],"takeaways":[""],"notes":[""]}',
      '要求：',
      '- summary：150-250 字，提炼文章最核心的研究、观点或洞察，适合哪些读者看。',
      '- highlights：5-8 条，提炼文章的核心论据、数据或事实增量。',
      '- takeaways：3-6 条，对个人提升、业务决策、认知升级有实质帮助的行动项或核心思考。',
      '- notes：5-10 条，适合沉淀为笔记的卡片式原子化概念或金句。',
      '- 核心要求：生成的 JSON 字符串本身必须是标准的、无畸变的 JSON。如果总结和 highlights 内容中包含双引号（如 "Codex"），必须使用标准反斜杠转义为 \\" ；绝不能含有任何未转义的控制性字符或硬换行。',
      '',
      `标题：${input.title}`,
      `链接：${input.url}`,
      '文章正文：',
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
    // 1. 优先使用记录整理模型
    return await trySummarize('markDescModel')
  } catch (firstError: any) {
    console.warn('[wechat-article-record] 优先记录整理模型调用失败，正在尝试使用主要聊天模型回退机制...', firstError)
    try {
      // 2. 备用回退到主要聊天模型
      return await trySummarize('primaryModel')
    } catch (secondError: any) {
      console.error('[wechat-article-record] 主要聊天模型回退调用同样失败:', secondError)
      const firstMsg = firstError?.body?.message || firstError?.message || String(firstError)
      const secondMsg = secondError?.body?.message || secondError?.message || String(secondError)
      throw new Error(`微信文章 AI 总结失败。\n[整理模型错误]: ${firstMsg}\n[备用模型错误]: ${secondMsg}`)
    }
  }
}

export function mergeWechatArticleSummary(content: string, summary: Partial<WechatArticleMeta>) {
  const meta = extractWechatMeta(content)
  const nextMeta: WechatArticleMeta = {
    ...meta,
    summary: summary.summary || meta.summary || '',
    highlights: summary.highlights || meta.highlights || [],
    takeaways: summary.takeaways || meta.takeaways || [],
    notes: summary.notes || meta.notes || [],
  }
  if (/<!--\s*lingmo:wechat-article\s+{[\s\S]*?}\s*-->/.test(content)) {
    return content.replace(/<!--\s*lingmo:wechat-article\s+{[\s\S]*?}\s*-->/, `<!-- lingmo:wechat-article ${JSON.stringify(nextMeta)} -->`)
  }
  return `<!-- lingmo:wechat-article ${JSON.stringify(nextMeta)} -->\n${content}`
}
