import { Store } from '@tauri-apps/plugin-store'

export interface ActivityGoalSettings {
  record: number
  writing: number
  conversation: number
}

export interface ActivityGoalProgressItem {
  key: keyof ActivityGoalSettings
  label: string
  target: number
  current: number
  percent: number
  completed: boolean
}

const STORE_PATH = 'store.json'
const STORE_KEY = 'activityGoalSettings'

export const DEFAULT_ACTIVITY_GOALS: ActivityGoalSettings = {
  record: 3,
  writing: 1,
  conversation: 2,
}

export async function loadActivityGoalSettings(): Promise<ActivityGoalSettings> {
  try {
    const store = await Store.load(STORE_PATH)
    const saved = await store.get<Partial<ActivityGoalSettings>>(STORE_KEY)
    return {
      record: Number(saved?.record) > 0 ? Number(saved?.record) : DEFAULT_ACTIVITY_GOALS.record,
      writing: Number(saved?.writing) > 0 ? Number(saved?.writing) : DEFAULT_ACTIVITY_GOALS.writing,
      conversation: Number(saved?.conversation) > 0 ? Number(saved?.conversation) : DEFAULT_ACTIVITY_GOALS.conversation,
    }
  } catch (error) {
    console.error('Failed to load activity goal settings:', error)
    return DEFAULT_ACTIVITY_GOALS
  }
}

export async function saveActivityGoalSettings(settings: ActivityGoalSettings) {
  const store = await Store.load(STORE_PATH)
  await store.set(STORE_KEY, settings)
  await store.save()
}

export function buildActivityGoalProgress(
  settings: ActivityGoalSettings,
  current: ActivityGoalSettings,
): ActivityGoalProgressItem[] {
  return [
    {
      key: 'record',
      label: '记录',
      target: settings.record,
      current: current.record,
      percent: settings.record > 0 ? Math.min(100, Math.round((current.record / settings.record) * 100)) : 100,
      completed: current.record >= settings.record,
    },
    {
      key: 'writing',
      label: '写作',
      target: settings.writing,
      current: current.writing,
      percent: settings.writing > 0 ? Math.min(100, Math.round((current.writing / settings.writing) * 100)) : 100,
      completed: current.writing >= settings.writing,
    },
    {
      key: 'conversation',
      label: '有效对话',
      target: settings.conversation,
      current: current.conversation,
      percent: settings.conversation > 0 ? Math.min(100, Math.round((current.conversation / settings.conversation) * 100)) : 100,
      completed: current.conversation >= settings.conversation,
    },
  ]
}

export function buildActivityGoalReminder(progress: ActivityGoalProgressItem[], now = new Date()) {
  const hour = now.getHours()
  const pending = progress.filter((item) => !item.completed)

  if (!pending.length) {
    return '今日目标已完成，可以顺手做一次回顾沉淀。'
  }

  if (hour < 12) {
    return `今天还有 ${pending.length} 项目标待完成，节奏正常。`
  }

  if (hour < 18) {
    const item = pending[0]
    return `${item.label} 目标还差 ${Math.max(0, item.target - item.current)}，下午可以继续补一段。`
  }

  const item = pending[0]
  return `今天的 ${item.label} 目标还差 ${Math.max(0, item.target - item.current)}，建议先补齐再做回顾。`
}
