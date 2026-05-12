import { Store } from '@tauri-apps/plugin-store'
import type { AiConfig } from '@/app/core/setting/config'
import { invokeAiJson } from '@/lib/ai/tauri-client'
import { upsertNoteRelationsBatch, type RelationInput } from '@/db/note-relations'

export interface LLMRelationResult {
  related: boolean
  relation_type: string
  confidence: number
  evidence: string
}

export interface CandidatePair {
  noteA: string
  noteB: string
  contentA: string
  contentB: string
  keywordScore?: number
  cosineScore?: number
}

const RELATION_TYPES = [
  'extends',      // 延伸
  'references',   // 引用
  'contradicts',  // 反驳
  'supports',     // 支撑
  'analogous',    // 类比
  'example_of',   // 示例
  'related',      // 相关
] as const

// 获取当前 AI 模型配置
async function getAIConfig() {
  const store = await Store.load('store.json')
  const currentModel = await store.get<string>('aiModel')
  if (!currentModel) return null

  const aiModelList = await store.get<AiConfig[]>('aiModelList')
  if (!aiModelList) return null

  for (const config of aiModelList) {
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(
        model => model.id === currentModel && model.modelType === 'chat',
      )
      if (targetModel) {
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
        }
      }
    } else {
      if (config.key === currentModel && config.modelType === 'chat') {
        return config
      }
    }
  }

  return null
}

// 构建关系分析提示词
function buildRelationPrompt(contentA: string, contentB: string): string {
  return `你是一个知识管理助手。请分析以下两篇笔记的主题关系。

笔记A:
${contentA}

笔记B:
${contentB}

请以严格的JSON格式返回分析结果（不要包含其他文字）:
{
  "related": true或false,
  "relation_type": "${RELATION_TYPES.join('|')}",
  "confidence": 0.0到1.0的数值,
  "evidence": "一句话说明两篇笔记的关联原因"
}

关系类型说明:
- extends: A是B的深入探讨或延伸
- references: A引用了B的观点或内容
- contradicts: A与B观点相反
- supports: A为B提供证据或支撑
- analogous: A与B结构相似可类比
- example_of: A是B的具体案例
- related: 主题相关但无上述具体关系

请根据笔记的核心主题内容判断关系，不要因为表面用词相似就判定为相关。`
}

// 解析 LLM 返回的 JSON
function parseRelationResponse(text: string): LLMRelationResult | null {
  try {
    // 尝试直接解析
    const json = JSON.parse(text)
    if (json.related !== undefined) return json as LLMRelationResult

    // 尝试从 markdown 代码块中提取
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (codeBlockMatch) {
      const parsed = JSON.parse(codeBlockMatch[1])
      if (parsed.related !== undefined) return parsed as LLMRelationResult
    }

    return null
  } catch {
    // 尝试提取 JSON 对象
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as LLMRelationResult
      } catch {
        return null
      }
    }
    return null
  }
}

// 对单对笔记执行 LLM 关系分析
async function analyzePair(
  config: NonNullable<Awaited<ReturnType<typeof getAIConfig>>>,
  pair: CandidatePair,
): Promise<LLMRelationResult | null> {
  const prompt = buildRelationPrompt(
    pair.contentA.slice(0, 1500),
    pair.contentB.slice(0, 1500),
  )

  try {
    const response = await invokeAiJson<any>({
      config: {
        baseUrl: config.baseURL || '',
        apiKey: config.apiKey || undefined,
        customHeaders: config.customHeaders,
      },
      path: '/chat/completions',
      method: 'POST',
      body: {
        model: config.model,
        messages: [
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 300,
      },
    })

    const content = response?.choices?.[0]?.message?.content
    if (!content) return null

    return parseRelationResponse(content)
  } catch (error) {
    console.error('[RelationExtractor] LLM analysis failed for pair:', pair.noteA, pair.noteB, error)
    return null
  }
}

// 对候选笔记对批量执行 LLM 关系分析
export async function extractLLMRelations(
  pairs: CandidatePair[],
  onProgress?: (current: number, total: number) => void,
): Promise<LLMRelationResult[]> {
  const config = await getAIConfig()
  if (!config) {
    console.warn('[RelationExtractor] No AI chat model configured, skipping LLM analysis')
    return []
  }

  const results: LLMRelationResult[] = []
  const relations: RelationInput[] = []

  for (let i = 0; i < pairs.length; i++) {
    if (onProgress) onProgress(i + 1, pairs.length)

    const pair = pairs[i]
    const result = await analyzePair(config, pair)

    if (result && result.related && result.confidence >= 0.7) {
      results.push(result)
      relations.push({
        source_note: pair.noteA,
        target_note: pair.noteB,
        relation_type: result.relation_type || 'related',
        confidence: result.confidence,
        evidence: result.evidence,
        source_method: 'llm',
        keyword_overlap_score: pair.keywordScore || 0,
        cosine_sim_score: pair.cosineScore || 0,
        llm_confirmed: 1,
      })
    }
  }

  // 批量存储
  if (relations.length > 0) {
    await upsertNoteRelationsBatch(relations)
  }

  return results
}
