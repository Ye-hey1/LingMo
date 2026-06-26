/**
 * run-knowledge-bridge - Phase 1 #C 自进化闭环
 *
 * 把 agent_run 同步到 KnowledgeObject 注册表，让 agent 能跨类型查询自己的历史。
 *
 * 触发点：run-snapshot-store.ts 在 upsertAgentRunFromSnapshot 成功后调用本模块。
 * 不阻塞主流程，错误只记录。
 */

import { objectRegistry } from './object-registry'
import type { AgentRunSnapshot } from '@/lib/agent-harness/types'

function deriveTagsFromSnapshot(snapshot: AgentRunSnapshot): string[] {
  const tags = new Set<string>()
  if (snapshot.route) tags.add(`route:${snapshot.route}`)
  if (snapshot.status) tags.add(`status:${snapshot.status}`)
  // 失败的 run 单独打标，便于 query_self_failures 查询
  if (snapshot.status === 'failed') tags.add('failed-run')
  return Array.from(tags).slice(0, 12)
}

function deriveTitle(snapshot: AgentRunSnapshot): string {
  const goal = (snapshot.userGoal || '').trim()
  if (goal) return goal.length > 120 ? `${goal.slice(0, 120)}...` : goal
  return `Agent Run ${snapshot.runId}`
}

/**
 * 把 agent_run snapshot 注册到 KO 表。
 * 调用方负责先完成 agent_runs 原表的 upsert。
 */
export async function registerAgentRunAsKnowledgeObject(
  snapshot: AgentRunSnapshot,
  options: { origin?: 'manual' | 'agent_generated' | 'capture' | 'synced' | 'imported' } = {},
): Promise<void> {
  const status = snapshot.status === 'completed'
    ? 'active'
    : snapshot.status === 'failed'
      ? 'inbox'
      : 'active'

  await objectRegistry.register({
    sourceType: 'agent_run',
    sourceId: snapshot.runId,
    title: deriveTitle(snapshot),
    tags: deriveTagsFromSnapshot(snapshot),
    origin: options.origin ?? 'agent_generated',
    status,
    sourceRunId: snapshot.runId,
    metadata: {
      route: snapshot.route,
      runStatus: snapshot.status,
      startedAt: snapshot.metrics?.startedAt ?? snapshot.updatedAt,
      toolCallCount: snapshot.metrics?.toolCalls ?? null,
      failedToolCalls: snapshot.metrics?.failedToolCalls ?? null,
      modelRequests: snapshot.metrics?.modelRequests ?? null,
      durationMs: snapshot.metrics?.durationMs ?? null,
    },
  })
}
