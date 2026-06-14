import { Tool } from '../types'
import { getToolRiskLevel, isDestructiveTool, isExecuteTool, getBaseToolName } from '../tool-policy'
import { noteTools } from './note-tools'
import { chatTools } from './chat-tools'
import { tagTools } from './tag-tools'
import { markTools } from './mark-tools'
import { folderTools } from './folder-tools'
import { systemTools } from './system-tools'
import { memoryTools } from './memory-tools'
import { editorTools } from './editor-tools'
import { diagramTools } from './diagram-tools'
import { safeTools } from './safe-tools'
import { flashcardTools } from './flashcard-tools'
import { activityTools } from './activity-tools'
import { favoriteTools } from './favorite-tools'
import { knowledgeGraphTools } from './knowledge-graph-tools'
import { agentMemoryTools } from './agent-memory-tools'
import { visualReportTools } from './visual-report-tools'
import { githubStarTools } from './github-star-tools'
import { githubTrendingTools } from './github-trending-tools'
import { reminderTools } from './reminder-tools'

export const allTools: Tool[] = [
  ...noteTools,
  ...chatTools,
  ...tagTools,
  ...markTools,
  ...folderTools,
  ...systemTools,
  ...memoryTools,
  ...activityTools,
  ...editorTools,
  ...diagramTools,
  ...flashcardTools,
  ...favoriteTools,
  ...knowledgeGraphTools,
  ...visualReportTools,
  ...agentMemoryTools,
  ...githubStarTools,
  ...githubTrendingTools,
  ...reminderTools,
  ...safeTools,
]

/**
 * Convert MCP tools to Agent tool format
 * @param serverId MCP server ID
 * @param tool MCP tool definition
 * @returns Agent tool
 */
