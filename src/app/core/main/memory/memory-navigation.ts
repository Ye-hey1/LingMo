import type { LlmMemoryPlatform } from '@/lib/llm-memory/api'
import emitter from '@/lib/emitter'

export interface MemorySessionTarget {
  platform: LlmMemoryPlatform
  sessionKey: string
}

let pendingMemorySessionTarget: MemorySessionTarget | null = null

export function requestOpenMemorySession(target: MemorySessionTarget) {
  pendingMemorySessionTarget = target
  emitter.emit('memory-open-session', target)
}

export function consumePendingMemorySessionTarget() {
  const target = pendingMemorySessionTarget
  pendingMemorySessionTarget = null
  return target
}
