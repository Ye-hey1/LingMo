import { extractAndStoreTopics, computeKeywordOverlapPairs, getNoteTopics } from '@/lib/topic-extractor'
import { computeCosineRelationPairs, getCosinePairsForNote } from '@/lib/similarity-cluster'
import { extractLLMRelations, type CandidatePair } from '@/lib/relation-extractor'
import {
  upsertNoteRelationsBatch,
  getRelationsForNote,
  deleteRelationsByMethod,
  getAllRelations,
  type NoteRelation,
  type RelationInput,
} from '@/db/note-relations'
import { getFileEmbeddings } from '@/db/vector'

export interface CrossValidatedRelation {
  source_note: string
  target_note: string
  final_score: number
  keyword_score: number
  cosine_score: number
  llm_score: number
  agreement_count: number
  relation_type: string
  evidence: string
}

// 权重配置
const WEIGHTS = {
  keyword: 0.35,
  cosine: 0.35,
  llm: 0.30,
}

// 阈值配置
const THRESHOLDS = {
  keyword: 0.15,
  cosine: 0.65,
  llm: 0.7,
  minAgreement: 2,
}

export interface BuildProgress {
  phase: string
  current: number
  total: number
}

// 对单篇笔记执行完整的三支柱分析
export async function buildRelationsForNote(
  filename: string,
  content: string,
  includeLLM = false,
): Promise<{
  topics: number
  keywordPairs: number
  cosinePairs: number
  llmPairs: number
  crossValidated: number
}> {
  const result = {
    topics: 0,
    keywordPairs: 0,
    cosinePairs: 0,
    llmPairs: 0,
    crossValidated: 0,
  }

  // 支柱 A: 提取关键词
  const topics = await extractAndStoreTopics(filename, content)
  result.topics = topics.length

  // 支柱 B: 余弦相似度（与所有其他文件）
  const cosinePairs = await getCosinePairsForNote(filename, 0.5)

  // 存储余弦关系
  if (cosinePairs.length > 0) {
    const relations: RelationInput[] = cosinePairs.map(pair => ({
      source_note: pair.noteA,
      target_note: pair.noteB,
      relation_type: 'related',
      confidence: pair.score,
      evidence: `余弦相似度: ${pair.score.toFixed(3)}`,
      source_method: 'cosine',
      cosine_sim_score: pair.score,
    }))
    await upsertNoteRelationsBatch(relations)
  }
  result.cosinePairs = cosinePairs.length

  // 关键词重叠（需要重新计算，因为只改了当前文件）
  const keywordPairs = await computeKeywordOverlapPairsForNote(filename)
  result.keywordPairs = keywordPairs.length

  // 交叉验证
  const crossValidated = await crossValidateForNote(filename)
  result.crossValidated = crossValidated

  // 支柱 C: LLM 分析（可选）
  if (includeLLM && crossValidated > 0) {
    const noteTopics = await getNoteTopics(filename)
    const topicKeywords = noteTopics.map(t => t.keyword)

    // 获取交叉验证的候选对
    const candidates = await buildLLMCandidates(filename, topicKeywords)

    if (candidates.length > 0) {
      const maxCandidates = Math.min(candidates.length, 10)
      const llmResults = await extractLLMRelations(candidates.slice(0, maxCandidates))
      result.llmPairs = llmResults.length

      // 重新交叉验证包含 LLM 结果
      await crossValidateForNote(filename)
    }
  }

  return result
}

