import {
  Schedule,
  cancel,
  isPermissionGranted,
  requestPermission,
  sendNotification,
  type Options,
} from '@tauri-apps/plugin-notification'
import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { checkIsTauri } from '@/lib/check'
import type { Reminder, ReminderSettings } from './types'

const MAX_NOTIFICATION_ID = 2_147_483_647
const REMINDER_GROUP = 'lingmo-reminders'
const MOBILE_PLATFORMS = new Set(['android', 'ios'])

interface DesktopNotificationResult {
  delivered: boolean
  backend: string
  appId?: string
}

export interface ReminderNotificationSendResult {
  delivered: boolean
  backend?: string
  error?: string
  unsupportedRuntime?: boolean
  permissionDenied?: boolean
}

function compact(value?: string, maxLength = 180) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text
}

export function getReminderNotificationId(reminderId: string): number {
  let hash = 2_166_136_261

  for (let index = 0; index < reminderId.length; index += 1) {
    hash ^= reminderId.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return ((hash >>> 0) % MAX_NOTIFICATION_ID) + 1
}

function resolveNotificationId(reminderOrId: Reminder | string | number): number {
  if (typeof reminderOrId === 'number') return reminderOrId
  if (typeof reminderOrId === 'string') return getReminderNotificationId(reminderOrId)
  return reminderOrId.systemNotificationId ?? getReminderNotificationId(reminderOrId.id)
}

function buildReminderNotificationOptions(
  reminder: Reminder,
  settings: ReminderSettings,
  notificationId?: number,
): Options {
  const prefix = compact(settings.reminderTitlePrefix, 32)
  const title = prefix ? `${prefix}: ${reminder.title}` : reminder.title
  const bodyParts = [
    compact(reminder.message, settings.reminderShowContext ? 220 : 120),
    settings.reminderShowContext && reminder.source?.label
      ? `来源: ${compact(reminder.source.label, 80)}`
      : '',
  ].filter(Boolean)

  return {
    id: notificationId,
    title,
    body: bodyParts.join('\n') || undefined,
    autoCancel: true,
    group: REMINDER_GROUP,
    extra: {
      reminderId: reminder.id,
      sourceType: reminder.source?.type,
    },
  }
}

function getTauriPlatform() {
  try {
    return platform()
  } catch {
    return undefined
  }
}

function supportsSystemScheduledNotifications() {
  const currentPlatform = getTauriPlatform()
  return currentPlatform ? MOBILE_PLATFORMS.has(currentPlatform) : false
}

async function sendDesktopNotification(options: Options): Promise<DesktopNotificationResult | null> {
  if (getTauriPlatform() !== 'windows') return null

  return invoke<DesktopNotificationResult>('send_desktop_notification', {
    title: options.title,
    body: options.body ?? null,
  })
}

async function sendImmediateNotification(options: Options): Promise<ReminderNotificationSendResult> {
  const desktopResult = await sendDesktopNotification(options)
  if (desktopResult) {
    return {
      delivered: desktopResult.delivered,
      backend: desktopResult.backend,
    }
  }

  sendNotification(options)
  return {
    delivered: true,
    backend: 'tauri-notification',
  }
}

export async function ensureReminderNotificationPermission(): Promise<boolean> {
  if (!checkIsTauri()) return false

  try {
    if (await isPermissionGranted()) return true
    return (await requestPermission()) === 'granted'
  } catch (error) {
    console.error('[ReminderNotification] permission failed:', error)
    return false
  }
}

export async function sendReminderNotification(
  reminder: Reminder,
  settings: ReminderSettings,
): Promise<boolean> {
  const result = await sendReminderNotificationWithResult(reminder, settings)
  return result.delivered
}

export async function sendReminderNotificationWithResult(
  reminder: Reminder,
  settings: ReminderSettings,
): Promise<ReminderNotificationSendResult> {
  if (!settings.reminderEnabled) {
    return { delivered: false, error: 'Reminder notifications are disabled.' }
  }

  if (!checkIsTauri()) {
    return { delivered: false, unsupportedRuntime: true }
  }

  const permitted = await ensureReminderNotificationPermission()
  if (!permitted) {
    return { delivered: false, permissionDenied: true }
  }

  try {
    return await sendImmediateNotification(buildReminderNotificationOptions(reminder, settings))
  } catch (error) {
    console.error('[ReminderNotification] send failed:', error)
    return {
      delivered: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function scheduleReminderNotification(
  reminder: Reminder,
  settings: ReminderSettings,
): Promise<{ scheduled: boolean; notificationId?: number }> {
  if (!settings.reminderEnabled || !checkIsTauri() || reminder.status !== 'scheduled') {
    return { scheduled: false }
  }

  if (!supportsSystemScheduledNotifications()) {
    return {
      scheduled: false,
      notificationId: resolveNotificationId(reminder),
    }
  }

  if (reminder.remindAt <= Date.now()) {
    return {
      scheduled: false,
      notificationId: resolveNotificationId(reminder),
    }
  }

  const permitted = await ensureReminderNotificationPermission()
  if (!permitted) {
    return {
      scheduled: false,
      notificationId: resolveNotificationId(reminder),
    }
  }

  const notificationId = resolveNotificationId(reminder)

  try {
    await cancel([notificationId])
  } catch {
    // It is fine if there was no pending system notification for this id.
  }

  try {
    sendNotification({
      ...buildReminderNotificationOptions(reminder, settings, notificationId),
      schedule: Schedule.at(new Date(reminder.remindAt), false, true),
    })

    return { scheduled: true, notificationId }
  } catch (error) {
    console.error('[ReminderNotification] schedule failed:', error)
    return { scheduled: false, notificationId }
  }
}

export async function cancelReminderNotification(reminderOrId: Reminder | string | number): Promise<boolean> {
  if (!checkIsTauri()) return false

  try {
    await cancel([resolveNotificationId(reminderOrId)])
    return true
  } catch (error) {
    console.error('[ReminderNotification] cancel failed:', error)
    return false
  }
}
