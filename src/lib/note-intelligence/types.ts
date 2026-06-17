export type NoteLifecycleKind = 'active' | 'sleeping' | 'island' | 'extract' | 'archive'

export interface NoteLifecycleSuggestion {
  notePath: string
  label: NoteLifecycleKind
  score: number
  reason: string
  suggestedAction: string
  modifiedAt?: number
  lastUsedAt?: number
}

export interface DelayedConnectionSuggestion {
  sourceNote: string
  targetNote: string
  title: string
  summary: string
  rationale: string
  confidence: number
}

export interface CounterpointResult {
  notePath: string
  title: string
  markdown: string
}

export interface NoteWakeDirective {
  title: string
  reason: string
  timeText: string
  dueAt: number
}

export interface TodayNoteIntelligence {
  wakeups: Array<{
    id: string
    title: string
    message?: string
    dueAt: number
    notePath?: string
  }>
  connections: DelayedConnectionSuggestion[]
  lifecycle: NoteLifecycleSuggestion[]
}
