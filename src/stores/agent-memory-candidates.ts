import { create } from 'zustand'
import type {
  AgentMemoryCandidateRecord,
  AgentMemoryCandidateStatus,
} from '@/db/agent'

interface AgentMemoryCandidatesState {
  candidates: AgentMemoryCandidateRecord[]
  loading: boolean
  generating: boolean
  clearing: boolean
  reviewingIds: string[]
  error: string | null
  lastGeneratedAt: number | null
  lastGeneratedCount: number
  inspectedRunCount: number
  loadCandidates: (status?: AgentMemoryCandidateStatus | 'all') => Promise<void>
  generateCandidates: (limit?: number) => Promise<void>
  approveCandidate: (id: string) => Promise<void>
  rejectCandidate: (id: string, note?: string) => Promise<void>
  clearPendingCandidates: () => Promise<number>
  clearError: () => void
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function addReviewingId(ids: string[], id: string) {
  return ids.includes(id) ? ids : [...ids, id]
}

function removeReviewingId(ids: string[], id: string) {
  return ids.filter(item => item !== id)
}

export const useAgentMemoryCandidatesStore = create<AgentMemoryCandidatesState>((set, get) => ({
  candidates: [],
  loading: false,
  generating: false,
  clearing: false,
  reviewingIds: [],
  error: null,
  lastGeneratedAt: null,
  lastGeneratedCount: 0,
  inspectedRunCount: 0,

  loadCandidates: async (status = 'pending') => {
    set({ loading: true, error: null })
    try {
      const { listAgentMemoryCandidates } = await import('@/lib/agent/memory-candidates')
      const candidates = await listAgentMemoryCandidates({ status, limit: 120 })
      set({ candidates, loading: false })
    } catch (error) {
      set({ loading: false, error: getErrorMessage(error) })
    }
  },

  generateCandidates: async (limit = 40) => {
    set({ generating: true, error: null })
    try {
      const { generateAgentMemoryCandidates } = await import('@/lib/agent/memory-candidates')
      const result = await generateAgentMemoryCandidates(limit)
      set({
        generating: false,
        lastGeneratedAt: Date.now(),
        lastGeneratedCount: result.generatedCandidateCount,
        inspectedRunCount: result.inspectedRunCount,
      })
      await get().loadCandidates('pending')
    } catch (error) {
      set({ generating: false, error: getErrorMessage(error) })
    }
  },

  approveCandidate: async (id: string) => {
    set(state => ({ reviewingIds: addReviewingId(state.reviewingIds, id), error: null }))
    try {
      const { approveAgentMemoryCandidate } = await import('@/lib/agent/memory-candidates')
      await approveAgentMemoryCandidate(id)
      await get().loadCandidates('pending')
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
      set(state => ({ reviewingIds: removeReviewingId(state.reviewingIds, id) }))
    }
  },

  rejectCandidate: async (id: string, note?: string) => {
    set(state => ({ reviewingIds: addReviewingId(state.reviewingIds, id), error: null }))
    try {
      const { rejectAgentMemoryCandidate } = await import('@/lib/agent/memory-candidates')
      await rejectAgentMemoryCandidate(id, note)
      await get().loadCandidates('pending')
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
      set(state => ({ reviewingIds: removeReviewingId(state.reviewingIds, id) }))
    }
  },

  clearPendingCandidates: async () => {
    set({ clearing: true, error: null })
    try {
      const { clearPendingAgentMemoryCandidates } = await import('@/lib/agent/memory-candidates')
      const archivedCount = await clearPendingAgentMemoryCandidates()
      set({ candidates: [], clearing: false })
      return archivedCount
    } catch (error) {
      set({ clearing: false, error: getErrorMessage(error) })
      return 0
    }
  },

  clearError: () => set({ error: null }),
}))
