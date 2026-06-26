import { create } from 'zustand'
import type { AgentRunDetail, AgentRunRecord } from '@/db/agent'

interface AgentRunsState {
  runs: AgentRunRecord[]
  selectedRunId: string | null
  selectedRunDetail: AgentRunDetail | null
  loadingRuns: boolean
  loadingDetail: boolean
  error: string | null
  loadRuns: (limit?: number) => Promise<void>
  selectRun: (runId: string) => Promise<void>
  refreshSelectedRun: () => Promise<void>
  clearSelection: () => void
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export const useAgentRunsStore = create<AgentRunsState>((set, get) => ({
  runs: [],
  selectedRunId: null,
  selectedRunDetail: null,
  loadingRuns: false,
  loadingDetail: false,
  error: null,

  loadRuns: async (limit = 50) => {
    set({ loadingRuns: true, error: null })
    try {
      const { listAgentRunsFromDb } = await import('@/db/agent')
      const runs = await listAgentRunsFromDb(limit)
      const currentSelectedId = get().selectedRunId
      const nextSelectedId = currentSelectedId && runs.some(run => run.id === currentSelectedId)
        ? currentSelectedId
        : runs[0]?.id || null

      set({
        runs,
        selectedRunId: nextSelectedId,
        loadingRuns: false,
        selectedRunDetail: nextSelectedId === currentSelectedId ? get().selectedRunDetail : null,
      })

      if (nextSelectedId && nextSelectedId !== currentSelectedId) {
        await get().selectRun(nextSelectedId)
      }
    } catch (error) {
      set({ loadingRuns: false, error: getErrorMessage(error) })
    }
  },

  selectRun: async (runId: string) => {
    if (!runId) return
    set({ selectedRunId: runId, loadingDetail: true, error: null })
    try {
      const { getAgentRunDetailFromDb } = await import('@/db/agent')
      const selectedRunDetail = await getAgentRunDetailFromDb(runId)
      set({ selectedRunDetail, loadingDetail: false })
    } catch (error) {
      set({ loadingDetail: false, error: getErrorMessage(error) })
    }
  },

  refreshSelectedRun: async () => {
    await get().loadRuns()
    const selectedRunId = get().selectedRunId
    if (selectedRunId) {
      await get().selectRun(selectedRunId)
    }
  },

  clearSelection: () => {
    set({ selectedRunId: null, selectedRunDetail: null })
  },
}))
