import { Store } from '@tauri-apps/plugin-store'
import type { AgentRunSnapshot } from './types'

const STORE_FILE = 'agent-harness-runs.json'
const SNAPSHOTS_KEY = 'snapshots'

async function loadStore() {
  return Store.load(STORE_FILE)
}

export async function saveRunSnapshot(snapshot: AgentRunSnapshot) {
  const store = await loadStore()
  const current = await store.get<AgentRunSnapshot[]>(SNAPSHOTS_KEY) || []
  const next = [
    ...current.filter(item => item.runId !== snapshot.runId),
    { ...snapshot, updatedAt: Date.now() },
  ].slice(-100)

  await store.set(SNAPSHOTS_KEY, next)
  await store.save()
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
