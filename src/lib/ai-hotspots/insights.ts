import { createOpenAIClient, getAISettings, prepareMessages } from '@/lib/ai/utils'
import type { AiHotspotItem, AiHotspotSuggestedAction } from './types'

export type AiHotspotInsightPatch = Pick<
  AiHotspotItem,
  'signalSummary' | 'signalEssence' | 'impactAudience' | 'suggestedAction' | 'relatedSignalIds'
>

function compactText(value: string | null | undefined, maxLength: number) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function pickAudience(item: AiHotspotItem) {
  const text = `${item.title} ${item.summary || ''} ${item.tags.join(' ')}`.toLowerCase()
  const audience: string[] = []

  if (/sdk|api|agent|github|tool|开发|工具|智能体/.test(text)) {
    audience.push('开发者')
  }
  if (/model|gpt|llm|claude|gemini|deepseek|模型|大模型|多模态/.test(text)) {
    audience.push('模型/产品团队')
  }
  if (/enterprise|startup|industry|应用|商业|企业|融资/.test(text)) {
    audience.push('产品与业务负责人')
  }
  if (/paper|research|benchmark|eval|论文|研究|评测/.test(text)) {
    audience.push('研究与策略观察者')
  }
  if (/gpu|chip|nvidia|算力|芯片/.test(text)) {
    audience.push('基础设施与算力团队')
  }

  return uniq(audience).slice(0, 3)
}

function pickAction(item: AiHotspotItem): AiHotspotSuggestedAction {
  if (item.score >= 52) return 'deep-dive'
  if (item.score >= 36) return 'digest'
  if (item.score >= 24) return 'favorite'
  return 'ignore'
}