// 对所有笔记执行完整分析
export async function buildAllRelations(
  onProgress?: (progress: BuildProgress) => void,
  includeLLM = false,
  maxLLMPairs = 50,
): Promise<{
  totalNotes: number
  keywordRelations: number
  cosineRelations: number
  llmRelations: number
  crossValidatedRelations: number
}> {
  // 获取所有文件嵌入（确认有哪些文件）
  const fileEmbeddings = await getFileEmbeddings()
  const allFiles = Array.from(fileEmbeddings.keys())
  const totalNotes = allFiles.length

  if (totalNotes === 0) {
    return {
      totalNotes: 0,
      keywordRelations: 0,
      cosineRelations: 0,
      llmRelations: 0,
      crossValidatedRelations: 0,
    }
  }

  // Phase 1: 关键词提取（对所有文件）
  onProgress?.({ phase: '关键词提取', current: 0, total: totalNotes })

  // 先清空旧的 keyword 和 cosine 方法的关系
  await deleteRelationsByMethod('keyword')
  await deleteRelationsByMethod('cosine')
  await deleteRelationsByMethod('cross_validated')

  // Phase 2: 计算关键词重叠对
  onProgress?.({ phase: '关键词匹配', current: 1, total: 3 })
  const keywordPairs = await computeKeywordOverlapPairs()

  // Phase 3: 计算余弦相似度对
  onProgress?.({ phase: '余弦相似度', current: 2, total: 3 })
  const cosinePairs = await computeCosineRelationPairs()

  // Phase 4: 交叉验证
  onProgress?.({ phase: '交叉验证', current: 3, total: 3 })
  const crossValidatedCount = await crossValidateAll()

  // Phase 5: LLM 分析（可选）
  let llmCount = 0
  if (includeLLM) {
    onProgress?.({ phase: 'LLM 深度分析', current: 0, total: 1 })

    // 获取交叉验证中的高分候选对
    const candidates = await getTopCrossValidatedCandidates(maxLLMPairs)

    if (candidates.length > 0) {
      const llmResults = await extractLLMRelations(
        candidates,
        (current, total) => onProgress?.({ phase: 'LLM 深度分析', current, total }),
      )
      llmCount = llmResults.length

      // 重新交叉验证
      await crossValidateAll()
    }
  }

  // 统计最终结果
  const allRelations = await getAllRelations('cross_validated')

  return {
    totalNotes,
    keywordRelations: keywordPairs.length,
    cosineRelations: cosinePairs.length,
    llmRelations: llmCount,
    crossValidatedRelations: allRelations.length,
  }
}

// 获取笔记的交叉验证关系
export async function getCrossValidatedRelations(
  filename: string,
  minConfidence = 0.3,
): Promise<CrossValidatedRelation[]> {
  const relations = await getRelationsForNote(filename)

  // 按 (source_note, target_note) 分组，合并不同方法的结果
  const grouped = new Map<string, {
    keyword_score: number
    cosine_score: number
    llm_score: number
    relation_type: string
    evidence: string
    otherNote: string
  }>()

  for (const rel of relations) {
    const otherNote = rel.source_note === filename ? rel.target_note : rel.source_note
    const key = [filename, otherNote].sort().join('->')

    if (!grouped.has(key)) {
      grouped.set(key, {
        keyword_score: 0,
        cosine_score: 0,
        llm_score: 0,
        relation_type: 'related',
        evidence: '',
        otherNote,
      })
    }

    const entry = grouped.get(key)!

    if (rel.source_method === 'keyword') entry.keyword_score = rel.confidence
    if (rel.source_method === 'cosine') entry.cosine_score = rel.confidence
    if (rel.source_method === 'llm') {
      entry.llm_score = rel.confidence
      entry.relation_type = rel.relation_type
      entry.evidence = rel.evidence || ''
    }
    if (rel.source_method === 'cross_validated') {
      entry.relation_type = rel.relation_type
      entry.evidence = rel.evidence || entry.evidence
    }
  }

  // 计算交叉验证分数
  const results: CrossValidatedRelation[] = []

  for (const [, entry] of grouped) {
    const signals = [
      entry.keyword_score >= THRESHOLDS.keyword,
      entry.cosine_score >= THRESHOLDS.cosine,
      entry.llm_score >= THRESHOLDS.llm,
    ]
    const agreementCount = signals.filter(Boolean).length

    // 至少需要 minAgreement 个方法同意（LLM 为 0 分时允许 2-of-2）
    const activeMethods = signals.filter(s => s !== false || entry.llm_score > 0).length
    const needsAgreement = entry.llm_score > 0 ? THRESHOLDS.minAgreement : 2

    if (agreementCount < needsAgreement && activeMethods < 2) continue

    const finalScore =
      WEIGHTS.keyword * entry.keyword_score +
      WEIGHTS.cosine * entry.cosine_score +
      WEIGHTS.llm * entry.llm_score

    if (finalScore < minConfidence) continue

    results.push({
      source_note: filename,
      target_note: entry.otherNote,
      final_score: finalScore,
      keyword_score: entry.keyword_score,
      cosine_score: entry.cosine_score,
      llm_score: entry.llm_score,
      agreement_count: agreementCount,
      relation_type: entry.relation_type,
      evidence: entry.evidence,
    })
  }

  return results.sort((a, b) => b.final_score - a.final_score)
}

