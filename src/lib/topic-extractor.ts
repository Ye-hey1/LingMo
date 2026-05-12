import { invoke } from '@tauri-apps/api/core'
import {
  upsertNoteTopics,
  getAllTopics,
  type TopicInput,
  type NoteTopic,
} from '@/db/note-topics'
import { upsertNoteRelationsBatch, type RelationInput } from '@/db/note-relations'

interface KeywordResult {
  text: string
  weight: number
}

interface OverlapPair {
  noteA: string
  noteB: string
  score: number
  sharedKeywords: string[]
}

// 从笔记内容中提取关键词并存储（带重试，容忍 database locked）
export async function extractAndStoreTopics(
  filename: string,
  content: string,
  topK = 20,
): Promise<TopicInput[]> {
  if (!content || content.trim().length === 0) return []

  try {
    const keywords = await invoke<KeywordResult[]>('rank_keywords', {
      text: content,
      topK,
    })

    const topics: TopicInput[] = keywords.map(kw => ({
      keyword: kw.text,
      weight: kw.weight,
    }))

    // 带重试的写入（database locked 时等待后重试）
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await upsertNoteTopics(filename, topics, 'textrank')
        return topics
      } catch (err) {
        lastError = err
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('locked') || msg.includes('busy')) {
          // 等待后重试（指数退避：500ms, 1500ms, 3500ms）
          await new Promise(r => setTimeout(r, 500 + attempt * 1000))
          continue
        }
        throw err // 非锁定错误直接抛出
      }
    }
    // 3 次重试都失败，静默忽略（主题提取是非关键任务）
    console.warn('[TopicExtractor] Gave up after 3 retries:', lastError)
    return topics
  } catch (error) {
    // 静默处理，不再用 console.error 触发错误边界
    console.warn('[TopicExtractor] Skipped:', error instanceof Error ? error.message : String(error))
    return []
  }
}

// 计算所有笔记间的关键词重叠对
export async function computeKeywordOverlapPairs(
  threshold = 0.15,
): Promise<OverlapPair[]> {
  const allTopics = await getAllTopics()

  // 按文件分组关键词
  const topicsByFile = new Map<string, Map<string, number>>()
  for (const topic of allTopics) {
    if (!topicsByFile.has(topic.filename)) {
      topicsByFile.set(topic.filename, new Map())
    }
    topicsByFile.get(topic.filename)!.set(topic.keyword, topic.weight)
  }

  const filenames = Array.from(topicsByFile.keys())
  const pairs: OverlapPair[] = []

  // 两两计算加权 Jaccard 相似度
  for (let i = 0; i < filenames.length; i++) {
    for (let j = i + 1; j < filenames.length; j++) {
      const fileA = filenames[i]
      const fileB = filenames[j]
      const topicsA = topicsByFile.get(fileA)!
      const topicsB = topicsByFile.get(fileB)!

      // 计算交集和并集
      let intersection = 0
      let union = 0
      const sharedKeywords: string[] = []

      // A 中的关键词
      for (const [keyword, weightA] of topicsA) {
        const weightB = topicsB.get(keyword)
        if (weightB !== undefined) {
          // 交集：取较小权重
          intersection += Math.min(weightA, weightB)
          sharedKeywords.push(keyword)
        }
        // 并集：取较大权重（A 部分）
        union += Math.max(weightA, weightB || 0)
      }

      // B 中独有的关键词（A 中没有的）
      for (const [keyword, weightB] of topicsB) {
        if (!topicsA.has(keyword)) {
          union += weightB
        }
      }

      const score = union > 0 ? intersection / union : 0

      if (score >= threshold) {
        pairs.push({
          noteA: fileA,
          noteB: fileB,
          score,
          sharedKeywords,
        })
      }
    }
  }

  // 将重叠对存入 note_relations
  if (pairs.length > 0) {
    const relations: RelationInput[] = pairs.map(pair => ({
      source_note: pair.noteA,
      target_note: pair.noteB,
      relation_type: 'related',
      confidence: pair.score,
      evidence: `共享关键词: ${pair.sharedKeywords.slice(0, 5).join(', ')}`,
      source_method: 'keyword',
      keyword_overlap_score: pair.score,
    }))

    await upsertNoteRelationsBatch(relations)
  }

  return pairs
}

// 获取指定笔记的关键词主题
export async function getNoteTopics(filename: string): Promise<NoteTopic[]> {
  const { getTopicsForNote } = await import('@/db/note-topics')
  return getTopicsForNote(filename)
}
