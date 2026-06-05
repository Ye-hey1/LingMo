import { Store } from '@tauri-apps/plugin-store'
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
} from './types'

export const REMINDER_SETTING_KEYS = Object.keys(DEFAULT_REMINDER_SETTINGS) as Array<keyof ReminderSettings>

export function normalizeReminderSettings(value: Partial<ReminderSettings> = {}): ReminderSettings {
  const defaultAdvance = Number(value.reminderDefaultAdvanceMinutes)
  const titlePrefix = typeof value.reminderTitlePrefix === 'string'
    ? value.reminderTitlePrefix.trim()
    : ''

  return {
    reminderEnabled: typeof value.reminderEnabled === 'boolean'
      ? value.reminderEnabled
      : DEFAULT_REMINDER_SETTINGS.reminderEnabled,
    reminderAllowAgentCreate: typeof value.reminderAllowAgentCreate === 'boolean'
      ? value.reminderAllowAgentCreate
      : DEFAULT_REMINDER_SETTINGS.reminderAllowAgentCreate,
    reminderDefaultAdvanceMinutes: Number.isFinite(defaultAdvance)
      ? Math.min(1440, Math.max(0, Math.floor(defaultAdvance)))
      : DEFAULT_REMINDER_SETTINGS.reminderDefaultAdvanceMinutes,
    reminderShowContext: typeof value.reminderShowContext === 'boolean'
      ? value.reminderShowContext
      : DEFAULT_REMINDER_SETTINGS.reminderShowContext,
    reminderTitlePrefix: titlePrefix || DEFAULT_REMINDER_SETTINGS.reminderTitlePrefix,
  }
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const store = await Store.load('store.json')
  const settings: Partial<ReminderSettings> = {}

  for (const key of REMINDER_SETTING_KEYS) {
    const value = await store.get<ReminderSettings[typeof key]>(key)
    if (value !== undefined && value !== null) {
      ;(settings as Record<string, unknown>)[key] = value
    }
  }

  return normalizeReminderSettings(settings)
}

export async function saveReminderSetting<K extends keyof ReminderSettings>(
  key: K,
  value: ReminderSettings[K],
): Promise<ReminderSettings> {
  const store = await Store.load('store.json')
  const nextSettings = normalizeReminderSettings({ [key]: value } as Partial<ReminderSettings>)
  const normalizedValue = nextSettings[key]

  await store.set(key, normalizedValue)
  await store.save()

  return loadReminderSettings()
}

