/**
 * AI 智能分类流水线（两阶段 + 增量）
 * ----------------------------------------------------------------
 * 移植自 TrendRadar 的 AIFilterPipeline 思路，适配 LingMo 的 TS 架构与 AI 客户端。
 *
 * 两阶段设计（省 token 的关键）：
 *   1. extractTags（首次 / 兴趣变更时）：从用户自然语言兴趣描述中提取结构化标签
 *      （tag + description），结果缓存。下次只对比 hash 决定是否重提取。
 *   2. classifyBatch（每次）：用已有标签列表对「未分类的」新闻批量分类，
 *      返回 {id, tag, score}。只处理 pending（增量），不重复消耗 token。
 *
 * 增量决策（借鉴 change_ratio）：
 *   - 兴趣文本 hash 变化 → 重新 extractTags（标签集合可能变）
 *   - 标签集合变化幅度大 → 全量重分类；小 → 仅对新条目分类
 *
 * 发挥 LingMo 特长：复用已有的 createOpenAIClient / getAISettings（insights.ts 同款），
 * 以及 fetch-article 的正文抓取（批量摘要时可带正文，比 TrendRadar 只看标题更准）。
 */

import { createOpenAIClient, getAISettings, prepareMessages } from '@/lib/ai/utils'
import { classifyByInterest, type InterestConfig } from './interests'
import { getInterestConfig } from './rules'
import type { AiHotspotItem } from './types'

/* ------------------------------- 类型 ------------------------------- */

export interface AiTag {
  id: number
  tag: string
  description: string
}

export interface AiClassification {
  id: string
  tag: string
  score: number
}

export interface AiFilterPipelineResult {
  /** 本次提取/复用的标签集合 */
  tags: AiTag[]
  /** 分类结果（仅含 score >= minScore 的条目） */
  classifications: AiClassification[]
  /** 是否执行了标签重提取 */
  tagsRebuilt: boolean
  /** 兴趣文本的 hash（用于持久化，下次对比） */
  interestsHash: string
}

export interface AiFilterPipelineOptions {
  /** 自然语言兴趣描述 */
  interestsText: string
  /** 最低相关度阈值（0-1），低于此分的不返回 */
  minScore: number
  /** 每批发送给 AI 的标题数（借鉴 TrendRadar batch_size，避免限流/超长） */
  batchSize: number
  /** 上次缓存的标签集合 + 兴趣 hash（用于增量决策） */
  cachedTags?: AiTag[]
  cachedInterestsHash?: string
  /** 词组 DSL 文本（keyword 模式回退 / 混合模式） */
  interestText?: string
}

/* --------------------------- 工具函数 --------------------------- */

async function sha1(text: string): Promise<string> {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // 降级：简单字符串 hash
    let h = 0
    for (let i = 0; i < text.length; i++) {
      h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
    }
    return `f${h}`
  }
}

function extractJsonObject<T>(text: string): T | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  const candidate =
    fenced ||
    trimmed.match(/\{[\s\S]*\}/)?.[0] ||
    trimmed.match(/\[[\s\S]*\]/)?.[0] ||
    trimmed
  try {
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}

async function callAi(prompt: string, temperature = 0.2): Promise<string> {
  const aiConfig = await getAISettings('markDescModel') || await getAISettings('primaryModel')
  if (!aiConfig?.model) throw new Error('未配置 AI 模型')
  const { messages } = await prepareMessages(prompt)
  const openai = await createOpenAIClient(aiConfig)
  const completion = await openai.chat.completions.create({
    model: aiConfig.model,
    messages,
    temperature,
    top_p: aiConfig.topP || 1,
  })
  return completion.choices[0]?.message?.content || ''
}

/* --------------------------- 阶段一：标签提取 --------------------------- */

interface ExtractedTagsResponse {
  tags: Array<{ tag: string; description: string }>
}

const EXTRACT_TAGS_SYSTEM = `你是一个兴趣标签提取专家。你的任务是从用户的兴趣描述中提取出结构化的新闻分类标签。

提取规则：
1. 每个标签简洁（2-6个字），同时配一句描述说明该标签涵盖哪些话题和关键词
2. 标签之间尽量不重叠
3. 标签数量控制在 5~20 个，优先保留细分标签，只有语义高度重叠时才合并
4. 描述要具体，包含具体的人名、公司名、产品名等关键词，方便后续分类
5. 返回顺序必须尽量遵循用户兴趣描述中的先后顺序，越靠前代表优先级越高`

const EXTRACT_TAGS_USER = (interests: string) => `用户的兴趣描述如下：

${interests}

请从中提取出新闻分类标签。

返回严格的 JSON 格式（不要添加任何其他内容）：
\`\`\`json
{
  "tags": [
    {"tag": "标签名", "description": "该标签涵盖的话题、关键词描述"}
  ]
}
\`\`\``

async function extractTags(interestsText: string): Promise<AiTag[]> {
  const content = await callAi(
    `${EXTRACT_TAGS_SYSTEM}\n\n${EXTRACT_TAGS_USER(interestsText)}`,
    0.3,
  )
  const parsed = extractJsonObject<ExtractedTagsResponse>(content)
  if (!parsed?.tags?.length) throw new Error('AI 标签提取结果为空或格式错误')

  return parsed.tags.map((t, index) => ({
    id: index + 1,
    tag: String(t.tag || '').trim().slice(0, 20),
    description: String(t.description || '').trim().slice(0, 200),
  })).filter(t => t.tag)
}

