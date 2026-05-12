import { create } from 'zustand'
import { Memory, getAllMemories, deleteMemory as deleteMemoryDb, upsertMemory, getMemoryStats, updateMemory as updateMemoryDb } from '@/db/memories'
import { fetchEmbedding } from '@/lib/ai/embedding'

interface MemoriesState {
  memories: Memory[]
  loading: boolean
  stats: {
    total: number
    preferences: number
    memories: number
    totalAccessCount: number
  } | null

  // Actions
  loadMemories: () => Promise<void>
  loadStats: () => Promise<void>
  addMemory: (content: string, category?: 'preference' | 'memory') => Promise<{ id: string; replaced: boolean }>
  updateMemory: (id: string, content: string, category: 'preference' | 'memory') => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  clearAllMemories: () => Promise<void>
}

async function clearMemoryContextCache() {
  try {
    const { contextLoader } = await import('@/lib/context/loader')
    contextLoader.clearCache()
  } catch (error) {
    console.error('Failed to clear memory context cache:', error)
  }
}

const useMemoriesStore = create<MemoriesState>((set, get) => ({
  memories: [],
  loading: false,
  stats: null,

  loadMemories: async () => {
    set({ loading: true })
    try {
      const memories = await getAllMemories()
      set({ memories, loading: false })
    } catch (error) {
      console.error('Failed to load memories:', error)
      set({ loading: false })
    }
  },

  loadStats: async () => {
    try {
      const stats = await getMemoryStats()
      set({ stats })
    } catch (error) {
      console.error('Failed to load memory stats:', error)
    }
  },

  addMemory: async (content, category) => {
    const embedding = await fetchEmbedding(content)
    if (!embedding) {
      throw new Error('无法生成向量嵌入，请检查嵌入模型配置')
    }

    const result = await upsertMemory({
      content,
      embedding: JSON.stringify(embedding),
      category,
    })

    // Reload memories and stats
    await clearMemoryContextCache()
    await get().loadMemories()
    await get().loadStats()

    return result
  },

  updateMemory: async (id, content, category) => {
    await updateMemoryDb(id, { content, category })
    await clearMemoryContextCache()
    await get().loadMemories()
    await get().loadStats()
  },

  deleteMemory: async (id) => {
    await deleteMemoryDb(id)
    await clearMemoryContextCache()
    await get().loadMemories()
    await get().loadStats()
  },

  clearAllMemories: async () => {
    const { clearAllMemories: clearDb } = await import('@/db/memories')
    await clearDb()
    await clearMemoryContextCache()
    await get().loadMemories()
    await get().loadStats()
  },
}))

export default useMemoriesStore
