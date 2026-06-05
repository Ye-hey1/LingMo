import { Tool, ToolResult } from '../types'
import { loadReminderSettings } from '@/lib/reminders/settings'
import { formatReminderTime, reminderScheduler } from '@/lib/reminders/scheduler'
import { parseReminderTimeText } from '@/lib/reminders/time-parser'
import type { Reminder, ReminderRepeat } from '@/lib/reminders/types'

const REPEAT_VALUES: ReminderRepeat[] = ['none', 'daily', 'weekly', 'monthly']

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeRepeat(value: unknown): ReminderRepeat {
  return REPEAT_VALUES.includes(value as ReminderRepeat) ? (value as ReminderRepeat) : 'none'
}

function normalizeTimestamp(value: unknown): number | undefined {
  const asNumber = normalizeNumber(value)
  if (asNumber !== undefined) {
    return asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber
  }

  const text = normalizeText(value)
  if (!text) return undefined

  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

function resolveDueAt(params: Record<string, any>, userInput?: string) {
  const delayMinutes = normalizeNumber(params.delayMinutes)
  if (delayMinutes !== undefined) {
    return Date.now() + Math.max(0, delayMinutes) * 60 * 1000
  }

  return (
    normalizeTimestamp(params.dueAt) ??
    parseReminderTimeText(normalizeText(params.timeText)) ??
    parseReminderTimeText(userInput)
  )
}

function formatReminderSummary(reminder: Reminder) {
  const dueLabel = formatReminderTime(reminder.dueAt)
  const remindLabel = formatReminderTime(reminder.remindAt)
  const advance = reminder.advanceNoticeMinutes > 0
    ? `，提前 ${reminder.advanceNoticeMinutes} 分钟通知`
    : ''
  const repeat = reminder.repeat === 'none' ? '' : `，重复：${reminder.repeat}`

  return `${reminder.title}：${dueLabel} 到期，${remindLabel} 提醒${advance}${repeat}`
}

export const createReminderTool: Tool = {
  name: 'create_reminder',
  description: `Create a local desktop reminder in LingMo. Use this when the user asks to remind them, notify them later, set a timer, or create a reminder/todo notification. Prefer delayMinutes for clear relative time such as "30 minutes later"; use dueAt for absolute date/time; pass timeText when the original time phrase is easier or ambiguous.`,
  category: 'system',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  parameters: [
    {
      name: 'title',
      type: 'string',
      description: 'Short reminder title, e.g. "休息一下" or "喝水"',
      required: true,
    },
    {
      name: 'delayMinutes',
      type: 'number',
      description: 'Relative delay in minutes. Use for requests like "30 分钟后提醒我".',
      required: false,
    },
    {
      name: 'dueAt',
      type: 'string',
      description: 'Absolute due time as ISO/local date string or timestamp. Use only when delayMinutes is not provided.',
      required: false,
    },
    {
      name: 'timeText',
      type: 'string',
      description: 'Original natural-language time phrase, e.g. "半小时后", "明天上午九点", or "tomorrow at 3pm".',
      required: false,
    },
    {
      name: 'message',
      type: 'string',
      description: 'Optional notification detail or context.',
      required: false,
    },
    {
      name: 'advanceNoticeMinutes',
      type: 'number',
      description: 'Optional minutes to notify before dueAt. Defaults to the user setting.',
      required: false,
    },
    {
      name: 'repeat',
      type: 'string',
      description: 'Repeat mode: none, daily, weekly, monthly. Defaults to none.',
      required: false,
    },
    {
      name: 'sourceLabel',
      type: 'string',
      description: 'Optional user-visible source label for the reminder context.',
      required: false,
    },
  ],
  execute: async (params, context): Promise<ToolResult> => {
    try {
      const settings = await loadReminderSettings()
      if (!settings.reminderAllowAgentCreate) {
        return {
          success: false,
          error: '设置中已关闭 AI 创建提醒。请到 设置 > 提醒 中开启“允许 AI 创建提醒”。',
        }
      }

      const title = normalizeText(params.title)
      if (!title) {
        return {
          success: false,
          error: '提醒标题不能为空',
        }
      }

      const dueAt = resolveDueAt(params, context?.userInput)
      if (dueAt === undefined) {
        return {
          success: false,
          error: '缺少有效提醒时间。请提供 delayMinutes、dueAt 或 timeText。',
        }
      }

      const reminder = await reminderScheduler.create({
        title,
        message: normalizeText(params.message) || undefined,
        dueAt,
        advanceNoticeMinutes: normalizeNumber(params.advanceNoticeMinutes),
        repeat: normalizeRepeat(params.repeat),
        source: {
          type: 'agent',
          label: normalizeText(params.sourceLabel) || context?.userInput?.slice(0, 80) || 'AI 对话',
        },
      })

      const disabledNote = settings.reminderEnabled ? '' : '（桌面提醒当前关闭，已保存但不会弹出系统通知）'
      return {
        success: true,
        data: reminder,
        message: `已创建提醒：${formatReminderSummary(reminder)}${disabledNote}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建提醒失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const listRemindersTool: Tool = {
  name: 'list_reminders',
  description: 'List LingMo reminders. Use this when the user asks what reminders are scheduled.',
  category: 'system',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  parameters: [
    {
      name: 'includeCompleted',
      type: 'boolean',
      description: 'Whether to include completed and cancelled reminders. Defaults to false.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const reminders = await reminderScheduler.list({
        includeCompleted: params.includeCompleted === true,
      })
      const lines = reminders.slice(0, 20).map((reminder, index) =>
        `${index + 1}. ${formatReminderSummary(reminder)}（ID: ${reminder.id}）`
      )

      return {
        success: true,
        data: reminders,
        message: lines.length > 0
          ? `当前提醒：\n${lines.join('\n')}`
          : '当前没有待触发提醒。',
      }
    } catch (error) {
      return {
        success: false,
        error: `读取提醒失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const cancelReminderTool: Tool = {
  name: 'cancel_reminder',
  description: 'Cancel a scheduled LingMo reminder by ID.',
  category: 'system',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: 'Reminder ID returned by create_reminder or list_reminders.',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const id = normalizeText(params.id)
      if (!id) {
        return { success: false, error: '缺少提醒 ID' }
      }

      const reminder = await reminderScheduler.cancel(id)
      if (!reminder) {
        return { success: false, error: `未找到提醒：${id}` }
      }

      return {
        success: true,
        data: reminder,
        message: `已取消提醒：${reminder.title}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `取消提醒失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const completeReminderTool: Tool = {
  name: 'complete_reminder',
  description: 'Mark a LingMo reminder as completed by ID.',
  category: 'system',
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: 'Reminder ID returned by create_reminder or list_reminders.',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const id = normalizeText(params.id)
      if (!id) {
        return { success: false, error: '缺少提醒 ID' }
      }

      const reminder = await reminderScheduler.complete(id)
      if (!reminder) {
        return { success: false, error: `未找到提醒：${id}` }
      }

      return {
        success: true,
        data: reminder,
        message: `已完成提醒：${reminder.title}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `完成提醒失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const reminderTools: Tool[] = [
  createReminderTool,
  listRemindersTool,
  cancelReminderTool,
  completeReminderTool,
]
