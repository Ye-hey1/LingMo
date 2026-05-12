import { create } from 'zustand'
import {
  KNOWLEDGE_GRAPH_TAG_GROUPS_STORAGE_KEY,
  createGraphTagGroup,
  type GraphTagGroup,
} from '@/lib/knowledge-graph-tags'

interface KnowledgeGraphTagsState {
  initialized: boolean
  tagGroups: GraphTagGroup[]
  initTagGroups: () => void
  addTagGroup: (name: string, query: string) => GraphTagGroup | null
  updateTagGroup: (id: string, patch: Partial<Pick<GraphTagGroup, 'name' | 'query'>>) => void
  removeTagGroup: (id: string) => void
}

async function persistTagGroups(tagGroups: GraphTagGroup[]) {
  // 同时保存到 localStorage（兼容）和 Tauri Store（跨设备同步）
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(KNOWLEDGE_GRAPH_TAG_GROUPS_STORAGE_KEY, JSON.stringify(tagGroups))
  }
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('store.json')
    await store.set('knowledgeGraph.tagGroups', tagGroups)
    await (store as any).save?.()
  } catch {
    // Tauri Store 不可用时静默降级到 localStorage
  }
}

async function readTagGroups(): Promise<GraphTagGroup[]> {
  // 优先从 Tauri Store 读取（跨设备同步）
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('store.json')
    const groups = await store.get<GraphTagGroup[]>('knowledgeGraph.tagGroups')
    if (Array.isArray(groups) && groups.length > 0) {
      return groups.filter(group => group?.id && group?.name)
    }
  } catch {
    // Tauri Store 不可用
  }

  // 退回到 localStorage
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KNOWLEDGE_GRAPH_TAG_GROUPS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as GraphTagGroup[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(group => group?.id && group?.name)
  } catch {
    return []
  }
}

export const useKnowledgeGraphTagsStore = create<KnowledgeGraphTagsState>((set, get) => ({
  initialized: false,
  tagGroups: [],

  initTagGroups: () => {
    if (get().initialized) return
    // 异步加载（支持 Tauri Store）
    readTagGroups().then(groups => {
      set({ initialized: true, tagGroups: groups })
    }).catch(() => {
      set({ initialized: true, tagGroups: [] })
    })
  },

  addTagGroup: (name, query) => {
    const group = createGraphTagGroup(name, query)
    if (!group) return null

    const next = [...get().tagGroups, group]
    set({ tagGroups: next })
    persistTagGroups(next)
    return group
  },

  updateTagGroup: (id, patch) => {
    const next = get().tagGroups.map(group => (
      group.id === id
        ? {
            ...group,
            ...patch,
            name: patch.name !== undefined ? patch.name.trim() || group.name : group.name,
            query: patch.query !== undefined ? patch.query.trim() : group.query,
          }
        : group
    ))
    set({ tagGroups: next })
    persistTagGroups(next)
  },

  removeTagGroup: (id) => {
    const next = get().tagGroups.filter(group => group.id !== id)
    set({ tagGroups: next })
    persistTagGroups(next)
  },
}))

export type { GraphTagGroup }
