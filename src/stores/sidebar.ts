import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

type SidebarTab = 'files' | 'notes' | 'favorites'

const STORE_PATH = 'store.json'
const STORAGE_KEYS = {
  fileSidebarVisible: 'fileSidebarVisible',
  noteSidebarVisible: 'noteSidebarVisible',
  leftSidebarVisible: 'leftSidebarVisible',
  centerPanelVisible: 'centerPanelVisible',
  rightSidebarVisible: 'rightSidebarVisible',
  leftSidebarTab: 'leftSidebarTab',
} as const

async function persistValue<T>(key: string, value: T) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(key, String(value))
  }

  const store = await Store.load(STORE_PATH)
  await store.set(key, value)
  await store.save()
}

async function readValue<T>(key: string) {
  const store = await Store.load(STORE_PATH)
  return await store.get<T>(key)
}

function readInitialSidebarVisibility() {
  if (typeof window === 'undefined') {
    return { left: true, center: true, right: true }
  }

  return {
    left: localStorage.getItem(STORAGE_KEYS.leftSidebarVisible) !== 'false',
    center: localStorage.getItem(STORAGE_KEYS.centerPanelVisible) !== 'false',
    right: localStorage.getItem(STORAGE_KEYS.rightSidebarVisible) !== 'false',
  }
}

export interface SidebarState {
  fileSidebarVisible: boolean
  toggleFileSidebar: () => Promise<void>
  showFileSidebar: () => Promise<void>
  noteSidebarVisible: boolean
  toggleNoteSidebar: () => Promise<void>
  showNoteSidebar: () => Promise<void>
  leftSidebarVisible: boolean
  toggleLeftSidebar: () => Promise<void>
  centerPanelVisible: boolean
  toggleCenterPanel: () => Promise<void>
  rightSidebarVisible: boolean
  toggleRightSidebar: () => Promise<void>
  leftSidebarTab: SidebarTab
  setLeftSidebarTab: (tab: SidebarTab) => Promise<void>
  initSidebarState: () => Promise<void>
}

const initialState = readInitialSidebarVisibility()

export const useSidebarStore = create<SidebarState>((set, get) => ({
  fileSidebarVisible: true,
  toggleFileSidebar: async () => {
    const nextValue = !get().fileSidebarVisible
    set({ fileSidebarVisible: nextValue })
    await persistValue(STORAGE_KEYS.fileSidebarVisible, nextValue)
  },
  showFileSidebar: async () => {
    set({ fileSidebarVisible: true })
    await persistValue(STORAGE_KEYS.fileSidebarVisible, true)
  },
  noteSidebarVisible: true,
  toggleNoteSidebar: async () => {
    const nextValue = !get().noteSidebarVisible
    set({ noteSidebarVisible: nextValue })
    await persistValue(STORAGE_KEYS.noteSidebarVisible, nextValue)
  },
  showNoteSidebar: async () => {
    set({ noteSidebarVisible: true })
    await persistValue(STORAGE_KEYS.noteSidebarVisible, true)
  },
  leftSidebarVisible: initialState.left,
  toggleLeftSidebar: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length

    if (leftSidebarVisible && visibleCount === 1) {
      return
    }

    const nextValue = !leftSidebarVisible
    set({ leftSidebarVisible: nextValue })
    await persistValue(STORAGE_KEYS.leftSidebarVisible, nextValue)
  },
  centerPanelVisible: initialState.center,
  toggleCenterPanel: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length

    if (centerPanelVisible && visibleCount === 1) {
      return
    }

    if (centerPanelVisible && visibleCount === 2 && leftSidebarVisible && !rightSidebarVisible) {
      return
    }

    const nextValue = !centerPanelVisible
    set({ centerPanelVisible: nextValue })
    await persistValue(STORAGE_KEYS.centerPanelVisible, nextValue)
  },
  rightSidebarVisible: initialState.right,
  toggleRightSidebar: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length

    if (rightSidebarVisible && visibleCount === 1) {
      return
    }

    if (rightSidebarVisible && visibleCount === 2 && leftSidebarVisible && !centerPanelVisible) {
      return
    }

    const nextValue = !rightSidebarVisible
    set({ rightSidebarVisible: nextValue })
    await persistValue(STORAGE_KEYS.rightSidebarVisible, nextValue)
  },
  leftSidebarTab: 'files',
  setLeftSidebarTab: async (tab: SidebarTab) => {
    set({ leftSidebarTab: tab })
    await persistValue(STORAGE_KEYS.leftSidebarTab, tab)
  },
  initSidebarState: async () => {
    const [leftState, centerState, rightState, leftTab] = await Promise.all([
      readValue<boolean>(STORAGE_KEYS.leftSidebarVisible),
      readValue<boolean>(STORAGE_KEYS.centerPanelVisible),
      readValue<boolean>(STORAGE_KEYS.rightSidebarVisible),
      readValue<SidebarTab>(STORAGE_KEYS.leftSidebarTab),
    ])

    if (leftState !== null && leftState !== undefined) {
      set({ leftSidebarVisible: leftState })
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEYS.leftSidebarVisible, String(leftState))
    }
    if (centerState !== null && centerState !== undefined) {
      set({ centerPanelVisible: centerState })
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEYS.centerPanelVisible, String(centerState))
    }
    if (rightState !== null && rightState !== undefined) {
      set({ rightSidebarVisible: rightState })
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEYS.rightSidebarVisible, String(rightState))
    }
    if (leftTab) {
      set({ leftSidebarTab: leftTab })
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEYS.leftSidebarTab, leftTab)
    }
  },
}))
