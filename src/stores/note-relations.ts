import { create } from 'zustand'
import {
  getRelationsForNote,
  getAllRelations,
  getRelationCount,
  type NoteRelation,
} from '@/db/note-relations'
import {
  getCrossValidatedRelations,
  type CrossValidatedRelation,
} from '@/lib/relation-engine'

interface NoteRelationsState {
  // 当前活动笔记的关系
  activeNoteRelations: CrossValidatedRelation[]
  isLoading: boolean
  isComputing: boolean
  lastComputedAt: number | null

  // 关系统计
  relationCounts: { method: string; count: number }[]

  // 操作
  loadRelationsForNote: (filename: string) => Promise<void>
  loadAllRelationCounts: () => Promise<void>
  triggerFullComputation: (
    onProgress?: (progress: { phase: string; current: number; total: number }) => void,
    includeLLM?: boolean,
  ) => Promise<void>
}

export const useNoteRelationsStore = create<NoteRelationsState>((set, get) => ({
  activeNoteRelations: [],
  isLoading: false,
  isComputing: false,
  lastComputedAt: null,
  relationCounts: [],

  loadRelationsForNote: async (filename: string) => {
    set({ isLoading: true })
    try {
      const relations = await getCrossValidatedRelations(filename)
      set({ activeNoteRelations: relations, isLoading: false })
    } catch (error) {
      console.error('[NoteRelations] Failed to load relations:', error)
      set({ activeNoteRelations: [], isLoading: false })
    }
  },

  loadAllRelationCounts: async () => {
    try {
      const counts = await getRelationCount()
      set({ relationCounts: counts })
    } catch (error) {
      console.error('[NoteRelations] Failed to load counts:', error)
    }
  },

  triggerFullComputation: async (onProgress, includeLLM = false) => {
    if (get().isComputing) return

    set({ isComputing: true })
    try {
      const { buildAllRelations } = await import('@/lib/relation-engine')
      const result = await buildAllRelations(onProgress, includeLLM)

      set({
        isComputing: false,
        lastComputedAt: Date.now(),
      })

      // 刷新统计
      await get().loadAllRelationCounts()

      return
    } catch (error) {
      console.error('[NoteRelations] Full computation failed:', error)
      set({ isComputing: false })
    }
  },
}))
