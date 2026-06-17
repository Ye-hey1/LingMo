import { getAllMarkdownFiles } from '@/lib/files'
import { getAllRelations } from '@/db/note-relations'
import { upsertNoteInsight } from '@/db/note-intelligence'
import type { DelayedConnectionSuggestion } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const MIN_TIME_GAP_DAYS = 21

function noteName(path: string) {
  return path.split('/').pop()?.replace(/\.md$/i, '') || path
}

function formatTimeGap(days: number) {
  if (days >= 365) return `${Math.round(days / 365)} 年前`
  if (days >= 30) return `${Math.round(days / 30)} 个月前`
  return `${Math.round(days)} 天前`
}

export async function refreshDelayedConnections(limit = 12): Promise<DelayedConnectionSuggestion[]> {
  const [files, relations] = await Promise.all([
    getAllMarkdownFiles(true),
    getAllRelations('cross_validated'),
  ])
  const modifiedByPath = new Map(
    files.map(file => [
      file.relativePath,
      file.metadata?.modifiedAt?.getTime() || file.modifiedAt?.getTime() || 0,
    ]),
  )

  const suggestions: DelayedConnectionSuggestion[] = []

  for (const relation of relations) {
    const sourceTime = modifiedByPath.get(relation.source_note) || 0
    const targetTime = modifiedByPath.get(relation.target_note) || 0
    if (!sourceTime || !targetTime) continue

    const gapDays = Math.abs(sourceTime - targetTime) / DAY_MS
    if (gapDays < MIN_TIME_GAP_DAYS) continue

    const newerNote = sourceTime >= targetTime ? relation.source_note : relation.target_note
    const olderNote = newerNote === relation.source_note ? relation.target_note : relation.source_note
    const confidence = Math.min(1, relation.confidence + Math.min(0.18, gapDays / 1200))
    const relationLabel = relation.relation_type === 'analogous'
      ? '相似模式'
      : relation.relation_type === 'supports'
        ? '互相支撑'
        : relation.relation_type === 'contradicts'
          ? '观点张力'
          : '共同主题'

    suggestions.push({
      sourceNote: newerNote,
      targetNote: olderNote,
      title: `${noteName(newerNote)} 和 ${noteName(olderNote)} 可能在讲同一个模式`,
      summary: `这两篇笔记跨越了 ${formatTimeGap(gapDays)} 的时间距离，但关系引擎识别到 ${relationLabel}。`,
      rationale: relation.evidence || `关系类型：${relation.relation_type}，置信度 ${(relation.confidence * 100).toFixed(0)}%。`,
      confidence,
    })
  }

  const deduped = new Map<string, DelayedConnectionSuggestion>()
  for (const suggestion of suggestions.sort((a, b) => b.confidence - a.confidence)) {
    const key = [suggestion.sourceNote, suggestion.targetNote].sort().join('->')
    if (!deduped.has(key)) deduped.set(key, suggestion)
  }

  const topSuggestions = Array.from(deduped.values()).slice(0, limit)
  for (const suggestion of topSuggestions) {
    await upsertNoteInsight({
      type: 'delayed_connection',
      source_note: suggestion.sourceNote,
      target_note: suggestion.targetNote,
      title: suggestion.title,
      summary: suggestion.summary,
      rationale: suggestion.rationale,
      confidence: suggestion.confidence,
    })
  }

  return topSuggestions
}
