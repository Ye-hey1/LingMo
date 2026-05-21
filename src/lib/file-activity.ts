import { stat } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { getFilePathOptions } from '@/lib/workspace'

export type FileActivityType = 'created' | 'modified' | 'manual-edit' | 'ai-edit' | 'sync' | 'restore' | 'export'

export interface FileActivityEvent {
  id: string
  path: string
  type: FileActivityType
  title: string
  description?: string
  timestamp: number
}

export interface FileSystemMetadata {
  createdAt?: number
  modifiedAt?: number
  size?: number
  readonly?: boolean
}

const STORE_FILE = 'file-activity.json'
const STORE_KEY = 'events'
const MAX_EVENTS = 500

export function formatFileActivityTime(value?: number) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export async function getFileSystemMetadata(filePath: string): Promise<FileSystemMetadata | null> {
  try {
    const pathOptions = await getFilePathOptions(filePath)
    const metadata = pathOptions.baseDir
      ? await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
      : await stat(pathOptions.path)

    return {
      createdAt: metadata.birthtime?.getTime(),
      modifiedAt: metadata.mtime?.getTime(),
      size: metadata.size,
      readonly: metadata.readonly,
    }
  } catch {
    return null
  }
}

export async function recordFileActivity(event: Omit<FileActivityEvent, 'id' | 'timestamp'> & { timestamp?: number }) {
  try {
    const store = await Store.load(STORE_FILE)
    const existing = await store.get<FileActivityEvent[]>(STORE_KEY) || []
    const next: FileActivityEvent = {
      ...event,
      id: `file-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: event.timestamp ?? Date.now(),
    }
    await store.set(STORE_KEY, [next, ...existing].slice(0, MAX_EVENTS))
    await (store as Store & { save?: () => Promise<void> }).save?.()
  } catch (error) {
    console.warn('[file-activity] Failed to record event:', error)
  }
}

export async function listStoredFileActivities(filePath: string, limit = 50): Promise<FileActivityEvent[]> {
  try {
    const store = await Store.load(STORE_FILE)
    const existing = await store.get<FileActivityEvent[]>(STORE_KEY) || []
    return existing
      .filter(event => event.path === filePath)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  } catch {
    return []
  }
}
