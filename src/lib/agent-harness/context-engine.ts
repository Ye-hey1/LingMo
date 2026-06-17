import { estimateTokens } from '@/lib/ai/token-counter'
import type { ContextItem, ContextLayerId, ContextLayerUsage, ContextPack, VfsRef } from './types'

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
  const normalizedItems = input.items.map(item => ({
    ...item,
    layer: item.layer || inferContextLayer(item),
    tokenEstimate: item.tokenEstimate || estimateTokens(item.content),
  }))
  const included: ContextItem[] = []
  const deferred: VfsRef[] = [...(input.deferred || [])]
  const warnings: string[] = []
  const budgets = buildLayerBudgets(input.tokenBudget)
  const layers = buildInitialLayerUsage(budgets)
  const deferredCandidates: ContextItem[] = []

  for (const layerId of CONTEXT_LAYER_ORDER) {
    const layerItems = normalizedItems
      .filter(item => item.layer === layerId)
      .sort((a, b) => b.priority - a.priority)
    const usage = layers.get(layerId)
    if (!usage) continue

    for (const item of layerItems) {
      if (usage.tokenUsed + item.tokenEstimate > usage.tokenBudget) {
        usage.droppedItemIds.push(item.id)
        deferredCandidates.push(item)
        const ref = vfsRefFromContextItem(input.runId, item)
        if (ref) usage.deferredRefs.push(ref)
        continue
      }
      included.push(item)
      usage.includedItemIds.push(item.id)
      usage.tokenUsed += item.tokenEstimate
    }
  }

  const includedIds = new Set(included.map(item => item.id))
  const used = () => included.reduce((sum, item) => sum + item.tokenEstimate, 0)
  for (const item of deferredCandidates.sort((a, b) => b.priority - a.priority)) {
    if (includedIds.has(item.id)) continue
    if (used() + item.tokenEstimate > input.tokenBudget) {
      const ref = vfsRefFromContextItem(input.runId, item)
      if (ref) deferred.push(ref)
      continue
    }

    const layer = layers.get(item.layer || 'other')
    included.push(item)
    includedIds.add(item.id)
    if (layer) {
      layer.includedItemIds.push(item.id)
      layer.tokenUsed += item.tokenEstimate
      layer.droppedItemIds = layer.droppedItemIds.filter(id => id !== item.id)
      layer.deferredRefs = layer.deferredRefs.filter(ref => ref.uri !== item.ref)
    }
  }

  for (const layer of layers.values()) {
    for (const itemId of layer.droppedItemIds) {
      warnings.push(`Deferred context item ${itemId} from ${layer.id} due to layer token budget`)
    }
  }

  return {
    runId: input.runId,
    tokenBudget: input.tokenBudget,
    included,
    deferred: dedupeDeferredRefs(deferred),
    layers: CONTEXT_LAYER_ORDER
      .map(layerId => layers.get(layerId))
      .filter((layer): layer is ContextLayerUsage => Boolean(layer)),
    warnings,
    checksum: checksum(JSON.stringify(included.map(item => [item.id, item.layer, item.ref, item.content]))),
  }
}

const CONTEXT_LAYER_ORDER: ContextLayerId[] = [
  'core',
  'current-note',
  'linked-files',
  'rag',
  'history',
  'skill',
  'tool-observation',
  'other',
]

const CONTEXT_LAYER_META: Record<ContextLayerId, { label: string; weight: number }> = {
  core: { label: '核心指令', weight: 22 },
  'current-note': { label: '当前笔记', weight: 20 },
  'linked-files': { label: '关联文件', weight: 18 },
  rag: { label: 'RAG 命中', weight: 14 },
  history: { label: '历史摘要', weight: 10 },
  skill: { label: '技能内容', weight: 8 },
  'tool-observation': { label: '工具观察', weight: 5 },
  other: { label: '其他上下文', weight: 3 },
}

function inferContextLayer(item: ContextItem): ContextLayerId {
  if (item.source === 'user') return 'core'
  if (item.source === 'quote') return 'current-note'
  if (item.source === 'file') return 'linked-files'
  if (item.source === 'skill') return 'skill'
  if (item.source === 'memory' || item.source === 'history') return 'history'
  if (item.source === 'tool') return 'tool-observation'
  return 'other'
}

function buildLayerBudgets(tokenBudget: number): Record<ContextLayerId, number> {
  const totalWeight = CONTEXT_LAYER_ORDER.reduce((sum, layerId) => sum + CONTEXT_LAYER_META[layerId].weight, 0)
  const budgets = {} as Record<ContextLayerId, number>
  let allocated = 0

  for (const layerId of CONTEXT_LAYER_ORDER) {
    const budget = Math.floor(tokenBudget * CONTEXT_LAYER_META[layerId].weight / totalWeight)
    budgets[layerId] = budget
    allocated += budget
  }

  budgets.core += Math.max(0, tokenBudget - allocated)
  return budgets
}

function buildInitialLayerUsage(budgets: Record<ContextLayerId, number>) {
  return new Map<ContextLayerId, ContextLayerUsage>(
    CONTEXT_LAYER_ORDER.map(layerId => [layerId, {
      id: layerId,
      label: CONTEXT_LAYER_META[layerId].label,
      tokenBudget: budgets[layerId],
      tokenUsed: 0,
      includedItemIds: [],
      deferredRefs: [],
      droppedItemIds: [],
    }]),
  )
}

function vfsRefFromContextItem(runId: string, item: ContextItem): VfsRef | null {
  if (!item.ref?.startsWith(`agent://${runId}/`)) return null
  const marker = `agent://${runId}/`
  const path = item.ref.slice(marker.length)
  return {
    uri: item.ref as VfsRef['uri'],
    runId,
    path,
    kind: 'context',
    summary: `Deferred context item ${item.id}`,
  }
}

function dedupeDeferredRefs(refs: VfsRef[]) {
  const seen = new Set<string>()
  return refs.filter(ref => {
    if (seen.has(ref.uri)) return false
    seen.add(ref.uri)
    return true
  })
}