function convertMcpToolToAgentTool(serverId: string, tool: any): Tool {
  // Parse parameters
  const parameters = Object.entries(tool.inputSchema?.properties || {}).map(([name, schema]: [string, any]) => ({
    name,
    type: mapJsonSchemaTypeToToolType(schema.type),
    description: schema.description || name,
    required: tool.inputSchema?.required?.includes(name) || false,
  }))

  // Enhance tool description to help AI better understand the tool's purpose
  const enhancedDescription = tool.description || tool.name
  const agentToolName = `${serverId}__${tool.name}`
  const risk = getToolRiskLevel(agentToolName, 'mcp')
  const baseName = getBaseToolName(agentToolName)
  const capabilities: Tool['capabilities'] = []

  if (risk === 'low') {
    capabilities.push('read')
  }
  if (risk !== 'low') {
    capabilities.push('write')
  }
  if (isDestructiveTool(agentToolName)) {
    capabilities.push('delete')
  }
  if (isExecuteTool(agentToolName)) {
    capabilities.push('execute')
  }
  if (/web|http|url|fetch|search|browser|request|api/i.test(`${baseName} ${enhancedDescription}`)) {
    capabilities.push('network')
  }

  return {
    name: agentToolName,
    description: enhancedDescription,
    parameters,
    requiresConfirmation: risk !== 'low',
    category: 'mcp',
    risk,
    capabilities,
    execute: async (params: Record<string, any>, context) => {
      try {
        if (context?.abortSignal?.aborted) {
          return {
            success: false,
            error: 'Tool execution cancelled before MCP call started.',
          }
        }

        const { callTool } = await import('@/lib/mcp/tools')
        const result = await callTool(serverId, tool.name, params)

        if (result.isError) {
          return {
            success: false,
            error: result.content.map((c: any) => c.text).join('\n'),
          }
        }

        return {
          success: true,
          data: result.content,
          message: result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * Map JSON Schema types to tool parameter types
 */
function mapJsonSchemaTypeToToolType(jsonType: string): Tool['parameters'][0]['type'] {
  const typeMap: Record<string, Tool['parameters'][0]['type']> = {
    string: 'string',
    number: 'number',
    integer: 'number',
    boolean: 'boolean',
    array: 'array',
    object: 'object',
  }
  return typeMap[jsonType] || 'string'
}

/**
 * Get all tools, including MCP tools (if there are selected servers)
 */
export function getAllTools(): Tool[] {
  const tools = [...allTools]

  // Dynamically add MCP tools
  // Note: due to circular dependency issues, cannot use import directly here
  // MCP tools will be added at runtime through dynamic loading
  // Return base tool list here
  return tools
}

// MCP tools cache — keyed by server+tool name for dedup
let mcpToolsCache: Tool[] = []
let mcpToolsLoaded = false
let mcpCacheKey = '' // tracks which servers are cached

function buildMcpCacheKey(serverIds: string[]): string {
  return serverIds.slice().sort().join(',')
}

/**
 * Get all tools, including MCP tools (async version)
 * This function is used for scenarios that need to load MCP tools.
 *
 * Optimizations (borrowed from claude-code-source patterns):
 * - Dedup by server+tool name to avoid duplicate registrations
 * - Cache invalidation only when server selection changes
 * - Filter out disconnected servers gracefully
 */
export async function getAllToolsAsync(): Promise<Tool[]> {
  const tools = [...allTools]

  try {
    const { useMcpStore } = await import('@/stores/mcp')
    const { mcpServerManager } = await import('@/lib/mcp/server-manager')

    const mcpStore = useMcpStore.getState()
    const currentKey = buildMcpCacheKey(mcpStore.selectedServerIds)

    // Return cached if server selection hasn't changed
    if (mcpToolsLoaded && mcpCacheKey === currentKey) {
      return [...tools, ...mcpToolsCache]
    }

    // Rebuild cache
    mcpToolsCache = []
    const seenNames = new Set<string>()

    for (const serverId of mcpStore.selectedServerIds) {
      let mcpTools: any[]
      try {
        mcpTools = mcpServerManager.getServerTools(serverId)
      } catch {
        // Server not connected — skip gracefully
        console.warn(`[Agent MCP] Server ${serverId} not available, skipping`)
        continue
      }

      for (const mcpTool of mcpTools) {
        const agentTool = convertMcpToolToAgentTool(serverId, mcpTool)
        // Dedup: if same tool name already registered, skip
        if (seenNames.has(agentTool.name)) {
          console.warn(`[Agent MCP] Duplicate tool name ${agentTool.name}, skipping`)
          continue
        }
        seenNames.add(agentTool.name)
        tools.push(agentTool)
        mcpToolsCache.push(agentTool)
      }
    }
    mcpToolsLoaded = true
    mcpCacheKey = currentKey
  } catch (error) {
    console.error('[Agent MCP] Failed to load MCP tools:', error)
  }

  return tools
}

/**
 * Get tools (including loaded MCP tools)
 */
export function getAllToolsSync(): Tool[] {
  if (mcpToolsLoaded) {
    return [...allTools, ...mcpToolsCache]
  }
  return allTools
}

/**
 * Reload MCP tools — invalidates cache and reloads
 */
export async function reloadMcpTools(): Promise<void> {
  mcpToolsCache = []
  mcpToolsLoaded = false
  mcpCacheKey = ''
  await getAllToolsAsync()
}

/**
 * Find tool by name — supports both exact match and MCP prefix patterns.
 * Borrowed from claude-code-source's toolMatchesName pattern.
 */
export function getToolByName(name: string): Tool | undefined {
  const tools = getAllToolsSync()
  // Exact match
  const exact = tools.find(tool => tool.name === name)
  if (exact) return exact

  // MCP tools: try matching without server prefix
  // e.g. "read_file" might match "server1__read_file"
  if (!name.includes('__')) {
    const mcpMatch = tools.find(tool => {
      const parts = tool.name.split('__')
      return parts.length === 2 && parts[1] === name
    })
    if (mcpMatch) return mcpMatch
  }

  return undefined
}

export function getToolsByCategory(category: Tool['category']): Tool[] {
  return allTools.filter(tool => tool.category === category)
}

export function getToolDescriptions(tools: Tool[] = getAllToolsSync()): string {
  return tools.map(tool => {
    const params = tool.parameters.map(p =>
      `  - ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`
    ).join('\n')

    return `### ${tool.name}
${tool.description}
Category: ${tool.category}
Risk: ${tool.risk || getToolRiskLevel(tool.name, tool.category)}
Capabilities: ${tool.capabilities?.join(', ') || 'unspecified'}
Requires Confirmation: ${tool.requiresConfirmation ? 'Yes' : 'No'}
Parameters:
${params || '  None'}
`
  }).join('\n\n')
}

export * from './note-tools'
export * from './chat-tools'
export * from './tag-tools'
export * from './mark-tools'
export * from './folder-tools'
export * from './system-tools'
export * from './memory-tools'
export * from './editor-tools'
export * from './diagram-tools'
export * from './safe-tools'
export * from './flashcard-tools'
export * from './activity-tools'
export * from './agent-memory-tools'
export * from './visual-report-tools'
export * from './github-star-tools'
export * from './github-trending-tools'
export * from './reminder-tools'
