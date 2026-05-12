import { Tool, ToolResult } from '../types'
import { getAllActivityEvents } from '@/db/activity'

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

export const getUserActivityTool: Tool = {
  name: 'get_user_activity',
  description: `Get recent user activity summary (chat/record/writing) for personalization and proactive suggestions.`,
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'days',
      type: 'number',
      description: 'Optional lookback window in days (1-30, default 7)',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Optional max number of recent entries to return (5-50, default 20)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const days = clampNumber(params.days, 1, 30, 7)
      const limit = clampNumber(params.limit, 5, 50, 20)
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

      const allEvents = await getAllActivityEvents()
      const recentEvents = allEvents
        .filter(event => event.createdAt >= cutoff)
        .sort((a, b) => b.createdAt - a.createdAt)

      const counts = {
        total: recentEvents.length,
        chat: 0,
        record: 0,
        writing: 0,
      }
      const topicCounter = new Map<string, number>()
      const hourCounter = new Map<number, number>()

      for (const event of recentEvents) {
        counts[event.source] += 1

        const topic = (event.title || '').trim().slice(0, 40)
        if (topic) {
          topicCounter.set(topic, (topicCounter.get(topic) || 0) + 1)
        }

        const hour = new Date(event.createdAt).getHours()
        hourCounter.set(hour, (hourCounter.get(hour) || 0) + 1)
      }

      const topTopics = Array.from(topicCounter.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([topic, count]) => ({ topic, count }))

      const activeHours = Array.from(hourCounter.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hour, count]) => ({ hour, label: formatHour(hour), count }))

      const recentEntries = recentEvents.slice(0, limit).map(event => ({
        id: event.id,
        source: event.source,
        title: event.title,
        description: event.description,
        createdAt: event.createdAt,
      }))

      const suggestions: string[] = []
      if (counts.writing >= counts.chat && counts.writing > 0) {
        suggestions.push('最近写作活动较多，可以建议用户将新笔记转为闪卡。')
      }
      if (counts.chat > 0) {
        suggestions.push('最近对话活跃，可以建议用户把高价值对话沉淀为笔记。')
      }
      if (counts.total === 0) {
        suggestions.push('最近无活动记录，建议先从一个小任务开始建立学习循环。')
      }

      return {
        success: true,
        data: {
          lookbackDays: days,
          counts,
          topTopics,
          activeHours,
          recentEntries,
          suggestions,
        },
        message: `最近 ${days} 天活动 ${counts.total} 条（chat ${counts.chat} / writing ${counts.writing} / record ${counts.record}）。`,
      }
    } catch (error) {
      return {
        success: false,
        error: `读取用户活动失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const activityTools: Tool[] = [
  getUserActivityTool,
]