// === 内部辅助函数 ===

// 对单篇笔记计算关键词重叠
async function computeKeywordOverlapPairsForNote(filename: string) {
  const { getAllTopics, getTopicsForNote } = await import('@/db/note-topics')
  const noteTopics = await getTopicsForNote(filename)
  if (noteTopics.length === 0) return []

  const allTopics = await getAllTopics()
  const myKeywords = new Map(noteTopics.map(t => [t.keyword, t.weight]))

  const pairs: { other: string; score: number; shared: string[] }[] = []

  // 按文件分组
  const otherTopics = new Map<string, Map<string, number>>()
  for (const topic of allTopics) {
    if (topic.filename === filename) continue
    if (!otherTopics.has(topic.filename)) {
      otherTopics.set(topic.filename, new Map())
    }
    otherTopics.get(topic.filename)!.set(topic.keyword, topic.weight)
  }

  for (const [otherFile, otherKws] of otherTopics) {
    let intersection = 0
    let union = 0
    const shared: string[] = []

    for (const [kw, weightA] of myKeywords) {
      const weightB = otherKws.get(kw)
      if (weightB !== undefined) {
        intersection += Math.min(weightA, weightB)
        shared.push(kw)
      }
      union += Math.max(weightA, weightB || 0)
    }

    for (const [kw, weightB] of otherKws) {
      if (!myKeywords.has(kw)) union += weightB
    }

    const score = union > 0 ? intersection / union : 0
    if (score >= THRESHOLDS.keyword) {
      pairs.push({ other: otherFile, score, shared })
    }
  }

  if (pairs.length > 0) {
    const relations: RelationInput[] = pairs.map(p => ({
      source_note: filename,
      target_note: p.other,
      relation_type: 'related',
      confidence: p.score,
      evidence: `共享关键词: ${p.shared.slice(0, 5).join(', ')}`,
      source_method: 'keyword',
      keyword_overlap_score: p.score,
    }))
    await upsertNoteRelationsBatch(relations)
  }

  return pairs
}

// 单篇笔记交叉验证
async function crossValidateForNote(filename: string): Promise<number> {
  const relations = await getRelationsForNote(filename)

  // 按 (noteA, noteB) 对分组
  const pairs = new Map<string, {
    keyword_score: number
    cosine_score: number
    llm_score: number
    relation_type: string
    evidence: string
    otherNote: string
  }>()

  for (const rel of relations) {
    if (rel.source_method === 'cross_validated') continue

    const otherNote = rel.source_note === filename ? rel.target_note : rel.source_note
    const key = [filename, otherNote].sort().join('->')

    if (!pairs.has(key)) {
      pairs.set(key, {
        keyword_score: 0, cosine_score: 0, llm_score: 0,
        relation_type: 'related', evidence: '', otherNote,
      })
    }

    const entry = pairs.get(key)!
    if (rel.source_method === 'keyword') entry.keyword_score = rel.confidence
    if (rel.source_method === 'cosine') entry.cosine_score = rel.confidence
    if (rel.source_method === 'llm') {
      entry.llm_score = rel.confidence
      entry.relation_type = rel.relation_type
      entry.evidence = rel.evidence || ''
    }
  }

  // 交叉验证并存储
  const validated: RelationInput[] = []

  for (const [, entry] of pairs) {
    const signals = [
      entry.keyword_score >= THRESHOLDS.keyword,
      entry.cosine_score >= THRESHOLDS.cosine,
      entry.llm_score >= THRESHOLDS.llm,
    ]
    const agreementCount = signals.filter(Boolean).length
    const hasLLM = entry.llm_score > 0
    const needsAgreement = hasLLM ? THRESHOLDS.minAgreement : 2

    if (agreementCount < needsAgreement) continue

    const finalScore =
      WEIGHTS.keyword * entry.keyword_score +
      WEIGHTS.cosine * entry.cosine_score +
      WEIGHTS.llm * entry.llm_score

    validated.push({
      source_note: filename,
      target_note: entry.otherNote,
      relation_type: entry.relation_type,
      confidence: finalScore,
      evidence: entry.evidence || `关键词:${entry.keyword_score.toFixed(2)} 余弦:${entry.cosine_score.toFixed(2)}${hasLLM ? ` LLM:${entry.llm_score.toFixed(2)}` : ''}`,
      source_method: 'cross_validated',
      keyword_overlap_score: entry.keyword_score,
      cosine_sim_score: entry.cosine_score,
      llm_confirmed: hasLLM ? 1 : 0,
    })
  }

  if (validated.length > 0) {
    await upsertNoteRelationsBatch(validated)
  }

  return validated.length
}

