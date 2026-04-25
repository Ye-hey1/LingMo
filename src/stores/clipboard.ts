import { create } from 'zustand'

interface ClipboardItem {
  path: string
  name: string
  isDirectory: boolean
  sha?: string
  isLocale?: boolean
}

type ClipboardOperation = 'copy' | 'cut' | 'none'

interface ClipboardState {
  clipboardItem: ClipboardItem | null
  clipboardOperation: ClipboardOperation
  setClipboardItem: (item: ClipboardItem | null, operation: ClipboardOperation) => void
}

const useClipboardStore = create<ClipboardState>((set) => ({
  clipboardItem: null,
  clipboardOperation: 'none',
  setClipboardItem: (item, operation) => set({ clipboardItem: item, clipboardOperation: operation }),
}))

export default useClipboardStore
