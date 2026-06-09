import { estimateTokens } from '@/lib/ai/token-counter'
import type { ContextItem, ContextPack, VfsRef } from './types'

function checksum(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

export function buildContextPack(input: {
  runId: string
  tokenBudget: number
  items: ContextItem[]
  deferred?: VfsRef[]
}): ContextPack {
  const sorted = [...input.items].sort((a, b) => b.priority - a.priority)
  const included: ContextItem[] = []
  const deferred: VfsRef[] = [...(input.deferred || [])]
  let used = 0
  const warnings: string[] = []

  for (const item of sorted) {
    const tokens = item.tokenEstimate || estimateTokens(item.content)
    if (used + tokens > input.tokenBudget) {
      warnings.push(`Deferred context item ${item.id} due to token budget`)
      continue
    }
    included.push({ ...item, tokenEstimate: tokens })
    used += tokens
  }

  return {
    runId: input.runId,
    tokenBudget: input.tokenBudget,
    included,
    deferred,
    warnings,
    checksum: checksum(JSON.stringify(included.map(item => [item.id, item.ref, item.content]))),
  }
}
