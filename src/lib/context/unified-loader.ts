import { contextLoader } from './loader'
import { loadWorkingMemory, formatWorkingMemoryForPrompt } from '@/lib/agent/working-memory'

export interface UnifiedContextOptions {
  activeFilePath?: string
  maxGraphRelations?: number
}

export interface UnifiedContextResult {
  prompt: string
  sections: {
    memories?: string
    workingMemory?: string
    graph?: string
  }
}

function trimBlock(value: string, maxChars: number) {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, maxChars).trim()}\n\n[context truncated: ${normalized.length - maxChars} chars omitted]`
}

async function buildGraphContext(filePath: string, maxGraphRelations: number) {
  try {
    const { getCrossValidatedRelations } = await import('@/lib/relation-engine')
    const relations = await getCrossValidatedRelations(filePath, 0.35)
    if (relations.length === 0) {
      return ''
    }

    const lines = relations.slice(0, maxGraphRelations).map((relation) => (
      `- ${relation.target_note} (${relation.relation_type}, score ${(relation.final_score * 100).toFixed(0)}%): ${relation.evidence || 'semantic relation'}`
    ))
    return `## Knowledge Graph Context\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

export class UnifiedContextLoader {
  async getContextForAgent(query: string, options: UnifiedContextOptions = {}): Promise<UnifiedContextResult> {
    const sections: UnifiedContextResult['sections'] = {}

    try {
      const memoryContext = await contextLoader.getContextForQuery(query)
      const memories = contextLoader.formatMemoriesForPrompt(memoryContext)
      if (memories.trim()) {
        sections.memories = trimBlock(memories, 6000)
      }
    } catch (error) {
      console.warn('[UnifiedContextLoader] Failed to load memories:', error)
    }

    try {
      const workingMemory = await loadWorkingMemory()
      const workingMemoryPrompt = formatWorkingMemoryForPrompt(workingMemory)
      if (workingMemoryPrompt.trim()) {
        sections.workingMemory = trimBlock(workingMemoryPrompt, 4000)
      }
    } catch (error) {
      console.warn('[UnifiedContextLoader] Failed to load working memory:', error)
    }

    if (options.activeFilePath) {
      const graph = await buildGraphContext(options.activeFilePath, options.maxGraphRelations || 8)
      if (graph.trim()) {
        sections.graph = trimBlock(graph, 5000)
      }
    }

    return {
      sections,
      prompt: [
        sections.memories,
        sections.workingMemory,
        sections.graph,
      ].filter(Boolean).join('\n\n'),
    }
  }
}

export const unifiedContextLoader = new UnifiedContextLoader()
