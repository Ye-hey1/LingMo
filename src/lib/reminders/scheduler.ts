import {
  DEFAULT_REMINDER_SETTINGS,
  type CreateReminderInput,
  type Reminder,
  type ReminderRepeat,
  type ReminderSettings,
} from './types'
import { loadReminderSettings } from './settings'
import {
  loadReminders,
  saveReminders,
  updateReminder,
  upsertReminder,
} from './store'
import {
  cancelReminderNotification,
  scheduleReminderNotification,
  sendReminderNotification,
} from './notification'

const MAX_TIMEOUT_MS = 2_147_000_000
const SYSTEM_NOTIFICATION_SETTLE_MS = 5_000

function createReminderId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeRepeat(value?: ReminderRepeat): ReminderRepeat {
  return value === 'daily' || value === 'weekly' || value === 'monthly' ? value : 'none'
}

function calculateRemindAt(dueAt: number, advanceNoticeMinutes: number) {
  return Math.max(Date.now(), dueAt - advanceNoticeMinutes * 60 * 1000)
}

function addMonths(timestamp: number, count: number) {
  const date = new Date(timestamp)
  const originalDay = date.getDate()
  date.setMonth(date.getMonth() + count)
  if (date.getDate() < originalDay) {
    date.setDate(0)
  }
  return date.getTime()
}

function getNextDueAt(reminder: Reminder, now = Date.now()) {
  let next = reminder.dueAt
  const repeat = normalizeRepeat(reminder.repeat)
  if (repeat === 'none') return null

  while (next <= now) {
    if (repeat === 'daily') next += 24 * 60 * 60 * 1000
    if (repeat === 'weekly') next += 7 * 24 * 60 * 60 * 1000
    if (repeat === 'monthly') next = addMonths(next, 1)
  }

  return next
}

