import { Store } from '@tauri-apps/plugin-store'
import type { AgentRunSnapshot } from './types'
import type { AgentRunPersistenceInput } from '@/db/agent'

const STORE_FILE = 'agent-harness-runs.json'
const SNAPSHOTS_KEY = 'snapshots'

async function loadStore() {
  return Store.load(STORE_FILE)
}

export async function saveRunSnapshot(
  snapshot: AgentRunSnapshot,
  input: AgentRunPersistenceInput = {},
) {
  const store = await loadStore()
  const current = await store.get<AgentRunSnapshot[]>(SNAPSHOTS_KEY) || []
  const persistedSnapshot = { ...snapshot, updatedAt: Date.now() }
  const next = [
    ...current.filter(item => item.runId !== snapshot.runId),
    persistedSnapshot,
  ].slice(-100)

  await store.set(SNAPSHOTS_KEY, next)
  await store.save()

  try {
    const { upsertAgentRunFromSnapshot } = await import('@/db/agent')
    await upsertAgentRunFromSnapshot(persistedSnapshot, input)
  } catch (error) {
    console.warn('[AgentRunSnapshot] Failed to mirror snapshot to SQLite:', error)
  }

  // Phase 1 #C 自进化闭环：把 agent_run 同步到 KnowledgeObject 注册表
  // 不阻塞主流程，错误只记录
  try {
    const { registerAgentRunAsKnowledgeObject } = await import('@/lib/knowledge/run-knowledge-bridge')
    await registerAgentRunAsKnowledgeObject(persistedSnapshot)
  } catch (error) {
    console.warn('[AgentRunSnapshot] Failed to register as KnowledgeObject:', error)
  }
}

export async function loadRunSnapshot(runId: string) {
  const store = await loadStore()
  const current = await store.get<AgentRunSnapshot[]>(SNAPSHOTS_KEY) || []
  return current.find(item => item.runId === runId) || null
}

export async function listRunSnapshots() {
  const store = await loadStore()
  return (await store.get<AgentRunSnapshot[]>(SNAPSHOTS_KEY) || [])
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
