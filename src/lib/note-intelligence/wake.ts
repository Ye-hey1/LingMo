import { reminderScheduler } from '@/lib/reminders/scheduler'
import { loadReminders } from '@/lib/reminders/store'
import { parseReminderTimeText } from '@/lib/reminders/time-parser'
import type { NoteWakeDirective } from './types'

const WAKE_COMMENT_RE = /<!--\s*lingmo:wake\s+([^>]+)-->/gi
const WAKE_LINE_RE = /^\s*(?:- \[ \]\s*)?(?:唤醒|提醒|复查|评估|review)\s*[:：]\s*(.+)$/gim

function parseAttributes(input: string) {
  const attrs = new Map<string, string>()
  const attrRe = /(\w+)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g
  let match: RegExpExecArray | null

  while ((match = attrRe.exec(input))) {
    attrs.set(match[1], match[2] ?? match[3] ?? match[4] ?? '')
  }

  return attrs
}

function noteTitleFromPath(notePath: string) {
  return notePath.split('/').pop()?.replace(/\.md$/i, '') || notePath
}

export function extractWakeDirectives(content: string, notePath: string, now = Date.now()): NoteWakeDirective[] {
  const directives: NoteWakeDirective[] = []
  let commentMatch: RegExpExecArray | null

  while ((commentMatch = WAKE_COMMENT_RE.exec(content))) {
    const attrs = parseAttributes(commentMatch[1])
    const timeText = attrs.get('after') || attrs.get('at') || attrs.get('time') || ''
    const dueAt = parseReminderTimeText(timeText, now)
    if (!dueAt) continue

    directives.push({
      title: attrs.get('title') || `回看：${noteTitleFromPath(notePath)}`,
      reason: attrs.get('reason') || '笔记唤醒条件到期',
      timeText,
      dueAt,
    })
  }

  let lineMatch: RegExpExecArray | null
  while ((lineMatch = WAKE_LINE_RE.exec(content))) {
    const text = lineMatch[1].trim()
    const dueAt = parseReminderTimeText(text, now)
    if (!dueAt) continue

    directives.push({
      title: `回看：${noteTitleFromPath(notePath)}`,
      reason: text,
      timeText: text,
      dueAt,
    })
  }

  return directives
}

export async function syncWakeDirectivesForNote(notePath: string, content: string) {
  const directives = extractWakeDirectives(content, notePath)
  if (directives.length === 0) return []

  const existing = await loadReminders()
  const created = []

  for (const directive of directives) {
    const duplicate = existing.find(reminder =>
      reminder.status === 'scheduled'
      && reminder.source?.type === 'note'
      && reminder.source.notePath === notePath
      && Math.abs(reminder.dueAt - directive.dueAt) < 60 * 1000
      && reminder.title === directive.title
    )

    if (duplicate) continue

    const reminder = await reminderScheduler.create({
      title: directive.title,
      message: directive.reason,
      dueAt: directive.dueAt,
      source: {
        type: 'note',
        label: '笔记唤醒',
        notePath,
      },
    })
    created.push(reminder)
  }

  return created
}

export async function getDueNoteWakeups(now = Date.now()) {
  const reminders = await loadReminders()
  return reminders
    .filter(reminder =>
      reminder.source?.type === 'note'
      && reminder.status === 'scheduled'
      && reminder.remindAt <= now,
    )
    .map(reminder => ({
      id: reminder.id,
      title: reminder.title,
      message: reminder.message,
      dueAt: reminder.dueAt,
      notePath: reminder.source?.notePath,
    }))
    .sort((a, b) => a.dueAt - b.dueAt)
}