export class ReminderScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private initialized = false
  private initPromise: Promise<void> | null = null

  async init() {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.refresh().finally(() => {
      this.initialized = true
      this.initPromise = null
    })

    return this.initPromise
  }

  async refresh() {
    this.clearTimers()
    const settings = await loadReminderSettings()
    const reminders = await loadReminders()

    if (!settings.reminderEnabled) {
      await this.clearSystemNotifications(reminders)
      return
    }

    const now = Date.now()
    const nextReminders: Reminder[] = []
    const overdueReminders: Reminder[] = []

    for (const reminder of reminders) {
      if (reminder.status !== 'scheduled') {
        nextReminders.push(reminder)
        continue
      }

      if (reminder.remindAt <= now) {
        overdueReminders.push(reminder)
      } else {
        nextReminders.push(await this.activateReminder(reminder, settings))
      }
    }

    await saveReminders(nextReminders)

    for (const reminder of overdueReminders) {
      await this.fire(reminder.id, reminder, {
        notify: reminder.systemNotificationScheduled !== true,
      })
    }
  }

  async create(input: CreateReminderInput): Promise<Reminder> {
    const settings = await loadReminderSettings()
    const title = input.title.trim()
    if (!title) {
      throw new Error('提醒标题不能为空')
    }

    const dueAt = Number(input.dueAt)
    if (!Number.isFinite(dueAt)) {
      throw new Error('提醒时间无效')
    }

    const advanceNoticeMinutes = Number.isFinite(input.advanceNoticeMinutes)
      ? Math.min(1440, Math.max(0, Math.floor(Number(input.advanceNoticeMinutes))))
      : settings.reminderDefaultAdvanceMinutes
    const now = Date.now()
    const reminder: Reminder = {
      id: createReminderId(),
      title,
      message: input.message?.trim() || undefined,
      dueAt,
      remindAt: calculateRemindAt(dueAt, advanceNoticeMinutes),
      advanceNoticeMinutes,
      repeat: normalizeRepeat(input.repeat),
      status: 'scheduled',
      source: input.source,
      createdAt: now,
      updatedAt: now,
    }

    const activatedReminder = settings.reminderEnabled
      ? await this.activateReminder(reminder, settings)
      : reminder

    await upsertReminder(activatedReminder)
    return activatedReminder
  }

  async list(options: { includeCompleted?: boolean } = {}) {
    const reminders = await loadReminders()
    const filtered = options.includeCompleted
      ? reminders
      : reminders.filter(item => item.status === 'scheduled')

    return filtered.sort((a, b) => a.remindAt - b.remindAt)
  }

  async cancel(id: string) {
    this.clearTimer(id)
    const reminder = (await loadReminders()).find(item => item.id === id)
    if (reminder) {
      await cancelReminderNotification(reminder)
    }

    return updateReminder(id, reminder => ({
      ...reminder,
      status: 'cancelled',
      systemNotificationScheduled: false,
      updatedAt: Date.now(),
    }))
  }

  async complete(id: string) {
    this.clearTimer(id)
    const reminder = (await loadReminders()).find(item => item.id === id)
    if (reminder) {
      await cancelReminderNotification(reminder)
    }

    return updateReminder(id, reminder => ({
      ...reminder,
      status: 'done',
      systemNotificationScheduled: false,
      updatedAt: Date.now(),
    }))
  }

  async disable() {
    this.clearTimers()
    await this.clearSystemNotifications(await loadReminders())
    this.initialized = false
  }

  dispose() {
    this.clearTimers()
    this.initialized = false
  }

  private async activateReminder(
    reminder: Reminder,
    settings: ReminderSettings,
  ): Promise<Reminder> {
    if (reminder.status !== 'scheduled') return reminder

    const scheduleResult = await scheduleReminderNotification(reminder, settings)
    const systemNotificationScheduled = scheduleResult.scheduled
    const systemNotificationId = scheduleResult.notificationId ?? reminder.systemNotificationId
    const nextReminder: Reminder = {
      ...reminder,
      systemNotificationId,
      systemNotificationScheduled,
      updatedAt: systemNotificationScheduled !== reminder.systemNotificationScheduled
        ? Date.now()
        : reminder.updatedAt,
    }

    this.scheduleTimer(nextReminder)
    return nextReminder
  }

  private scheduleTimer(reminder: Reminder) {
    this.clearTimer(reminder.id)
    if (reminder.status !== 'scheduled') return

    const timerAt = reminder.remindAt + (
      reminder.systemNotificationScheduled ? SYSTEM_NOTIFICATION_SETTLE_MS : 0
    )
    const delay = Math.max(0, timerAt - Date.now())
    const timer = setTimeout(() => {
      if (delay >= MAX_TIMEOUT_MS) {
        void this.refresh()
      } else {
        void this.fire(reminder.id)
      }
    }, Math.min(delay, MAX_TIMEOUT_MS))

    this.timers.set(reminder.id, timer)
  }

  private async fire(
    id: string,
    providedReminder?: Reminder,
    options: { notify?: boolean } = {},
  ) {
    this.clearTimer(id)
    const reminders = await loadReminders()
    const reminder = reminders.find(item => item.id === id) || providedReminder
    if (!reminder || reminder.status !== 'scheduled') return

    const settings = await loadReminderSettings()
    const shouldNotify = options.notify ?? reminder.systemNotificationScheduled !== true
    if (shouldNotify) {
      await sendReminderNotification(reminder, settings)
    }

    const now = Date.now()
    const nextDueAt = getNextDueAt(reminder, now)

    if (nextDueAt) {
      const repeatedReminder: Reminder = {
        ...reminder,
        dueAt: nextDueAt,
        remindAt: calculateRemindAt(nextDueAt, reminder.advanceNoticeMinutes),
        systemNotificationScheduled: false,
        lastTriggeredAt: now,
        updatedAt: now,
      }
      const nextReminder = settings.reminderEnabled
        ? await this.activateReminder(repeatedReminder, settings)
        : repeatedReminder

      await upsertReminder(nextReminder)
      return
    }

    await upsertReminder({
      ...reminder,
      status: 'done',
      systemNotificationScheduled: false,
      lastTriggeredAt: now,
      updatedAt: now,
    })
  }

  private async clearSystemNotifications(reminders: Reminder[]) {
    let changed = false
    const nextReminders: Reminder[] = []

    for (const reminder of reminders) {
      if (reminder.status === 'scheduled') {
        await cancelReminderNotification(reminder)

        if (reminder.systemNotificationScheduled) {
          changed = true
          nextReminders.push({
            ...reminder,
            systemNotificationScheduled: false,
            updatedAt: Date.now(),
          })
          continue
        }
      }

      nextReminders.push(reminder)
    }

    if (changed) {
      await saveReminders(nextReminders)
    }
  }

  private clearTimer(id: string) {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
  }

  private clearTimers() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }
}

export const reminderScheduler = new ReminderScheduler()

export function formatReminderTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function getDefaultReminderSettings() {
  return DEFAULT_REMINDER_SETTINGS
}
