export type ReminderStatus = 'scheduled' | 'done' | 'cancelled'

export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly'

export type ReminderSourceType = 'agent' | 'manual' | 'note' | 'chat'

export interface ReminderSource {
  type: ReminderSourceType
  label?: string
  notePath?: string
  conversationId?: number
  chatId?: number
}

export interface Reminder {
  id: string
  title: string
  message?: string
  dueAt: number
  remindAt: number
  advanceNoticeMinutes: number
  repeat: ReminderRepeat
  status: ReminderStatus
  source?: ReminderSource
  createdAt: number
  updatedAt: number
  lastTriggeredAt?: number
  systemNotificationId?: number
  systemNotificationScheduled?: boolean
}

export interface CreateReminderInput {
  title: string
  message?: string
  dueAt: number
  advanceNoticeMinutes?: number
  repeat?: ReminderRepeat
  source?: ReminderSource
}

export interface ReminderSettings {
  reminderEnabled: boolean
  reminderAllowAgentCreate: boolean
  reminderDefaultAdvanceMinutes: number
  reminderShowContext: boolean
  reminderTitlePrefix: string
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  reminderEnabled: true,
  reminderAllowAgentCreate: true,
  reminderDefaultAdvanceMinutes: 0,
  reminderShowContext: true,
  reminderTitlePrefix: 'LingMo 提醒',
}