// 全量交叉验证
async function crossValidateAll(): Promise<number> {
  await deleteRelationsByMethod('cross_validated')

  const allRelations = await getAllRelations()
  const files = new Set<string>()
  for (const rel of allRelations) {
    files.add(rel.source_note)
    files.add(rel.target_note)
  }

  let count = 0
  for (const file of files) {
    count += await crossValidateForNote(file)
  }

  return count
}

// 构建 LLM 候选对（带笔记内容）
async function buildLLMCandidates(
  filename: string,
  topicKeywords: string[],
): Promise<CandidatePair[]> {
  const relations = await getRelationsForNote(filename)
  const candidates: CandidatePair[] = []

  // 优先选择交叉验证通过的或至少有一个方法认可的
  const seen = new Set<string>()
  const prioritizedRelations = relations.filter(r => {
    const otherNote = r.source_note === filename ? r.target_note : r.source_note
    if (seen.has(otherNote)) return false
    seen.add(otherNote)
    return r.confidence >= 0.3
  }).sort((a, b) => b.confidence - a.confidence)

  const { readWorkspaceTextFile } = await import('@/lib/file-binary')

  for (const rel of prioritizedRelations.slice(0, 15)) {
    const otherNote = rel.source_note === filename ? rel.target_note : rel.source_note

    try {
      const [contentA, contentB] = await Promise.all([
        readWorkspaceTextFile(filename),
        readWorkspaceTextFile(otherNote),
      ])

      if (!contentA || !contentB) continue

      candidates.push({
        noteA: filename,
        noteB: otherNote,
        contentA,
        contentB,
        keywordScore: rel.keyword_overlap_score || 0,
        cosineScore: rel.cosine_sim_score || 0,
      })
    } catch {
      continue
    }
  }

  return candidates
}

// 获取最高分的交叉验证候选对（用于全量 LLM 分析）
async function getTopCrossValidatedCandidates(maxPairs: number): Promise<CandidatePair[]> {
  const relations = await getAllRelations('cross_validated')

  // 按对分组
  const pairsMap = new Map<string, { noteA: string; noteB: string; score: number }>()
  for (const rel of relations) {
    const key = [rel.source_note, rel.target_note].sort().join('->')
    if (!pairsMap.has(key) || pairsMap.get(key)!.score < rel.confidence) {
      pairsMap.set(key, {
        noteA: rel.source_note,
        noteB: rel.target_note,
        score: rel.confidence,
      })
    }
  }

  // 按分数排序取前 N
  const topPairs = Array.from(pairsMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPairs)

  const { readWorkspaceTextFile } = await import('@/lib/file-binary')
  const candidates: CandidatePair[] = []

  for (const pair of topPairs) {
    try {
      const [contentA, contentB] = await Promise.all([
        readWorkspaceTextFile(pair.noteA),
        readWorkspaceTextFile(pair.noteB),
      ])

      if (!contentA || !contentB) continue

      candidates.push({
        noteA: pair.noteA,
        noteB: pair.noteB,
        contentA,
        contentB,
      })
    } catch {
      continue
    }
  }

  return candidates
}
