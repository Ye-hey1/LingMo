import { getAllMarkdownFiles } from '@/lib/files'
import { getNoteUsageSummary, upsertLifecycleLabel } from '@/db/note-intelligence'
import { getAllRelations } from '@/db/note-relations'
import type { NoteLifecycleKind, NoteLifecycleSuggestion } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const STALE_DAYS = 45
const OLD_DAYS = 120
const LONG_NOTE_BYTES = 4200

function lifecycleCopy(label: NoteLifecycleKind) {
  switch (label) {
    case 'island':
      return {
        reason: '长期没有访问记录，也没有明显的关系连接。',
        suggestedAction: '建议补充标签、建立连接，或归入资料归档。',
      }
    case 'extract':
      return {
        reason: '内容较长，近期使用较少，适合提炼成更短的常青摘要。',
        suggestedAction: '建议提炼为摘要、原则或决策记录。',
      }
    case 'archive':
      return {
        reason: '长期未使用，且没有被关系图谱或活动记录重新激活。',
        suggestedAction: '建议归档，保留原文但从日常视野中移出。',
      }
    case 'sleeping':
      return {
        reason: '这篇笔记一段时间没有出现，但仍有关系连接。',
        suggestedAction: '建议在回顾中重读，判断是否需要更新。',
      }
    default:
      return {
        reason: '近期仍有访问或编辑活动。',
        suggestedAction: '保持当前状态。',
      }
  }
}

export async function refreshLifecycleSuggestions(limit = 30): Promise<NoteLifecycleSuggestion[]> {
  const files = await getAllMarkdownFiles(true)
  const markdownFiles = files.filter(file => file.relativePath.endsWith('.md'))
  const paths = markdownFiles.map(file => file.relativePath)
  const usage = await getNoteUsageSummary(paths)
  const relations = await getAllRelations('cross_validated')
  const relationCounts = new Map<string, number>()

  for (const relation of relations) {
    relationCounts.set(relation.source_note, (relationCounts.get(relation.source_note) || 0) + 1)
    relationCounts.set(relation.target_note, (relationCounts.get(relation.target_note) || 0) + 1)
  }

  const now = Date.now()
  const suggestions: NoteLifecycleSuggestion[] = []

  for (const file of markdownFiles) {
    const modifiedAt = file.metadata?.modifiedAt?.getTime() || file.modifiedAt?.getTime() || 0
    const lastUsedAt = usage.get(file.relativePath)?.lastUsedAt || modifiedAt
    const daysSinceUse = lastUsedAt ? (now - lastUsedAt) / DAY_MS : OLD_DAYS
    const relationCount = relationCounts.get(file.relativePath) || 0
    const size = file.metadata?.size || 0

    let label: NoteLifecycleKind = 'active'
    let score = 0

    if (daysSinceUse >= OLD_DAYS && relationCount === 0) {
      label = 'archive'
      score = Math.min(1, 0.55 + daysSinceUse / 365)
    } else if (daysSinceUse >= STALE_DAYS && relationCount === 0) {
      label = 'island'
      score = Math.min(1, 0.45 + daysSinceUse / 180)
    } else if (daysSinceUse >= STALE_DAYS && size >= LONG_NOTE_BYTES) {
      label = 'extract'
      score = Math.min(1, 0.42 + size / 18000 + daysSinceUse / 365)
    } else if (daysSinceUse >= STALE_DAYS && relationCount > 0) {
      label = 'sleeping'
      score = Math.min(1, 0.38 + relationCount / 20 + daysSinceUse / 365)
    }

    if (label === 'active') continue

    const copy = lifecycleCopy(label)
    const suggestion: NoteLifecycleSuggestion = {
      notePath: file.relativePath,
      label,
      score,
      reason: copy.reason,
      suggestedAction: copy.suggestedAction,
      modifiedAt,
      lastUsedAt,
    }
    suggestions.push(suggestion)
  }

  suggestions.sort((a, b) => b.score - a.score)
  const topSuggestions = suggestions.slice(0, limit)

  for (const suggestion of topSuggestions) {
    await upsertLifecycleLabel({
      note_path: suggestion.notePath,
      label: suggestion.label,
      score: suggestion.score,
      reason: suggestion.reason,
      suggested_action: suggestion.suggestedAction,
    })
  }

  return topSuggestions
}