/** 计算新旧标签集合的变化比例（借鉴 change_ratio） */
function computeChangeRatio(oldTags: AiTag[], newTags: AiTag[]): number {
  if (oldTags.length === 0 && newTags.length === 0) return 0
  const oldSet = new Set(oldTags.map(t => t.tag))
  const newSet = new Set(newTags.map(t => t.tag))
  const all = new Set([...oldSet, ...newSet])
  const common = [...oldSet].filter(t => newSet.has(t)).length
  const changed = all.size - common * 2 < 0 ? 0 : all.size - common
  return all.size === 0 ? 0 : changed / all.size
}

/* --------------------------- 阶段二：批量分类 --------------------------- */

const CLASSIFY_SYSTEM = `你是一个高效的新闻分类专家。根据给定的标签列表，快速判断每条新闻标题最适合哪个标签。

分类规则：
1. 每条新闻只归入一个最相关的标签（选相关度最高的那个）
2. 不匹配任何标签的新闻不要输出（不要返回空结果）
3. 给出 0.0-1.0 的相关度分数（1.0=完全相关，0.5=部分相关）
4. 只根据标题判断，不要过度推测
5. 如果两类标签相关度接近，优先选择排序更靠前的标签（前面的标签优先级更高）`

const CLASSIFY_USER = (tagsList: string, newsList: string, count: number) => `## 分类标签

${tagsList}

## 新闻列表（共 ${count} 条）

${newsList}

请对每条新闻进行分类。返回严格的 JSON 数组（不要添加任何其他内容）：
\`\`\`json
[
  {"id": 1, "tag_id": 1, "score": 0.9}
]
\`\`\`
只返回有匹配的新闻，无匹配的不要包含在结果中。`

interface ClassifyBatchResponse {
  id: number
  tag_id: number
  score: number
}

async function classifyBatch(
  items: AiHotspotItem[],
  tags: AiTag[],
): Promise<AiClassification[]> {
  const tagsList = tags.map(t => `${t.id}. ${t.tag}（${t.description}）`).join('\n')
  const newsList = items.map((item, index) => `${index + 1}. ${item.title}`).join('\n')
  const content = await callAi(`${CLASSIFY_SYSTEM}\n\n${CLASSIFY_USER(tagsList, newsList, items.length)}`, 0.2)

  const parsed = extractJsonObject<ClassifyBatchResponse[]>(content)
  if (!Array.isArray(parsed)) return []

  const tagById = new Map(tags.map(t => [t.id, t.tag]))
  const results: AiClassification[] = []
  for (const entry of parsed) {
    const idx = entry.id - 1
    const item = items[idx]
    const tag = tagById.get(entry.tag_id)
    if (!item || !tag) continue
    const score = typeof entry.score === 'number' ? Math.max(0, Math.min(1, entry.score)) : 0
    results.push({ id: item.id, tag, score })
  }
  return results
}

/* --------------------------- 流水线主编排 --------------------------- */

const RECLASSIFY_THRESHOLD = 0.6

/**
 * 运行 AI 智能分类流水线。
 *
 * @param items 待分类的热点（通常是「未分类过」的增量条目；全量重分类时传全部）
 * @param options 配置项
 */
export async function runAiFilterPipeline(
  items: AiHotspotItem[],
  options: AiFilterPipelineOptions,
): Promise<AiFilterPipelineResult> {
  const interestsHash = await sha1(options.interestsText)
  let tags = options.cachedTags && options.cachedTags.length > 0 ? [...options.cachedTags] : []
  let tagsRebuilt = false

  // 兴趣文本变更 → 重新提取标签
  if (interestsHash !== options.cachedInterestsHash || tags.length === 0) {
    const newTags = await extractTags(options.interestsText)
    const changeRatio = computeChangeRatio(tags, newTags)
    // 标签变化大 → 全量重分类（清空 cached 隐含：调用方需传全部 items）
    // 这里仅记录；全量/增量由调用方根据返回的 tagsRebuilt + changeRatio 决定传哪些 items
    tags = newTags
    tagsRebuilt = true
    console.info(
      `[ai-filter] 兴趣变更 → 重新提取标签 ${tags.length} 个，changeRatio=${changeRatio.toFixed(2)}`,
    )
  }

  if (items.length === 0) {
    return { tags, classifications: [], tagsRebuilt, interestsHash }
  }

  // 分批分类（借鉴 TrendRadar batch_size + 间隔，这里不 sleep，靠 batchSize 控制单次体积）
  const allClassifications: AiClassification[] = []
  for (let i = 0; i < items.length; i += options.batchSize) {
    const batch = items.slice(i, i + options.batchSize)
    const batchResult = await classifyBatch(batch, tags)
    allClassifications.push(...batchResult)
  }

  const classifications = allClassifications.filter(c => c.score >= options.minScore)

  return { tags, classifications, tagsRebuilt, interestsHash }
}

/* --------------------------- 混合模式辅助 --------------------------- */

/**
 * 混合分类：先用词组 DSL（keyword，免 token）快速打标签，
 * 未命中词组且启用 AI 模式时再交给 AI 兜底。
 * 这是 LingMo 相对 TrendRadar 的增强——keyword 模式零成本覆盖大多数。
 */
export function classifyHybrid(
  text: string,
  config: InterestConfig,
): { tags: string[]; byKeyword: boolean } {
  const result = classifyByInterest(text, config)
  if (result.tags.length > 0) {
    return { tags: result.tags, byKeyword: true }
  }
  // keyword 未命中 → 标记为待 AI 分类（调用方决定是否触发 AI）
  return { tags: [], byKeyword: false }
}

/** 便捷：用当前缓存的兴趣配置做 keyword 分类 */
export function classifyWithCurrentConfig(text: string) {
  return classifyHybrid(text, getInterestConfig())
}

export { RECLASSIFY_THRESHOLD }
