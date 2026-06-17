import { getLifecycleLabels } from '@/db/note-intelligence'
import { refreshDelayedConnections } from './connections'
import { refreshLifecycleSuggestions } from './lifecycle'
import { getDueNoteWakeups } from './wake'
import type { NoteLifecycleSuggestion, TodayNoteIntelligence } from './types'

function mapLifecycleRows(rows: Awaited<ReturnType<typeof getLifecycleLabels>>): NoteLifecycleSuggestion[] {
  return rows.map(row => ({
    notePath: row.note_path,
    label: row.label as NoteLifecycleSuggestion['label'],
    score: row.score,
    reason: row.reason,
    suggestedAction: row.suggested_action,
    lastUsedAt: row.updated_at,
  }))
}

export async function loadTodayNoteIntelligence(options: { refresh?: boolean } = {}): Promise<TodayNoteIntelligence> {
  const [wakeups, connections, lifecycle] = await Promise.all([
    getDueNoteWakeups(),
    options.refresh ? refreshDelayedConnections(8) : refreshDelayedConnections(8),
    options.refresh
      ? refreshLifecycleSuggestions(12)
      : getLifecycleLabels(12).then(mapLifecycleRows),
  ])

  return {
    wakeups,
    connections,
    lifecycle,
  }
}

export { refreshDelayedConnections } from './connections'
export { refreshLifecycleSuggestions } from './lifecycle'
export { generateCounterpointForNote, appendCounterpointToContent } from './counterpoint'
export { extractWakeDirectives, syncWakeDirectivesForNote, getDueNoteWakeups } from './wake'
export type {
  CounterpointResult,
  DelayedConnectionSuggestion,
  NoteLifecycleSuggestion,
  NoteWakeDirective,
  TodayNoteIntelligence,
} from './types'
