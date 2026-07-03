/**
 * self-evolution-tools - Phase 1 #C 自进化闭环
 *
 * 让 agent 能查询自己的历史运行记录，从过去的决策/失败中学习。
 *
 * 数据来源：KnowledgeObject 注册表（sourceType='agent_run'）
 * 配合 agent_runs 原表（src/db/agent.ts）拿完整 snapshot。
 */

import { Tool, ToolResult } from '../types'
import { objectRegistry } from '@/lib/knowledge/object-registry'
import { getAgentRunFromDb } from '@/db/agent'

function formatToolError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

/**
 * query_agent_runs - 列出最近的 agent 运行（含本次会话之外的）
 *
 * 用途：agent 在规划复杂任务时，先看自己最近是否做过类似的事。
 */
export const queryAgentRunsTool: Tool = {
  name: 'query_agent_runs',
  description:
    'List recent agent runs to recall what was previously attempted. ' +
    'Returns id, goal, route, status, startedAt, tool call counts. ' +
    'Use this before planning complex work to learn from past attempts.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'limit',
      type: 'number',
      description: 'Max results, default 10',
      required: false,
    },
    {
      name: 'status',
      type: 'string',
      description: 'Filter by run status: running | completed | failed. Default: all.',
      required: false,
    },
    {
      name: 'routeLike',
      type: 'string',
      description: 'Substring match on route (e.g., "research", "writing")',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const limit = Math.max(1, Math.min(50, Number(params.limit) || 10))

      // 先从 KO 表查（拿 tags / status），再交叉原表拿完整记录
      const koRuns = await objectRegistry.query({
        sourceType: 'agent_run',
        limit: limit * 2, // 留 buffer 给过滤
        orderBy: 'updatedAt',
        orderDir: 'desc',
      })

      let filtered = koRuns
      if (params.status) {
        const s = String(params.status)
        filtered = filtered.filter(ko => {
          const runStatus = (ko.metadata && parseMetadata(ko.metadata).runStatus) || ''
          return runStatus === s
        })
      }
      if (params.routeLike) {
        const r = String(params.routeLike).toLowerCase()
        filtered = filtered.filter(ko => {
          const route = (ko.metadata && parseMetadata(ko.metadata).route) || ''
          return String(route).toLowerCase().includes(r)
        })
      }

      const top = filtered.slice(0, limit)
      // 交叉拿原表（更可信的 startedAt 等）
      const detailed = await Promise.all(
        top.map(async ko => {
          try {
            const record = await getAgentRunFromDb(ko.sourceId)
            return {
              runId: ko.sourceId,
              title: ko.title,
              route: record?.route ?? parseMetadata(ko.metadata).route,
              status: record?.status ?? parseMetadata(ko.metadata).runStatus,
              startedAt: record?.startedAt ?? ko.createdAt,
              endedAt: record?.endedAt ?? null,
              toolCalls: parseMetadata(ko.metadata).toolCallCount,
              failedToolCalls: parseMetadata(ko.metadata).failedToolCalls,
              tags: ko.tags ? safeParseArray(ko.tags) : [],
              goal: record?.userGoal ?? ko.title,
            }
          } catch {
            return {
              runId: ko.sourceId,
              title: ko.title,
              route: parseMetadata(ko.metadata).route,
              status: parseMetadata(ko.metadata).runStatus,
              startedAt: ko.createdAt,
              endedAt: null,
              toolCalls: null,
              failedToolCalls: null,
              tags: ko.tags ? safeParseArray(ko.tags) : [],
              goal: ko.title,
            }
          }
        }),
      )

      return {
        success: true,
        data: {
          total: detailed.length,
          runs: detailed,
          summary: `找到 ${detailed.length} 个相关历史 run`,
        },
      }
    } catch (error) {
      return { success: false, error: `查询历史 run 失败: ${formatToolError(error)}` }
    }
  },
}

/**
 * query_self_failures - 专门查最近失败的 run
 *
 * 用途：避免重复踩坑。agent 在做高风险动作前先看最近是否有类似失败。
 */
export const querySelfFailuresTool: Tool = {
  name: 'query_self_failures',
  description:
    'Find recent failed agent runs to avoid repeating the same mistakes. ' +
    'Returns failed runs with their error messages. Call this before retrying a risky action.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'limit',
      type: 'number',
      description: 'Max results, default 5',
      required: false,
    },
    {
      name: 'sinceMs',
      type: 'number',
      description: 'Only include runs updated after this timestamp (ms epoch). Default: 7 days ago.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const limit = Math.max(1, Math.min(50, Number(params.limit) || 5))
      const sinceMs = Number(params.sinceMs) || (Date.now() - 7 * 24 * 60 * 60 * 1000)

      const koFailures = await objectRegistry.query({
        sourceType: 'agent_run',
        tag: 'failed-run',
        updatedSince: sinceMs,
        limit: limit * 2,
        orderBy: 'updatedAt',
        orderDir: 'desc',
      })

      const top = koFailures.slice(0, limit)
      const detailed = await Promise.all(
        top.map(async ko => {
          const record = await getAgentRunFromDb(ko.sourceId).catch(() => null)
          return {
            runId: ko.sourceId,
            goal: record?.userGoal ?? ko.title,
            route: record?.route ?? parseMetadata(ko.metadata).route,
            error: record?.error || record?.finalAnswer || '(no error detail)',
            failedAt: record?.endedAt ?? ko.updatedAt,
            failedToolCalls: parseMetadata(ko.metadata).failedToolCalls,
          }
        }),
      )

      return {
        success: true,
        data: {
          total: detailed.length,
          failures: detailed,
          summary: `最近 7 天内有 ${detailed.length} 次失败 run`,
        },
      }
    } catch (error) {
      return { success: false, error: `查询失败历史失败: ${formatToolError(error)}` }
    }
  },
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function safeParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export const selfEvolutionTools: Tool[] = [
  queryAgentRunsTool,
  querySelfFailuresTool,
]
