export const MEMORY_TAB_ID = 'workspace-memory-manager'
export const MEMORY_TAB_PATH = 'note-gen://memory-manager'
export const MEMORY_TAB_NAME = '记忆'

export function isMemoryTabPath(path: string) {
  return path === MEMORY_TAB_PATH
}
