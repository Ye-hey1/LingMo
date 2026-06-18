import type { Tool, ToolResult } from '../types'

type SearchableTool = Pick<Tool, 'name' | 'description' | 'category' | 'parameters' | 'requiresConfirmation' | 'risk' | 'capabilities'>

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function baseToolName(name: string): string {
  return name.includes('__') ? name.split('__').pop() || name : name
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function tokenize(input: string): string[] {
  return uniqueStrings(
    input
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_/-]+/gu, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2)
  )
}

function toolSearchText(tool: SearchableTool): string {
  return [
    tool.name,
    baseToolName(tool.name),
    tool.description,
    tool.category,
    tool.risk,
    tool.capabilities?.join(' '),
    tool.parameters.map(param => `${param.name} ${param.type} ${param.description}`).join(' '),
  ].filter(Boolean).join(' ').toLowerCase()
}

function scoreTool(tool: SearchableTool, query: string, queryTokens: string[]): { score: number; matched: string[] } {
  const name = tool.name.toLowerCase()
  const baseName = baseToolName(tool.name).toLowerCase()
  const description = tool.description.toLowerCase()
  const category = tool.category.toLowerCase()
  const text = toolSearchText(tool)
  const normalizedQuery = query.trim().toLowerCase()
  const matched: string[] = []
  let score = 0

  if (normalizedQuery && text.includes(normalizedQuery)) {
    score += 18
    matched.push(normalizedQuery)
  }

  for (const token of queryTokens) {
    if (name === token || baseName === token) {
      score += 30
      matched.push(token)
      continue
    }

    if (name.includes(token) || baseName.includes(token)) {
      score += 18
      matched.push(token)
      continue
    }

    if (category.includes(token)) {
      score += 8
      matched.push(token)
      continue
    }

    if (description.includes(token)) {
      score += 7
      matched.push(token)
      continue
    }

    if (text.includes(token)) {
      score += 4
      matched.push(token)
    }
  }

  if (score > 0 && tool.risk === 'low') score += 2
  if (score > 0 && tool.capabilities?.includes('read')) score += 1

  return { score, matched: uniqueStrings(matched).slice(0, 6) }
}

function formatToolResult(tool: SearchableTool, score: number, matched: string[]) {
  return {
    name: tool.name,
    baseName: baseToolName(tool.name),
    category: tool.category,
    description: tool.description,
    risk: tool.risk || 'unspecified',
    capabilities: tool.capabilities || [],
    requiresConfirmation: tool.requiresConfirmation,
    score,
    matched,
    parameters: tool.parameters.map(param => ({
      name: param.name,
      type: param.type,
      required: param.required,
      description: param.description,
      default: param.default,
    })),
  }
}

export const toolSearchTools: Tool[] = [
  {
    name: 'tool_search',
    description: 'Search the Agent tool registry by capability, name, category, and parameter text. Use this when you are unsure which tool can perform a needed action.',
    category: 'system',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Capability or tool keyword to search for, such as "web search", "read file", "git diff", or "diagram".',
        required: true,
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum results to return. Default 8, max 20.',
        required: false,
        default: 8,
      },
      {
        name: 'category',
        type: 'string',
        description: 'Optional category filter, for example filesystem, web, mcp, editor, system, note, search.',
        required: false,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        context?.abortSignal?.throwIfAborted()
        const query = typeof params.query === 'string' ? params.query.trim() : ''
        if (!query) {
          return {
            success: false,
            error: 'query is required',
          }
        }

        const maxResults = clampNumber(params.maxResults, 8, 1, 20)
        const category = typeof params.category === 'string' ? params.category.trim().toLowerCase() : ''
        const { getAllToolsSync } = await import('./index')
        const allTools = getAllToolsSync()
        const queryTokens = tokenize(query)
        const scored = allTools
          .filter(tool => !category || tool.category.toLowerCase() === category)
          .map(tool => ({
            tool,
            ...scoreTool(tool, query, queryTokens),
          }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))

        const results = scored
          .slice(0, maxResults)
          .map(item => formatToolResult(item.tool, item.score, item.matched))

        const lines = results.length
          ? results.map((tool, index) => `${index + 1}. ${tool.name} (${tool.category}, ${tool.risk}) - ${tool.description}`)
          : ['No matching tools found.']

        return {
          success: true,
          data: {
            query,
            category: category || undefined,
            totalToolCount: allTools.length,
            matchedCount: scored.length,
            returnedCount: results.length,
            results,
          },
          message: [
            `Found ${scored.length} matching tool(s) for "${query}".`,
            ...lines,
          ].join('\n'),
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to search tools: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
]
