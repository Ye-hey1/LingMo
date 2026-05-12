import { getFileEmbeddings } from '@/db/vector'
import { upsertNoteRelationsBatch, type RelationInput } from '@/db/note-relations'

export interface CosinePair {
  noteA: string
  noteB: string
  score: number
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// 计算所有文件间的余弦相似度对
export async function computeCosineRelationPairs(
  threshold = 0.65,
): Promise<CosinePair[]> {
  const fileEmbeddings = await getFileEmbeddings()
  const entries = Array.from(fileEmbeddings.entries())

  if (entries.length < 2) return []

  const pairs: CosinePair[] = []

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [fileA, embA] = entries[i]
      const [fileB, embB] = entries[j]

      const score = cosineSimilarity(embA, embB)
      if (score >= threshold) {
        pairs.push({
          noteA: fileA,
          noteB: fileB,
          score,
        })
      }
    }
  }

  // 存入 note_relations
  if (pairs.length > 0) {
    const relations: RelationInput[] = pairs.map(pair => ({
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

  return pairs
}

// 获取指定笔记与所有其他笔记的余弦相似度
export async function getCosinePairsForNote(
  filename: string,
  threshold = 0.5,
): Promise<CosinePair[]> {
  const fileEmbeddings = await getFileEmbeddings()
  const sourceEmb = fileEmbeddings.get(filename)

  if (!sourceEmb) return []

  const pairs: CosinePair[] = []

  for (const [otherFile, otherEmb] of fileEmbeddings) {
    if (otherFile === filename) continue

    const score = cosineSimilarity(sourceEmb, otherEmb)
    if (score >= threshold) {
      pairs.push({
        noteA: filename,
        noteB: otherFile,
        score,
      })
    }
  }

  return pairs.sort((a, b) => b.score - a.score)
}