function findRelatedSignalIds(item: AiHotspotItem, candidates: AiHotspotItem[]) {
  const tagSet = new Set(item.tags.map(tag => tag.toLowerCase()))
  return candidates
    .filter(candidate => candidate.id !== item.id && !candidate.deletedAt)
    .map(candidate => ({
      id: candidate.id,
      score:
        (candidate.sourceId === item.sourceId ? 2 : 0) +
        candidate.tags.filter(tag => tagSet.has(tag.toLowerCase())).length * 3 +
        (candidate.score >= 30 ? 1 : 0),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(candidate => candidate.id)
}

export /** 从标题中提取关键信息生成有意义的摘要 */
function extractKeyInfo(title: string): string {
  // 去掉来源后缀（如 " - Arab News"）
  const cleanTitle = title.replace(/\s*[-–—]\s*[^-–—]{2,30}$/g, '').trim()
  
  // 如果标题已经有足够的信息，直接用
  if (cleanTitle.length >= 15) {
    return cleanTitle
  }
  return title
}

function buildLocalHotspotInsight(
  item: AiHotspotItem,
  relatedItems: AiHotspotItem[] = [],
): AiHotspotInsightPatch {
  const tagLabel = item.tags.slice(0, 2).join(' / ') || 'AI 信号'
  const _sourceLine = `${item.sourceName}${item.feedName && item.feedName !== item.sourceName ? ` / ${item.feedName}` : ''}`
  const impactAudience = pickAudience(item)
  const suggestedAction = pickAction(item)

  // 优先使用已有的 summary（来自 RSS description）
  let signalSummary = compactText(item.summary, 120)
  
  // 如果没有 summary，从标题提取关键信息
  if (!signalSummary) {
    const keyInfo = extractKeyInfo(item.title)
    signalSummary = keyInfo
  }

  const essenceParts = [
    item.score >= 45 ? '高强度信号' : item.score >= 26 ? '可跟踪信号' : '低噪声观察',
    tagLabel,
    impactAudience.length > 0 ? `影响 ${impactAudience.join('、')}` : '适合后续复核',
  ]

  return {
    signalSummary,
    signalEssence: essenceParts.join('；'),
    impactAudience,
    suggestedAction,
    relatedSignalIds: findRelatedSignalIds(item, relatedItems),
  }
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed
  try {
    return JSON.parse(candidate) as Partial<AiHotspotInsightPatch>
  } catch {
    return null
  }
}

/**
 * JSON 修复重试（借鉴 TrendRadar analyzer._retry_fix_json）。
 * AI 偶尔返回含有中文引号、未转义双引号的 JSON，让 AI 自己修复后重试一次。
 */
async function repairAndParseJson(
  rawText: string,
  aiConfig: NonNullable<Awaited<ReturnType<typeof getAISettings>>>,
): Promise<Partial<AiHotspotInsightPatch> | null> {
  if (!aiConfig.model) return null
  const modelName = aiConfig.model
  try {
    const repairPrompt = [
      '你是一个 JSON 修复助手。用户会提供一段格式有误的 JSON，你需要修复 JSON 格式错误并返回正确的 JSON。',
      '直接返回纯 JSON，不要包含 markdown 代码块标记（如 ```json）或任何说明文字。',
      '修复要点：值中的双引号改用中文引号「」或转义 \\\”，补全缺失的逗号/括号。',
      '',
      `以下 JSON 解析失败：`,
      rawText,
    ].join('\n')
    const { messages } = await prepareMessages(repairPrompt)
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages,
      temperature: 0,
      top_p: aiConfig.topP || 1,
    })
    const repaired = completion.choices[0]?.message?.content || ''
    return extractJsonObject(repaired)
  } catch {
    return null
  }
}

function normalizeAiPatch(
  item: AiHotspotItem,
  localPatch: AiHotspotInsightPatch,
  aiPatch: Partial<AiHotspotInsightPatch> | null,
): AiHotspotInsightPatch {
  if (!aiPatch) return localPatch

  const suggestedAction = aiPatch.suggestedAction &&
    ['ignore', 'favorite', 'deep-dive', 'digest', 'save'].includes(aiPatch.suggestedAction)
    ? aiPatch.suggestedAction
    : localPatch.suggestedAction

  return {
    signalSummary: compactText(aiPatch.signalSummary, 120) || localPatch.signalSummary,
    signalEssence: compactText(aiPatch.signalEssence, 96) || localPatch.signalEssence,
    impactAudience: Array.isArray(aiPatch.impactAudience)
      ? uniq(aiPatch.impactAudience).slice(0, 4)
      : localPatch.impactAudience,
    suggestedAction,
    relatedSignalIds: Array.isArray(aiPatch.relatedSignalIds)
      ? aiPatch.relatedSignalIds.filter(id => typeof id === 'string' && id !== item.id).slice(0, 3)
      : localPatch.relatedSignalIds,
  }
}

export async function generateAiHotspotInsight(
  item: AiHotspotItem,
  relatedItems: AiHotspotItem[] = [],
): Promise<AiHotspotInsightPatch> {
  const localPatch = buildLocalHotspotInsight(item, relatedItems)

  try {
    const aiConfig = await getAISettings('markDescModel') || await getAISettings('primaryModel')
    if (!aiConfig?.model) {
      return localPatch
    }

    const prompt = [
      '请把下面的 AI 热点整理成知识雷达卡片信号，输出严格 JSON，不要 Markdown。',
      '字段：signalSummary（一句话墨摘，60-90字），signalEssence（一句话精华判断，40-70字），impactAudience（2-4个中文短标签），suggestedAction（ignore/favorite/deep-dive/digest/save 之一），relatedSignalIds（可为空数组）。',
      '判断要克制、信息密度高，不要营销腔。',
      '',
      `标题：${item.title}`,
      `来源：${item.sourceName} / ${item.feedName}`,
      `标签：${item.tags.join('、') || '未分类'}`,
      `热度：${item.score}`,
      `摘要：${item.summary || '无'}`,
      `链接：${item.url}`,
    ].join('\n')

    const { messages } = await prepareMessages(prompt)
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig.model,
      messages,
      temperature: 0.2,
      top_p: aiConfig.topP || 1,
    })
    const content = completion.choices[0]?.message?.content || ''
    let parsed = extractJsonObject(content)
    // JSON 解析失败 → 让 AI 修复后重试一次（借鉴 TrendRadar 的鲁棒性设计）
    if (!parsed && content.trim()) {
      parsed = await repairAndParseJson(content, aiConfig)
    }
    return normalizeAiPatch(item, localPatch, parsed)
  } catch (error) {
    console.warn('[ai-hotspots] insight generation fallback:', error)
    return localPatch
  }
}
