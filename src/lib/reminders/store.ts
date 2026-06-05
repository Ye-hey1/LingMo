import { Store } from '@tauri-apps/plugin-store'
import type { Reminder } from './types'

const REMINDER_STORE_FILE = 'reminders.json'
const REMINDERS_KEY = 'reminders'

function sanitizeReminder(value: unknown): Reminder | null {
  if (!value || typeof value !== 'object') return null

  const item = value as Partial<Reminder>
  if (typeof item.id !== 'string' || !item.id.trim()) return null
  if (typeof item.title !== 'string' || !item.title.trim()) return null
  if (typeof item.dueAt !== 'number' || !Number.isFinite(item.dueAt)) return null

  const advanceNoticeMinutes = typeof item.advanceNoticeMinutes === 'number'
    ? Math.min(1440, Math.max(0, Math.floor(item.advanceNoticeMinutes)))
    : 0
  const remindAt = typeof item.remindAt === 'number' && Number.isFinite(item.remindAt)
    ? item.remindAt
    : item.dueAt - advanceNoticeMinutes * 60 * 1000

  return {
    id: item.id,
    title: item.title.trim(),
    message: typeof item.message === 'string' ? item.message : undefined,
    dueAt: item.dueAt,
    remindAt,
    advanceNoticeMinutes,
    repeat: item.repeat === 'daily' || item.repeat === 'weekly' || item.repeat === 'monthly'
      ? item.repeat
      : 'none',
    status: item.status === 'done' || item.status === 'cancelled' ? item.status : 'scheduled',
    source: item.source,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
    lastTriggeredAt: typeof item.lastTriggeredAt === 'number' ? item.lastTriggeredAt : undefined,
    systemNotificationId: typeof item.systemNotificationId === 'number' && Number.isFinite(item.systemNotificationId)
      ? item.systemNotificationId
      : undefined,
    systemNotificationScheduled: item.systemNotificationScheduled === true,
  }
}

async function loadStore() {
  return Store.load(REMINDER_STORE_FILE)
}

export async function loadReminders(): Promise<Reminder[]> {
  const store = await loadStore()
  const raw = await store.get<unknown[]>(REMINDERS_KEY)
  if (!Array.isArray(raw)) return []

  return raw
    .map(sanitizeReminder)
    .filter((item): item is Reminder => Boolean(item))
    .sort((a, b) => a.remindAt - b.remindAt)
}

export async function saveReminders(reminders: Reminder[]): Promise<void> {
  const store = await loadStore()
  await store.set(REMINDERS_KEY, reminders)
  await store.save()
}

export async function upsertReminder(reminder: Reminder): Promise<Reminder> {
  const reminders = await loadReminders()
  const next = [
    reminder,
    ...reminders.filter(item => item.id !== reminder.id),
  ].sort((a, b) => a.remindAt - b.remindAt)

  await saveReminders(next)
  return reminder
}

export async function updateReminder(
  id: string,
  updater: (reminder: Reminder) => Reminder,
): Promise<Reminder | null> {
  const reminders = await loadReminders()
  const index = reminders.findIndex(item => item.id === id)
  if (index < 0) return null

  const nextReminder = updater(reminders[index])
  reminders[index] = nextReminder
  await saveReminders(reminders.sort((a, b) => a.remindAt - b.remindAt))
  return nextReminder
}
